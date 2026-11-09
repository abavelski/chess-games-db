import assert from 'node:assert/strict';
import { test } from 'node:test';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { Chess } from 'chessops/chess';
import { makeFen } from 'chessops/fen';
import { createKindlePlayServer } from '../electron/kindle-play-http.mjs';
import { applyUci, initialFen, PlayError } from '../electron/kindle-play-game.mjs';
import { KindlePlayMaia } from '../electron/kindle-play-maia.mjs';
import { UciProcess } from '../electron/engines.mjs';
import { fileURLToPath } from 'node:url';

async function setup(t, maia = { available: () => true, move: () => 'e7e5' }) {
  const server = createKindlePlayServer({ maia }); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  return async (path, body, options = {}) => {
    const response = await fetch(base + '/api/v1/' + path, { method: body === undefined ? 'GET' : 'POST', ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }), ...options });
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('content-type'), 'application/json');
    return { status: response.status, body: await response.json(), headers: response.headers };
  };
}
const move = { uci: 'e2e4', expectedPly: 0 };

test('frozen HTTP game contract, FEN, rejection, resignation and replacement', async t => {
  const call = await setup(t);
  assert.deepEqual((await call('health')).body, { apiVersion: 1, maiaAvailable: true });
  assert.equal((await call('games/current')).body.error.code, 'NO_GAME');
  const created = await call('games', { rating: 1500 }); assert.equal(created.status, 201);
  assert.deepEqual(created.body, { apiVersion: 1, rating: 1500, playerColor: 'white', fen: initialFen, moves: [], ply: 0, status: 'playing', result: null, lastMove: null });
  assert.deepEqual((await call('games/current')).body, created.body);
  assert.equal((await call('games', { rating: 1500 })).status, 409);
  const illegal = await call('games/current/moves', { ...move, uci: 'e2e5' });
  assert.equal(illegal.status, 422); assert.deepEqual(illegal.body.state, created.body);
  const moved = await call('games/current/moves', move); assert.equal(moved.status, 200);
  const position = Chess.default(); applyUci(position, 'e2e4'); applyUci(position, 'e7e5');
  assert.equal(moved.body.fen, makeFen(position.toSetup())); assert.deepEqual(moved.body.moves, ['e2e4','e7e5']); assert.equal(moved.body.lastMove, 'e7e5'); assert.equal(moved.body.ply, 2);
  const stale = await call('games/current/moves', move); assert.equal(stale.status, 409); assert.equal(stale.body.error.code, 'STALE_PLY'); assert.deepEqual(stale.body.state, moved.body);
  assert.deepEqual((await call('games/current')).body, moved.body);
  const resigned = await call('games/current/resign', {}); assert.equal(resigned.status, 200);
  assert.deepEqual(resigned.body.result, { outcome: 'black_win', reason: 'resignation' });
  assert.deepEqual((await call('games/current')).body, resigned.body);
  assert.equal((await call('games/current/moves', { uci: 'g1f3', expectedPly: 2 })).body.error.code, 'GAME_FINISHED');
  assert.equal((await call('games', { rating: 2600 })).status, 201);
});

test('strict bodies, routes, methods, byte limits including chunked upload', async t => {
  const call = await setup(t);
  for (const body of [{}, { rating: 1550 }, { rating: 1500, fen: initialFen }, [], null, { rating: '1500' }]) assert.equal((await call('games', body)).status, 400);
  assert.equal((await call('games', {}, { body: '{' })).status, 400);
  assert.equal((await call('games', {}, { headers: { 'Content-Type': 'text/plain' } })).status, 415);
  assert.equal((await call('games', { rating: 1500, padding: 'a'.repeat(4096) })).status, 413);
  assert.equal((await call('games/current/')).status, 404);
  assert.equal((await call('health?file=engines.json')).status, 404);
  const method = await call('health', {}); assert.equal(method.status, 405); assert.equal(method.headers.get('allow'), 'GET');
  await call('games', { rating: 1500 });
  for (const body of [{ ...move, uci: 'e2e4\nquit' }, { ...move, expectedPly: -1 }, { ...move, expectedPly: 0.5 }, { ...move, fen: initialFen }]) assert.equal((await call('games/current/moves', body)).status, 400);
  assert.equal((await call('games/current/resign', { extra: true })).status, 400);
  // A separate server exercises real chunked HTTP rather than fetch's content-length uploads.
  const server = createKindlePlayServer({ maia: { available: () => false } }); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const status = await new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port: server.address().port, path: '/api/v1/games', method: 'POST', headers: { 'Content-Type': 'application/json', 'Transfer-Encoding': 'chunked' } }, res => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject); req.write('x'.repeat(3000)); req.end('x'.repeat(2000));
  });
  assert.equal(status, 413);
});

test('busy conflicts and 503/504 failures expose unchanged committed state', async t => {
  let reject;
  const call = await setup(t, { available: () => false, move: () => new Promise((_, fail) => { reject = fail; }) });
  assert.equal((await call('health')).body.maiaAvailable, false);
  const start = (await call('games', { rating: 1500 })).body;
  for (const [status, code] of [[503, 'ENGINE_UNAVAILABLE'], [504, 'ENGINE_TIMEOUT']]) {
    const pending = call('games/current/moves', move);
    // Wait for provider entry without relying on network scheduling.
    while (!reject) await new Promise(resolve => setTimeout(resolve, 5));
    for (const [path, body] of [['games/current/moves', move], ['games/current/resign', {}], ['games', { rating: 1500 }]]) {
      const busy = await call(path, body); assert.equal(busy.status, 409); assert.equal(busy.body.error.code, 'BUSY'); assert.deepEqual(busy.body.state, start);
    }
    assert.deepEqual((await call('games/current')).body, start);
    reject(new PlayError(status, code, 'Engine failed')); reject = null;
    const failed = await pending; assert.equal(failed.status, status); assert.equal(failed.body.error.code, code); assert.deepEqual(failed.body.state, start);
    assert.deepEqual((await call('games/current')).body, start);
  }
});

test('HTTP round trip through a real fake-UCI subprocess', async t => {
  const maia = new KindlePlayMaia({ pythonPath: process.execPath, checkpointPath: fileURLToPath(import.meta.url) }, { processFactory: () => new UciProcess(process.execPath, [fileURLToPath(new URL('./fixtures/fake-playing-maia.mjs', import.meta.url))]) });
  t.after(() => maia.close());
  const call = await setup(t, maia);
  await call('games', { rating: 700 });
  assert.deepEqual((await call('games/current/moves', move)).body.moves, ['e2e4','e7e5']);
  assert.equal((await call('games/current/moves', { uci: 'g1f3', expectedPly: 2 })).body.ply, 4);
});
