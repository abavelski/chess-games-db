import assert from 'node:assert/strict';
import { once } from 'node:events';
import { copyFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { app, BrowserWindow, dialog } from 'electron';
import { desktopTestDirectory, finishDesktopTest } from './fixtures/desktop-test.mjs';

async function smoke() {
// Import the shipped entry point and its dependencies from ASAR, not the checkout.
const temporary = desktopTestDirectory();
app.setPath('userData', temporary);
const database = join(temporary, 'games.sqlite3');
const packagedRoot = resolve('release/win-unpacked/resources/app.asar');
if (process.argv[2]) {
  copyFileSync(resolve(process.argv[2]), database);
} else {
  const requirePackaged = createRequire(join(packagedRoot, 'package.json'));
  const Database = requirePackaged('better-sqlite3');
  const db = new Database(database);
  db.exec(readFileSync(new URL('../db/migrations/007_games.sql', import.meta.url), 'utf8'));
  db.pragma('user_version = 7');
  db.close();
}
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [database] });
const errors = [];
app.on('browser-window-created', (_event, window) => {
  window.webContents.on('preload-error', (_event, _path, error) => errors.push(error.message));
  window.webContents.on('console-message', event => {
    if (event.level === 'error') errors.push(event.message);
  });
});
const timeout = setTimeout(() => {
  console.error('Packaged desktop smoke timed out.');
  finishDesktopTest(app, 1);
}, 30000);

try {
  const created = once(app, 'browser-window-created');
  await import(pathToFileURL(resolve('release/win-unpacked/resources/app.asar/electron/main.mjs')).href);
  const [, window] = await created;
  await once(window.webContents, 'did-finish-load');
  assert.ok(window.webContents.getURL().includes('app.asar'), 'Load the shipped UI');
  const result = await window.webContents.executeJavaScript(`(async () => {
    const opened = await window.chessArchive.openDatabase();
    const games = await window.chessArchive.searchGames({});
    const game = games.rows.length ? await window.chessArchive.getGame(games.rows[0].id) : null;
    return { canceled: opened.canceled, total: games.total, pgn: game?.pgn };
  })()`);
  assert.equal(result.canceled, false);
  assert.ok(result.total >= 0);
  if (process.argv[2]) {
    assert.ok(result.total > 0);
    assert.ok(result.pgn.length > 0);
  }
  assert.deepEqual(errors, []);
  console.log(`Packaged desktop smoke passed: ASAR startup, UI, database open, ${result.total} games${result.pgn ? ', PGN decoding' : ''}.`);
  clearTimeout(timeout);
  finishDesktopTest(app, 0);
} catch (error) {
  console.error(error);
  clearTimeout(timeout);
  finishDesktopTest(app, 1);
}
}

// Electron emits ready only after its entry module finishes evaluating.
void smoke().catch(error => {
  console.error(error);
  app.exit(1);
});
