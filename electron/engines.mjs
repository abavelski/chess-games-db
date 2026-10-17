import { Chess } from 'chessops/chess';
import { parseFen } from 'chessops/fen';
import { parseUci } from 'chessops/util';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';

export const engineDefaults = Object.freeze({ stockfishPath: '', pythonPath: '', checkpointPath: '', device: 'auto', threads: Math.max(1, Math.min(4, availableParallelism() - 1)), hash: 256, budget: 3000 });
const movePattern = /^[a-h][1-8][a-h][1-8][qrbn]?$/;
export function validateSettings(input) {
  const settings = { ...engineDefaults, ...input };
  for (const key of ['stockfishPath', 'pythonPath', 'checkpointPath']) {
    if (typeof settings[key] !== 'string' || settings[key].length > 4096 || /[\r\n\0]/.test(settings[key])) throw new Error(`Invalid ${key}`);
  }
  if (!['auto', 'cpu', 'mps', 'cuda'].includes(settings.device)) throw new Error('Invalid Maia device');
  for (const [key, min, max] of [['threads', 1, 128], ['hash', 16, 8192], ['budget', 100, 60000]]) {
    if (!Number.isInteger(settings[key]) || settings[key] < min || settings[key] > max) throw new Error(`Invalid ${key}`);
  }
  return Object.fromEntries(Object.keys(engineDefaults).map(key => [key, settings[key]]));
}
export function validateRequest(request) {
  if (!request || typeof request.id !== 'string' || request.id.length > 200 || !['stockfish', 'maia'].includes(request.engine)) throw new Error('Invalid engine request');
  if (typeof request.initialFen !== 'string' || request.initialFen.length > 200 || /[\r\n\0]/.test(request.initialFen) || request.initialFen.split(' ').length !== 6) throw new Error('Invalid starting FEN');
  if (!Array.isArray(request.moves) || request.moves.length > 10000 || request.moves.some(move => typeof move !== 'string' || !movePattern.test(move))) throw new Error('Invalid moves');
  if (!['white', 'black'].includes(request.turn) || ![1, 3, 5].includes(request.lines) || !Number.isInteger(request.rating) || request.rating < 600 || request.rating > 2600) throw new Error('Invalid analysis settings');
  try {
    const position = Chess.fromSetup(parseFen(request.initialFen).unwrap()).unwrap();
    for (const uci of request.moves) {
      const move = parseUci(uci);
      if (!move || !position.isLegal(move)) throw new Error('Illegal move');
      position.play(move);
    }
    if (position.turn !== request.turn) throw new Error('Incorrect side to move');
  } catch { throw new Error('Invalid analysis position or move history'); }
  return request;
}
export function parseEngineInfo(line, turn = 'white') {
  if (/^info string engine-device (cpu|cuda|mps)$/.test(line)) return { device: line.split(' ').at(-1) };
  if (line.startsWith('info string maia-policy ')) {
    try {
      const data = JSON.parse(line.slice('info string maia-policy '.length));
      if (Array.isArray(data) && data.length <= 5 && data.every(item => movePattern.test(item.move) && Number.isFinite(item.probability) && item.probability >= 0 && item.probability <= 1)) return { candidates: data };
    } catch { /* Ignore malformed engine output. */ }
    return null;
  }
  if (!line.startsWith('info ')) return null;
  const score = line.match(/\bscore (cp|mate) (-?\d+)(?: (lowerbound|upperbound))?/);
  const pv = (line.split(' pv ')[1] || '').trim().split(/\s+/).filter(move => movePattern.test(move));
  if (!score) return null;
  const sign = turn === 'white' ? 1 : -1;
  return { rank: Number(line.match(/\bmultipv (\d+)/)?.[1] || 1), depth: Number(line.match(/\bdepth (\d+)/)?.[1] || 0), score: { type: score[1], value: Number(score[2]) * sign, ...(score[1] === 'mate' && Number(score[2]) === 0 ? { winner: turn === 'white' ? 'black' : 'white' } : {}), bound: score[3] ? (sign === 1 ? score[3] : score[3] === 'lowerbound' ? 'upperbound' : 'lowerbound') : undefined }, moves: pv };
}

// Only this class talks to subprocess stdin/stdout. Searches are serialized and
// drained through bestmove before another position can own the output stream.
export class UciProcess extends EventEmitter {
  constructor(command, args = [], { startupTimeout = 180000, stopTimeout = 15000 } = {}) {
    super();
    this.stopTimeout = stopTimeout;
    this.waiters = new Set();
    this.dead = false;
    this.child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], shell: false, env: { ...process.env, HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1', PYTHONUNBUFFERED: '1' } });
    let buffer = '';
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', chunk => {
      buffer += chunk;
      if (buffer.length > 2e6) return this.fail(new Error('Engine output exceeded limit'));
      const lines = buffer.split(/\r?\n/); buffer = lines.pop();
      for (const line of lines) {
        if (line.startsWith('id name ')) this.name = line.slice(8);
        for (const waiter of [...this.waiters]) if (waiter.match(line)) waiter.resolve(line);
        this.emit('line', line);
      }
    });
    this.diagnostic = '';
    this.child.stderr.on('data', chunk => { this.diagnostic = (this.diagnostic + chunk).slice(-2000); });
    this.child.stdin.on('error', error => this.fail(error));
    this.child.on('error', error => this.fail(error));
    this.child.on('exit', () => this.fail(new Error(`Engine exited. ${this.diagnostic}`)));
    this.ready = this.initialize(startupTimeout);
    this.ready.catch(() => {});
  }
  send(command) { if (this.dead) throw new Error('Engine is not running'); this.child.stdin.write(command + '\n'); }
  wait(match, timeout) {
    return new Promise((resolve, reject) => {
      const waiter = { match, resolve: value => { clearTimeout(timer); this.waiters.delete(waiter); resolve(value); }, reject: error => { clearTimeout(timer); this.waiters.delete(waiter); reject(error); } };
      const timer = setTimeout(() => { waiter.reject(new Error('Engine timed out')); this.close(); }, timeout);
      this.waiters.add(waiter);
      if (this.dead) waiter.reject(new Error('Engine is not running'));
    });
  }
  async initialize(timeout) {
    const handshake = this.wait(line => line === 'uciok', timeout); this.send('uci'); await handshake;
    const ready = this.wait(line => line === 'readyok', timeout); this.send('isready'); await ready;
  }
  async stop() {
    if (!this.searching || this.dead) return;
    const stopped = this.wait(line => line.startsWith('bestmove '), this.stopTimeout);
    this.send('stop'); await stopped; this.searching = false;
  }
  fail(error) {
    if (this.dead) return;
    this.dead = true;
    for (const waiter of [...this.waiters]) waiter.reject(error);
    this.emit('failure', error);
    this.child.kill();
  }
  close() {
    if (this.dead) return;
    try { this.send('quit'); } catch { /* Already closed. */ }
    this.fail(new Error('Engine closed'));
  }
}

