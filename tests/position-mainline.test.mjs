import test from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chessops/chess';
import { parseSan } from 'chessops/san';
import { scalachessCharPair } from 'chessops/compat';
import { build } from 'esbuild';

// Pgn-viewer's ESM distribution has extensionless internal imports, supported
// by the app's bundler but not Node's direct ESM loader. Bundle just the
// pure viewer game/path modules in memory to cross-check real viewer paths.
const viewerBundle = await build({
  stdin: {
    contents: "export { makeGame } from '@lichess-org/pgn-viewer/pgn'; export { Path } from '@lichess-org/pgn-viewer/path';",
    resolveDir: process.cwd(), sourcefile: 'position-viewer-harness.mjs', loader: 'js',
  },
  bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent',
});
const { makeGame, Path } = await import('data:text/javascript;base64,' +
  Buffer.from(viewerBundle.outputFiles[0].contents).toString('base64'));
import { reviewPgn, prepareDisplayPgn } from '../src/pgn.mjs';
import { MAINLINE_EXTRACTOR_VERSION, extractMainlinePositions } from '../lib/position-mainline.mjs';

function complete(pgn, count) {
  const original = Buffer.from(pgn);
  const result = extractMainlinePositions(pgn);
  assert.equal(result.status, 'complete', result.diagnostic);
  assert.equal(result.diagnostic, null);
  assert.deepEqual(Buffer.from(pgn), original, 'do not modify original PGN');
  if (count !== undefined) assert.equal(result.occurrences.length, count);
  const occurrences = result.occurrences;
  assert.equal(occurrences[0].path, '');
  assert.equal(occurrences[0].ply, 0);
  assert.equal(new Set(occurrences.map(o => o.path)).size, occurrences.length);
  for (const o of occurrences) {
    assert.equal(typeof o.hash, 'bigint');
    assert.equal(typeof o.sqliteHash, 'bigint');
    assert.equal(typeof o.pawnHash, 'bigint');
    assert.equal(typeof o.sqlitePawnHash, 'bigint');
    assert.equal(o.sqliteHash, BigInt.asIntN(64, o.hash));
    assert.equal(o.sqlitePawnHash, BigInt.asIntN(64, o.pawnHash));
    assert.match(o.pawnSignature, /^[0-9a-f]{16}:[0-9a-f]{16}$/);
    assert.equal(o.is_mainline, 1);
    assert.equal(o.path.length % 2, 0);
  }
  return occurrences;
}

function agreesWithReview(pgn, occurrences) {
  const viewer = makeGame(prepareDisplayPgn(pgn));
  const tokens = reviewPgn(pgn).tokens.filter(t => t.type === 'move' && t.depth === 0);
  assert.deepEqual(tokens.map(t => t.path), occurrences.slice(1).map(o => o.path));
  assert.deepEqual(tokens.map(t => t.ply), occurrences.slice(1).map(o => o.ply));
  for (const item of occurrences) {
    const node = viewer.dataAt(new Path(item.path));
    assert.ok(node, 'viewer should resolve path ' + JSON.stringify(item.path));
    if (item.path) assert.equal(node.path.path, item.path);
    // Viewer FEN uses legal-EP chessops normalization; these fixtures have no
    // pinned EP differences. The separately tested PS-01 contract covers those.
    const fen = node.fen;
    const { positionFingerprint } = shared;
    const fingerprint = positionFingerprint(fen);
    assert.equal(item.verificationKey, fingerprint.verificationKey);
    assert.equal(item.hash, fingerprint.hash);
    assert.equal(item.pawnSignature, fingerprint.pawnSignature);
  }
}
import * as shared from '../lib/position-hash.mjs';

test('orthodox start, root, full paths, castling and published hash vector', () => {
  assert.equal(MAINLINE_EXTRACTOR_VERSION, 'position-mainline-v1');
  const pgn = '1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. O-O Nf6 *';
  const occurrences = complete(pgn, 9);
  assert.equal(occurrences[0].hash, 0x463b96181691fc9cn);
  assert.deepEqual(occurrences.map(o => o.ply), [...Array(9).keys()]);
  agreesWithReview(pgn, occurrences);
  assert.equal(occurrences[1].path, scalachessCharPair(parseSan(Chess.default(), 'e4')));
  assert.equal(occurrences[1].hash, 0x823c9b50fd114196n);
});

test('custom initial FEN, black-to-move and nonstandard move counters', () => {
  const pgn = '[SetUp "1"]\n[FEN "8/8/8/8/8/8/4K3/7k b - - 0 24"]\n\n24... Kh2 { A black move. } *';
  const occurrences = complete(pgn, 2);
  assert.equal(occurrences[1].ply, 48);
  assert.equal(occurrences[0].verificationKey, '8/8/8/8/8/8/4K3/7k b - -');
  agreesWithReview(pgn, occurrences);
  assert.deepEqual(complete(pgn.replace('[SetUp "1"]\n', '')), occurrences,
    'FEN-only setup has identical reviewer semantics');
  const whitePgn = '[SetUp "1"]\n[FEN "4k3/8/8/8/8/8/8/4K3 w - - 0 15"]\n\n15. Kf2 *';
  const white = complete(whitePgn, 2);
  assert.equal(white[1].ply, 29);
  agreesWithReview(whitePgn, white);
});

