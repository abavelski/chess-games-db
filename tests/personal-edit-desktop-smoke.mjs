import { desktopTestDirectory, finishDesktopTest } from './fixtures/desktop-test.mjs';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import { fixtureArchive } from './fixtures/opening-archive.mjs';
import { ChessArchive } from '../electron/database.mjs';

const temporary = desktopTestDirectory(); app.setPath('userData', temporary);
const path = join(temporary, 'games.db');
const pgn = '1.e4 {Book note} (1.d4 d5) e5 2.Nf3 *';
const db = fixtureArchive(path, [pgn]); db.close();
const archive = new ChessArchive(path), id = archive.searchGames().rows[0].id;
archive.savePersonal(id, {
  lines: [['e2e4', 'c7c5', 'g1f3', 'b8c6'], ['e2e4', 'c7c5', 'b1c3'], ['d2d4', 'd7d5', 'c2c4']],
  comments: [
    { moves: [], text: 'Starting note' }, { moves: ['e2e4'], text: 'Book move note' },
    { moves: ['e2e4', 'c7c5'], text: 'Try Sicilian' },
    { moves: ['e2e4', 'c7c5', 'g1f3'], text: 'Develop knight' },
    { moves: ['e2e4', 'c7c5', 'g1f3', 'b8c6'], text: 'Respond' },
    { moves: ['e2e4', 'c7c5', 'b1c3'], text: 'Sibling note' },
  ],
}); archive.close();
writeFileSync(join(temporary, 'archive.json'), JSON.stringify({ path }));
const errors = [];
app.on('browser-window-created', (_event, window) => {
  window.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message); });
  window.webContents.on('preload-error', (_event, _path, error) => errors.push(error.message));
});
async function smoke() {
  let code = 0;
  const timeout = setTimeout(() => { console.error('Personal editing desktop timeout'); app.exit(1); }, 40000);
  try {
    const created = once(app, 'browser-window-created'); await import('../electron/main.mjs'); const [, window] = await created;
    await once(window.webContents, 'did-finish-load');
    await window.webContents.executeJavaScript(`(async () => {
      const wait = async predicate => { const end = Date.now() + 7000; while (!predicate()) { if (Date.now() > end) throw new Error('Timed out: ' + predicate); await new Promise(r => setTimeout(r, 20)); } };
      const button = label => [...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === label || b.textContent.trim() === label);
      const current = () => document.querySelector('.review-move[aria-current="step"]');
      const detail = () => window.chessArchive.getGame(${id});
      const open = async () => {
        await wait(() => document.querySelector('.result-item'));
        document.querySelector('.result-item').click();
        await wait(() => button('Add comment') && !button('Add comment').disabled);
      };
      const save = async () => {
        button('Save my comments').click();
        await wait(() => button('Save my comments').disabled && button('Save my comments').getAttribute('aria-busy') === 'false');
      };
      const close = async () => { button('Back to games').click(); await wait(() => !document.querySelector('.review-shell')); };
      await open();
      if (document.querySelector('textarea')) throw new Error('Editor should be hidden initially');
      button('Edit starting-position comment').click(); await wait(() => document.querySelector('textarea')?.value === 'Starting note');
      button('Edit comment: Try Sicilian').click(); await wait(() => current()?.textContent.includes('c5') && document.querySelector('textarea')?.value === 'Try Sicilian');
      if (document.activeElement !== document.querySelector('textarea')) await wait(() => document.activeElement === document.querySelector('textarea'));
      const textarea = document.querySelector('textarea');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(textarea, 'Updated Sicilian');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      await wait(() => !button('Save my comments').disabled);
      if (!(await detail()).personal.comments.some(c => c.text === 'Try Sicilian')) throw new Error('Edit saved automatically');
      await save(); await close(); await open();
      button('Edit comment: Updated Sicilian').click(); await wait(() => document.querySelector('textarea')?.value === 'Updated Sicilian');
      button('Delete comment at this position').click(); await wait(() => !button('Edit comment: Updated Sicilian'));
      if (!(await detail()).personal.comments.some(c => c.text === 'Updated Sicilian')) throw new Error('Individual deletion saved automatically');
      if (!button('Edit starting-position comment') || !button('Edit comment: Book move note') || !button('Edit comment: Sibling note')) throw new Error('Deleting one comment removed others');
      await save(); await close(); await open();
      if (button('Edit comment: Updated Sicilian')) throw new Error('Deleted comment returned after reopening');
      const ownMove = san => [...document.querySelectorAll('.personal-move')].find(b => b.textContent.includes(san));
      ownMove('Nf3').click(); await wait(() => current()?.textContent.includes('Nf3') && button('Delete selected personal move'));
      const board = document.querySelector('.review-board cg-board');
      button('Delete selected personal move').click();
      await wait(() => !ownMove('Nf3') && !ownMove('Nc6') && current()?.textContent.includes('c5'));
      if (document.querySelector('.review-board cg-board') !== board) throw new Error('Trimming remounted the board');
      if (!ownMove('Nc3') || !ownMove('c4') || button('Edit comment: Develop knight') || button('Edit comment: Respond')) throw new Error('Trim did not preserve siblings or remove descendant comments');
      if ((await detail()).personal.lines[0].length !== 4) throw new Error('Trimming saved automatically');
      await save(); await close(); await open();
      const trimmed = await detail();
      if (trimmed.personal.lines.length !== 2 || trimmed.personal.comments.some(c => ['Develop knight', 'Respond'].includes(c.text))) throw new Error('Trim did not persist');
      ownMove('c5').click(); await wait(() => button('Delete selected personal move'));
      button('Delete selected personal move').click(); await wait(() => !ownMove('c5') && !ownMove('Nc3') && current()?.textContent.includes('e4'));
      if (!ownMove('c4') || !document.querySelector('.review-original pre').textContent.includes('Book note')) throw new Error('Trim damaged book or unrelated line');
      button('Back to games').click(); await wait(() => document.querySelector('.unsaved-changes-dialog[open]'));
      button('Discard').click(); await wait(() => !document.querySelector('.review-shell')); await open();
      if (!ownMove('c5') || !ownMove('Nc3') || ownMove('Nf3')) throw new Error('Discard did not restore last saved branches');
      if ((await detail()).pgn !== ${JSON.stringify(pgn)}) throw new Error('Source PGN changed');
    })()`);
    assert.deepEqual(errors, []);
    console.log('Personal editing desktop passed: reopen, click-to-edit, individual comment deletion, subtree trimming, sibling preservation, explicit saves and discard.');
  } catch (error) { console.error(error); code = 1; }
  finally { clearTimeout(timeout); finishDesktopTest(app, code); }
}
void smoke();
