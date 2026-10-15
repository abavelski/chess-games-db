import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { app } from 'electron';
import Database from 'better-sqlite3';

// Run with Electron so this exercises its native SQLite ABI and sandboxed preload.
const temporary = mkdtempSync(join(tmpdir(), 'chess-desktop-'));
app.setPath('userData', temporary);
const path = join(temporary, 'archive.sqlite3');
const db = new Database(path);
for (const migration of ['001_initial', '002_source_records', '003_record_classification']) {
  db.exec(readFileSync(new URL(`../db/migrations/${migration}.sql`, import.meta.url), 'utf8'));
}
db.pragma('user_version = 3');
const insertSource = db.prepare('INSERT INTO sources (source_key, title, original_file) VALUES (?, ?, ?)');
insertSource.run('book:catalog:smoke:db-001', 'Smoke book', '/books/Smoke book/Level 1.cbh');
insertSource.run('book:catalog:smoke:db-002', 'Smoke book', '/books/Smoke book/Level 2.cbh');
insertSource.run('other', 'Other book', null);
const pgn = '[White "Smoke White"]\n[Black "Smoke Black"]\n\n1. e4 e5 2. Nf3 *';
// Zstandard-compressed fixture; no compression tool is required at test time.
const compressed = Buffer.from('KLUv/SA+vQEAxAJbV2hpdGUgIlNtb2tlICJdCltCbGFjayJdCgoxLiBlNCBlNSAyLiBOZjMgKgMAQICcdMA1lQ==', 'base64');
for (const sourceId of [1, 2, 3]) {
  db.prepare('INSERT INTO games (source_id, source_game_key, white, black, pgn_zstd, pgn_sha256) VALUES (?, ?, ?, ?, ?, ?)')
    .run(sourceId, 'game', 'Smoke White', 'Smoke Black', compressed, createHash('sha256').update(pgn).digest('hex'));
  db.prepare("INSERT INTO source_records (source_id, source_record_key, record_type, status, metadata_json) VALUES (?, 'game', 'game', 'extracted', '{}')")
    .run(sourceId);
}
db.close();
const archiveHash = () => createHash('sha256').update(readFileSync(path)).digest('hex');
const originalHash = archiveHash();
writeFileSync(join(temporary, 'archive.json'), JSON.stringify({ path }));

const errors = [];
app.on('browser-window-created', (_event, window) => {
  window.webContents.on('console-message', (_event, details) => {
    if (details.level === 'error') errors.push(details.message);
  });
  window.webContents.on('preload-error', (_event, _path, error) => errors.push(error.message));
});

async function checkWindow(window) {
  await once(window.webContents, 'did-finish-load');
  assert.ok(window.webContents.getURL().startsWith('file:'), 'Built app must work without Vite');
  const state = await window.webContents.executeJavaScript(`(async () => {
    const catalog = await window.chessArchive.getCatalog();
    const games = await window.chessArchive.searchGames({ search: 'Smoke White' });
    const game = await window.chessArchive.getGame(games.rows[0].id);
    const deadline = Date.now() + 5000;
    while (!document.querySelector('cg-board') && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    const next = document.querySelector('.lpv__controls__goto--next');
    next?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    document.dispatchEvent(new MouseEvent('mouseup'));
    return {
      books: catalog.totals.books, total: games.total, pgn: game.pgn,
      board: !!document.querySelector('cg-board'),
      move: document.querySelector('.move.current')?.textContent,
      errors: [...document.querySelectorAll('.notice.error')].map(el => el.textContent),
    };
  })()`);
  assert.equal(state.books, 2);
  assert.equal(state.total, 3);
  assert.equal(state.pgn, pgn);
  assert.equal(state.board, true);
  assert.equal(state.move, 'e4');
  assert.deepEqual(state.errors, []);

  const grouping = await window.webContents.executeJavaScript(`(async () => {
    const waitFor = async predicate => {
      const deadline = Date.now() + 5000;
      while (!predicate()) {
        if (Date.now() > deadline) throw new Error('Book selection did not update');
        await new Promise(resolve => setTimeout(resolve, 25));
      }
    };
    const buttons = [...document.querySelectorAll('.book-link')].filter(b => b.title === 'Smoke book');
    if (buttons.length !== 1) throw new Error('Book title is repeated');
    buttons[0].click();
    await waitFor(() => document.querySelectorAll('.result-item').length === 2);
    const select = document.querySelector('.book-sections select');
    const sections = [...select.options].map(o => o.textContent);
    const change = value => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, value);
      select.dispatchEvent(new Event('change', { bubbles: true }));
    };
    change('2');
    await waitFor(() => document.querySelectorAll('.result-item').length === 1 &&
      document.querySelector('.eyebrow')?.textContent.includes('#2'));
    [...document.querySelectorAll('.nav-link')].find(b => b.textContent === 'Source records').click();
    await waitFor(() => document.querySelector('.details-content .eyebrow')?.textContent.includes('SOURCE RECORD'));
    change('all');
    await waitFor(() => document.querySelectorAll('.result-item').length === 2);
    const catalog = await window.chessArchive.getCatalog();
    const book = catalog.books.find(b => b.title === 'Smoke book');
    const games = await window.chessArchive.searchGames({ sourceIds: book.source_ids });
    const records = await window.chessArchive.searchRecords({ sourceIds: book.source_ids });
    const outside = await window.chessArchive.searchGames({ sourceIds: book.source_ids, sourceId: 3 });
    return { sections, gameIds: games.rows.map(g => g.source_id).sort(), records: records.total, outside: outside.total };
  })()`);
  assert.deepEqual(grouping.sections, ['All sections (2)', 'Level 1', 'Level 2']);
  assert.deepEqual(grouping.gameIds, [1, 2]);
  assert.equal(grouping.records, 2);
  assert.equal(grouping.outside, 0);
}

async function smoke() {
  const timeout = setTimeout(() => { console.error('Desktop smoke test timed out'); app.exit(1); }, 20000);
  try {
    const created = once(app, 'browser-window-created');
    await import('../electron/main.mjs');
    const [, window] = await created;
    await checkWindow(window);
    if (process.platform === 'darwin') {
      const closed = once(window, 'closed');
      window.close();
      await closed;
      const reopened = once(app, 'browser-window-created');
      app.emit('activate');
      await checkWindow((await reopened)[1]);
    }
    assert.deepEqual(errors, []);
    assert.equal(archiveHash(), originalHash, 'Browsing must preserve every byte of the archive');
    console.log('Desktop smoke passed: built renderer, preload, SQLite, PGN, move controls, and macOS reopening.');
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    clearTimeout(timeout);
    app.on('will-quit', () => rmSync(temporary, { recursive: true, force: true }));
    app.quit();
  }
}

// Electron emits ready after entry-module evaluation completes.
void smoke();
