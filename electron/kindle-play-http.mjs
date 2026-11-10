import { createServer } from 'node:http';
import { KindlePlayGame, PlayError } from './kindle-play-game.mjs';

const routes = new Map([
  ['/api/v1/health', 'GET'], ['/api/v1/games', 'POST'],
  ['/api/v1/games/current', 'GET'], ['/api/v1/games/current/moves', 'POST'],
  ['/api/v1/games/current/resign', 'POST'],
]);
function readJson(request) {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers['content-type'] ?? '')) throw new PlayError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Use application/json with UTF-8 encoding.');
  if (Number(request.headers['content-length']) > 4096) throw new PlayError(413, 'PAYLOAD_TOO_LARGE', 'JSON body exceeds 4 KiB.');
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    request.on('data', chunk => {
      size += chunk.length;
      if (size > 4096) { reject(new PlayError(413, 'PAYLOAD_TOO_LARGE', 'JSON body exceeds 4 KiB.')); return; }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (size > 4096) return;
      try {
        const body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw Error('Expected object');
        resolve(body);
      } catch { reject(new PlayError(400, 'BAD_REQUEST', 'Expected a JSON object.')); }
    });
    request.on('error', reject);
    request.on('aborted', () => reject(new PlayError(400, 'BAD_REQUEST', 'Request was interrupted.')));
  });
}
function fields(body, names) {
  if (Object.keys(body).length !== names.length || names.some(name => !Object.hasOwn(body, name))) throw new PlayError(400, 'BAD_REQUEST', `Expected fields: ${names.join(', ') || 'none'}.`);
}
export function createKindlePlayServer({ maia, game = new KindlePlayGame(), log = console.warn, accepting = () => true }) {
  const server = createServer({ requestTimeout: 10000, headersTimeout: 10000 }, async (request, response) => {
    const route = request.url;
    const send = (status, value, headers = {}) => {
      if (response.destroyed) return;
      response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers });
      response.end(JSON.stringify(value));
    };
    try {
      if (!accepting()) throw new PlayError(503, 'SERVER_STOPPED', 'Desktop listener stopped.');
      const method = routes.get(route);
      if (!method) throw new PlayError(404, 'NOT_FOUND', 'Unknown API route.');
      if (request.method !== method) { response.setHeader('Allow', method); throw new PlayError(405, 'METHOD_NOT_ALLOWED', `Use ${method} for this route.`); }
      if (method === 'GET') {
        if (request.headers['transfer-encoding'] || Number(request.headers['content-length']) > 0) throw new PlayError(400, 'BAD_REQUEST', 'GET requests do not accept a body.');
        if (route === '/api/v1/health') return send(200, { apiVersion: 1, maiaAvailable: maia.available() });
        const state = game.snapshot();
        if (!state) throw new PlayError(404, 'NO_GAME', 'Start a game first.');
        return send(200, state);
      }
      const body = await readJson(request);
      if (!accepting()) throw new PlayError(503, 'SERVER_STOPPED', 'Desktop listener stopped.');
      if (route === '/api/v1/games') {
        fields(body, Object.hasOwn(body, 'playerColor') ? ['rating', 'playerColor'] : ['rating']);
        return send(201, await game.start(body.rating, body.playerColor, input => maia.move(input)));
      }
      if (route.endsWith('/resign')) { fields(body, []); return send(200, game.resign()); }
      fields(body, ['uci', 'expectedPly']);
      return send(200, await game.move(body.uci, body.expectedPly, input => maia.move(input)));
    } catch (error) {
      request.resume();
      if (!(error instanceof PlayError)) log('Kindle play HTTP failure', error);
      const state = routes.has(route) && route !== '/api/v1/health' ? game.snapshot() : null;
      send(error instanceof PlayError ? error.status : 500, {
        error: { code: error instanceof PlayError ? error.code : 'INTERNAL_ERROR', message: error instanceof PlayError ? error.message : 'Desktop server error. Check desktop logs.' },
        ...(state ? { state } : {}),
      });
    }
  });
  return server;
}
