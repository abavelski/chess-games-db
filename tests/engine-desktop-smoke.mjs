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
    assert.equal(hash(), original);
    assert.deepEqual(errors, []);
    console.log('Engine desktop smoke passed: local subprocess IPC, independent controls, probabilities/rating, arrows, line exploration, setup, and archive preservation.');
  } catch (error) { console.error(error); code = 1; }
  finally { clearTimeout(timeout); app.on('will-quit', () => { rmSync(temporary, { recursive: true, force: true }); app.exit(code); }); app.quit(); }
}
void smoke();
