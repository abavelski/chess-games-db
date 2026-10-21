import test from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chessops/chess';
import { makeFen } from 'chessops/fen';
import { parseSan } from 'chessops/san';
import { extractMainlinePositions } from '../lib/position-mainline.mjs';
import { positionFingerprint } from '../lib/position-hash.mjs';
import { resolveReviewNavigation } from '../src/review-navigation.mjs';
import { criticalReveal } from '../src/critical-positions.mjs';
import { reviewPgn } from '../src/pgn.mjs';

function fenAfter(...sans) {
  const position = Chess.default();
  for (const san of sans) {
    const move = parseSan(position, san);
    assert.ok(move, 'legal move ' + san);
    position.play(move);
  }
  return makeFen(position.toSetup());
}
function matchAt(pgn, fen) {
  const positions = extractMainlinePositions(pgn);
  assert.equal(positions.status, 'complete', positions.diagnostic);
  const { verificationKey } = positionFingerprint(fen);
  const occurrence = positions.occurrences.find(item => item.verificationKey === verificationKey);
  assert.ok(occurrence, 'fixture must contain searched position');
  return { path: occurrence.path, ply: occurrence.ply, isMainline: true };
}

test('PS-07 lands on exact original positions for transpositions at different plies', () => {
  const fen = fenAfter('Nf3', 'Nf6', 'g3', 'g6');
  const normal = '1. Nf3 Nf6 2. g3 g6 *';
  const late = '1. Nf3 Nf6 2. Ng1 Ng8 3. Nf3 Nf6 4. g3 g6 *';
  const before = [normal, late];
  const first = matchAt(normal, fen);
  const second = matchAt(late, fen);
  assert.equal(first.ply, 4);
  assert.equal(second.ply, 8);
  assert.notEqual(first.path, second.path);
  for (const [pgn, match] of [[normal, first], [late, second]]) {
    const result = resolveReviewNavigation(pgn, match, fen);
    assert.equal(result.path, match.path);
    assert.equal(result.positionKey, positionFingerprint(fen).verificationKey);
    assert.equal(result.notice, null);
  }
  assert.deepEqual([normal, late], before, 'navigation must never change original PGN');
});

test('PS-07 custom FEN root and deterministic earliest repeated occurrence', () => {
  const custom = '4k3/8/8/8/8/8/8/4K3 w - - 0 1';
  const pgn = '[SetUp "1"]\n[FEN "' + custom + '"]\n\n*';
  const root = matchAt(pgn, custom);
  assert.deepEqual(root, { path: '', ply: 0, isMainline: true });
  assert.deepEqual(resolveReviewNavigation(pgn, root, custom), {
    path: '', positionKey: positionFingerprint(custom).verificationKey, notice: null,
  });
  const repeated = '1. Nf3 Nf6 2. Ng1 Ng8 3. Nf3 Nf6 4. Ng1 Ng8 *';
  const fen = fenAfter('Nf3', 'Nf6');
  const earliest = matchAt(repeated, fen);
  assert.equal(earliest.ply, 2);
  assert.equal(resolveReviewNavigation(repeated, earliest, fen).path, earliest.path);
  const later = extractMainlinePositions(repeated).occurrences.find(o => o.ply === 6);
  assert.ok(later);
  assert.equal(resolveReviewNavigation(repeated, { path: later.path, ply: 6, isMainline: true }, fen).path, '');
});

test('PS-07 rejects stale paths, incorrect ply or exact board, missing matches and illegal PGN', () => {
  const pgn = '1. e4 e5 2. Nf3 Nc6 *';
  const fen = fenAfter('e4', 'e5', 'Nf3', 'Nc6');
  const good = matchAt(pgn, fen);
  for (const bad of [
    null,
    { ...good, path: 'broken' },
    { ...good, ply: 2 },
    { ...good, path: extractMainlinePositions(pgn).occurrences[2].path },
    { ...good, isMainline: false },
  ]) {
    const result = resolveReviewNavigation(pgn, bad, fen);
    assert.equal(result.path, '');
    assert.equal(result.positionKey, null);
    assert.match(result.notice, /indexed|position/i);
  }
  assert.equal(resolveReviewNavigation(pgn, good, fenAfter('e4', 'e5', 'Nf3')).path, '');
  assert.equal(resolveReviewNavigation('1. e4 e5 2. Ke9 *', good, fen).path, '');
  assert.equal(resolveReviewNavigation(pgn, good, 'invalid FEN').path, '');
});

test('PS-07 Study stops never reveals a target beyond the first hidden marker', () => {
  const pgn = '1. e4 {[%crit opening]} e5 2. Nf3 Nc6 *';
  const fen = fenAfter('e4', 'e5', 'Nf3', 'Nc6');
  const match = matchAt(pgn, fen);
  assert.equal(resolveReviewNavigation(pgn, match, fen).path, match.path);
  const restricted = resolveReviewNavigation(pgn, match, fen, true);
  const reveal = criticalReveal(reviewPgn(pgn).tokens, 0, true);
  assert.equal(reveal.paused, true);
  assert.equal(reveal.allowedPaths.has(restricted.path), true);
  assert.equal(reveal.allowedPaths.has(match.path), false);
  assert.equal(restricted.path, extractMainlinePositions(pgn).occurrences[1].path);
  assert.equal(restricted.positionKey, null);
  assert.match(restricted.notice, /Study stops hides the matching position/);
  const firstFen = fenAfter('e4');
  const visible = matchAt(pgn, firstFen);
  assert.equal(resolveReviewNavigation(pgn, visible, firstFen, true).path, visible.path);
  const none = '1. e4 e5 *', noneFen = fenAfter('e4', 'e5');
  assert.equal(resolveReviewNavigation(none, matchAt(none, noneFen), noneFen, true).notice, null);
});
