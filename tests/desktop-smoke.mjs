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
db.prepare('INSERT INTO sources (source_key, title) VALUES (?, ?)').run('smoke', 'Smoke book');
const pgn = '[White "Smoke White"]\n[Black "Smoke Black"]\n\n1. e4 e5 2. Nf3 *';
// Zstandard-compressed fixture; no compression tool is required at test time.
const compressed = Buffer.from('KLUv/SA+vQEAxAJbV2hpdGUgIlNtb2tlICJdCltCbGFjayJdCgoxLiBlNCBlNSAyLiBOZjMgKgMAQICcdMA1lQ==', 'base64');
db.prepare('INSERT INTO games (source_id, source_game_key, white, black, pgn_zstd, pgn_sha256) VALUES (1, ?, ?, ?, ?, ?)')
  .run('game', 'Smoke White', 'Smoke Black', compressed, createHash('sha256').update(pgn).digest('hex'));
db.close();
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
  assert.equal(state.books, 1);
  assert.equal(state.total, 1);
  assert.equal(state.pgn, pgn);
  assert.equal(state.board, true);
  assert.equal(state.move, 'e4');
  assert.deepEqual(state.errors, []);
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
