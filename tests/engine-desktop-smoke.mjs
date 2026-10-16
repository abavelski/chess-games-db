import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { app } from 'electron';
import { fixtureArchive } from './fixtures/opening-archive.mjs';
const temporary = mkdtempSync(join(tmpdir(), 'chess-engines-'));
app.setPath('userData', temporary);
const path = join(temporary, 'archive.sqlite3');
const db = fixtureArchive(path, ['1.e4 {Book note [%cal Ge2e4] [%csl Yd4]} e5 2.Nf3 Nc6 *']); db.close();
const hash = () => createHash('sha256').update(readFileSync(path)).digest('hex');
const original = hash();
writeFileSync(join(temporary, 'archive.json'), JSON.stringify({ path }));
writeFileSync(join(temporary, 'engines.json'), JSON.stringify({ stockfishPath: fileURLToPath(new URL('./fixtures/fake-uci.mjs', import.meta.url)), pythonPath: fileURLToPath(new URL('./fixtures/fake-maia.mjs', import.meta.url)), checkpointPath: fileURLToPath(new URL('./fixtures/fake-maia.mjs', import.meta.url)), device: 'cpu', threads: 1, hash: 16, budget: 100 }));
const errors = [];
app.on('browser-window-created', (_event, window) => {
  window.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message); });
  window.webContents.on('preload-error', (_event, _path, error) => errors.push(error.message));
});
async function smoke() {
  let code = 0;
  const timeout = setTimeout(() => { console.error('Engine desktop smoke timed out'); app.exit(1); }, 45000);
  try {
    const created = once(app, 'browser-window-created'); await import('../electron/main.mjs'); const [, window] = await created;
    await once(window.webContents, 'did-finish-load');
    await window.webContents.executeJavaScript(`(async () => {
      const wait = async predicate => { const end = Date.now() + 8000; while (!predicate()) { if (Date.now() > end) throw new Error('Timed out: ' + predicate); await new Promise(r => setTimeout(r, 25)); } };
      const button = text => [...document.querySelectorAll('button')].find(b => b.textContent === text);
      window.smokeWait = wait; window.smokeButton = button;
      await wait(() => document.querySelector('.result-item'));
      document.querySelector('.result-item').click(); await wait(() => document.querySelector('.review-shell cg-board'));
      if (button('Stockfish').getAttribute('aria-pressed') !== 'false' || button('Maia').getAttribute('aria-pressed') !== 'false') throw new Error('Engines must default off');
      button('Stockfish').click(); await wait(() => document.querySelectorAll('.engine-line').length === 3);
      await wait(() => document.querySelector('svg.cg-shapes line[stroke="#27854c"]'));
      button('Evaluation bar').click(); await wait(() => document.querySelector('.evaluation-bar'));
      button('Engine lines').click(); await wait(() => !document.querySelector('.engine-line'));
      if (button('Stockfish').getAttribute('aria-pressed') !== 'true') throw new Error('Hiding lines disabled Stockfish');
      button('Engine lines').click(); await wait(() => document.querySelector('.engine-line'));
      button('Maia').click(); await wait(() => document.querySelector('.maia-candidates')?.textContent.includes('38.0%'));
      await wait(() => document.querySelector('svg.cg-shapes line[stroke="#9155c2"]'));
      document.querySelector('.analysis-options').open = true;
      button('Engine arrows').click(); await wait(() => !document.querySelector('svg.cg-shapes line[stroke="#27854c"]'));
      if (!document.querySelector('svg.cg-shapes line[stroke="#9155c2"]')) throw new Error('Maia arrows must remain independent');
      button('Engine arrows').click();
      const rating = document.querySelector('[aria-label="Maia rating"]');
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(rating, '1800'); rating.dispatchEvent(new Event('change', { bubbles: true }));
      await wait(() => document.querySelector('.maia-candidates')?.textContent.includes('42.0%'));
      document.querySelector('.engine-line button').click(); await wait(() => document.querySelector('.analysis-branch'));
      if (!document.querySelector('.analysis-branch').textContent.includes('e4')) throw new Error('Line preview missing');
      button('Return to book position').click(); await wait(() => !document.querySelector('.analysis-branch'));
      button('Stockfish').click(); button('Maia').click();
      document.querySelector('[aria-label="Next move"]').click(); await wait(() => document.querySelector('svg.cg-shapes circle'));
      button('Book annotations').click(); await wait(() => !document.querySelector('svg.cg-shapes circle'));
      button('Book annotations').click(); await wait(() => document.querySelector('svg.cg-shapes circle'));
      button('Engine setup').click(); await wait(() => document.querySelector('dialog[open]'));
      if (!document.querySelector('dialog input').value.includes('fake-uci')) throw new Error('Settings did not load');
      document.querySelector('dialog button[type="button"]').focus();
    })()`);
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    await window.webContents.executeJavaScript(`(async () => { await window.smokeWait(() => !document.querySelector('dialog')); if (!document.querySelector('.review-shell')) throw new Error('Setup Escape closed review'); })()`);
    await window.webContents.executeJavaScript(`(async () => {
      const wait = window.smokeWait, button = window.smokeButton;
      document.querySelector('[aria-label="First position"]').click();
      button('Stockfish').click(); button('Maia').click();
      await wait(() => document.querySelector('.engine-line button'));
      document.querySelector('.engine-line button').click(); await wait(() => document.querySelector('.analysis-branch'));
      document.querySelector('[aria-label="Flip board"]').click();
      document.querySelector('.review-original').open = true;
      document.querySelector('.review-transcript').scrollTop = 25;
      window.beforePiece = { branch: document.querySelector('.analysis-branch').textContent, pgn: document.querySelector('.review-original pre').textContent, path: document.querySelector('[aria-current="step"]')?.dataset.reviewPath || '', scroll: document.querySelector('.review-transcript').scrollTop };
      button('Piece mode').focus(); button('Piece mode').click(); await wait(() => document.querySelector('.piece-mode[open] cg-board'));
      if (document.querySelector('.piece-mode').querySelector('svg, .evaluation-bar, .review-comment, .review-move, square.last-move, square.check')) throw new Error('Piece mode leaked annotations');
      if (!document.querySelector('.piece-mode .orientation-black')) throw new Error('Piece mode lost orientation');
      if (document.querySelectorAll('.piece-mode button').length !== 2) throw new Error('Piece mode must have only two minimal controls');
      window.pieceStart = document.querySelector('.piece-board').dataset.fen;
      await wait(() => document.querySelector('.stockfish-analysis .engine-status').textContent.includes('paused'));
    })()`);
    const clickSquare = async square => {
      const point = await window.webContents.executeJavaScript(`(() => {
        const rect = document.querySelector('.piece-mode cg-board').getBoundingClientRect();
        const file = '${square}'.charCodeAt(0) - 97, rank = Number('${square}'[1]) - 1;
        const black = !!document.querySelector('.piece-mode .orientation-black');
        return { x: Math.round(rect.left + ((black ? 7 - file : file) + .5) * rect.width / 8), y: Math.round(rect.top + ((black ? rank : 7 - rank) + .5) * rect.height / 8) };
      })()`);
      window.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point });
      window.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point });
      await new Promise(resolve => setTimeout(resolve, 80));
    };
    await clickSquare('e4'); await clickSquare('e6'); // Illegal in normal chess, permitted here.
    await window.webContents.executeJavaScript(`(async () => {
      const wait = window.smokeWait, button = window.smokeButton;
      await wait(() => document.querySelector('.piece-board').dataset.fen !== window.pieceStart);
      button('Reset position').click(); await wait(() => document.querySelector('.piece-board').dataset.fen === window.pieceStart);
      button('Return to review').click(); await wait(() => !document.querySelector('.piece-mode'));
      if (document.querySelector('.analysis-branch').textContent !== window.beforePiece.branch || document.querySelector('.review-original pre').textContent !== window.beforePiece.pgn) throw new Error('Return lost review state');
      if (!document.querySelector('.review-board .orientation-black')) throw new Error('Return lost orientation');
      if (button('Stockfish').getAttribute('aria-pressed') !== 'true' || button('Maia').getAttribute('aria-pressed') !== 'true') throw new Error('Return changed enable states');
      await wait(() => document.querySelector('.stockfish-analysis .engine-status').textContent.includes('complete'));
      await new Promise(r => requestAnimationFrame(r));
      if (document.querySelector('.review-transcript').scrollTop !== window.beforePiece.scroll) throw new Error('Return lost scroll');
      button('Piece mode').focus(); button('Piece mode').click(); await wait(() => document.querySelector('.piece-mode[open]'));
    })()`);
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    await window.webContents.executeJavaScript(`(async () => {
      await window.smokeWait(() => !document.querySelector('.piece-mode'));
      if (!document.querySelector('.review-shell')) throw new Error('Piece mode Escape closed review');
      await window.smokeWait(() => document.activeElement?.textContent === 'Piece mode');
      window.smokeButton('Return to book position').click();
      await window.smokeWait(() => !document.querySelector('.analysis-branch'));
    })()`);
    assert.equal(hash(), original);
    assert.deepEqual(errors, []);
    console.log('Engine desktop smoke passed: local subprocess IPC, independent controls, probabilities/rating, arrows, line exploration, setup, free Piece mode/reset/exact restoration/Escape, and archive preservation.');
  } catch (error) { console.error(error); code = 1; }
  finally { clearTimeout(timeout); app.on('will-quit', () => { rmSync(temporary, { recursive: true, force: true }); app.exit(code); }); app.quit(); }
}
void smoke();
