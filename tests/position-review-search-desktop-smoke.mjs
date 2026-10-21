import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app, BrowserWindow, dialog } from 'electron';
import { desktopTestDirectory, finishDesktopTest } from './fixtures/desktop-test.mjs';
import { fixtureArchive, hash } from './fixtures/opening-archive.mjs';
import { upsertGame } from '../lib/game-writer.mjs';
import { ChessArchive } from '../electron/database.mjs';
import { main as positionsCli } from '../scripts/positions.mjs';

// This tests an indexed disposable archive and a separate unindexed fixture;
// neither the Electron search nor a declined note-edit writes the source PGN.
const directory = desktopTestDirectory();
app.setPath('userData', directory);
const path = join(directory, 'position-review-indexed.sqlite3');
const unindexedPath = join(directory, 'position-review-unindexed.sqlite3');
const scores = [
  '1. Nf3 (1. d4 d5) Nf6 *',
  '1. d4 d5 2. c4 *',
  '1. Nf3 Nf6 *',
  '1. e4 e5 *',
];
const db = fixtureArchive(path, scores);
for (let id = 1; id <= 4; id++) upsertGame(db, { id, year: id === 3 ? 2010 : 2020 });
db.close();
const editor = new ChessArchive(path);
editor.savePersonal(3, { lines: [['e2e4']], comments: [] });
editor.close();
await positionsCli(['init', '--database', path]);
await positionsCli(['build', '--database', path, '--include-variations']);
fixtureArchive(unindexedPath, ['1.e4 *']).close();
const originals = [path, unindexedPath].map(p => hash(readFileSync(p)));
writeFileSync(join(directory, 'archive.json'), JSON.stringify({ path }));
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [unindexedPath] });
const errors = [];
app.on('browser-window-created', (_event, win) => {
  win.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message); });
  win.webContents.on('preload-error', (_event, _path, error) => errors.push(error.message));
});