export class EngineManager {
  constructor(settings, emit, processFactory = (command, args) => new UciProcess(command, args)) {
    this.settings = validateSettings(settings); this.emit = emit; this.processFactory = processFactory;
    this.sessions = new Map(); this.queues = new Map(); this.latest = new Map();
  }
  configure(settings) { this.close(); this.settings = validateSettings(settings); }
  configuration() {
    const settings = this.settings;
    return { ...settings, model: 'Maia 3 · 79M', stockfishAvailable: !!settings.stockfishPath && existsSync(settings.stockfishPath), maiaAvailable: !!settings.pythonPath && existsSync(settings.pythonPath) && !!settings.checkpointPath && existsSync(settings.checkpointPath) };
  }
  session(engine) {
    let session = this.sessions.get(engine);
    if (session && !session.dead) return session;
    const s = this.settings;
    const paths = engine === 'stockfish' ? [s.stockfishPath] : [s.pythonPath, s.checkpointPath];
    if (paths.some(path => !path || !existsSync(path))) throw new Error(engine === 'stockfish' ? 'Stockfish is not configured. See the local engine installation instructions.' : 'Maia is not configured. See the local engine installation instructions.');
    session = this.processFactory(engine === 'stockfish' ? s.stockfishPath : s.pythonPath, engine === 'stockfish' ? [] : [fileURLToPath(new URL('./maia_bridge.py', import.meta.url)), '--checkpoint-path', s.checkpointPath, '--device', s.device]);
    session.on('failure', error => { const request = session.active; if (request && this.latest.get(engine) === request.id) this.emit({ id: request.id, engine, status: 'error', error: error.message }); });
    this.sessions.set(engine, session); return session;
  }
  analyze(input) {
    const request = validateRequest(input);
    this.latest.set(request.engine, request.id);
    const previous = this.sessions.get(request.engine);
    if (previous && !previous.dead) previous.send('stop');
    const work = (this.queues.get(request.engine) || Promise.resolve()).catch(() => {}).then(async () => {
      if (this.latest.get(request.engine) !== request.id) return;
      let session;
      try {
        this.emit({ id: request.id, engine: request.engine, status: 'loading' });
        session = this.session(request.engine); await session.ready; await session.stop();
        if (this.latest.get(request.engine) !== request.id) return;
        session.active = request;
        if (request.engine === 'stockfish') {
          session.send(`setoption name Threads value ${this.settings.threads}`);
          session.send(`setoption name Hash value ${this.settings.hash}`);
          session.send(`setoption name MultiPV value ${request.lines}`);
        } else {
          session.send(`setoption name Elo value ${request.rating}`);
          session.send(`setoption name MultiPV value ${request.lines}`);
        }
        session.send(`position fen ${request.initialFen}${request.moves.length ? ' moves ' + request.moves.join(' ') : ''}`);
        const receive = line => {
          if (this.latest.get(request.engine) !== request.id) return;
          const info = parseEngineInfo(line, request.turn);
          if (info) this.emit({ id: request.id, engine: request.engine, status: 'analyzing', ...info });
        };
        session.on('line', receive);
        this.emit({ id: request.id, engine: request.engine, status: 'analyzing' });
        const done = session.wait(line => line.startsWith('bestmove '), request.engine === 'maia' ? 180000 : this.settings.budget + 15000);
        session.searching = true;
        session.send(request.engine === 'stockfish' ? `go movetime ${this.settings.budget}` : 'go nodes 1');
        try { await done; } finally { session.searching = false; session.off('line', receive); }
        if (this.latest.get(request.engine) === request.id) this.emit({ id: request.id, engine: request.engine, status: 'complete' });
      } catch (error) {
        if (this.latest.get(request.engine) === request.id) this.emit({ id: request.id, engine: request.engine, status: 'error', error: error.message });
        session?.close();
      }
    });
    this.queues.set(request.engine, work);
    return { id: request.id };
  }
  stop(engine) {
    if (!['stockfish', 'maia'].includes(engine)) throw new Error('Invalid engine');
    this.latest.delete(engine);
    const session = this.sessions.get(engine);
    if (session && !session.dead) session.send('stop');
  }
  close() { this.latest.clear(); for (const session of this.sessions.values()) session.close(); this.sessions.clear(); }
}
