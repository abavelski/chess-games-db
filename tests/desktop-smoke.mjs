import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { app, BrowserWindow } from 'electron';
import Database from 'better-sqlite3';
import { initializeGames, upsertGame } from '../lib/game-writer.mjs';
import { ChessArchive } from '../electron/database.mjs';

// Run with Electron so this exercises its native SQLite ABI and sandboxed preload.
const temporary = mkdtempSync(join(tmpdir(), 'chess-desktop-'));
app.setPath('userData', temporary);
const path = join(temporary, 'archive.sqlite3');
const db = new Database(path);
initializeGames(db);
const pgn = "[White \"Smoke White\"]\n[Black \"Smoke Black\"]\n\n{ [%pre:ENG Opening introduction.] }\n1. e4 $14 { [%post Space in the center.] [%cal Gb6a4,Yc3a4] [%csl Ra4] }\n({ [%pre Another plan:] } 1. d4 d5 { A queen-pawn approach. } (1... Nf6 { Nested note. }))\ne5 { [%eval -0.80/10] } 2. Nf3 (2. Bc4 { Final variation. }) Nc6 { Closing text. } *";
// Zstandard-compressed fixture; no compression tool is required at test time.
const compressed = Buffer.from('KLUv/WBKABUIAIZQNiYQzTYHUotIpSOIR86QpbvDGhWXWH8dHwjAFq9e2X8jEhEAAAIAAS0AKgApAOqseUn7Ncky04uy2x+6NcOEW6CDCUe4iL5ZS1Jg2LpKtCTFGfMgLoqzbNRCFJR8TTlHxpoKd9WzEcYg8KykwXK3bBFd0siymZ0p+W5ntvByWb0/DsAffhPLiqFvLnGArqoO4/NKsX0Rwn1LLHQ0cybilG9OMP2Zrs7npUmvg48cAZ9XOcGyes6AQW/Mb4urudtuCKxyhTAegTycgUeBPhx3q+FFxKvRmFeWrx8OAAMb5IooZDtPNMZVjeWCVcurxSH0cFlkNqWMVLegrZxPBmEqAQ==', 'base64');
for (const sourceId of [1,2,3]) upsertGame(db,{white:'Smoke White',black:'Smoke Black',pgn_zstd:compressed,pgn_sha256:createHash('sha256').update(pgn).digest('hex'),
 sources:[{source:{id:sourceId,source_key:'source:'+sourceId,title:sourceId===3?'Other source':'Smoke section '+sourceId},source_game_key:'game',sequence:sourceId}]});
