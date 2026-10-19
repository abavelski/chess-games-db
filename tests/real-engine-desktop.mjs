import { desktopTestDirectory, finishDesktopTest } from './fixtures/desktop-test.mjs';
// Opt-in real-model desktop verification. All external HTTP is blocked.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { writeFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { app, session } from 'electron';
import { fixtureArchive } from './fixtures/opening-archive.mjs';
if (!process.env.CHESS_ENGINE_CONFIG) throw new Error('Set CHESS_ENGINE_CONFIG to a local engines.json before running this opt-in test.');
const settings = JSON.parse(readFileSync(resolve(process.env.CHESS_ENGINE_CONFIG), 'utf8'));
const temporary = desktopTestDirectory();
app.setPath('userData', temporary);
const path = join(temporary, 'archive.sqlite3');
const db = fixtureArchive(path, ['1.e4 {Book note [%cal Ge2e4]} e5 2.Nf3 Nc6 *', '1.e4 e5 2.Nf3 Nc6 3.Bb5 a6 4.Ba4 Nf6 5.O-O Be7 6.Re1 b5 7.Bb3 O-O *', '[SetUp "1"]\n[FEN "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1"]\n\n1.O-O-O O-O *', '[SetUp "1"]\n[FEN "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1"]\n\n1.O-O O-O-O *']); db.close();
const hash = () => createHash('sha256').update(readFileSync(path)).digest('hex');
const original = hash();
writeFileSync(join(temporary, 'archive.json'), JSON.stringify({ path }));
writeFileSync(join(temporary, 'engines.json'), JSON.stringify(settings));
const errors = [];
app.on('browser-window-created', (_event, window) => {
  window.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message); });
  window.webContents.on('preload-error', (_event, _path, error) => errors.push(error.message));
});
async function smoke() {
  let code = 0;
  const timeout = setTimeout(() => { console.error('Real engine desktop timeout'); app.exit(1); }, 240000);
  try {
    const created = once(app, 'browser-window-created'); await import('../electron/main.mjs'); const [, window] = await created;
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => callback({ cancel: true }));
    await once(window.webContents, 'did-finish-load');
    const result = await window.webContents.executeJavaScript(`(async () => {
      const wait = async predicate => { const end = Date.now() + 180000; while (!predicate()) { const error = document.querySelector('.engine-error'); if (error) throw new Error(error.textContent); if (Date.now() > end) throw new Error('Timed out: ' + predicate); await new Promise(r => setTimeout(r, 30)); } };
      const button = text => [...document.querySelectorAll('button')].find(b => b.textContent === text || b.getAttribute('aria-label') === text);
      window.realWait = wait; window.realButton = button;
      await wait(() => document.querySelector('.result-item'));
      document.querySelector('.result-item').click(); await wait(() => document.querySelector('.review-shell cg-board'));
      const start = performance.now();
      window.chessEngine.onUpdate(event => { if (event.device) window.realDevice = event.device; });
      button('Game review settings').click(); await wait(() => document.querySelector('dialog[open]'));
      [...document.querySelectorAll('dialog label')].find(label => label.textContent.trim() === 'Evaluation bar').querySelector('input').click();
      button('Done').click(); await wait(() => !document.querySelector('dialog'));
      button('Stockfish').click(); button('Maia').click();
      await wait(() => document.querySelector('.stockfish-analysis .engine-status')?.textContent.includes('complete') && document.querySelector('.maia-analysis .engine-status')?.textContent.includes('complete'));
      if (document.querySelectorAll('.engine-line').length !== 3 || !document.querySelector('.maia-candidates button')) throw new Error('Missing real engine output');
      if (!document.querySelector('svg.cg-shapes line[stroke="#27854c"]') || !document.querySelector('svg.cg-shapes line[stroke="#9155c2"]')) throw new Error('Missing real arrows');
      const device = window.realDevice || '';
      if (!/mps|cpu|cuda/.test(device)) throw new Error('Device must be shown');
      const elapsedMs = Math.round(performance.now() - start);
      const evaluation = document.querySelector('.evaluation-bar').getAttribute('aria-label');
      const candidates = document.querySelector('.maia-candidates').textContent;
      button('Piece mode').click(); await wait(() => document.querySelector('.piece-mode[open]'));
      await wait(() => document.querySelector('.stockfish-analysis .engine-status').textContent.includes('paused'));
      button('Return to review').click(); await wait(() => !document.querySelector('.piece-mode'));
      await wait(() => document.querySelector('.maia-analysis .engine-status').textContent.includes('complete'));
      button('Stockfish').click(); button('Maia').click();
      return { elapsedMs, device, evaluation, candidates };
    })()`);
    const clickSquare = async square => {
      const point = await window.webContents.executeJavaScript(`(() => { const r = document.querySelector('.review-board cg-board').getBoundingClientRect(); return { x: Math.round(r.left + ('${square}'.charCodeAt(0)-97+.5)*r.width/8), y: Math.round(r.top+(8-Number('${square}'[1])+.5)*r.height/8) }; })()`);
      window.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point });
      window.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point });
      await new Promise(resolve => setTimeout(resolve, 80));
    };
    await clickSquare('e2'); await clickSquare('e4');
    await window.webContents.executeJavaScript(`(async () => { await window.realWait(() => document.querySelector('.analysis-branch')?.textContent.includes('e4')); })()`);
    await clickSquare('e7'); await clickSquare('e5');
    await window.webContents.executeJavaScript(`(async () => {
      await window.realWait(() => document.querySelector('.analysis-branch')?.textContent.includes('e4 e5'));
      window.realButton('Return to game position').click(); await window.realWait(() => !document.querySelector('.analysis-branch'));
      document.querySelector('.review-header > button').click(); await window.realWait(() => !document.querySelector('.review-shell'));
    })()`);
    await window.webContents.executeJavaScript(`(async () => {
      const wait = window.realWait, button = window.realButton;
      for (const index of [1, 2, 3]) {
        document.querySelectorAll('.result-item')[index].click(); await wait(() => document.querySelector('.review-shell cg-board'));
        document.querySelector('[aria-label="Last mainline position"]').click();
        await wait(() => document.querySelector('.review-move[aria-current="step"]')?.textContent.includes('O-O'));
        button('Stockfish').click(); button('Maia').click();
        await wait(() => document.querySelector('.stockfish-analysis .engine-status')?.textContent.includes('complete') && document.querySelector('.maia-analysis .engine-status')?.textContent.includes('complete'));
        if (!document.querySelector('.engine-line') || !document.querySelector('.maia-candidates button')) throw new Error('Missing post-castling evaluation');
        document.querySelector('.review-header > button').click(); await wait(() => !document.querySelector('.review-shell'));
      }
    })()`);
    assert.deepEqual(errors, []); assert.equal(hash(), original);
    console.log('Real engine desktop passed (HTTP blocked; both colors and castling wings):', JSON.stringify(result));
  } catch (error) { console.error(error); code = 1; }
  finally { clearTimeout(timeout); finishDesktopTest(app, code); }
}
void smoke();
