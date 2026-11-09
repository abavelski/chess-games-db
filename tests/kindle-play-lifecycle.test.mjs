import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter, once } from 'node:events';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { startKindlePlayServer, validateServerConfig } from '../electron/kindle-play-lifecycle.mjs';
import { loadEngineSettings } from '../electron/engine-settings.mjs';

test('strict opt-in configuration', () => {
  assert.deepEqual(validateServerConfig({ enabled: true }), { enabled: true, host: '127.0.0.1', port: 8765 });
  for (const config of [{}, null, [], { enabled: 1 }, { enabled: true, port: 0 }, { enabled: true, port: 65536 }, { enabled: true, host: 'localhost' }, { enabled: true, secret: 'bad' }]) assert.throws(() => validateServerConfig(config));
});

test('disabled/missing/invalid config is harmless; bind failure and shutdown clean up', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'kindle-lifecycle-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const app = Object.assign(new EventEmitter(), { getPath: () => directory, isPackaged: true });
  const config = join(directory, 'kindle-play-server.json');
  const logs = []; let created = 0, closed = 0;
  const options = { log: (...entry) => logs.push(entry), createMaia: () => { created++; return { available: () => false, close: () => { closed++; } }; } };
  assert.equal(await startKindlePlayServer(app, {}, options), null);
  writeFileSync(config, JSON.stringify({ enabled: false })); assert.equal(await startKindlePlayServer(app, {}, options), null);
  writeFileSync(config, '{'); assert.equal(await startKindlePlayServer(app, {}, options), null);
  assert.equal(created, 0); assert.match(logs[0][0], /Could not start/);
  const occupied = createServer(); occupied.listen(0, '127.0.0.1'); await once(occupied, 'listening');
  const port = occupied.address().port;
  writeFileSync(config, JSON.stringify({ enabled: true, host: '127.0.0.1', port }));
  assert.equal(await startKindlePlayServer(app, {}, options), null);
  assert.equal(closed, 1); assert.equal(app.listenerCount('will-quit'), 0);
  await new Promise(resolve => occupied.close(resolve));
  const running = await startKindlePlayServer(app, {}, options);
  assert.ok(running); assert.match(logs.at(-1)[0], new RegExp(`127.0.0.1:${port}`));
  assert.deepEqual(await (await fetch(`http://127.0.0.1:${port}/api/v1/health`)).json(), { apiVersion: 1, maiaAvailable: false });
  const stopped = once(running.server, 'close'); app.emit('will-quit'); await stopped;
  assert.equal(closed, 2); assert.equal(running.server.listening, false);
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
