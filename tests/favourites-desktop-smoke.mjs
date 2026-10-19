import { desktopTestDirectory, finishDesktopTest } from './fixtures/desktop-test.mjs';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import Database from 'better-sqlite3';
import { initializeGames, upsertGame } from '../lib/game-writer.mjs';
import { frame, hash } from './fixtures/opening-archive.mjs';

const temporary = desktopTestDirectory();
app.setPath('userData', temporary);
const path = join(temporary, 'games.db'), db = new Database(path);
initializeGames(db);
for (let index = 0; index < 42; index++) {
  const pgn = '1. e4 e5 *';
  upsertGame(db, { white: 'Player ' + index, black: 'Opponent', year: 2000 + index,
    pgn_zstd: frame(pgn), pgn_sha256: hash(pgn) });
}
db.close();
writeFileSync(join(temporary, 'archive.json'), JSON.stringify({ path }));
const errors = [];
app.on('browser-window-created', (_event, window) => {
  window.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message); });
  window.webContents.on('preload-error', (_event, _path, error) => errors.push(error.message));
});

async function smoke() {
  let exitCode = 0;
  const timeout = setTimeout(() => app.exit(1), 30000);
  try {
    const created = once(app, 'browser-window-created');
    await import('../electron/main.mjs');
    const [, window] = await created;
    await once(window.webContents, 'did-finish-load');
    await window.webContents.executeJavaScript(`(async () => {
      const wait = async predicate => {
        const deadline = Date.now() + 5000;
        while (!predicate()) {
          if (Date.now() > deadline) throw new Error('Favourites UI did not update: ' + predicate);
          await new Promise(resolve => setTimeout(resolve, 20));
        }
      };
      const idle = () => document.querySelector('.game-results')?.getAttribute('aria-busy') === 'false';
      const star = () => document.querySelector('.game-result-row .favourite-button');
      const filter = () => document.querySelector('.favourites-filter input');
      const setValue = (element, value) => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(element, value);
        element.dispatchEvent(new Event('input', { bubbles: true }));
      };
      await wait(() => star() && idle());
      if (star().getAttribute('aria-pressed') !== 'false') throw new Error('Initial star must be empty');
      star().click();
      await wait(() => star()?.getAttribute('aria-pressed') === 'true' && !star().disabled && idle());
      if (document.querySelector('.review-shell')) throw new Error('Star opened review');
      filter().click();
      await wait(() => idle() && document.querySelectorAll('.result-item').length === 1);
      const search = document.querySelector('[aria-label="Search games"]');
      setValue(search, 'no match');
      await wait(() => idle() && document.querySelector('.empty-results h3'));
      if (!filter().checked) throw new Error('Search cleared favourites filter');
      setValue(search, '');
      await wait(() => idle() && document.querySelectorAll('.result-item').length === 1);
      document.querySelector('.result-item').click();
      await wait(() => document.querySelector('.review-shell cg-board'));
      const reviewStar = document.querySelector('.review-shell .favourite-button');
      if (reviewStar.getAttribute('aria-pressed') !== 'true') throw new Error('Review lost favourite');
      document.querySelector('[aria-label="Next move"]').click();
      await wait(() => document.querySelector('.review-move[aria-current="step"]'));
      reviewStar.click();
      await wait(() => reviewStar.getAttribute('aria-pressed') === 'false' && !reviewStar.disabled);
      if (!document.querySelector('.review-move[aria-current="step"]')?.textContent.includes('e4')) throw new Error('Saving favourite reset review position');
      document.querySelector('.review-header > button').click();
      await wait(() => !document.querySelector('.review-shell') && idle() && document.querySelector('.empty-results h3'));
      document.querySelector('.empty-results button').click();
      await wait(() => !filter().checked && idle() && document.querySelectorAll('.result-item').length === 40);
      await window.chessArchive.setFavourite(1, true);
      filter().click();
      await wait(() => idle() && document.querySelectorAll('.result-item').length === 1);
      filter().click();
      await wait(() => idle() && document.querySelectorAll('.result-item').length === 40);
      const games = await window.chessArchive.searchGames({ pageSize: 100 });
      for (const game of games.rows.slice(0, 41)) await window.chessArchive.setFavourite(game.id, true);
      filter().click();
      await wait(() => idle() && document.querySelector('.pagination').textContent.includes('of 41'));
      document.querySelector('[aria-label="Next page"]').click();
      await wait(() => idle() && document.querySelectorAll('.result-item').length === 1);
      star().click();
      await wait(() => idle() && document.querySelectorAll('.result-item').length === 40 && document.querySelector('.pagination').textContent.includes('Page 1 of 1'));
      const saved = await window.chessArchive.searchGames({ favouritesOnly: true });
      if (saved.total !== 40) throw new Error('Filtered count did not match saved favourites');
      if (document.querySelector('.notice.error')) throw new Error(document.querySelector('.notice.error').textContent);
    })()`);
    assert.deepEqual(errors, []);
    console.log('Favourites desktop smoke passed: list/review stars, immediate saves, combined search, clear filters, review position and pagination after removal.');
  } catch (error) { console.error(error); exitCode = 1; }
  finally {
    clearTimeout(timeout);
    finishDesktopTest(app, exitCode);
  }
}
void smoke();
