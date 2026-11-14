import assert from 'node:assert/strict';
import { test } from 'node:test';
import { KindlePlayGame, PlayError } from '../electron/kindle-play-game.mjs';

test('Black opening is atomic, SAN and identity survive turns and resignation', async () => {
  const game = new KindlePlayGame({ now: () => '2026-11-10T12:00:00.000Z', id: () => 'session' });
  await assert.rejects(Promise.resolve().then(() => game.start(1500, 'black', () => 'bad')), { code: 'ENGINE_UNAVAILABLE' });
  assert.equal(game.snapshot(), null);
  const start = await game.start(1500, 'black', () => 'e2e4');
  assert.equal(start.gameId, 'session'); assert.equal(start.playerColor, 'black');
  assert.deepEqual(start.sanMoves, ['e4']); assert.equal(start.ply, 1);
  assert.equal(start.lastMoveAt, start.startedAt);
  const moved = await game.move('e7e5', 1, () => 'g1f3');
  assert.deepEqual(moved.sanMoves, ['e4', 'e5', 'Nf3']);
  assert.equal(game.resign().result.outcome, 'white_win');
  assert.equal(game.snapshot().lastMoveAt, moved.lastMoveAt);
});

test('Black opening timeout, busy and failed replacement preserve prior snapshot', async () => {
  const game = new KindlePlayGame(); game.start(1500); game.resign();
  const previous = game.snapshot(); let fail;
  const pending = game.start(1500, 'black', () => new Promise((_, reject) => { fail = reject; }));
  assert.throws(() => game.start(1500), { code: 'BUSY' });
  assert.deepEqual(game.snapshot(), previous);
  fail(new PlayError(504, 'ENGINE_TIMEOUT', 'timeout'));
  await assert.rejects(pending, { code: 'ENGINE_TIMEOUT' });
  assert.deepEqual(game.snapshot(), previous);
});

test('Black human mate skips reply and White Maia mate finishes at odd ply', async () => {
  const game = new KindlePlayGame();
  await game.start(1500, 'black', () => 'f2f3');
  await game.move('e7e5', 1, () => 'g2g4');
  const humanMate = await game.move('d8h4', 3, () => { throw Error('Must not search'); });
  assert.equal(humanMate.ply, 4); assert.equal(humanMate.result.outcome, 'black_win');
  assert.equal(humanMate.sanMoves.at(-1), 'Qh4#');
  await game.start(1500, 'black', () => 'e2e4');
  await game.move('e7e5', 1, () => 'd1h5');
  await game.move('b8c6', 3, () => 'f1c4');
  const maiaMate = await game.move('g8f6', 5, () => 'h5f7');
  assert.equal(maiaMate.ply, 7); assert.equal(maiaMate.result.outcome, 'white_win');
  assert.equal(maiaMate.sanMoves.at(-1), 'Qxf7#');
});

test('timestamps only advance with successful committed moves and SAN covers castling/en passant', async () => {
  let time = '2026-11-10T12:00:00.000Z';
  const game = new KindlePlayGame({ now: () => time });
  const start = game.start(1500);
  time = '2026-11-10T12:01:00.000Z';
  await assert.rejects(game.move('e2e4', 0, () => 'bad'));
  assert.equal(game.snapshot().lastMoveAt, null);
  await game.move('e2e4', 0, () => 'e7e5');
  await game.move('g1f3', 2, () => 'b8c6');
  await game.move('f1c4', 4, () => 'g8f6');
  const castle = await game.move('e1g1', 6, () => 'f8e7');
  assert.equal(castle.sanMoves[6], 'O-O');
  assert.equal(castle.lastMoveAt, time); assert.equal(castle.startedAt, start.startedAt);
  time = '2026-11-10T12:02:00.000Z';
  assert.equal(game.resign().lastMoveAt, castle.lastMoveAt);
  game.start(1500);
  await game.move('e2e4', 0, () => 'a7a6');
  await game.move('e4e5', 2, () => 'd7d5');
  assert.equal((await game.move('e5d6', 4, () => 'e7d6')).sanMoves[4], 'exd6');
});
