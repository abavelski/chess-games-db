import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Chess } from 'chessops/chess';
import { parseFen } from 'chessops/fen';
import { UciProcess, validateSettings } from './engines.mjs';
import { applyUci, PlayError, validateRating } from './kindle-play-game.mjs';

export class KindlePlayMaia {
  constructor(settings, { processFactory = (command, args) => new UciProcess(command, args), deadline = 180000, log = console.warn } = {}) {
    this.settings = typeof settings === 'function' ? settings : () => settings;
    this.processFactory = processFactory; this.deadline = deadline; this.log = log;
    this.queue = Promise.resolve(); this.closed = false; this.session = null;
  }
  available() {
    try {
      const s = validateSettings(this.settings());
      return !!s.pythonPath && existsSync(s.pythonPath) && !!s.checkpointPath && existsSync(s.checkpointPath);
    } catch { return false; }
  }
  move(request) {
    const work = this.queue.catch(() => {}).then(() => this.search(request));
    this.queue = work;
    return work;
  }
  async search({ initialFen, moves, rating }) {
    if (this.closed || !this.available()) throw new PlayError(503, 'ENGINE_UNAVAILABLE', 'Maia is not configured. See desktop setup instructions.');
    validateRating(rating);
    const position = Chess.fromSetup(parseFen(initialFen).unwrap()).unwrap();
    const history = moves.map(move => applyUci(position, move));
    if (position.turn !== 'black' || position.isEnd()) throw new Error('Expected a playable Black position.');
    const settings = validateSettings(this.settings());
    const signature = JSON.stringify(settings);
    if (this.signature !== signature) { this.session?.close(); this.session = null; }
    this.signature = signature;
    let timer;
    try {
      if (!this.session || this.session.dead) {
        const bridge = fileURLToPath(new URL('./maia_bridge.py', import.meta.url)).replace(/([\\/])app\.asar([\\/])/, '$1app.asar.unpacked$2');
        this.session = this.processFactory(settings.pythonPath, [bridge, '--checkpoint-path', settings.checkpointPath, '--device', settings.device, '--threads', String(settings.threads)]);
      }
      const session = this.session;
      // One deadline includes cold startup and search, below the client's ~195s timeout.
      timer = setTimeout(() => session.fail(new Error('Engine timed out')), this.deadline);
      await session.ready;
      session.send(`setoption name Elo value ${rating}`);
      session.send(`position fen ${initialFen}${history.length ? ' moves ' + history.join(' ') : ''}`);
      const done = session.wait(line => line.startsWith('bestmove '), this.deadline);
      session.send('go nodes 1');
      const line = await done;
      const match = /^bestmove ([a-h][1-8][a-h][1-8][qrbn]?)(?: ponder [a-h][1-8][a-h][1-8][qrbn]?)?$/.exec(line);
      if (!match) throw new Error('Invalid Maia bestmove');
      return applyUci(position, match[1], true);
    } catch (error) {
      this.session?.close(); this.session = null;
      this.log('Kindle play Maia failure', error);
      const timeout = /timed out/i.test(error.message);
      throw new PlayError(timeout ? 504 : 503, timeout ? 'ENGINE_TIMEOUT' : 'ENGINE_UNAVAILABLE', timeout ? 'Maia timed out. Refresh the game before retrying.' : 'Maia is unavailable. Check desktop engine setup and logs.');
    } finally { clearTimeout(timer); }
  }
  close() { this.closed = true; this.session?.close(); }
}
