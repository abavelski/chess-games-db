import { normalizeMove } from 'chessops/chess';
import { PgnParser, makePgn, startingPosition, ChildNode } from 'chessops/pgn';
import { parseSan, makeSanAndPlay } from 'chessops/san';
import { parseUci, makeUci } from 'chessops/util';
import { scalachessCharPair } from 'chessops/compat';

export const emptyPersonal = () => ({ lines: [], comments: [] });

// Store complete UCI histories so branches and comments have stable identities.
export function personalPath(initial, moves) {
  const position = initial.clone();
  let path = '';
  for (const uci of moves) {
    const parsed = parseUci(uci);
    const move = parsed && normalizeMove(position, parsed);
    if (!move || !position.isLegal(move)) throw new Error('Illegal personal move: ' + uci);
    path += scalachessCharPair(move);
    position.play(move);
  }
  return path;
}

export function mergePersonal(pgn, personal = emptyPersonal()) {
  const ownPaths = new Set();
  if (!personal.lines.length && !personal.comments.length) return { pgn, ownPaths, comments: new Map() };
  let game;
  new PgnParser((parsed, error) => {
    if (error) throw new Error('This PGN is too complex to extend completely.');
    game ??= parsed;
  }).parse(pgn);
  if (!game) throw new Error('No game found.');
  const initial = startingPosition(game.headers).unwrap();
  for (const moves of personal.lines) {
    const position = initial.clone();
    let node = game.moves, path = '';
    for (const uci of moves) {
      const parsed = parseUci(uci);
      const move = parsed && normalizeMove(position, parsed);
      if (!move || !position.isLegal(move)) throw new Error('Illegal personal move: ' + uci);
      path += scalachessCharPair(move);
      let child = node.children.find(child => {
        const parsed = parseSan(position, child.data.san);
        const candidate = parsed && normalizeMove(position, parsed);
        return candidate && makeUci(candidate) === makeUci(move);
      });
      const san = makeSanAndPlay(position, move);
      if (!child) {
        child = new ChildNode({ san });
        node.children.push(child);
        ownPaths.add(path);
      }
      node = child;
    }
  }
  const comments = new Map();
  for (const comment of personal.comments) {
    const path = personalPath(initial, comment.moves);
    // A comment must refer to a position in the book or a personal branch.
    let node = game.moves, position = initial.clone();
    for (let i = 2; i <= path.length; i += 2) {
      const child = node.children.find(child => {
        const move = parseSan(position, child.data.san);
        return move && path.slice(i - 2, i) === scalachessCharPair(move);
      });
      if (!child) throw new Error('Personal comment position is missing.');
      position.play(parseSan(position, child.data.san));
      node = child;
    }
    comments.set(path, comment.text);
  }
  return { pgn: personal.lines.length ? makePgn(game) : pgn, ownPaths, comments };
}

export function validatePersonal(value, pgn) {
  if (!value || !Array.isArray(value.lines) || !Array.isArray(value.comments) || value.lines.length > 2000 || value.comments.length > 2000) throw new Error('Invalid personal analysis.');
  const history = moves => Array.isArray(moves) && moves.length <= 1000 && moves.every(move => typeof move === 'string' && /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move));
  if (value.lines.some(line => !history(line) || !line.length) || value.comments.some(comment => !comment || !history(comment.moves) || typeof comment.text !== 'string' || !comment.text.trim() || comment.text.length > 20000)) throw new Error('Invalid personal analysis.');
  const clean = { lines: value.lines.map(line => [...line]), comments: value.comments.map(({ moves, text }) => ({ moves: [...moves], text })) };
  if (JSON.stringify(clean).length > 4000000) throw new Error('Personal analysis is too large.');
  mergePersonal(pgn, clean);
  return clean;
}

// Keep explored branches available during study without revealing later book moves.
export function personalReviewTokens(tokens, ownPaths, revealed) {
  const visible = new Map(tokens.slice(0, revealed.tokens.length).map((token, i) => [token, revealed.tokens[i]]));
  const root = [], stack = [root];
  for (const token of tokens) {
    if (token.type === 'variation-start') {
      const group = { start: token, children: [], end: null };
      stack.at(-1).push(group); stack.push(group.children);
    } else if (token.type === 'variation-end' && stack.length > 1) {
      stack.pop(); stack.at(-1).at(-1).end = token;
    } else {
      let parent = token.path;
      while (ownPaths.has(parent)) parent = parent.slice(0, -2);
      if (visible.has(token)) stack.at(-1).push(visible.get(token));
      else if (token.type === 'move' && ownPaths.has(token.path) && revealed.allowedPaths.has(parent)) stack.at(-1).push(token);
    }
  }
  const flatten = items => items.flatMap(item => {
    if (!item.children) return [item];
    const children = flatten(item.children);
    return children.length ? [item.start, ...children, ...(item.end ? [item.end] : [])] : [];
  });
  const result = flatten(root);
  const tail = result.findIndex(token => token.type === 'move' && !token.depth && ownPaths.has(token.path));
  return tail < 0 ? result : [...result.slice(0, tail), { type: 'variation-start', depth: 1 }, ...result.slice(tail).map(token => ({ ...token, depth: token.depth + 1 })), { type: 'variation-end', depth: 1 }];
}


export function updatePersonalComment(personal, moves, text) {
  const key = JSON.stringify(moves);
  const index = personal.comments.findIndex(comment => JSON.stringify(comment.moves) === key);
  const comments = [...personal.comments];
  if (!text.trim()) {
    if (index >= 0) comments.splice(index, 1);
  } else if (index >= 0) comments[index] = { moves: [...moves], text };
  else comments.push({ moves: [...moves], text });
  return { ...personal, comments };
}

// Remove a personal move's subtree, retaining the prefix and sibling branches.
export function removePersonalMove(pgn, personal, moves) {
  const merged = mergePersonal(pgn, personal);
  let initial;
  new PgnParser((game, error) => {
    if (error) throw new Error('This PGN is too complex to edit completely.');
    initial ??= startingPosition(game.headers).unwrap();
  }).parse(pgn);
  const target = personalPath(initial, moves);
  if (!merged.ownPaths.has(target)) throw new Error('Only personal moves can be deleted.');
  const candidates = new Map();
  for (const line of personal.lines) {
    const linePath = personalPath(initial, line);
    const kept = linePath.startsWith(target) ? line.slice(0, moves.length - 1) : [...line];
    const keptPath = personalPath(initial, kept);
    if (merged.ownPaths.has(keptPath)) candidates.set(keptPath, kept);
  }
  const paths = [...candidates.keys()];
  const lines = paths.filter(path => !paths.some(other => other !== path && other.startsWith(path))).map(path => candidates.get(path));
  const comments = personal.comments.filter(comment => !personalPath(initial, comment.moves).startsWith(target));
  return { lines, comments };
}
