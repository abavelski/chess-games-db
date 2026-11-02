import test from 'node:test';
import assert from 'node:assert/strict';
import { OPENING_START_FEN, openingBoard, appendOpeningMove, openingAnchor } from '../src/opening-session.mjs';
const initial = { mode: 'prefix', rootFen: OPENING_START_FEN, moves: [], filters: {} };
test('all move entry uses strict legal replay and canonical castling', () => {
  assert.deepEqual(appendOpeningMove(initial, 'e2e4').moves, ['e2e4']);
  assert.throws(() => appendOpeningMove(initial, 'e2e5'), /illegal/);
  const castle = { ...initial, rootFen: 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1' };
  assert.deepEqual(appendOpeningMove(castle, 'e1g1').moves, ['e1h1']);
  assert.deepEqual(openingBoard(castle.rootFen, ['e1h1']).sans, ['O-O']);
});
test('promotion, setup counters, terminal positions and explicit anchors retain their roots', () => {
  const promotion = openingAnchor(initial, '4k3/P7/8/8/8/8/8/4K3 w - - 17 42');
  const next = appendOpeningMove(promotion, 'a7a8n');
  assert.equal(next.mode, 'position'); assert.equal(next.rootFen, promotion.rootFen);
  assert.match(openingBoard(next.rootFen, next.moves).fen, /^N3k3\//);
  assert.equal(openingBoard('7k/6Q1/6K1/8/8/8/8/8 b - - 0 1').position.hasDests(), false);
  assert.throws(() => openingAnchor(initial, '4k3/8/8/8/8/8/8/4K3 w K - 0 1'), /metadata/);
  const original = appendOpeningMove(initial, 'g1f3');
  const anchor = openingAnchor(original, openingBoard(original.rootFen, original.moves).fen);
  assert.deepEqual(original.moves, ['g1f3']); assert.deepEqual(anchor.moves, []);
});
