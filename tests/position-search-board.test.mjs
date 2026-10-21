import test from 'node:test';
import assert from 'node:assert/strict';
import { positionFingerprint } from '../lib/position-hash.mjs';
import {
  INITIAL_POSITION_FEN, positionBoard, positionPiece, positionLegalTargets,
  positionNeedsPromotion, playPositionMove,
} from '../src/position-search-board.mjs';

const apply = (moves, from, to, promotion) => playPositionMove(moves, from, to, promotion);

test('position board starts orthodox, obeys side to move, only commits legal moves', () => {
  const root = positionBoard();
  assert.equal(root.fen, INITIAL_POSITION_FEN);
  assert.equal(root.turn, 'white');
  assert.equal(root.sans.length, 0);
  assert.equal(positionPiece(root, 'e2').role, 'pawn');
  assert.equal(positionPiece(root, 'e2').color, 'white');
  assert.deepEqual(positionLegalTargets(root, 'e2'), ['e3', 'e4']);
  assert.deepEqual(positionLegalTargets(root, 'e7'), []);
  assert.throws(() => apply([], 'e2', 'e5'), /Illegal move/);
  assert.throws(() => apply([], 'e7', 'e5'), /Illegal move/);
  const initial = [];
  const moves = apply(initial, 'e2', 'e4');
  assert.deepEqual(initial, [], 'playing does not mutate earlier history');
  assert.equal(positionBoard(moves).turn, 'black');
  assert.deepEqual(positionBoard(moves).sans, ['e4']);
  assert.equal(positionBoard(moves).fen.split(' ')[1], 'b');
  assert.deepEqual(positionLegalTargets(positionBoard(moves), 'e2'), []);
  assert.deepEqual(positionLegalTargets(positionBoard(moves), 'e7'), ['e5', 'e6']);
  assert.deepEqual(positionBoard(moves.slice(0,-1)).fen, root.fen, 'undo restores exact starting FEN');
  assert.equal(positionBoard([]).fen, root.fen, 'reset restores exact starting FEN');
});

test('transpositions produce identical FEN; castling rights and turn are tracked', () => {
  const first = ['g1f3', 'g8f6', 'g2g3', 'g7g6'];
  const second = ['g2g3', 'g7g6', 'g1f3', 'g8f6'];
  const a = positionBoard(first), b = positionBoard(second);
  assert.equal(a.fen.split(' ').slice(0, 4).join(' '), b.fen.split(' ').slice(0, 4).join(' '));
  assert.equal(positionFingerprint(a.fen).hash, positionFingerprint(b.fen).hash);
  assert.notDeepEqual(a.sans, b.sans);
  const castleBefore = positionBoard(['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4', 'g8f6']);
  assert.ok(positionLegalTargets(castleBefore, 'e1').includes('g1'));
  const castleAfter = apply(castleBefore.moves, 'e1', 'g1');
  const state = positionBoard(castleAfter);
  assert.equal(state.sans.at(-1), 'O-O');
  assert.equal(state.turn, 'black');
  assert.equal(state.fen.split(' ')[2], 'kq');
  assert.equal(positionPiece(state, 'g1').role, 'king');
  assert.equal(positionPiece(state, 'f1').role, 'rook');
});

test('position-search model refuses invalid histories or promotion choices', () => {
  for (const bad of [null, {}, 'e2e4', ['illegal'], Array(2049).fill('e2e4')]) {
    assert.throws(() => positionBoard(bad), /Invalid|move/i);
  }
  assert.throws(() => apply([], 'e2', 'e4', 'elephant'), /promotion/i);
  assert.equal(positionNeedsPromotion(positionBoard(), 'e2', 'e4'), false);
  assert.equal(positionNeedsPromotion(positionBoard(), 'e2', 'e8'), false);
  assert.deepEqual(positionLegalTargets(positionBoard(), 'a8'), []);
});