test('en-passant and promotion replay matches review positions', () => {
  const ep = '1. e4 a6 2. e5 d5 3. exd6 *';
  const moves = complete(ep, 6);
  assert.equal(moves[4].verificationKey.split(' ')[3], 'd6');
  assert.equal(moves[5].verificationKey.split(' ')[3], '-');
  agreesWithReview(ep, moves);
  const pgn = '[SetUp "1"]\n[FEN "4k3/P7/8/8/8/8/8/4K3 w - - 0 15"]\n\n15. a8=Q+ *';
  const promoted = complete(pgn, 2);
  assert.equal(promoted[1].ply, 29);
  assert.equal(promoted[1].verificationKey, 'Q3k3/8/8/8/8/8/8/4K3 b - -');
  agreesWithReview(pgn, promoted);
});

test('transpositions and comments yield the same hash but retain distinct paths', () => {
  const a = complete('1. Nf3 Nf6 2. g3 g6 *', 5);
  const b = complete('1. g3 g6 2. Nf3 Nf6 *', 5);
  assert.equal(a[4].hash, b[4].hash);
  assert.equal(a[4].verificationKey, b[4].verificationKey);
  assert.equal(a[4].pawnHash, b[4].pawnHash);
  assert.notEqual(a[4].path, b[4].path);
  const annotated = complete('1.Nf3 $1 { [%eval +0.10] comment } Nf6 2.g3 g6', 5);
  assert.deepEqual(annotated, a);
  agreesWithReview('1.Nf3 $1 { [%eval +0.10] comment } Nf6 2.g3 g6', annotated);
});

test('repeated positions have distinct viewer paths, without opening cutoff', () => {
  const pgn = [...Array(30)].map((_, i) =>
    (i * 2 + 1) + '. Nf3 Nf6 ' + (i * 2 + 2) + '. Ng1 Ng8').join(' ') + ' *';
  const positions = complete(pgn, 121);
  const repeated = positions.filter(o => o.verificationKey === positions[0].verificationKey);
  assert.equal(repeated.length, 31);
  assert.equal(new Set(repeated.map(o => o.path)).size, 31);
  assert.equal(positions.at(-1).path.length, 240);
  agreesWithReview(pgn, positions);
});

test('mainline-only ignores nested sidelines but not their syntax', () => {
  const pgn = '[Event "book"]\n[Result "*"]\n\n{Opening note}\n' +
    '1.e4!? $1 { [%crit opening] } (1. d4 {ignore} d5 (1... this-is-unknown))\n' +
    'e5 ; semicolon comment\n' +
    '2.Nf3 (2. Nonsense SAN) Nc6 { end } *';
  const positions = complete(pgn, 5);
  agreesWithReview(pgn, positions);
  assert.deepEqual(positions.map(o => o.ply), [0, 1, 2, 3, 4]);
  assert.equal(complete('{ Only commentary. } *', 1)[0].hash, 0x463b96181691fc9cn);
});


test('pinned en-passant is fingerprinted using Polyglot even when viewer hides it', () => {
  const fen = 'k3r3/8/8/3pP3/8/8/8/4K3 w - d6 0 1';
  const pgn = '[SetUp "1"]\n[FEN "' + fen + '"]\n\n*';
  const [root] = complete(pgn, 1);
  assert.equal(root.verificationKey.split(' ')[3], 'd6');
  const viewer = makeGame(prepareDisplayPgn(pgn));
  assert.equal(viewer.initial.fen.split(' ')[3], '-', 'review uses legal-EP normalization');
  assert.equal(root.verificationKey.split(' ').slice(0, 3).join(' '),
    viewer.initial.fen.split(' ').slice(0, 3).join(' '));
  assert.notEqual(root.hash, shared.positionFingerprint(viewer.initial.fen).hash,
    'pinned pawn still toggles the Polyglot en-passant key');
});

test('malformed PGNs never leak partial occurrences and diagnostics are deterministic', () => {
  const bad = [
    ['1. e4 e5 2. Ke5 *', /Illegal mainline move/],
    ['1. e4 garbage e5 *', /Malformed or unrecognized/],
    ['1. e4 { unfinished', /Unterminated PGN comment/],
    ['1. e4 (1. d4', /Unterminated PGN variation/],
    ['1. e4 ) e5 *', /Unexpected PGN variation terminator/],
    ['1. e4 * 1. d4 *', /after PGN result|Multiple PGN result/],
    ['1. e4 *\n\n1. d4 *', /result|one PGN/i],
    ['[SetUp "1"]\n\n1. e4 *', /requires a FEN/],
    ['[SetUp "0"]\n[FEN "8/8/8/8/8/8/4K3/7k b - - 0 24"]\n\n*', /contradicts/],
    ['[SetUp "maybe"]\n\n1.e4 *', /Invalid SetUp/],
    ['[FEN "8/8/8/8/8/8/8/8 w - - 0 1"]\n\n*', /ERR_EMPTY|ERR_KINGS|kings/i],
    ['[Variant "Crazyhouse"]\n\n1. e4 *', /Only standard/],
    ['[Variant "Chess960"]\n\n1. e4 *', /Chess960/],
    ['[Result "1-0"]\n\n1. e4 0-1', /Result header/],
    ['[Event "broken"\n\n1. e4 *', /Malformed PGN header/],
    ['1. e4 \0 e5 *', /NUL/],
    [null, /nonempty PGN/],
    [5, /nonempty PGN/],
    ['', /nonempty PGN/],
  ];
  for (const [pgn, expected] of bad) {
    const first = extractMainlinePositions(pgn);
    assert.equal(first.status, 'invalid', String(pgn));
    assert.deepEqual(first.occurrences, [], String(pgn));
    assert.match(first.diagnostic, expected, String(pgn));
    assert.deepEqual(extractMainlinePositions(pgn), first, 'diagnostic is stable');
  }
});