for(let index=0;index<42;index++)upsertGame(db,{white:'Page White',black:'Page Black',pgn_zstd:compressed,pgn_sha256:createHash('sha256').update(pgn).digest('hex'),sources:[{source:{source_key:'source:3',title:'Other source'},source_game_key:'page-'+index,sequence:10+index}]});
upsertGame(db,{id:1,annotator:'Test Analyst',year:1972,event:'Test Match',eco:'C20',result:'1-0'});
db.close();
const compatibilityPath=join(temporary,'compatibility.sqlite3');copyFileSync(path,compatibilityPath);
const compatibility=new Database(compatibilityPath);
for(const version of [3,4,5,6,99]) {compatibility.pragma('user_version='+version);assert.throws(()=>new ChessArchive(compatibilityPath),/supports database schema/);}
compatibility.close();
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
    const openingFacets = await window.chessArchive.openingFacets({});
    if (!openingFacets.supported || openingFacets.revision) throw new Error('Fresh v7 has an empty opening catalogue');
    const games = await window.chessArchive.searchGames({ search: 'Smoke White' });
    const game = await window.chessArchive.getGame(games.rows[0].id);
    const deadline = Date.now() + 5000;
    while (!document.querySelector('.result-item') && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    if (document.querySelector('cg-board, .sidebar, .book-open, .details-panel')) throw new Error('Browser must show only the game list');
    if (document.querySelectorAll('.result-item').length !== 40) throw new Error('Expected paginated games');
    document.querySelector('.result-item').click();
    while (!document.querySelector('.review-shell cg-board') && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    document.querySelector('[aria-label="Next move"]').click();
    await new Promise(resolve => setTimeout(resolve, 50));
    return {
      games: catalog.totals.games, total: games.total, pgn: game.pgn,
      board: !!document.querySelector('cg-board'),
      move: document.querySelector('.review-move[aria-current="step"]')?.textContent,
      errors: [...document.querySelectorAll('.notice.error')].map(el => el.textContent),
    };
  })()`);
  assert.equal(state.games, 45);
  assert.equal(state.total, 3);
  assert.equal(state.pgn, pgn);
  assert.equal(state.board, true);
  assert.match(state.move, /e4/);
  assert.deepEqual(state.errors, []);

  const windowCount = BrowserWindow.getAllWindows().length;
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
    const comments = [...root.querySelectorAll('.review-comment')].map(p => p.textContent.trim());
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
    if (root.querySelector('.review-controls [aria-label="Flip board"]')) throw new Error('Flip board must be in settings');
    root.querySelector('[aria-label="Game review settings"]').click();
    await waitFor(() => root.querySelector('dialog[open]'));
    root.querySelector('[aria-label="Flip board"]').click();
    [...root.querySelectorAll('dialog button')].find(button => button.textContent === 'Done').click();
    await waitFor(() => !root.querySelector('dialog'));
    const flipped = !!root.querySelector('.orientation-black');
    const original = root.querySelector('.review-original pre').textContent;
    const pair = [...root.querySelectorAll('.review-move-pair')].find(p => p.textContent.includes('d4'));
    const pairMoves = [...pair.querySelectorAll('.review-move')].map(button => button.getBoundingClientRect());
    const evaluations = [...root.querySelectorAll('.review-evaluation')].map(e => e.textContent.trim());
    if (Math.abs(pairMoves[0].top - pairMoves[1].top) > 1) throw new Error('White and Black moves must share a line');
    if (root.textContent.includes('Moves & commentary')) throw new Error('Score heading must be removed');
    const main = root.querySelector('.review-mainline-row .review-move');
    const side = root.querySelector('.review-variation-line .review-move');
    if (parseFloat(getComputedStyle(main).fontSize) <= parseFloat(getComputedStyle(side).fontSize)) throw new Error('Mainline must be larger than variations');
    if (root.querySelectorAll('.review-variation-line .review-variation-line').length !== 1) throw new Error('Nested variation grouping lost');
    const e4 = [...root.querySelectorAll('.review-mainline-row .review-move')].find(move => move.textContent.includes('e4')).getBoundingClientRect();
    const e5 = [...root.querySelectorAll('.review-mainline-row .review-move')].find(move => move.textContent.includes('e5')).getBoundingClientRect();
    if (e5.left <= e4.left + 20 || Math.abs(e4.width - e5.width) > 1) throw new Error('Mainline must have equal White and Black columns');

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
  assert.ok(reviewState.width > 500, 'Review board must use the available screen');
  assert.equal(reviewState.flipped, true);
  assert.equal(reviewState.original, pgn);
  if (process.env.CHESS_REVIEW_SCREENSHOT) {
    await window.webContents.executeJavaScript("document.querySelector('.review-transcript').scrollTop = 0");
    writeFileSync(process.env.CHESS_REVIEW_SCREENSHOT, (await window.webContents.capturePage()).toPNG());
  }
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
  await window.webContents.executeJavaScript('new Promise(resolve => setTimeout(resolve, 120))');
  const resizeStart = await window.webContents.executeJavaScript(`(() => {
    const handle = document.querySelector('[aria-label="Resize board"]').getBoundingClientRect();
    return { x: Math.round(handle.left + handle.width / 2), y: Math.round(handle.top + handle.height / 2), width: document.querySelector('.review-board cg-board').getBoundingClientRect().width };
  })()`);
  window.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, x: resizeStart.x, y: resizeStart.y });
  window.webContents.sendInputEvent({ type: 'mouseMove', button: 'left', modifiers: ['leftButtonDown'], x: resizeStart.x - 120, y: resizeStart.y - 120 });
  window.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, x: resizeStart.x - 120, y: resizeStart.y - 120 });
  const resized = await window.webContents.executeJavaScript(`(async () => {
    await new Promise(resolve => setTimeout(resolve, 100));
    const board = document.querySelector('.review-board cg-board').getBoundingClientRect();
    return { width: board.width, height: board.height, column: document.querySelector('.review-board').getBoundingClientRect().width, saved: Number(localStorage.getItem('review-board-size-v1')) };
  })()`);
  assert.ok(resized.width < resizeStart.width - 80, 'Dragging the corner shrinks the board: ' + JSON.stringify({ resizeStart, resized }));
  assert.ok(Math.abs(resized.width - resized.height) < 1, 'Resizing keeps a square board');
  assert.ok(Math.abs(resized.saved - resized.column) < 1, 'Board size is saved locally');
  window.setSize(920, 650);
  await window.webContents.executeJavaScript(`(async () => {
    await new Promise(resolve => setTimeout(resolve, 100));
    const controls = document.querySelector('.review-controls').getBoundingClientRect();
    const score = document.querySelector('.review-score').getBoundingClientRect();
    if (controls.bottom > innerHeight || score.right > innerWidth) throw new Error('Resized board must fit smaller windows');
  })()`);
  window.setSize(1510, 920);
  await window.webContents.executeJavaScript(`(async () => {
    await new Promise(resolve => setTimeout(resolve, 100));
    const size = document.querySelector('.review-board').getBoundingClientRect().width;
    if (Math.abs(size - Number(localStorage.getItem('review-board-size-v1'))) > 1) throw new Error('Window growth must restore preferred size');
    const handle = document.querySelector('[aria-label="Resize board"]');
    handle.focus();
    handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }));
    if (document.querySelector('.review-move[aria-current="step"]')) throw new Error('Resize keys must not navigate the game');
    if (Number(localStorage.getItem('review-board-size-v1')) >= size) throw new Error('Resize handle must support keyboard input');
    handle.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    if (localStorage.getItem('review-board-size-v1') !== null) throw new Error('Double click must reset preferred size');
    document.querySelector('.review-shell .lpv').focus();
  })()`);
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
    return !document.querySelector('.review-shell') && document.activeElement?.classList.contains('result-item');
  })()`);
  assert.equal(returned, true, 'Escape must restore the existing library');
  assert.equal(window.isDestroyed(), false);

  const grouping = await window.webContents.executeJavaScript(`(async () => {
    const waitFor = async predicate => {
      const deadline = Date.now() + 5000;
      while (!predicate()) {
        if (Date.now() > deadline) throw new Error('Game browser did not update: ' + predicate);
        await new Promise(resolve => setTimeout(resolve, 25));
      }
    };
    const change = (element, value) => {
      const prototype = element.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value);
      element.dispatchEvent(new Event(element.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
    };
    const property = label => [...document.querySelectorAll('.property-filter')].find(el=>el.querySelector(':scope > span')?.textContent===label);
    const choose = async (label, text) => {
      const root=property(label);root.querySelector('.property-trigger').click();
      await waitFor(()=>root.querySelector('[role=option]')&&!root.querySelector('[role=status]'));
      const option=[...root.querySelectorAll('[role=option]')].find(el=>el.querySelector('span')?.textContent.replace('✓ ','')===text);
      if(!option)throw new Error('Missing option '+text);option.click();
      root.querySelector('[role=combobox]').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
    };
    await choose('Source','Smoke section 1');
    await waitFor(()=>document.querySelectorAll('.result-item').length===1);
    await choose('Source','Smoke section 2');
    await waitFor(()=>document.querySelectorAll('.result-item').length===2);
    await choose('Source type','other');
    await waitFor(()=>document.querySelectorAll('.result-item').length===2);
    const source=property('Source');source.querySelector('.property-trigger').click();
    await waitFor(()=>source.querySelector('[role=combobox]'));
    source.querySelector('[role=combobox]').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true}));
    if(!source.querySelector('[role=combobox]').getAttribute('aria-activedescendant'))throw new Error('Missing keyboard active option');
    source.querySelector('[role=combobox]').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
    document.querySelector('.result-item').click();await waitFor(()=>document.querySelector('.review-shell'));
    document.querySelector('.review-header button').click();await waitFor(()=>!document.querySelector('.review-shell'));
    if(property('Source').querySelectorAll('.property-chips button').length!==2)throw new Error('Selections lost');
    const year=[...document.querySelectorAll('label.field')].find(el=>el.querySelector('span')?.textContent==='Year from').querySelector('input');
    change(year,'2000');await waitFor(()=>document.querySelector('.empty-results h3')?.textContent==='No games found');
    if(property('Source').querySelectorAll('.property-chips button').length!==2)throw new Error('Zero result lost selected options');
    document.querySelector('.empty-results button').click();await waitFor(()=>document.querySelectorAll('.result-item').length===40);
    document.querySelector('[aria-label="Next page"]').click();await waitFor(()=>document.querySelectorAll('.result-item').length===5);
    const originalText = document.querySelector('.results-list').textContent;
    window.scrollTo(0, document.body.scrollHeight);
    const scrollY = window.scrollY;
    document.querySelector('.result-item').click();
    await waitFor(() => document.querySelector('.review-shell cg-board'));
    document.querySelector('.review-header button').click();
    await waitFor(() => !document.querySelector('.review-shell') && document.activeElement?.classList.contains('result-item'));
    if (document.querySelector('.results-list').textContent !== originalText) throw new Error('Return changed the page');
    if (Math.abs(window.scrollY - scrollY) > 1) throw new Error('Return lost list scroll');
    if (document.querySelector('[aria-label="Previous page"]').disabled) throw new Error('Page was reset');
    return true;
  })()`);
  assert.equal(grouping,true);

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
    console.log('Desktop smoke passed: library, property multiselects, same-window review and keyboard shortcuts, all commentary, colored arrows, variations, navigation, and archive preservation.');
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
