import { createHash } from 'node:crypto';
import { makeFen } from 'chessops/fen';
import { parseSan, makeSan } from 'chessops/san';
import { makeUci } from 'chessops/util';
import { scalachessCharPair } from 'chessops/compat';
import { parseSearchPosition, positionFingerprint } from './position-hash.mjs';

export const SOURCE_TREE_VERSION = 'opening-source-tree-v1';
export const ANNOTATION_VERSION = 'opening-annotations-prototype-v1';
export const digest = value => createHash('sha256').update(value).digest('hex');
const RESULTS = /^(?:1-0|0-1|1\/2-1\/2|\*)$/;
const SAN = /^(?:[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?|O-O(?:-O)?)[+#]?$/;
const COLORS = new Set(['red', 'green', 'yellow', 'blue']);
const SQUARE = /^[a-h][1-8]$/;

// The DTO carries annotation-free movetext, not a generic permissive PGN.
// No token can be ignored here, including in a rejected side branch.
export function readSourceTree(source) {
  if (!source || typeof source.moves_pgn !== 'string' || source.moves_pgn.length > 4_000_000)
    throw new Error('Missing or oversized source movetext');
  if (typeof source.start_fen !== 'string') throw new Error('Missing source root FEN');
  const rootPosition = parseSearchPosition(source.start_fen);
  function node(position, parent, ordinal, move, sourceIndex) {
    const fingerprint = positionFingerprint(position);
    return { parent, ordinal, sourceIndex, path: parent ? [...parent.path, ordinal] : [],
      ply: parent ? parent.ply + 1 : 0,
      mainline: parent ? parent.mainline && ordinal === 0 : true,
      uci: move ? makeUci(move) : null, san: null,
      viewerPath: parent ? parent.viewerPath + scalachessCharPair(move) : '',
      fen: makeFen(position.toSetup()), exactKey: fingerprint.verificationKey,
      hash: fingerprint.sqliteHash, position, children: [], leafLo: 0, leafHi: 0 };
  }
  const root = node(rootPosition, null, 0, null, -1);
  const nodes = [root], stack = [];
  let current = root, offset = 0, ended = false, numberPending = false;
  const notation = source.moves_pgn;
  while (offset < notation.length) {
    const tail = notation.slice(offset);
    const whitespace = /^\s+/.exec(tail);
    if (whitespace) { offset += whitespace[0].length; continue; }
    if (ended) throw new Error(`Unexpected source token after result at ${offset}`);
    if (tail[0] === '(') {
      if (numberPending) throw new Error(`Move number without a move at ${offset}`);
      if (!current.parent || stack.length >= 256) throw new Error(`Invalid variation at ${offset}`);
      stack.push({ returnTo: current, count: nodes.length });
      current = current.parent;
      offset++;
      continue;
    }
    if (tail[0] === ')') {
      if (numberPending) throw new Error(`Move number without a move at ${offset}`);
      const frame = stack.pop();
      if (!frame || nodes.length === frame.count) throw new Error(`Empty/unmatched variation at ${offset}`);
      current = frame.returnTo;
      offset++;
      continue;
    }
    const number = /^(\d+)\.(\.\.)?/.exec(tail);
    if (number) {
      if (numberPending || Number(number[1]) !== current.position.fullmoves ||
          Boolean(number[2]) !== (current.position.turn === 'black'))
        throw new Error(`Move number disagrees with source root/path at ${offset}`);
      offset += number[0].length;
      numberPending = true;
      continue;
    }
    const token = /^[^\s()]+/.exec(tail)?.[0];
    if (!token) throw new Error(`Unknown source token at ${offset}`);
    if (RESULTS.test(token)) {
      if (numberPending) throw new Error('Move number without a move before result');
      if (stack.length) throw new Error('Result inside source variation');
      ended = true;
      offset += token.length;
      continue;
    }
    const normalized = token.replace(/^0-0-0/, 'O-O-O').replace(/^0-0/, 'O-O');
    if (!SAN.test(normalized)) throw new Error(`Unsupported source move ${token} at ${offset}`);
    const move = parseSan(current.position, normalized);
    if (!move || !current.position.isLegal(move)) throw new Error(`Illegal source move ${token} at ${offset}`);
    const san = makeSan(current.position, move);
    if (san.replace(/[+#]$/, '') !== normalized.replace(/[+#]$/, ''))
      throw new Error(`Ambiguous/noncanonical source move ${token} at ${offset}`);
    const position = current.position.clone();
    position.play(move);
    const next = node(position, current, current.children.length, move, nodes.length - 1);
    next.san = san;
    current.children.push(next);
    nodes.push(next);
    current = next;
    numberPending = false;
    offset += token.length;
    if (nodes.length > 100_001) throw new Error('Source tree exceeds move limit');
  }
  if (stack.length) throw new Error('Unclosed source variation');
  if (numberPending) throw new Error('Source ends with a move number');
  if (source.all_lines_ply != null && source.all_lines_ply !== nodes.length - 1)
    throw new Error(`Source node count mismatch: expected ${source.all_lines_ply}, read ${nodes.length - 1}`);
  if (source.main_line_ply != null && source.main_line_ply !== nodes.filter(n => n.parent && n.mainline).length)
    throw new Error('Source mainline count mismatch');
  let leaf = 0;
  function intervals(n) {
    n.leafLo = leaf;
    if (!n.children.length) leaf++;
    else for (const child of n.children) intervals(child);
    n.leafHi = leaf;
  }
  // Traversal depth is bounded independently of recursive helper stack size.
  if (nodes.some(n => n.ply > 2048)) throw new Error('Source tree exceeds depth limit');
  intervals(root);
  const treeHash = digest(JSON.stringify(nodes.map(n => [n.path, n.uci, n.exactKey])));
  return { root, nodes, moveCount: nodes.length - 1,
    leafCount: nodes.length > 1 ? leaf : 0, treeHash };
}

export function normalizeAnnotations(tree, annotations) {
  const seen = new Set();
  const mapping = new Map(tree.nodes.map(n => [n.sourceIndex, n]));
  return annotations.map(a => {
    if (!Number.isSafeInteger(a.sequence) || a.sequence < 0 || seen.has(a.sequence))
      throw new Error('Invalid/duplicate annotation sequence');
    seen.add(a.sequence);
    const node = mapping.get(a.move_index);
    const original = JSON.parse(a.payload_json);
    let supported = false;
    let payload = original;
    switch (a.annotation_type) {
      case 'TextBefore': case 'TextAfter':
        supported = typeof original.text === 'string' && original.text === a.text;
        payload = { text: original.text };
        break;
      case 'Symbols':
        supported = Array.isArray(original.nags) && original.nags.every(n => Number.isSafeInteger(n) && n >= 0 && n <= 255);
        payload = { nags: original.nags };
        break;
      case 'Arrows':
        supported = Array.isArray(original.arrows) && original.arrows.every(a =>
          COLORS.has(a.color) && SQUARE.test(a.from) && SQUARE.test(a.to));
        payload = { arrows: original.arrows };
        break;
      case 'Squares':
        supported = Array.isArray(original.squares) && original.squares.every(s =>
          COLORS.has(s.color) && SQUARE.test(s.square));
        payload = { squares: original.squares };
        break;
      // Eval score perspective and array offsets require independent evidence.
      // Quotations are retained payloads, never silently indexed as new games.
    }
    const sourceConsistent = original.move === a.move_index && original._type === a.annotation_type;
    return { sequence: a.sequence, sourceIndex: a.move_index,
      sourcePath: node ? node.path.join('.') : null,
      type: a.annotation_type, sourceLanguage: a.language,
      language: ({ ENG: 'en', GER: 'de', ENGLISH: 'en', GERMAN: 'de' })[a.language] ?? a.language ?? null,
      placement: a.move_index === -1 ? 'root' : a.annotation_type === 'TextBefore' ? 'before' : 'after',
      status: !node || !sourceConsistent ? 'unmapped' : supported ? 'supported' : 'unsupported',
      payload, original, payloadHash: digest(a.payload_json) };
  }).sort((a, b) => a.sequence - b.sequence);
}

// Prototype viewer notation: typed payload remains authoritative. A controlled
// marker independently verifies exact language/order/placement through parsing.
// Source text never enters PGN syntax unescaped.
export function generateViewerPgn(tree, annotations = []) {
  const byPath = new Map();
  for (const a of annotations) {
    if (a.sourcePath === null) continue;
    const list = byPath.get(a.sourcePath) ?? [];
    list.push(a);
    byPath.set(a.sourcePath, list);
  }
  const comments = (n, before) => (byPath.get(n.path.join('.')) ?? [])
    .filter(a => (a.placement === 'before') === before)
    .map(a => `{[%opening ${Buffer.from(JSON.stringify(a)).toString('base64')}]}`).join(' ');
  const moveText = n => `${comments(n, true)} ${n.parent.position.fullmoves}${n.parent.position.turn === 'black' ? '...' : '.'} ${n.san} ${comments(n, false)}`;
  function line(n) {
    const chunks = [];
    while (n.children.length) {
      const [main, ...alternatives] = n.children;
      chunks.push(moveText(main));
      for (const alternative of alternatives) chunks.push(`(${moveText(alternative)} ${line(alternative)})`);
      n = main;
    }
    return chunks.join(' ');
  }
  return `[SetUp "1"]\n[FEN "${tree.root.fen}"]\n[Result "*"]\n\n${comments(tree.root, false)} ${line(tree.root)} *`;
}
