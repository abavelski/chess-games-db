import { createKindleStudyPersistence } from './kindle-play-studies.mjs';
import { readFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { join } from 'node:path';
import { once } from 'node:events';
import { engineFailureLogger } from './engine-log.mjs';
import { KindlePlayMaia } from './kindle-play-maia.mjs';
import { createKindlePlayServer } from './kindle-play-http.mjs';
import { KindlePlayGame, PlayError } from './kindle-play-game.mjs';

export function validateServerConfig(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['enabled', 'host', 'port'].includes(key)) || typeof input.enabled !== 'boolean') throw new Error('Expected enabled boolean and optional host/port in kindle-play-server.json.');
  const { enabled, host = '127.0.0.1', port = 8765 } = input;
  if (typeof host !== 'string' || !isIP(host)) throw new Error('Kindle play host must be an IPv4 or IPv6 address.');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Kindle play port must be an integer in 1..65535.');
  return { enabled, host, port };
}

const controllers = new WeakMap();

export function createKindlePlayController(app, settings, { store, log, createMaia = input => new KindlePlayMaia(input), now = () => new Date().toISOString() } = {}) {
  if (controllers.has(app)) return controllers.get(app);
  const fileLog = engineFailureLogger(join(app.getPath('userData'), 'logs', 'kindle-play-server.log'));
  const report = log ?? ((message, error) => {
    console[error ? 'warn' : 'info'](message, error?.message ?? '');
    fileLog({ message, ...(error ? { error: error.message, trace: error.trace, stderr: error.stderr } : {}) });
  });
  const game = new KindlePlayGame({ now, ...(store ? { persist: createKindleStudyPersistence(store) } : {}) });
  const availability = new KindlePlayMaia(settings);
  let config = { host: '127.0.0.1', port: 8765 }, configError = false;
  let listener = 'stopped', error = null, server = null, maia = null;
  let starting, stopping, thinking = false, activeMove = null, cancelMove = null;
  let quitting = false;
  function readConfig() {
    configError = false;
    try {
      config = validateServerConfig(JSON.parse(readFileSync(join(app.getPath('userData'), 'kindle-play-server.json'), 'utf8')));
    } catch (failure) {
      if (failure.code === 'ENOENT') config = { host: '127.0.0.1', port: 8765 };
      else { configError = true; report('Invalid Kindle play bind preferences', failure); }
    }
  }
  readConfig();
  function status() {
    let configured = false, available = false;
    try {
      const input = typeof settings === 'function' ? settings() : settings;
      configured = Boolean(input?.pythonPath && input?.checkpointPath);
      available = maia ? maia.available() : availability.available();
    } catch { /* Never expose settings or raw engine errors. */ }
    const snapshot = game.snapshot();
    const address = server?.address();
    return {
      listener, host: config.host, port: config.port,
      address: address && typeof address === 'object' ? { host: address.address, port: address.port, family: address.family } : null,
      maia: { configured, available, activity: thinking ? 'thinking' : 'idle' },
      game: snapshot ? { status: snapshot.status, result: snapshot.result, rating: snapshot.rating, playerColor: snapshot.playerColor, ply: snapshot.ply, lastMoveAt: snapshot.lastMoveAt } : null,
      error,
      securityNotice: 'Bind to 0.0.0.0 only on trusted private Wi-Fi. No TLS or authentication.',
    };
  }
  const controller = {
    status,
    start() {
      if (quitting || listener === 'listening') return Promise.resolve(status());
      if (stopping) return stopping.then(() => controller.start());
      if (starting) return starting;
      listener = 'starting'; error = null;
      starting = (async () => {
        try {
          readConfig();
          if (configError) throw new Error('Invalid bind preferences');
          maia = createMaia(settings); maia.log = report;
          const provider = {
            available: () => maia.available(),
            move(input) {
              thinking = true;
              const engine = maia;
              const canceled = new Promise((_, reject) => { cancelMove = () => reject(new PlayError(503, 'ENGINE_UNAVAILABLE', 'Desktop listener stopped. Refresh before retrying.')); });
              activeMove = Promise.race([canceled, Promise.resolve().then(() => engine.move(input))])
                .finally(() => { thinking = false; cancelMove = null; });
              return activeMove;
            },
          };
          server = createKindlePlayServer({ maia: provider, game, log: report,
            accepting: () => listener === 'listening',
          });
          server.on('error', failure => report('Kindle play server error', failure));
          const ready = once(server, 'listening');
          server.listen(config.port, config.host);
          await ready;
          if (listener === 'starting') listener = 'listening';
          report(`Kindle play server listening on ${config.host}:${config.port} (trusted LAN only)`);
        } catch (failure) {
          report('Could not start Kindle play server', failure);
          maia?.close(); maia = null;
          server?.close(); server?.closeAllConnections(); server = null;
          listener = 'error';
          error = configError ? 'Invalid kindle-play-server.json. Correct bind preferences and retry.' : failure.code === 'EADDRINUSE' ? 'The configured port is already in use. Stop the other listener and retry.' : 'Could not start the listener. Check desktop logs and bind preferences.';
        }
        return status();
      })().finally(() => { starting = null; });
      return starting;
    },
    stop() {
      if (stopping) return stopping;
      if (!starting && !server && !maia) { listener = 'stopped'; error = null; return Promise.resolve(status()); }
      listener = 'stopping';
      const startup = starting;
      // Cancel before closing sockets so no pending engine result can commit a turn.
      cancelMove?.(); maia?.close(); maia = null;
      stopping = (async () => {
        if (startup) await startup;
        cancelMove?.();
        if (maia) { maia.close(); maia = null; }
        if (server) {
          const closing = new Promise(resolve => server.close(resolve));
          server.closeAllConnections();
          await closing; server = null;
        }
        if (activeMove) { await activeMove.catch(() => {}); activeMove = null; }
        listener = 'stopped'; error = null;
        return status();
      })().finally(() => { stopping = null; });
      return stopping;
    },
    close() { quitting = true; return controller.stop(); },
  };
  app.once('will-quit', () => { void controller.close(); });
  controllers.set(app, controller);
  return controller;
}

export function registerKindlePlayIpc({ ipcMain, controller, authorize }) {
  for (const action of ['status', 'start', 'stop']) {
    ipcMain.handle('kindle-play:' + action, (event, ...args) => {
      if (!authorize(event)) throw Error('Kindle play access denied.');
      if (args.length) throw Error('Kindle play actions accept no arguments.');
      return controller[action]();
    });
  }
}
