import { createHash } from 'node:crypto';
import { PgnParser, startingPosition } from 'chessops/pgn';
import { parseSan } from 'chessops/san';
import { makeUci } from 'chessops/util';
import { makeFen } from 'chessops/fen';

export const OPENING_ALGORITHM = 'catalogue-v1';
export const digest = value => createHash('sha256').update(value).digest('hex');
export const positionKey = position => makeFen(position.toSetup(), { epd: true });

// Retain all mainline tokens, including invalid ones that a tolerant PGN parser
// might otherwise skip. Ignore comments, headers and complete nested variations.
function mainlineTokens(pgn) {
  let text = '', variation = 0, comment = false, header = false, quoted = false, escaped = false, lineComment = false;
  for (const char of pgn) {
    if (lineComment) { if (char === '\n') lineComment = false; else continue; }
    if (comment) { if (char === '}') comment = false; continue; }
    if (header) {
      if (escaped) { escaped = false; continue; }
      if (char === '\\' && quoted) { escaped = true; continue; }
      if (char === '"') quoted = !quoted;
      if (char === ']' && !quoted) header = false;
      continue;
    }
    if (char === '{') { comment = true; text += ' '; continue; }
    if (char === ';' || (char === '%' && (!text || text.endsWith('\n')))) { lineComment = true; continue; }
    if (char === '[') { header = true; text += ' '; continue; }
    if (char === '(') { variation++; text += ' '; continue; }
    if (char === ')') { if (!variation) throw new Error('Unbalanced PGN variation'); variation--; continue; }
    if (char === '}') throw new Error('Unbalanced PGN comment');
    if (!variation) text += char;
  }
  if (comment || header || variation) throw new Error('Truncated PGN comment, header or variation');
  const tokens = text.replace(/\$\d+/g, ' ').replace(/\d+\.(?:\.\.)?/g, ' ').trim().split(/\s+/).filter(Boolean);
  const moves = [];
  let ended = false;
  for (let token of tokens) {
    if (/^(1-0|0-1|1\/2-1\/2|\*)$/.test(token)) { ended = true; continue; }
    if (/^(e\.p\.|[!?]+)$/.test(token)) continue;
    if (ended) throw new Error('Unexpected moves after PGN result');
    token = token.replace(/[!?]+$/, '');
    moves.push(token);
  }
  return moves;
}

export function replayMainline(pgn) {
  const games = [];
  new PgnParser((game, error) => { if (error) throw error; games.push(game); }).parse(pgn);
  if (games.length !== 1) throw new Error('Expected exactly one PGN game');
  const game = games[0];
  const position = startingPosition(game.headers).unwrap();
  if (position.rules !== 'chess') throw new Error('Only standard chess openings are supported');
  const positions = [], moves = [];
  for (const san of mainlineTokens(pgn)) {
    const move = parseSan(position, san);
    if (!move) throw new Error(`Illegal move at ply ${moves.length + 1}: ${san}`);
    moves.push(makeUci(move)); position.play(move);
    positions.push(positionKey(position));
  }
  return { moves, positions };
}

export function buildCatalogue(files, overrides = {}) {
  const nodes = new Map(), entries = new Map(), byPosition = new Map();
  for (const file of ['a', 'b', 'c', 'd', 'e']) {
    if (typeof files[file] !== 'string') throw new Error(`Missing ${file}.tsv`);
    const lines = files[file].replace(/^\uFEFF/, '').trim().split(/\r?\n/);
    if (lines.shift() !== 'eco\tname\tpgn') throw new Error(`Invalid ${file}.tsv columns`);
    for (const line of lines) {
      if (!line.trim()) continue;
      const [eco, name, pgn, extra] = line.split('\t');
      if (!new RegExp(`^${file.toUpperCase()}[0-9]{2}$`).test(eco) || !name?.trim() || !pgn || extra !== undefined) throw new Error(`Invalid catalogue row: ${line}`);
      const replay = replayMainline(pgn);
      if (!replay.moves.length) throw new Error('Catalogue line has no moves');
      const colon = name.indexOf(':');
      const path = overrides[name] ?? (colon < 0 ? [name] : [name.slice(0, colon), ...name.slice(colon + 1).split(',')]);
      if (!Array.isArray(path) || !path.length || path.some(label => typeof label !== 'string' || !label.trim())) throw new Error(`Invalid taxonomy override: ${name}`);
      const labels = path.map(label => label.trim());
      let parent = null;
      for (let depth = 1; depth <= labels.length; depth++) {
        const parts = labels.slice(0, depth), id = digest(JSON.stringify(parts));
        nodes.set(id, { id, label: parts.at(-1), path: parts, parent_id: parent }); parent = id;
      }
      const id = digest(JSON.stringify([eco, name, pgn]));
      const entry = { id, eco, name, pgn, uci: replay.moves.join(' '), position_key: replay.positions.at(-1), node_id: parent, depth: labels.length };
      if (!entries.has(id)) {
        entries.set(id, entry);
        const matches = byPosition.get(entry.position_key) ?? [];
        matches.push(entry); byPosition.set(entry.position_key, matches);
      }
    }
  }
  return { nodes: [...nodes.values()], entries: [...entries.values()], byPosition };
}

export function classifyOpening(pgn, catalogue) {
  try {
    const replay = replayMainline(pgn), matches = [];
    for (let index = 0; index < replay.positions.length; index++) {
      for (const entry of catalogue.byPosition.get(replay.positions[index]) ?? []) {
        matches.push({ entry_id: entry.id, ply: index + 1, exact: entry.uci === replay.moves.slice(0, index + 1).join(' '), depth: entry.depth });
      }
    }
    matches.sort((a, b) => b.ply - a.ply || Number(b.exact) - Number(a.exact) || b.depth - a.depth || a.entry_id.localeCompare(b.entry_id));
    return { status: matches.length ? 'matched' : 'unmatched', primary_entry_id: matches[0]?.entry_id ?? null, matched_ply: matches[0]?.ply ?? null, diagnostic: null, matches };
  } catch (error) {
    return { status: 'invalid', primary_entry_id: null, matched_ply: null, diagnostic: String(error.message).slice(0, 1000), matches: [] };
  }
}
