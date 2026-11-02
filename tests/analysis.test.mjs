import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analysisKey, appendMove, linePreview, replayPosition, sourcePosition, switchSideToMove } from '../src/analysis.mjs';
const fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
test('temporary branches validate moves and never mutate their source', () => {
  const root = replayPosition(fen, ['e2e4']);
  const branch = appendMove(root, 'e7', 'e5');
  assert.deepEqual(root.moves, ['e2e4']);
  assert.deepEqual(branch.sans, ['e4', 'e5']);
  assert.throws(() => appendMove(root, 'e7', 'e4'));
  assert.deepEqual(linePreview(root, ['c7c5', 'g1f3', 'illegal']).map(item => item.san), ['c5', 'Nf3']);
});
test('custom FENs and underpromotion preserve full setup and history', () => {
  const custom = replayPosition('7k/P7/8/8/8/8/8/7K w - - 0 25', []);
  assert.equal(appendMove(custom, 'a7', 'a8', 'knight').moves[0], 'a7a8n');
});

test('switching turns preserves pieces, castling and counters, clears en passant and starts a new line', () => {
  const current = replayPosition(fen, ['e2e4', 'a7a6', 'e4e5', 'd7d5']);
  assert.equal(current.fen.split(' ')[3], 'd6');
  const switched = switchSideToMove(current);
  assert.equal(switched.turn, 'black');
  assert.deepEqual(switched.fen.split(' '), current.fen.split(' ').map((field, i) => i === 1 ? 'b' : i === 3 ? '-' : field));
  assert.deepEqual(switched.moves, []);
  assert.equal(switched.initialFen, switched.fen);
  assert.equal(current.turn, 'white');
  assert.equal(current.moves.length, 4);
  assert.deepEqual(switchSideToMove(switched).fen.split(' ').slice(0, 3), current.fen.split(' ').slice(0, 3));
});

test('switching turns cannot leave the nonmoving king in check', () => {
  const checked = replayPosition('4k3/8/8/8/8/8/8/K3R3 b - - 0 1', []);
  assert.throws(() => switchSideToMove(checked));
  assert.equal(checked.turn, 'black');
});
test('cache distinguishes same board with different histories and model settings', () => {
  const root = replayPosition(fen, []);
  const repeated = replayPosition(fen, ['g1f3', 'g8f6', 'f3g1', 'f6g8']);
  assert.notEqual(analysisKey(root, 'maia', { rating: 1500 }), analysisKey(repeated, 'maia', { rating: 1500 }));
  assert.notEqual(analysisKey(root, 'maia', { rating: 1500 }), analysisKey(root, 'maia', { rating: 1800 }));
});
test('source history follows selected variation rather than mainline', () => {
  const viewer = { path: { path: 'aabb' }, game: { initial: { fen }, moves: { children: [{ data: { path: { path: 'aa' }, uci: 'd2d4' }, children: [{ data: { path: { path: 'aabb' }, uci: 'd7d5' }, children: [] }] }] } } };
  assert.deepEqual(sourcePosition(viewer).moves, ['d2d4', 'd7d5']);
});
