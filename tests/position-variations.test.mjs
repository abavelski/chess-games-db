import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { reviewPgn, prepareDisplayPgn } from '../src/pgn.mjs';
import { positionFingerprint } from '../lib/position-hash.mjs';
import { extractAllPositions, extractMainlinePositions, VARIATION_EXTRACTOR_VERSION } from '../lib/position-mainline.mjs';

// The application bundles the viewer's extensionless ESM imports. Use the same
// existing pure-board harness as PS-03 to prove recorded paths are navigable.
const viewerBundle = await build({
  stdin: {
    contents: "export { makeGame } from '@lichess-org/pgn-viewer/pgn'; export { Path } from '@lichess-org/pgn-viewer/path';",
    resolveDir: process.cwd(), sourcefile: 'variation-viewer-harness.mjs', loader: 'js',
  },
  bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent',
});
const { makeGame, Path } = await import('data:text/javascript;base64,' +
  Buffer.from(viewerBundle.outputFiles[0].contents).toString('base64'));

function compareWithViewer(pgn, withVariations = true) {
  const original = Buffer.from(pgn);
  const result = extractAllPositions(pgn);
  assert.equal(result.status, 'complete', result.diagnostic);
  assert.deepEqual(Buffer.from(pgn), original);
  const mainline = extractMainlinePositions(pgn);
  assert.deepEqual(result.occurrences.filter(item => item.is_mainline), mainline.occurrences);
  const tokens = reviewPgn(pgn).tokens.filter(token => token.type === 'move');
  assert.deepEqual(result.occurrences.slice(1).map(item => item.path), tokens.map(token => token.path));
  assert.deepEqual(result.occurrences.slice(1).map(item => item.ply), tokens.map(token => token.ply));
  const viewer = makeGame(prepareDisplayPgn(pgn));
  for (const item of result.occurrences) {
    const node = viewer.dataAt(new Path(item.path));
    assert.ok(node, 'viewer must navigate to original path ' + JSON.stringify(item.path));
    assert.equal(item.verificationKey, positionFingerprint(node.fen).verificationKey);
    assert.equal(item.pawnSignature, positionFingerprint(node.fen).pawnSignature);
    assert.equal(typeof item.sqliteHash, 'bigint');
    assert.equal(typeof item.sqlitePawnHash, 'bigint');
    assert.ok(item.path.length <= 4096);
  }
  assert.equal(new Set(result.occurrences.map(item => item.path)).size, result.occurrences.length);
  if (withVariations) assert.ok(result.occurrences.some(item => !item.is_mainline));
  return result.occurrences;
}

test('PS-09 nested, sibling, root and same-ply variations preserve source order and viewer paths', () => {
  assert.equal(VARIATION_EXTRACTOR_VERSION, 'position-variations-v1');
  const pgn = '1. e4 (1. d4 d5 (1... Nf6 2. c4) 2. c4) (1. c4 e5) ' +
    'e5 (1... c5 2. Nf3 (2. Nc3)) 2. Nf3 Nc6 *';
  const hits = compareWithViewer(pgn);
  assert.equal(hits.filter(item => item.is_mainline).length, 5);
  assert.ok(hits.filter(item => !item.is_mainline).length >= 8);
  assert.ok(hits.some(item => item.path !== '' && item.ply === 1 && !item.is_mainline));
});

test('PS-09 castling alternatives and promotions on SetUp/FEN roots', () => {
  compareWithViewer('1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. d3 (4. O-O) Nf6 *');
  const pgn = '[SetUp "1"]\n[FEN "4k3/P7/8/8/8/8/8/4K3 w - - 0 15"]\n\n' +
    '15. a8=Q+ (15. a8=N) (15. a8=R+) *';
  const hits = compareWithViewer(pgn);
  assert.equal(hits[0].ply, 0);
  assert.deepEqual(hits.filter(item => !item.is_mainline).map(item => item.ply), [29, 29]);
  const black = '[SetUp "1"]\n[FEN "8/8/8/8/8/8/4K3/7k b - - 0 24"]\n\n24... Kh2 (24... Kg1) *';
  compareWithViewer(black);
});

test('PS-09 repeated position on mainline and alternative branch retains distinct paths and pawn keys', () => {
  const pgn = '1. e4 e5 (1... c5 2. Nf3 d6) 2. Nf3 (2. Nc3) Nc6 *';
  const hits = compareWithViewer(pgn);
  const blackE5 = hits.find(item => item.is_mainline && item.ply === 2);
  const blackC5 = hits.find(item => !item.is_mainline && item.ply === 2);
  assert.ok(blackE5 && blackC5);
  assert.notEqual(blackE5.pawnSignature, blackC5.pawnSignature);
  const same = compareWithViewer('1. Nf3 (1. g3 g6 2. Nf3 Nf6) Nf6 2. g3 g6 *');
  const mainLast = same.find(item => item.is_mainline && item.ply === 4);
  const sideLast = same.find(item => !item.is_mainline && item.ply === 4);
  assert.equal(mainLast.verificationKey, sideLast.verificationKey);
  assert.notEqual(mainLast.path, sideLast.path);
});

test('PS-09 illegal, ignored and truncated variation never declares full coverage', () => {
  const mainline = '1. e4 e5 2. Nf3 Nc6 *';
  for (const pgn of [
    '1. e4 e5 (1... Ke9) 2. Nf3 Nc6 *',
    '1. e4 (1. d4 illegal) e5 2. Nf3 Nc6 *',
    '1. e4 e5 (1... c5 2. blah) 2. Nf3 Nc6 *',
  ]) {
    const result = extractAllPositions(pgn);
    assert.equal(result.status, 'partial', result.diagnostic);
    assert.match(result.diagnostic, /Variation indexing incomplete/);
    assert.deepEqual(result.occurrences, extractMainlinePositions(mainline).occurrences);
    assert.deepEqual(extractAllPositions(pgn), result, 'diagnostics must be deterministic');
  }
  const truncated = extractAllPositions('1. e4 (1. d4');
  assert.equal(truncated.status, 'invalid');
  assert.deepEqual(truncated.occurrences, []);
  assert.match(truncated.diagnostic, /Unterminated PGN variation/);
});

test('PS-09 bounded replay rejects excessively long paths without partial sidebranch hits', () => {
  const pgn = '1. e4 (' + Array.from({ length: 2050 }, () => '(').join('') + '1. d4' +
    Array.from({ length: 2050 }, () => ')').join('') + ') e5 *';
  const result = extractAllPositions(pgn);
  assert.notEqual(result.status, 'complete');
  assert.match(result.diagnostic, /nest|complex|resource|variation|parser/i);
});
