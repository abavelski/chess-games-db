import { PgnParser, makePgn, startingPosition } from 'chessops/pgn';
import { parseSan, makeSanAndPlay } from 'chessops/san';
import { scalachessCharPair } from 'chessops/compat';

function parse(pgn) {
  let result;
  new PgnParser((game, error) => {
    if (error) throw new Error('This PGN is too complex to display completely. The original PGN is available below.');
    result ??= game;
  }).parse(pgn);
  if (!result) throw new Error('No game was found in this PGN.');
  return result;
}

function restoreComment(comment) {
  // cbtext is the lossless UTF-8 backup of text whose braces were escaped by
  // the importer. Prefer it to the escaped copy rather than displaying both.
  const backup = /\[%cbtext\s+([A-Za-z0-9+/=]+)\]/.exec(comment);
  if (backup) {
    try {
      comment = new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(backup[1]), c => c.charCodeAt(0)));
    } catch { /* Keep the readable fallback when a backup is damaged. */ }
  }
  return comment;
}

export function commentText(comment, keepBoardAnnotations = false) {
  return restoreComment(comment).replace(/\[%([\w]+)(?::[\w-]+)?(?:\s+([^\]]*))?\]/g, (tag, kind, payload = '') => {
    const value = payload.trim();
    switch (kind.toLowerCase()) {
      case 'pre': case 'post': return value;
      case 'cal': case 'csl': return keepBoardAnnotations ? tag.replace(/\s*,\s*/g, ',') : '';
      case 'cbtext': case 't': case 'varcolor': case 'anno': return '';
      case 'clk': return keepBoardAnnotations ? tag : `Clock: ${value}`;
      case 'emt': return keepBoardAnnotations ? tag : `Time spent: ${value}`;
      case 'eval': return `Evaluation: ${value}`;
      case 'crit': return `Critical position${value ? ' · ' + value : ''}. `;
      case 'medal': return `Award${value ? ' · ' + value : ''}. `;
      case 'train': return 'Training exercise. ';
      case 'video': return 'Video annotation. ';
      case 'pawnstruct': return 'Pawn structure. ';
      case 'path': return `Piece route: ${value}. `;
      case 'tc': return `Time limit: ${value}. `;
      case 'quote': {
        const white = /\bwhite="([^"]*)"/.exec(value)?.[1];
        const black = /\bblack="([^"]*)"/.exec(value)?.[1];
        return white || black ? `Quoted game: ${[white, black].filter(Boolean).join(' — ')}. ` : '';
      }
      default: return `${kind}: ${value}`;
    }
  }).replace(/\r\n?/g, '\n').trim();
}

function displayPgn(game) {
  const clean = comments => comments?.map(comment => commentText(comment, true));
  // Work on a parsed copy only; the original PGN and archive are never changed.
  game.comments = clean(game.comments);
  const stack = [...game.moves.children];
  while (stack.length) {
    const node = stack.pop();
    node.data.comments = clean(node.data.comments);
    node.data.startingComments = clean(node.data.startingComments);
    stack.push(...node.children);
  }
  return makePgn(game);
}

export const prepareDisplayPgn = pgn => displayPgn(parse(pgn));

export function reviewPgn(pgn) {
  const game = parse(pgn);
  const tokens = [];
  let position = null;
  let positionError = null;
  try { position = startingPosition(game.headers).unwrap(); }
  catch { positionError = 'The starting position is invalid. You can still read the complete score and commentary.'; }
  const comments = (list, depth) => {
    for (const comment of list || []) {
      const text = commentText(comment);
      if (text) tokens.push({ type: 'comment', text, depth });
    }
  };
  comments(game.comments, 0);
  const tasks = game.moves.children.length ? [{ type: 'line', node: game.moves.children[0],
    alternatives: game.moves.children.slice(1), position, path: '', ply: position ? (position.fullmoves - 1) * 2 + (position.turn === 'black' ? 1 : 0) : 0, depth: 0 }] : [];
  while (tasks.length) {
    const task = tasks.pop();
    if (task.type !== 'line') { tokens.push(task); continue; }
    const { node, depth, path, ply } = task;
    const nextPosition = task.position?.clone();
    const move = nextPosition && parseSan(nextPosition, node.data.san);
    let nextPath = null;
    let san = node.data.san;
    if (move) {
      nextPath = path + scalachessCharPair(move);
      san = makeSanAndPlay(nextPosition, move);
    }
    const critical = [];
    const extractCritical = comment => restoreComment(comment).replace(
      /\[%crit\s+(opening|middlegame|endgame)\s*\]/gi,
      (_tag, phase) => {
        phase = phase.toLowerCase();
        if (!critical.includes(phase)) critical.push(phase);
        return '';
      },
    );
    comments(node.data.startingComments?.map(extractCritical), depth);
    const evaluations = [];
    const after = (node.data.comments || []).map(comment => extractCritical(comment).replace(
      /\[%eval\s+([+-]?(?:\d+(?:\.\d+)?|#-?\d+))(?:\s*[,/]\s*(\d+))?\s*\]/gi,
      (_tag, value, searchDepth) => {
        const number = Number(value);
        const score = value.includes('#') ? value : (number > 0 ? '+' : '') + number.toFixed(2);
        evaluations.push({ value: score, depth: searchDepth === undefined ? undefined : Number(searchDepth) });
        return '';
      },
    ));
    tokens.push({ type: 'move', san, path: nextPath, ply: ply + 1, nags: node.data.nags || [], depth,
      evaluations, critical,
      annotated: /\[%(?:cal|csl)\s/.test([...(node.data.startingComments || []), ...(node.data.comments || [])].join(' ')) });
    comments(after, depth);
    if (node.children.length) tasks.push({ type: 'line', node: node.children[0], alternatives: node.children.slice(1),
      position: move ? nextPosition : null, path: nextPath, ply: ply + 1, depth });
    for (let i = task.alternatives.length - 1; i >= 0; i--) {
      tasks.push({ type: 'variation-end', depth: depth + 1 });
      tasks.push({ type: 'line', node: task.alternatives[i], alternatives: [], position: task.position, path, ply, depth: depth + 1 });
      tasks.push({ type: 'variation-start', depth: depth + 1 });
    }
  }
  return { tokens, headers: [...game.headers], displayPgn: displayPgn(game), positionError };
}
