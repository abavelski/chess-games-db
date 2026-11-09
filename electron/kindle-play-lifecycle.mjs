import { readFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { join } from 'node:path';
import { once } from 'node:events';
import { engineFailureLogger } from './engine-log.mjs';
import { KindlePlayMaia } from './kindle-play-maia.mjs';
import { createKindlePlayServer } from './kindle-play-http.mjs';

export function validateServerConfig(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['enabled', 'host', 'port'].includes(key)) || typeof input.enabled !== 'boolean') throw new Error('Expected enabled boolean and optional host/port in kindle-play-server.json.');
  const { enabled, host = '127.0.0.1', port = 8765 } = input;
  if (typeof host !== 'string' || !isIP(host)) throw new Error('Kindle play host must be an IPv4 or IPv6 address.');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Kindle play port must be an integer in 1..65535.');
  return { enabled, host, port };
}

export async function startKindlePlayServer(app, settings, { log, createMaia = input => new KindlePlayMaia(input) } = {}) {
  const fileLog = engineFailureLogger(join(app.getPath('userData'), 'logs', 'kindle-play-server.log'));
  const report = log ?? ((message, error) => {
    console[error ? 'warn' : 'info'](message, error?.message ?? '');
    fileLog({ message, ...(error ? { error: error.message, trace: error.trace, stderr: error.stderr } : {}) });
  });
  let server, maia, close;
  try {
    let input;
    try { input = JSON.parse(readFileSync(join(app.getPath('userData'), 'kindle-play-server.json'), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    const config = validateServerConfig(input);
    if (!config.enabled) return null;
    maia = createMaia(settings);
    maia.log = report;
    server = createKindlePlayServer({ maia, log: report });
    close = () => { maia.close(); server.close(); server.closeAllConnections(); };
    app.once('will-quit', close);
    server.on('error', error => report('Kindle play server error', error));
    const listening = once(server, 'listening');
    server.listen(config.port, config.host);
    await listening;
    const address = server.address();
    report(`Kindle play server listening on ${address.family === 'IPv6' ? '[' + address.address + ']' : address.address}:${address.port} (trusted LAN only)`);
    return { server, maia, close };
  } catch (error) {
    report('Could not start Kindle play server', error);
    if (close) { app.removeListener('will-quit', close); close(); }
    else maia?.close();
    return null;
  }
}
