import { app, ipcMain } from 'electron';
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
    const ipc = expression => window.webContents.executeJavaScript(expression);
    await ipc(`(async()=>{
      window.kindleWait=async fn=>{const end=Date.now()+6000;while(!fn()){if(Date.now()>end)throw Error('Kindle UI timeout: '+fn);await new Promise(r=>setTimeout(r,25));}};
      window.kindleButton=text=>[...document.querySelectorAll('main[aria-label="Maia"] button')].find(b=>b.textContent===text);
      const tabs=[...document.querySelectorAll('[aria-label="Workspaces"] button')];
      if(tabs.map(b=>b.textContent).join('|')!=='Games|Openings|My Studies|Maia')throw Error('Workspace tab order');
      tabs[3].click();
      await kindleWait(()=>document.querySelector('main[aria-label="Maia"]')?.textContent.includes('Listener: stopped'));
      if(!document.querySelector('main[aria-label="Maia"]').textContent.includes('Never')&&!document.querySelector('main[aria-label="Maia"]').textContent.includes('No current game'))throw Error('Initial game status');
    })()`);
    assert.equal((await ipc('window.kindlePlay.status()')).listener, 'stopped');
    await assert.rejects(call('health'), 'Legacy enabled:true must not auto-start');
    await ipc(`(async()=>{kindleButton('Start listener').click();await kindleWait(()=>document.querySelector('main[aria-label="Maia"]').textContent.includes('Listener: listening'));if(!kindleButton('Start listener').disabled)throw Error('Duplicate start enabled');})()`);
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
    assert.equal((await ipc('window.kindlePlay.stop()')).listener, 'stopped');
    await assert.rejects(call('health'));
    assert.equal((await ipc('window.kindlePlay.start()')).listener, 'listening');
    assert.equal((await call('games/current')).body.ply, 6, 'Restart preserves the committed game');
    const black = await call('games', { rating: 1500, playerColor: 'black' });
    assert.equal(black.status, 201); assert.equal(black.body.ply, 1);
    assert.deepEqual(black.body.sanMoves.length, 1);
    assert.equal((await call('games/current/moves', { uci: 'e7e5', expectedPly: 1 })).status, 200);
    await ipc(`(async()=>{
      await kindleWait(()=>document.querySelector('main[aria-label="Maia"]').textContent.includes('Human: black'));
      document.querySelector('[aria-label="Workspaces"] button:nth-child(3)').click();
      await kindleWait(()=>document.querySelector('.study-list button'));
      const records=await personalStudies.list({});
      if(records.total!==3)throw Error('Expected one study per game');
      const row=records.rows.find(r=>r.white_elo===1500);
      if(!row||row.revision!==2||row.result!=='*')throw Error('Black study metadata/revision');
      [...document.querySelectorAll('.study-list button')].find(b=>b.textContent===row.title).click();
      await kindleWait(()=>document.querySelector('[aria-label="Study title"]'));
      window.kindleStudyId=row.id;
    })()`);
    await call('games/current/resign', {});
    await ipc(`(async()=>{
      await kindleWait(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='Reload saved revision'));
      [...document.querySelectorAll('button')].find(b=>b.textContent==='Reload saved revision').click();
      await kindleWait(()=>document.querySelector('.study-save-status')?.textContent.includes('revision 3'));
      const field=document.querySelector('[aria-label="Study title"]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(field,'Retain this draft');field.dispatchEvent(new Event('input',{bubbles:true}));
      await kindleWait(()=>document.querySelector('.study-save-status').textContent==='Unsaved changes');
      const saved=await personalStudies.get({id:kindleStudyId});
      await personalStudies.update({id:saved.id,expectedRevision:saved.revision,draft:{title:'External title',pgn:saved.pgn,origin_kind:saved.origin_kind,tags:saved.tags}});
      await kindleWait(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='Reload saved revision'));
      if(field.value!=='Retain this draft')throw Error('External write replaced dirty draft');
      document.querySelector('[aria-label="Workspaces"] button:nth-child(4)').click();
      await kindleWait(()=>document.querySelector('dialog[open]'));
      [...document.querySelectorAll('dialog button')].find(b=>b.textContent==='Discard and leave').click();
      await kindleWait(()=>document.querySelector('.workspace-root').dataset.workspace==='maia');
      kindleButton('Stop listener').click();
      await kindleWait(()=>document.querySelector('main[aria-label="Maia"]').textContent.includes('Listener: stopped'));
    })()`);
    // Representative IPC status fixtures exercise safe rendering without a model.
    let mockStatus = await ipc('window.kindlePlay.status()'), statusReads = 0;
    ipcMain.removeHandler('kindle-play:status');
    ipcMain.handle('kindle-play:status', () => { statusReads++; return mockStatus; });
    mockStatus = { ...mockStatus, listener: 'error', error: '<img src=x onerror=alert(1)> Bind failed', maia: { configured: true, available: false, activity: 'idle' } };
    await ipc(`(async()=>{await kindleWait(()=>document.querySelector('main[aria-label="Maia"] [role="alert"]')?.textContent.includes('Bind failed'));if(document.querySelector('main[aria-label="Maia"] img'))throw Error('Status error interpreted as HTML');})()`);
    mockStatus = { ...mockStatus, listener: 'listening', error: null, maia: { configured: true, available: true, activity: 'thinking' } };
    await ipc(`(async()=>{await kindleWait(()=>document.querySelector('main[aria-label="Maia"]').textContent.includes('thinking'));document.querySelector('[aria-label="Workspaces"] button:first-child').click();await new Promise(r=>setTimeout(r,100));})()`);
    const readsWhenHidden = statusReads;
    await new Promise(resolve => setTimeout(resolve, 1200));
    assert.equal(statusReads, readsWhenHidden, 'Hidden Maia pane must stop polling');
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
