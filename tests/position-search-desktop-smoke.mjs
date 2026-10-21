import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app, BrowserWindow, dialog } from 'electron';
import { desktopTestDirectory, finishDesktopTest } from './fixtures/desktop-test.mjs';
import { fixtureArchive, hash } from './fixtures/opening-archive.mjs';
import { upsertGame } from '../lib/game-writer.mjs';
import { installPositionIndex } from '../scripts/position-index.mjs';
import { buildPositions } from '../lib/position-builder.mjs';

// Only disposable archives are written. The app itself only reads the index.
const directory = desktopTestDirectory();
app.setPath('userData', directory);
const path = join(directory, 'position-indexed.sqlite3');
const unindexedPath = join(directory, 'position-unindexed.sqlite3');
const scores = [
  ...Array(41).fill('1. e4 e5 2. Nf3 Nc6 *'),
  '1. Nf3 Nc6 2. e4 e5 *', '1. d4 d5 *',
];
const db = fixtureArchive(path, scores);
upsertGame(db, { id: 1, year: 2000 });
upsertGame(db, { id: 2, year: 2020 });
db.exec("ALTER TABLE games ADD COLUMN favourite INTEGER NOT NULL DEFAULT 0 CHECK(favourite IN (0,1))");
db.prepare('UPDATE games SET favourite=1 WHERE id=1').run();
installPositionIndex(db);
await buildPositions(db, { batchSize: 10 });
db.close();
fixtureArchive(unindexedPath, ['1.e4 *']).close();
const originals = [path, unindexedPath].map(file => hash(readFileSync(file)));
writeFileSync(join(directory, 'archive.json'), JSON.stringify({ path }));
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [unindexedPath] });
const errors = [];
app.on('browser-window-created', (_event, window) => {
  window.webContents.on('console-message', event => {
    if (event.level === 'error') errors.push(event.message);
  });
  window.webContents.on('preload-error', (_event, _path, error) => errors.push(error.message));
});

