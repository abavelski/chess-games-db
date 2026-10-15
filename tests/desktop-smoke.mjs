import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { app, BrowserWindow } from 'electron';
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
const pgn = "[White \"Smoke White\"]\n[Black \"Smoke Black\"]\n\n{ [%pre:ENG Opening introduction.] }\n1. e4 $14 { [%post Space in the center.] [%cal Gb6a4,Yc3a4] [%csl Ra4] }\n({ [%pre Another plan:] } 1. d4 d5 { A queen-pawn approach. } (1... Nf6 { Nested note. }))\ne5 { [%eval -0.80/10] } 2. Nf3 (2. Bc4 { Final variation. }) Nc6 { Closing text. } *";
// Zstandard-compressed fixture; no compression tool is required at test time.
const compressed = Buffer.from('KLUv/WBKABUIAIZQNiYQzTYHUotIpSOIR86QpbvDGhWXWH8dHwjAFq9e2X8jEhEAAAIAAS0AKgApAOqseUn7Ncky04uy2x+6NcOEW6CDCUe4iL5ZS1Jg2LpKtCTFGfMgLoqzbNRCFJR8TTlHxpoKd9WzEcYg8KykwXK3bBFd0siymZ0p+W5ntvByWb0/DsAffhPLiqFvLnGArqoO4/NKsX0Rwn1LLHQ0cybilG9OMP2Zrs7npUmvg48cAZ9XOcGyes6AQW/Mb4urudtuCKxyhTAegTycgUeBPhx3q+FFxKvRmFeWrx8OAAMb5IooZDtPNMZVjeWCVcurxSH0cFlkNqWMVLegrZxPBmEqAQ==', 'base64');
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
  window.webContents.on('console-message', event => {
    if (event.level === 'error') errors.push(event.message);
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
  assert.match(state.move, /^e4/);
  assert.deepEqual(state.errors, []);

  const previewWidth = await window.webContents.executeJavaScript('document.querySelector("cg-board").getBoundingClientRect().width');
  const windowCount = BrowserWindow.getAllWindows().length;
  await window.webContents.executeJavaScript('document.querySelector(".review-open").click()');
  const reviewState = await window.webContents.executeJavaScript(`(async () => {
    const root = document.querySelector('.review-shell');
    const waitFor = async predicate => {
      const deadline = Date.now() + 5000;
      while (!predicate()) {
        if (Date.now() > deadline) throw new Error('Review did not update');
        await new Promise(resolve => setTimeout(resolve, 25));
      }
    };
    await waitFor(() => root.querySelector('svg.cg-shapes line'));
    const comments = [...root.querySelectorAll('.review-comment')].map(p => p.textContent.trim().replace(/^\{ (.*) \}$/s, '$1'));
    const current = () => root.querySelector('.review-move[aria-current="step"]')?.textContent;
    const initial = current();
    const arrows = [...root.querySelectorAll('svg.cg-shapes line')].map(line => line.getAttribute('stroke'));
    const squares = root.querySelectorAll('svg.cg-shapes circle').length;
    const width = root.querySelector('cg-board').getBoundingClientRect().width;
    [...root.querySelectorAll('.review-move')].find(b => b.textContent.includes('d4')).click();
    await waitFor(() => current()?.includes('d4'));
    await waitFor(() => root.querySelectorAll('svg.cg-shapes line').length === 0);
    const variation = current();
    root.querySelector('[aria-label="Next move"]').click();
    await waitFor(() => current()?.includes('d5'));
    root.querySelector('[aria-label="Last mainline position"]').click();
    await waitFor(() => current()?.includes('Nc6'));
    root.querySelector('[aria-label="First position"]').click();
    await waitFor(() => !current());
    root.querySelector('[aria-label="Flip board"]').click();
    const flipped = !!root.querySelector('.orientation-black');
    const original = root.querySelector('.review-original pre').textContent;
    const pair = [...root.querySelectorAll('.review-move-pair')].find(p => p.textContent.includes('d4'));
    const pairMoves = [...pair.querySelectorAll('.review-move')].map(button => button.getBoundingClientRect());
    const evaluations = [...root.querySelectorAll('.review-evaluation')].map(e => e.textContent.trim());
    if (Math.abs(pairMoves[0].top - pairMoves[1].top) > 1) throw new Error('White and Black moves must share a line');
    if (!evaluations.includes('(⩲)') || !evaluations.includes('(-0.80)')) throw new Error('Evaluations must appear beside their move');
    const evaluation = root.querySelector('.review-evaluation');
    if (parseFloat(getComputedStyle(evaluation).fontSize) >= parseFloat(getComputedStyle(evaluation.parentElement).fontSize)) throw new Error('Evaluation text must be smaller');
    return { comments, initial, variation, arrows, squares, width, flipped, original, parentheses: root.querySelectorAll('.review-variation').length, ends: root.querySelectorAll('.review-variation-end').length, controlsBottom: root.querySelector('.review-controls').getBoundingClientRect().bottom, viewport: innerHeight };
  })()`);
  assert.deepEqual(reviewState.comments, ['Opening introduction.', 'Space in the center.', 'Another plan:',
    'A queen-pawn approach.', 'Nested note.', 'Final variation.', 'Closing text.']);
  assert.match(reviewState.initial, /e4/);
  assert.match(reviewState.variation, /d4/);
  assert.equal(reviewState.arrows.length, 2);
  assert.notEqual(reviewState.arrows[0], reviewState.arrows[1]);
  assert.equal(reviewState.squares, 1);
  assert.ok(reviewState.width > previewWidth, 'Review board must be larger than the preview');
  assert.equal(reviewState.flipped, true);
  assert.equal(reviewState.original, pgn);
  window.setSize(920, 650);
  const compact = await window.webContents.executeJavaScript(`(async () => {
    await new Promise(resolve => setTimeout(resolve, 100));
    const root = document.querySelector('.review-shell');
    const board = root.querySelector('cg-board').getBoundingClientRect();
    const score = root.querySelector('.review-score').getBoundingClientRect();
    const controls = root.querySelector('.review-controls').getBoundingClientRect();
    return board.width > 300 && Math.abs(board.width - board.height) < 1 &&
      controls.bottom <= innerHeight && score.bottom <= innerHeight && score.right <= innerWidth;
  })()`);
  assert.equal(compact, true, 'Board, controls, and commentary must fit the minimum window size');
  window.setSize(1510, 920);
  assert.equal(BrowserWindow.getAllWindows().length, windowCount, 'Review must use the library window');
  assert.equal(reviewState.parentheses, 3);
  assert.equal(reviewState.ends, 3);
  assert.ok(reviewState.controlsBottom <= reviewState.viewport, 'Controls must fit in the window');
  // Use real Electron key input, including while the board itself has focus.
  const key = async (keyCode, expected) => {
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode });
    const current = await window.webContents.executeJavaScript(`(async () => {
      await new Promise(resolve => setTimeout(resolve, 60));
      return document.querySelector('.review-move[aria-current="step"]')?.textContent || '';
    })()`);
    assert.match(current, expected);
  };
  await key('Right', /e4/);
  await key('Right', /e5/);
  await window.webContents.executeJavaScript('document.querySelector(".review-shell .lpv").focus()');
  await key('Left', /e4/);
  await key('End', /Nc6/);
  await key('Home', /^$/);
  await key('F', /^$/);
  assert.equal(await window.webContents.executeJavaScript('!!document.querySelector(".review-shell .orientation-white")'), true);
  const ignored = await window.webContents.executeJavaScript(`(() => {
    const input = document.createElement('input');
    document.querySelector('.review-shell').appendChild(input); input.focus();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    input.remove();
    return !document.querySelector('.review-move[aria-current="step"]');
  })()`);
  assert.equal(ignored, true, 'Typing and text-editing keys must not navigate the board');
  window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  const returned = await window.webContents.executeJavaScript(`(async () => {
    await new Promise(resolve => setTimeout(resolve, 60));
    return !document.querySelector('.review-shell') && !!document.querySelector('.review-open');
  })()`);
  assert.equal(returned, true, 'Escape must restore the existing library');
  assert.equal(window.isDestroyed(), false);

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
  let exitCode = 0;
  const timeout = setTimeout(() => { console.error('Desktop smoke test timed out'); app.exit(1); }, 30000);
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
    console.log('Desktop smoke passed: library, book grouping, same-window review and keyboard shortcuts, all commentary, colored arrows, variations, navigation, and archive preservation.');
  } catch (error) {
    console.error(error);
    exitCode = 1;
  } finally {
    clearTimeout(timeout);
    app.on('will-quit', () => {
      rmSync(temporary, { recursive: true, force: true });
      app.exit(exitCode);
    });
    app.quit();
  }
}

// Electron emits ready after entry-module evaluation completes.
void smoke();
