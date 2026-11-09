import { app } from 'electron';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Chess } from 'chessops/chess';
import { makeFen } from 'chessops/fen';
import { desktopTestDirectory } from './fixtures/desktop-test.mjs';
import { KindlePlayMaia } from '../electron/kindle-play-maia.mjs';
import { UciProcess } from '../electron/engines.mjs';
import { applyUci } from '../electron/kindle-play-game.mjs';
const directory = desktopTestDirectory();
app.setPath('userData', directory);
const real = process.argv.includes('--real-maia');
const sessions = [], exits = [];
const originalSearch = KindlePlayMaia.prototype.search;
KindlePlayMaia.prototype.search = function(request) {
  if (!this.smokeInstrumented) {
    this.smokeInstrumented = true;
    const factory = this.processFactory;
    this.processFactory = (...args) => {
      const session = real ? factory(...args) : new UciProcess('node', [fileURLToPath(new URL('./fixtures/fake-playing-maia.mjs', import.meta.url))]);
      sessions.push(session); exits.push(once(session.child, 'close')); return session;
    };
  }
  return originalSearch.call(this, request);
};
if (!real) writeFileSync(join(directory, 'engines.json'), JSON.stringify({ pythonPath: process.execPath, checkpointPath: fileURLToPath(import.meta.url) }));
const run = promisify(execFile);
let base, code = 0;
async function call(path, body) {
  const args = ['--silent', '--show-error', '--max-time', '195', '-w', '\n%{http_code}'];
  if (body !== undefined) args.push('-H', 'Content-Type: application/json', '--data-binary', JSON.stringify(body));
  args.push(base + '/api/v1/' + path);
  const { stdout } = await run(process.platform === 'win32' ? 'curl.exe' : 'curl', args, { timeout: 200000, windowsHide: true });
  const split = stdout.lastIndexOf('\n');
  return { status: Number(stdout.slice(split + 1)), body: JSON.parse(stdout.slice(0, split)) };
}
async function smoke() {
  const timeout = setTimeout(() => { console.error('Kindle desktop smoke timed out'); app.exit(1); }, real ? 450000 : 30000);
  try {
    // Reserve a free port, then release it before the real app starts its server.
    const reservation = createServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
    const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
    base = `http://127.0.0.1:${port}`;
    writeFileSync(join(directory, 'kindle-play-server.json'), JSON.stringify({ enabled: true, host: '127.0.0.1', port }));
    const created = once(app, 'browser-window-created'); await import('../electron/main.mjs');
    const [, window] = await created; await once(window.webContents, 'did-finish-load');
    assert.equal((await call('health')).body.maiaAvailable, true);
    assert.equal(sessions.length, 0, 'Health must not warm Maia');
    for (const rating of [700, 2300]) {
      assert.equal((await call('games', { rating })).status, 201);
      const position = Chess.default(); let ply = 0;
      for (const uci of ['e2e4', 'g1f3', 'b1c3']) {
        const response = await call('games/current/moves', { uci, expectedPly: ply });
        assert.equal(response.status, 200, JSON.stringify(response.body));
        assert.equal(response.body.rating, rating);
        assert.equal(response.body.ply, ply + 2);
        assert.equal(response.body.moves[ply], uci);
        for (const played of response.body.moves.slice(ply)) applyUci(position, played);
        assert.equal(response.body.fen, makeFen(position.toSetup()));
        ply += 2;
        console.log(JSON.stringify({ rating, ply, moves: response.body.moves, fen: response.body.fen }));
      }
      const before = (await call('games/current')).body;
      const illegal = await call('games/current/moves', { uci: 'a1a8', expectedPly: ply });
      assert.equal(illegal.status, 422); assert.deepEqual(illegal.body.state, before);
      assert.equal((await call('games/current/moves', { uci: 'd2d4', expectedPly: 0 })).body.error.code, 'STALE_PLY');
      assert.deepEqual((await call('games/current/resign', {})).body.result, { outcome: 'black_win', reason: 'resignation' });
    }
    assert.equal(sessions.length, 1, 'One dedicated process reused across games and ratings');
    console.log(`Kindle desktop ${real ? 'REAL Maia' : 'fake Maia'} curl smoke passed: two ratings, six legal pairs, exact FEN, illegal/stale rejection and resignation.`);
  } catch (error) { console.error(error); code = 1; }
  finally {
    // Allow the production will-quit handlers to run, then observe child exit.
    app.once('will-quit', event => {
      event.preventDefault();
      void (async () => {
        try {
          assert.ok(sessions.every(session => session.dead), 'Quit must close play processes');
          await Promise.all(exits);
          await assert.rejects(call('health'));
          console.log('Kindle shutdown verified: UCI child exited and HTTP listener closed.');
        } catch (error) { console.error(error); code = 1; }
        clearTimeout(timeout); app.exit(code);
      })();
    });
    app.quit();
  }
}
void smoke();
