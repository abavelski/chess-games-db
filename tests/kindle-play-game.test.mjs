import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Chess } from 'chessops/chess';
import { parseFen, makeFen } from 'chessops/fen';
import { KindlePlayGame, initialFen, applyUci, terminalResult } from '../electron/kindle-play-game.mjs';
const position = fen => Chess.fromSetup(parseFen(fen).unwrap()).unwrap();

test('game snapshots, rating bounds, legal transaction, stale ply, resign and replacement', async () => {
  const game = new KindlePlayGame();
  assert.equal(game.snapshot(), null);
  for (const rating of [undefined, 599, 650, 2700, '1500']) assert.throws(() => game.start(rating), { code: 'BAD_REQUEST' });
  const start = game.start(1500);
  assert.equal(start.fen, initialFen); assert.equal(start.ply, 0);
  assert.throws(() => game.start(1500), { status: 409 });
  start.moves.push('bad'); assert.deepEqual(game.snapshot().moves, []);
  await assert.rejects(game.move('e2e5', 0, () => 'e7e5'), { code: 'ILLEGAL_MOVE' });
  await assert.rejects(game.move('e2e4', 1, () => 'e7e5'), { code: 'STALE_PLY' });
  const moved = await game.move('e2e4', 0, () => 'e7e5');
  assert.deepEqual(moved.moves, ['e2e4', 'e7e5']); assert.equal(moved.ply, 2);
  const expected = Chess.default(); applyUci(expected, 'e2e4'); applyUci(expected, 'e7e5');
  assert.equal(moved.fen, makeFen(expected.toSetup()));
  assert.deepEqual(game.resign().result, { outcome: 'black_win', reason: 'resignation' });
  await assert.rejects(game.move('g1f3', 2, () => 'b8c6'), { code: 'GAME_FINISHED' });
  assert.equal(game.start(600).ply, 0);
});

test('rollback and busy isolation keep half moves private', async () => {
  const game = new KindlePlayGame(); const start = game.start(1500);
  let reject;
  const pending = game.move('e2e4', 0, () => new Promise((_, fail) => { reject = fail; }));
  assert.deepEqual(game.snapshot(), start);
  assert.throws(() => game.resign(), { code: 'BUSY' });
  assert.throws(() => game.start(1500), { code: 'BUSY' });
  reject(new Error('crash')); await assert.rejects(pending, { code: 'ENGINE_UNAVAILABLE' });
  await assert.rejects(game.move('e2e4', 0, () => 'e7e4'), { code: 'ENGINE_UNAVAILABLE' });
  assert.deepEqual(game.snapshot(), start);
});

test('checkmate after engine and human moves, automatic repetition', async () => {
  const game = new KindlePlayGame(); game.start(1500);
  await game.move('f2f3', 0, () => 'e7e5');
  assert.deepEqual((await game.move('g2g4', 2, () => 'd8h4')).result, { outcome: 'black_win', reason: 'checkmate' });
  game.start(1500);
  await game.move('e2e4', 0, () => 'e7e5'); await game.move('d1h5', 2, () => 'b8c6'); await game.move('f1c4', 4, () => 'g8f6');
  assert.equal((await game.move('h5f7', 6, () => { throw Error('must not search'); })).result.outcome, 'white_win');
  game.start(1500);
  for (let i = 0; i < 8; i++) await game.move(i % 2 ? 'f3g1' : 'g1f3', i * 2, () => i % 2 ? 'f6g8' : 'g8f6');
  assert.equal(game.snapshot().result.reason, 'draw');
});

test('castling, promotion, en passant and terminal classification', () => {
  const castle = position('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
  assert.throws(() => applyUci(castle, 'e1h1'), { code: 'ILLEGAL_MOVE' });
  assert.equal(applyUci(castle, 'e1g1'), 'e1g1');
  assert.equal(applyUci(castle, 'e8a8', true), 'e8c8');
  assert.match(makeFen(castle.toSetup()), /^2kr3r\/8\/8\/8\/8\/8\/8\/R4RK1/);
  for (const promotion of ['q', 'r', 'b', 'n']) {
    const pos = position('7k/P7/8/8/8/8/8/7K w - - 0 1');
    assert.equal(applyUci(pos, 'a7a8' + promotion), 'a7a8' + promotion);
  }
  const ep = Chess.default(); for (const uci of ['e2e4','a7a6','e4e5','d7d5','e5d6']) applyUci(ep, uci);
  assert.equal(ep.board.get(35), undefined);
  assert.equal(terminalResult(position('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1')).reason, 'stalemate');
  assert.equal(terminalResult(position('7k/8/6K1/8/8/8/8/8 w - - 0 1')).reason, 'draw');
  assert.equal(terminalResult(position('7k/8/6K1/8/8/8/8/R7 w - - 150 80')).reason, 'draw');
});