async function smoke() {
  const timeout = setTimeout(() => { console.error('PS-11 desktop smoke timed out'); app.exit(1); }, 65000);
  let exitCode = 0;
  try {
    const created = once(app, 'browser-window-created');
    await import('../electron/main.mjs');
    const [, win] = await created;
    await once(win.webContents, 'did-finish-load');
    await win.webContents.executeJavaScript(`(async () => {
      window.rsWait = async (check, message) => {
        const deadline = Date.now() + 10000;
        while (!check()) {
          if (Date.now() > deadline) throw new Error('PS-11 ' + message +
            ' (stage=' + (window.rsStage || 'init') + ')');
          await new Promise(resolve => setTimeout(resolve, 30));
        }
      };
      window.rsCount = n => document.querySelector('.results-titlebar [role="status"]')?.textContent ===
        n + (n === 1 ? ' game' : ' games') &&
        document.querySelector('.game-results')?.getAttribute('aria-busy') === 'false';
      window.rsReview = () => document.querySelector('.review-session:not([hidden])');
      window.rsButton = text => [...rsReview()?.querySelectorAll('button') || []].find(el =>
        el.textContent.trim().includes(text) || el.getAttribute('aria-label') === text);
      window.rsSetField = (el, value) => {
        const setter = Object.getOwnPropertyDescriptor(el instanceof HTMLTextAreaElement ?
          HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value').set;
        setter.call(el, value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      };
      window.rsFind = () => rsButton('Find games with this position');
      window.rsOrigin = () => document.querySelector('.review-search-return button');
      window.rsStage = 'source sideline';
      await rsWait(() => rsCount(4), 'initial games');
      const from = [...document.querySelectorAll('label.field')].find(el =>
        el.textContent.includes('Year from')).querySelector('input');
      rsSetField(from, '2015');
      await rsWait(() => rsCount(3), 'filtered games');
      const original = document.querySelector('.result-item');
      original.click();
      await rsWait(() => !!rsFind(), 'opening original review');
      const sideline = [...rsReview().querySelectorAll('.review-move')]
        .find(el => el.textContent.includes('d4'));
      if (!sideline) throw new Error('Source variation missing from original game');
      sideline.click();
      await rsWait(() => !!rsReview().querySelector('.review-move[aria-current="step"]')?.textContent.includes('d4'), 'selecting source branch');
      window.rsSourcePath = rsReview().querySelector('.review-move[aria-current="step"]').dataset.reviewPath;
      window.rsSourceBoard = rsReview().querySelector('cg-board');
      const returnButton = rsButton('Find games with this position');
      returnButton.focus();
      returnButton.click();
      await rsWait(() => rsCount(1) && !!rsOrigin() && !rsReview(), 'source variation lookup');
      if (from.value !== '2015' || document.querySelector('.position-coverage-notice')) throw new Error('Filters/coverage incorrect after review lookup');
      if (!document.querySelector('.position-search-active')) throw new Error('Reviewed FEN not applied to search');
      document.querySelector('.position-search-heading > div > button').click();
      await rsWait(() => !!document.querySelector('.position-variation-toggle input'), 'showing variation scope toggle');
      const scope = document.querySelector('.position-variation-toggle input');
      if (scope.checked) throw new Error('Review lookup must default to mainline');
      scope.click();
      await rsWait(() => rsCount(2), 'including origin source variation');
      if (!document.querySelector('.results-list')?.textContent.includes('Author’s annotation')) throw new Error('Origin source variation not searchable with scope enabled');
      scope.click();
      await rsWait(() => rsCount(1), 'restoring mainline lookup');
      document.querySelector('.result-item').click();
      await rsWait(() => !!rsReview() && !!rsReview().querySelector('.review-controls [aria-live="polite"]')?.textContent.includes('d4'), 'opening matching game');
      rsButton('Back to games').click();
      await rsWait(() => !rsReview() && rsCount(1), 'return from matching game');
      window.rsStage = 'restore original review';
      rsOrigin().focus();
    })()`);
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
    await win.webContents.executeJavaScript(`(async () => {
      await rsWait(() => !!rsReview() && !!rsFind(), 'keyboard return to original');
      if (rsReview().querySelector('.review-move[aria-current="step"]')?.dataset.reviewPath !== rsSourcePath ||
          rsReview().querySelector('cg-board') !== rsSourceBoard)
        throw new Error('Original viewer path or board was recreated during lookup');
      await rsWait(() => document.activeElement === rsFind(), 'restored focus');
      window.rsStage = 'piece mode exclusion';
      rsButton('Piece mode').click();
      await rsWait(() => !!document.querySelector('.piece-mode[open]'), 'piece mode');
      if (!rsFind().disabled || !rsFind().title.includes('Piece mode'))
        throw new Error('Free-piece mode search must be disabled with explanation');
      document.querySelector('.piece-mode button:last-child').click();
      await rsWait(() => !document.querySelector('.piece-mode[open]'), 'return from piece mode');
      window.rsStage = 'unsaved edit decision';
      rsButton('Add comment').click();
      await rsWait(() => !!rsReview().querySelector('.personal-comment-editor textarea'), 'comment editor');
      const comment = rsReview().querySelector('.personal-comment-editor textarea');
      rsSetField(comment, 'Note before cross-game search');
      await rsWait(() => !rsButton('Save my comments').disabled, 'dirty personal note');
      rsFind().click();
      await rsWait(() => !!document.querySelector('.unsaved-changes-dialog[open]'), 'save/discard/cancel modal');
      if (!document.querySelector('.unsaved-changes-dialog').textContent.includes('searching for matching games'))
        throw new Error('Search-specific unsaved-edit protection missing');
      document.querySelector('.unsaved-changes-dialog button:last-child').click();
      await rsWait(() => !document.querySelector('.unsaved-changes-dialog'), 'Cancel');
      if (!rsReview() || rsReview().querySelector('textarea')?.value !== 'Note before cross-game search')
        throw new Error('Cancel lost uncommitted note or exited review');
      rsFind().click();
      await rsWait(() => !!document.querySelector('.unsaved-changes-dialog[open]'), 'save dialog');
      document.querySelector('.unsaved-changes-dialog button:first-child').click();
      await rsWait(() => !rsReview() && rsCount(1), 'Save and search');
      const saved = await window.chessArchive.getGame(1);
      if (!saved.personal.comments.some(c => c.text === 'Note before cross-game search'))
        throw new Error('Saved note was not persisted before the search');
      rsOrigin().click();
      await rsWait(() => !!rsReview() && rsReview().querySelector('textarea')?.value === 'Note before cross-game search', 'return with saved note');
      if (rsReview().querySelector('.review-move[aria-current="step"]')?.dataset.reviewPath !== rsSourcePath)
        throw new Error('Saved original variation path lost');
      rsSetField(rsReview().querySelector('textarea'), 'Unsaved change to discard');
      rsFind().click();
      await rsWait(() => !!document.querySelector('.unsaved-changes-dialog[open]'), 'discard dialog');
      document.querySelector('.unsaved-changes-dialog button:nth-child(2)').click();
      await rsWait(() => !rsReview() && rsCount(1), 'Discard and search');
      if (!(await window.chessArchive.getGame(1)).personal.comments.some(c => c.text === 'Note before cross-game search'))
        throw new Error('Discard overwrote saved comment');
      rsOrigin().click();
      await rsWait(() => rsReview()?.querySelector('textarea')?.value === 'Note before cross-game search', 'discard restored saved note');
      rsButton('Back to games').click();
      await rsWait(() => !rsReview() && !rsOrigin(), 'back from origin');
      if (from.value !== '2015') throw new Error('Returning from origin lost filters');
      window.rsStage = 'saved personal sideline';
      document.querySelector('.position-search-heading .subtle-button')?.click();
      rsSetField(from, '');
      await rsWait(() => rsCount(4), 'all games for personal branch');
      const game3 = [...document.querySelectorAll('.result-item')]
        .find(el => el.textContent.includes('White 2'));
      if (!game3) throw new Error('Personal-analysis fixture missing');
      game3.click();
      await rsWait(() => !!rsReview() && !!rsReview().querySelector('.personal-move'), 'saved personal branch review');
      const own = rsReview().querySelector('.personal-move');
      own.click();
      await rsWait(() => !!rsReview().querySelector('.personal-move[aria-current="step"]'), 'select personal branch');
      window.rsPersonalPath = rsReview().querySelector('.personal-move[aria-current="step"]').dataset.reviewPath;
      rsFind().click();
      await rsWait(() => !rsReview() && rsCount(1), 'personal branch lookup');
      if (!document.querySelector('.results-list')?.textContent.includes('White 3'))
        throw new Error('Other game containing personal branch position not found');
      rsOrigin().click();
      await rsWait(() => !!rsReview() && !!rsReview().querySelector('.personal-move[aria-current="step"]'), 'return to saved personal branch');
      if (rsReview().querySelector('.personal-move[aria-current="step"]').dataset.reviewPath !== rsPersonalPath)
        throw new Error('Personal variation path lost on return');
      rsButton('Back to games').click();
      await rsWait(() => !rsReview(), 'exit personal review');
      window.rsStage = 'archive missing position index';
      document.querySelector('.browser-archive button').click();
      await rsWait(() => document.querySelector('.browser-archive > span')?.title.endsWith('position-review-unindexed.sqlite3'), 'switching to unindexed archive');
      await rsWait(() => rsCount(1), 'unindexed normal list');
      document.querySelector('.result-item').click();
      await rsWait(() => !!rsReview(), 'unindexed game review');
      if (rsFind().disabled) throw new Error('Legal position should be searchable even if the index is absent');
      rsFind().click();
      await rsWait(() => !rsReview() && !!document.querySelector('.position-coverage-notice'), 'missing-index warning');
      if (!document.querySelector('.position-coverage-notice').textContent.includes('no position index'))
        throw new Error('Missing index must not report a conclusive zero');
      rsOrigin().click();
      await rsWait(() => !!rsReview(), 'return from unindexed lookup');
    })()`);
    assert.equal(BrowserWindow.getAllWindows().length, 1);
    assert.deepEqual(errors, []);
    assert.equal(hash(readFileSync(unindexedPath)), originals[1], 'read-only review search changed unindexed archive');
    console.log('PS-11 desktop smoke passed: source/personal branches, scope and filters, keyboard return, preserved viewer/focus, piece mode, Save/Discard/Cancel, absent index.');
  } catch (error) { console.error(error); exitCode = 1; }
  finally { clearTimeout(timeout); finishDesktopTest(app, exitCode); }
}
void smoke();