async function smoke() {
  const timeout = setTimeout(() => { console.error('PS-06 desktop smoke timed out'); app.exit(1); }, 45000);
  let exitCode = 0;
  try {
    const created = once(app, 'browser-window-created');
    await import('../electron/main.mjs');
    const [, window] = await created;
    await once(window.webContents, 'did-finish-load');
    await window.webContents.executeJavaScript(`(async () => {
      window.psWait = async predicate => {
        const deadline = Date.now() + 10000;
        while (!predicate()) {
          if (Date.now() > deadline) throw new Error('PS-06 UI timeout: ' + predicate);
          await new Promise(resolve => setTimeout(resolve, 25));
        }
      };
      window.psCount = n => document.querySelector('.results-titlebar [role="status"]')?.textContent ===
        n + (n === 1 ? ' game' : ' games') &&
        document.querySelector('.game-results')?.getAttribute('aria-busy') === 'false' &&
        document.querySelectorAll('.result-item').length === Math.min(n, 40);
      window.psSquare = name => document.querySelector('.position-square[data-square="' + name + '"]');
      window.psMove = async (from, to) => {
        if (psSquare(from).getAttribute('aria-pressed') !== 'true') psSquare(from).click();
        await new Promise(resolve => setTimeout(resolve, 60));
        if (psSquare(from).getAttribute('aria-pressed') !== 'true') {
          const selected = document.querySelector('.position-square.selected')?.getAttribute('data-square');
          throw new Error('Could not select ' + from + ' for ' + to + ' (selected ' +
            selected + '; turn ' + document.querySelector('.position-turn').textContent +
            '; FEN ' + document.querySelector('.position-fen output').textContent + ')');
        }
        psSquare(to).click();
        await new Promise(resolve => setTimeout(resolve, 60));
        if (psSquare(from).getAttribute('aria-pressed') !== 'false') {
          throw new Error('Move ' + from + to + ' was not committed: ' +
            document.querySelector('.position-board-error')?.textContent);
        }
      };
      window.psField = (el, value) => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(el,value); el.dispatchEvent(new Event('input', { bubbles:true }));
      };
      await psWait(() => psCount(43));
      if (document.querySelector('.position-search-board')) throw new Error('Search board must be unobtrusive until opened');
      const trigger = [...document.querySelectorAll('button')].find(b => b.textContent.includes('Search by position'));
      trigger.click();
      await psWait(() => document.querySelectorAll('.position-square').length === 64);
      const startFen = document.querySelector('.position-fen output').textContent;
      psSquare('e2').click();
      await psWait(() => psSquare('e2').getAttribute('aria-pressed') === 'true');
      psSquare('e5').click();
      await psWait(() => !!document.querySelector('.position-board-error'));
      if (document.querySelector('.position-move-list').textContent.includes('e4') ||
          document.querySelector('.position-fen output').textContent !== startFen ||
          !document.querySelector('.position-board-error')) throw new Error('Illegal move changed the board');
      psSquare('e4').click();
      await psWait(() => document.querySelector('.position-move-list').textContent.includes('e4'));
      if (!document.querySelector('.position-move-list').textContent.includes('e4') ||
          !document.querySelector('.position-turn').textContent.includes('Black')) throw new Error('Legal move or turn failed');
      if (!psCount(43)) throw new Error('Playing a move must not silently invoke the search API');
      document.querySelector('.position-search-actions button:nth-child(2)').click();
      await psWait(() => document.querySelector('.position-fen output').textContent === startFen);
      if (document.querySelector('.position-fen output').textContent !== startFen) throw new Error('Undo must restore FEN');
      await psMove('e2', 'e4');
      document.querySelector('.position-search-actions button:nth-child(3)').click();
      await psWait(() => document.querySelector('.position-fen output').textContent === startFen);
      if (document.querySelector('.position-fen output').textContent !== startFen) throw new Error('Reset must restore FEN');
      // Transposed order, no opening-name selection or PGN scan.
      for (const [a,b] of [['g1','f3'],['b8','c6'],['e2','e4'],['e7','e5']]) await psMove(a,b);
      if (!document.querySelector('.position-turn').textContent.includes('White')) throw new Error('Side to move is incorrect');
      const fen = document.querySelector('.position-fen output').textContent;
      document.querySelector('.position-search-submit .primary-button').click();
      await psWait(() => psCount(42) && document.querySelectorAll('.position-match-label').length === 40);
      if (!document.querySelector('.position-search-active')) throw new Error('Missing position search indicator');
      if (document.querySelector('.position-coverage-notice')) throw new Error('Complete index should not show partial warning');
      window.psFenBeforeReview = fen;
      document.querySelector('[aria-label="Next page"]').click();
      await psWait(() => document.querySelector('.pagination').textContent.includes('Page 2 of 2') &&
        document.querySelectorAll('.result-item').length === 2);
      window.scrollTo(0, document.body.scrollHeight);
      window.psSavedScroll = scrollY;
      document.querySelector('.result-item').click();
      await psWait(() => document.querySelector('.review-shell'));
    })()`);
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    await window.webContents.executeJavaScript(`(async () => {
      await psWait(() => !document.querySelector('.review-shell') &&
        document.activeElement?.classList.contains('result-item'));
      if (!document.querySelector('.pagination').textContent.includes('Page 2 of 2') ||
          document.querySelector('.position-fen output').textContent !== psFenBeforeReview ||
          !document.querySelector('.position-move-list').textContent.includes('Nf3') ||
          Math.abs(scrollY - psSavedScroll) > 1) throw new Error('Search page, board, history or scroll lost on Back');
      const years = [...document.querySelectorAll('label.field')];
      const from = years.find(el => el.textContent.includes('Year from')).querySelector('input');
      psField(from, '2000');
      await psWait(() => psCount(2));
      document.querySelector('.favourites-filter input').click();
      await psWait(() => psCount(1));
      if (!document.querySelector('.position-search-active')) throw new Error('Other filters cleared position search');
      const currentFen = document.querySelector('.position-fen output').textContent;
      document.querySelector('.position-search-submit .subtle-button').click();
      await psWait(() => psCount(1) && !document.querySelector('.position-search-active'));
      if (document.querySelector('.position-fen output').textContent !== currentFen) throw new Error('Clearing search lost board setup');
      if (!document.querySelector('.favourites-filter input').checked || from.value !== '2000') throw new Error('Clearing position search removed unrelated filters');
      // Keyboard arrow navigation and Enter/Space square interaction.
      document.querySelector('.position-search-actions button:nth-child(3)').click();
      const e2 = psSquare('e2');
      e2.focus();
      e2.dispatchEvent(new KeyboardEvent('keydown', { key:'ArrowUp', bubbles:true, cancelable:true }));
      if (document.activeElement !== psSquare('e3')) throw new Error('Arrow keys must move keyboard square focus');
      psSquare('e2').focus();
    })()`);
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
    await window.webContents.executeJavaScript(`(async () => {
      await psWait(() => psSquare('e2').getAttribute('aria-pressed') === 'true');
      if (document.querySelectorAll('.position-square.legal').length !== 2) throw new Error('Keyboard selection lacks legal destinations');
      psSquare('e4').click();
      if (!document.querySelector('.position-move-list').textContent.includes('e4')) throw new Error('Keyboard-selected move did not play');
    })()`);
    window.setSize(920, 650);
    await window.webContents.executeJavaScript(`(async () => {
      await new Promise(resolve => setTimeout(resolve, 100));
      if (document.documentElement.scrollWidth > innerWidth) throw new Error('Position board overflows minimum desktop width');
      if (document.querySelector('.position-search-board').getBoundingClientRect().width < 220)
        throw new Error('Board too small at minimum window width');
    })()`);
    window.setSize(1510,920);
    await window.webContents.executeJavaScript(`(async () => {
      document.querySelector('.browser-archive button').click();
      await psWait(() => psCount(1) && !document.querySelector('.position-search-active'));
      document.querySelector('.position-search-heading button').click();
      await psWait(() => document.querySelectorAll('.position-square').length === 64);
      document.querySelector('.position-search-submit .primary-button').click();
      await psWait(() => !!document.querySelector('.position-coverage-notice'));
      if (!document.querySelector('.position-coverage-notice').textContent.includes('no position index') ||
          !document.querySelector('.empty-results').textContent.includes('Position index not ready'))
        throw new Error('Unindexed v7 archive must explain missing index, not zero results');
    })()`);
    assert.equal(BrowserWindow.getAllWindows().length, 1);
    assert.deepEqual(errors, []);
    assert.deepEqual([path, unindexedPath].map(file => hash(readFileSync(file))), originals,
      'browser position search must not write either archive');
    console.log('PS-06 desktop smoke passed: legal and illegal moves, undo/reset, transposition search, paging, filters, review return, keyboard, compact screen, absent index and immutable archives.');
  } catch (error) { console.error(error); exitCode = 1; }
  finally { clearTimeout(timeout); finishDesktopTest(app, exitCode); }
}
void smoke();
