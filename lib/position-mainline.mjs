import { Chess } from 'chessops/chess';
import { scalachessCharPair } from 'chessops/compat';
import { PgnParser, startingPosition } from 'chessops/pgn';
import { parseSan } from 'chessops/san';
import { parseSearchPosition, positionFingerprint } from './position-hash.mjs';

// PS-03's stable, pure mainline replay contract. PS-04 records this version
// alongside the input PGN SHA and publishes occurrences only on 'complete'.
export const MAINLINE_EXTRACTOR_VERSION = 'position-mainline-v1';
const MAX_PATH_LENGTH = 4096; // Storage constraint in migration 009, not an opening cutoff.
const SAN_RESULT = new Set(['1-0', '0-1', '1/2-1/2', '*']);

function invalid(message) {
  throw new Error(message);
}

// chessops' PgnParser deliberately tolerates unknown text, unmatched brackets,
// and truncated tokens. Before trusting the mainline AST, independently scan
// the complete score to reject hidden junk rather than silently under-index.
// Variation *moves* are not validated by PS-03, but their syntax must balance.
function scanMainline(pgn, includeVariations = false) {
  let index = 0, depth = 0, lineStart = true, sawMovetext = false;
  let token = '';
  let result = null, headerResult = null;
  const sans = [], allSans = [], headers = new Map();
  const accept = (part, depth) => {
    if (!part) return;
    // NAGs can be glued to the preceding SAN, e.g. e4$1.
    const fragments = part.replace(/(\$\d{1,4})/g, ' $1 ').split(/\s+/).filter(Boolean);
    for (let fragment of fragments) {
      while (/^\d+\.(?:\.\.)?/.test(fragment)) fragment = fragment.replace(/^\d+\.(?:\.\.)?/, '');
      if (!fragment || fragment === '...' || /^\$\d{1,4}$/.test(fragment) ||
          /^[!?]+$/.test(fragment) || /^e\.p\.$/i.test(fragment)) continue;
      const outcome = fragment.replace(/[–—]/g, '-');
      if (SAN_RESULT.has(outcome)) {
        if (depth) invalid('Unexpected result inside PGN variation');
        if (result !== null) invalid('Multiple PGN result markers');
        result = outcome;
      } else {
        if (result !== null) invalid('Unexpected move or text after PGN result');
        if (/^[O0o][-–—][O0o](?:[-–—][O0o])?[+#]?[!?]*$/.test(fragment)) {
          fragment = fragment.replace(/[0o]/g, 'O').replace(/[–—]/g, '-');
        }
        const san = fragment.replace(/[!?]+$/, '');
        if (!san) continue;
        if (depth === 0) sans.push(san);
        if (includeVariations) {
          allSans.push({ san, depth });
          if (allSans.length > 100000) invalid('PGN variation move count exceeds resource limit');
        }
      }
    }
  };
  const flush = () => {
    if (token) {
      if (depth === 0 || includeVariations) accept(token, depth);
      token = '';
    }
  };
  if (pgn.charCodeAt(0) === 0xfeff) index = 1;
  for (; index < pgn.length; index++) {
    const char = pgn[index];
    if (char === '\0') invalid('PGN contains a NUL character');
    if (char === '\n' || char === '\r') {
      flush();
      lineStart = true;
      continue;
    }
    if (char === '%' && lineStart) {
      flush();
      while (index + 1 < pgn.length && pgn[index + 1] !== '\n' && pgn[index + 1] !== '\r') index++;
      continue;
    }
    if (/\s/.test(char)) { flush(); continue; }
    const atLineStart = lineStart;
    lineStart = false;
    if (char === ';') {
      flush();
      while (index + 1 < pgn.length && pgn[index + 1] !== '\n' && pgn[index + 1] !== '\r') index++;
      continue;
    }
    if (char === '{') {
      flush();
      const end = pgn.indexOf('}', index + 1);
      if (end < 0) invalid('Unterminated PGN comment');
      if (pgn.slice(index + 1, end).includes('{')) invalid('Nested PGN comment delimiter');
      const inner = pgn.slice(index + 1, end);
      lineStart = inner.includes('\n') || inner.includes('\r')
        ? /(?:^|[\r\n])[ \t]*$/.test(inner)
        : false;
      index = end;
      continue;
    }
    if (char === '}') invalid('Unexpected PGN comment terminator');
    if (char === '(') { flush(); depth++; if (includeVariations && depth > 2048) invalid('PGN variation nesting exceeds resource limit'); continue; }
    if (char === ')') {
      flush();
      if (depth === 0) invalid('Unexpected PGN variation terminator');
      depth--;
      continue;
    }
    if (char === '[') {
      flush();
      if (depth || sawMovetext) invalid('Unexpected PGN header inside movetext');
      // Header syntax and escaping mirror chessops/pgn; comments are not
      // allowed inside a tag and a malformed tag must never be ignored.
      const found = /^\[([A-Za-z0-9][A-Za-z0-9_+#=:-]*)\s+"((?:[^"\\]|\\["\\])*)"\]/.exec(pgn.slice(index));
      if (!found) invalid('Malformed PGN header');
      const name = found[1];
      const value = found[2].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
      headers.set(name, value);
      if (name === 'Result') headerResult = value;
      index += found[0].length - 1;
      lineStart = false;
      continue;
    }
    if (char === ']') invalid('Unexpected PGN header terminator');
    if (depth === 0 || includeVariations) {
      sawMovetext = true;
      token += char;
    }
  }
  flush();
  if (depth) invalid('Unterminated PGN variation');
  if (headerResult !== null && result !== null && headerResult !== result) {
    invalid('PGN Result header disagrees with movetext result');
  }
  return { sans, allSans, headers, result };
}

function startingChess(headers) {
  const setup = headers.get('SetUp');
  const fen = headers.get('FEN');
  if (setup !== undefined && setup !== '0' && setup !== '1') invalid('Invalid SetUp header');
  if (setup === '1' && !fen) invalid('SetUp "1" requires a FEN header');
  if (setup === '0' && fen !== undefined) invalid('SetUp "0" contradicts the FEN header');
  // Align with chessops and the existing reviewer: a FEN without SetUp is
  // allowed, unless an explicitly contradictory SetUp value was provided.
  const variant = headers.get('Variant')?.trim().toLowerCase();
  if (variant && ['chess960', 'chess 960', 'fischerandom', 'fischerrandom',
    'fischer random'].includes(variant)) invalid('Chess960 is not standard chess');
  const initial = startingPosition(headers).unwrap();
  if (!(initial instanceof Chess) || initial.rules !== 'chess') {
    invalid('Only standard chess positions are supported');
  }
  if (fen) {
    // Chess.fromSetup can silently discard impossible EP/castling metadata;
    // the strict PS-01 parser rejects it, including Chess960 castling rights.
    parseSearchPosition(fen);
  }
  return initial;
}

function occurrence(position, path, ply) {
  const fp = positionFingerprint(position);
  return {
    ply,
    path,
    is_mainline: 1,
    hash: fp.hash,
    sqliteHash: fp.sqliteHash,
    verificationKey: fp.verificationKey,
    pawnHash: fp.pawnHash,
    sqlitePawnHash: fp.sqlitePawnHash,
    pawnSignature: fp.pawnSignature,
  };
}

function plyAfter(position) {
  return (position.fullmoves - 1) * 2 + (position.turn === 'black' ? 1 : 0);
}

/**
 * Extract every standard-chess mainline position, including the actual
 * custom-FEN root. Never mutates PGN or writes to SQLite. All hashes are bigint
 * and are NOT JSON/Number-safe. A failed replay discards *all* occurrences.
 *
 * @returns {{status:'complete'|'invalid', diagnostic:string|null,
 *            occurrences:Array<object>}}
 */
export function extractMainlinePositions(pgn) {
  try {
    if (typeof pgn !== 'string' || !pgn.trim()) invalid('Expected one nonempty PGN string');
    const scanned = scanMainline(pgn);
    const games = [];
    new PgnParser((game, error) => {
      if (error) throw error;
      games.push(game);
    }).parse(pgn);
    if (games.length !== 1) invalid('Expected exactly one PGN game');
    const game = games[0];
    // Ensure parser's mainline is the entire score: it otherwise silently
    // ignores unrecognized tokens in source PGN.
    const nodes = [...game.moves.mainlineNodes()];
    if (nodes.length !== scanned.sans.length ||
        nodes.some((node, i) => node.data.san !== scanned.sans[i])) {
      invalid('Malformed or unrecognized mainline PGN token');
    }
    const position = startingChess(game.headers);
    // Validate against the scanned header metadata, not parser normalization.
    for (const field of ['SetUp', 'FEN', 'Variant']) {
      if (scanned.headers.get(field) !== game.headers.get(field) &&
          scanned.headers.has(field)) invalid('PGN header parsing mismatch: ' + field);
    }
    const occurrences = [occurrence(position, '', 0)];
    let path = '';
    for (const [index, node] of nodes.entries()) {
      const move = parseSan(position, node.data.san);
      if (!move) invalid('Illegal mainline move at ply ' + (index + 1) + ': ' + node.data.san);
      path += scalachessCharPair(move);
      if (path.length > MAX_PATH_LENGTH) invalid('Viewer path exceeds schema-7 extension limit');
      position.play(move);
      occurrences.push(occurrence(position, path, plyAfter(position)));
    }
    return { status: 'complete', diagnostic: null, occurrences };
  } catch (error) {
    return {
      status: 'invalid',
      diagnostic: String(error instanceof Error ? error.message : error).slice(0, 1000),
      occurrences: [],
    };
  }
}


// PS-09: the author-authored PGN variation tree is separate from saved personal
// analysis. Failed sidelines never contaminate or erase valid mainline keys.
// The legacy mainline extractor above remains strict and versioned independently.
export const VARIATION_EXTRACTOR_VERSION = 'position-variations-v1';

export function extractAllPositions(pgn) {
  const mainline = extractMainlinePositions(pgn);
  if (mainline.status !== 'complete') return mainline;
  const partial = message => ({
    status: 'partial',
    diagnostic: String(message).slice(0, 1000),
    occurrences: mainline.occurrences,
  });
  try {
    if (pgn.length > 16 * 1024 * 1024) invalid('PGN exceeds variation replay resource limit');
    const scanned = scanMainline(pgn, true);
    const games = [];
    new PgnParser((game, error) => {
      if (error) throw error;
      games.push(game);
    }).parse(pgn);
    if (games.length !== 1) invalid('Expected exactly one PGN game');
    const initial = startingChess(games[0].headers);
    const tasks = games[0].moves.children.length
      ? [{ node: games[0].moves.children[0],
        alternatives: games[0].moves.children.slice(1),
        position: initial, path: '', depth: 0 }] : [];
    const visited = new Set(['']);
    const occurrences = [mainline.occurrences[0]];
    const actualSans = [];
    while (tasks.length) {
      const task = tasks.pop();
      const { node, depth } = task;
      actualSans.push({ san: node.data.san, depth });
      if (actualSans.length > 100000) invalid('PGN variation move count exceeds resource limit');
      const next = task.position.clone();
      const move = parseSan(next, node.data.san);
      if (!move) invalid('Illegal variation move at depth ' + depth + ': ' + node.data.san);
      const path = task.path + scalachessCharPair(move);
      if (path.length > MAX_PATH_LENGTH) invalid('Viewer path exceeds schema-7 extension limit');
      if (visited.has(path)) invalid('Duplicate viewer path in original PGN');
      visited.add(path);
      next.play(move);
      occurrences.push({ ...occurrence(next, path, plyAfter(next)), is_mainline: depth === 0 ? 1 : 0 });
      if (node.children.length) tasks.push({
        node: node.children[0], alternatives: node.children.slice(1),
        position: next, path, depth,
      });
      for (let i = task.alternatives.length - 1; i >= 0; i--) {
        tasks.push({
          node: task.alternatives[i], alternatives: [],
          position: task.position, path: task.path, depth: depth + 1,
        });
      }
    }
    // PgnParser is tolerant and can drop unrecognized author moves. Refuse
    // all-variation completeness unless every original SAN token survived in
    // source order and at the same nested variation depth.
    if (actualSans.length !== scanned.allSans.length ||
      actualSans.some((item, i) => item.san !== scanned.allSans[i].san ||
        item.depth !== scanned.allSans[i].depth)) {
      invalid('Malformed or unrecognized variation PGN token');
    }
    const replayMainline = occurrences.filter(item => item.is_mainline);
    if (replayMainline.length !== mainline.occurrences.length ||
      replayMainline.some((item, i) =>
        item.path !== mainline.occurrences[i].path ||
        item.verificationKey !== mainline.occurrences[i].verificationKey ||
        item.ply !== mainline.occurrences[i].ply)) {
      invalid('Variation replay disagrees with the original mainline');
    }
    return { status: 'complete', diagnostic: null, occurrences };
  } catch (error) {
    return partial('Variation indexing incomplete: ' +
      (error instanceof Error ? error.message : String(error)));
  }
}
