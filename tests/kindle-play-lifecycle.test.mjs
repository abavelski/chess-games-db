import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter, once } from 'node:events';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { runInNewContext } from 'node:vm';
import { createKindlePlayController, registerKindlePlayIpc, validateServerConfig } from '../electron/kindle-play-lifecycle.mjs';
import { loadEngineSettings } from '../electron/engine-settings.mjs';

test('strict opt-in configuration', () => {
  assert.deepEqual(validateServerConfig({ enabled: true }), { enabled: true, host: '127.0.0.1', port: 8765 });
  for (const config of [{}, null, [], { enabled: 1 }, { enabled: true, port: 0 }, { enabled: true, port: 65536 }, { enabled: true, host: 'localhost' }, { enabled: true, secret: 'bad' }]) assert.throws(() => validateServerConfig(config));
});

async function fixture(t, options = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'kindle-lifecycle-'));
  const app = Object.assign(new EventEmitter(), { getPath: () => directory });
  const occupied = createServer(); occupied.listen(0, '127.0.0.1'); await once(occupied, 'listening');
  const port = occupied.address().port;
  await new Promise(resolve => occupied.close(resolve));
  const config = join(directory, 'kindle-play-server.json');
  writeFileSync(config, JSON.stringify({ enabled: true, host: '127.0.0.1', port }));
  if (options.configBytes === null) unlinkSync(config);
  else if (options.configBytes !== undefined) writeFileSync(config, options.configBytes);
  let created = 0, closed = 0;
  const controller = createKindlePlayController(app, {}, { log: () => {}, createMaia: () => {
    created++; return { available: () => false, move: () => 'e7e5', close: () => { closed++; }, ...options.maia };
  }, now: () => '2026-11-09T12:00:00.000Z' });
  t.after(async () => { await controller.close(); rmSync(directory, { recursive: true, force: true }); });
  const call = async (path, body) => {
    const response = await fetch(`http://127.0.0.1:${port}/api/v1/${path}`, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  return { controller, app, port, config, call, counts: () => ({ created, closed }) };
}

test('missing, disabled and malformed boot preferences never start or rewrite config', async t => {
  for (const configBytes of [null, '{"enabled":false}', '{']) {
    const f = await fixture(t, { configBytes });
    assert.equal(f.controller.status().listener, 'stopped');
    assert.deepEqual(f.counts(), { created: 0, closed: 0 });
    if (configBytes !== null) assert.equal(readFileSync(f.config, 'utf8'), configBytes);
    else assert.equal(f.controller.status().port, 8765);
  }
});

test('legacy enabled config stays stopped; manual duplicate starts/stops, restart and quit', async t => {
  const f = await fixture(t), c = f.controller;
  assert.equal(c.status().listener, 'stopped'); assert.equal(c.status().game, null);
  assert.deepEqual(f.counts(), { created: 0, closed: 0 });
  const starting = c.start(); assert.equal(c.status().listener, 'starting');
  await Promise.all([starting, c.start()]);
  assert.equal(c.status().listener, 'listening'); assert.equal(c.status().address.port, f.port);
  assert.equal((await f.call('health')).body.maiaAvailable, false);
  await f.call('games', { rating: 1500 });
  assert.equal(c.status().game.lastMoveAt, null);
  await f.call('games/current/moves', { uci: 'e2e4', expectedPly: 0 });
  assert.equal(c.status().game.lastMoveAt, '2026-11-09T12:00:00.000Z');
  assert.equal(c.status().maia.activity, 'idle');
  const saved = c.status().game;
  assert.equal((await f.call('games/current/moves', { uci: 'g1f3', expectedPly: 0 })).status, 409);
  assert.equal((await f.call('games/current/moves', { uci: 'a1a8', expectedPly: 2 })).status, 422);
  assert.deepEqual(c.status().game, saved);
  await f.call('games/current'); await f.call('games/current/resign', {});
  assert.equal(c.status().game.lastMoveAt, saved.lastMoveAt);
  await Promise.all([c.stop(), c.stop()]);
  await assert.rejects(f.call('health'));
  await c.start(); assert.equal(c.status().game.ply, 2);
  assert.equal(c.status().game.status, 'finished');
  f.app.emit('will-quit'); await c.close();
  await assert.rejects(f.call('health'));
  assert.deepEqual(f.counts(), { created: 2, closed: 2 });
});

test('bind error and invalid config are sanitized, recoverable and preserve config bytes', async t => {
  const f = await fixture(t), c = f.controller;
  const occupied = createServer(); occupied.listen(f.port, '127.0.0.1'); await once(occupied, 'listening');
  t.after(() => occupied.close());
  assert.equal((await c.start()).listener, 'error');
  assert.match(c.status().error, /port/i); assert.equal(c.status().address, null);
  await new Promise(resolve => occupied.close(resolve));
  assert.equal((await c.start()).listener, 'listening'); await c.stop();
  for (const bytes of ['{', '{"enabled":true,"future":"private-path"}']) {
    writeFileSync(f.config, bytes);
    assert.equal((await c.start()).listener, 'error');
    assert.equal(readFileSync(f.config, 'utf8'), bytes);
    assert.doesNotMatch(JSON.stringify(c.status()), /private-path|SyntaxError/);
  }
  writeFileSync(f.config, JSON.stringify({ enabled: false, host: '127.0.0.1', port: f.port }));
  assert.equal((await c.start()).listener, 'listening');
});

test('stop cancels a pending provider, preserves committed turn and permits restart', async t => {
  let entered, reply;
  const pending = new Promise(resolve => { entered = resolve; });
  const f = await fixture(t, { maia: { move: () => { entered(); return new Promise(resolve => { reply = resolve; }); } } });
  const c = f.controller; await c.start(); await f.call('games', { rating: 1500 });
  const request = f.call('games/current/moves', { uci: 'e2e4', expectedPly: 0 }).catch(() => null);
  await pending; assert.equal(c.status().maia.activity, 'thinking');
  const stopping = c.stop(); assert.equal(c.status().listener, 'stopping');
  await stopping; await request;
  assert.equal(c.status().game.ply, 0); assert.equal(c.status().game.lastMoveAt, null);
  reply('e7e5'); await c.start();
  assert.equal((await f.call('games/current')).body.ply, 0);
});

test('stop during startup and immediate restart serialize one listener and close each provider once', async t => {
  const f = await fixture(t), c = f.controller;
  const first = c.start(), stop = c.stop(), restart = c.start();
  await Promise.all([first, stop, restart]);
  assert.equal(c.status().listener, 'listening');
  assert.deepEqual(f.counts(), { created: 2, closed: 1 });
  await c.stop(); assert.deepEqual(f.counts(), { created: 2, closed: 2 });
});

test('IPC authorizes every action and rejects unexpected arguments', async t => {
  const f = await fixture(t), handlers = new Map();
  registerKindlePlayIpc({ ipcMain: { handle: (name, fn) => handlers.set(name, fn) }, controller: f.controller, authorize: event => event.allowed });
  for (const action of ['status', 'start', 'stop']) {
    const run = handlers.get('kindle-play:' + action);
    assert.throws(() => run({ allowed: false }), /denied/);
    assert.throws(() => run({ allowed: true }, { host: '0.0.0.0' }), /arguments/);
    assert.ok(await run({ allowed: true }));
  }
});

test('shared settings use a whole validated profile and packaged defaults', t => {
  const directory = mkdtempSync(join(tmpdir(), 'kindle-settings-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const app = { getPath: () => directory, isPackaged: true };
  assert.equal(loadEngineSettings(app).pythonPath, '');
  writeFileSync(join(directory, 'engines.json'), JSON.stringify({ pythonPath: 'chosen-python', device: 'cpu' }));
  assert.equal(loadEngineSettings(app).pythonPath, 'chosen-python');
  assert.equal(loadEngineSettings(app).checkpointPath, '');
  writeFileSync(join(directory, 'engines.json'), '{'); assert.equal(loadEngineSettings(app).pythonPath, '');
});

test('preload exposes a frozen narrow Kindle API without renderer arguments', async () => {
  const exposed = {}, calls = [];
  runInNewContext(readFileSync(new URL('../electron/preload.cjs', import.meta.url), 'utf8'), {
    require: () => ({ contextBridge: { exposeInMainWorld: (name, api) => { exposed[name] = api; } }, ipcRenderer: { invoke: (...args) => { calls.push(args); return Promise.resolve({}); } } }),
  });
  assert.ok(Object.isFrozen(exposed.kindlePlay));
  assert.deepEqual(Object.keys(exposed.kindlePlay), ['status', 'start', 'stop']);
  for (const action of ['status', 'start', 'stop']) await exposed.kindlePlay[action]({ host: 'unsafe' });
  assert.deepEqual(calls, [['kindle-play:status'], ['kindle-play:start'], ['kindle-play:stop']]);
});
