import { desktopTestDirectory, finishDesktopTest } from './fixtures/desktop-test.mjs';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { app } from 'electron';
import { fixtureArchive } from './fixtures/opening-archive.mjs';
const temporary = desktopTestDirectory();
app.setPath('userData', temporary);
const path = join(temporary, 'archive.sqlite3');
const db = fixtureArchive(path, ['1.e4 {Book note [%crit opening] [%cal Ge2e4] [%csl Yd4]} (1.d4 {Variation [%crit middlegame] [%cal Rd2d4]} d5) e5 2.Nf3 Nc6 {[%crit endgame]} *', '[SetUp "1"]\n[FEN "7k/P7/8/8/8/8/8/7K w - - 0 25"]\n\n25.a8=Q+ *']); db.close();
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
      const button = text => [...document.querySelectorAll('button')].find(b => b.textContent === text || b.getAttribute('aria-label') === text);
      window.smokeWait = wait; window.smokeButton = button;
      window.smokeSetting = async (label, value) => {
        button('Game review settings').click(); await wait(() => document.querySelector('dialog[open]'));
        const select = document.querySelector('dialog select[aria-label="' + label + '"]');
        if (select) {
          Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, String(value));
          select.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
          const input = [...document.querySelectorAll('dialog label')].find(el => el.textContent.trim() === label)?.querySelector('input');
          if (!input) throw new Error('Missing setting: ' + label);
          if (input.checked !== value) input.click();
        }
        button('Done').click(); await wait(() => !document.querySelector('dialog'));
      };

      await wait(() => document.querySelector('.result-item'));
      document.querySelector('.result-item').click(); await wait(() => document.querySelector('.review-shell cg-board'));
      const markers = [...document.querySelectorAll('.review-critical')];
      if (markers.map(el => el.title).join('|') !== 'Critical opening position|Critical middlegame position|Critical endgame position') throw new Error('Missing critical markers or tooltips');
      if (new Set(markers.map(el => getComputedStyle(el).color)).size !== 3) throw new Error('Critical phases need distinct colors');
      if ([...document.querySelectorAll('.review-comment')].some(el => el.textContent.includes('Critical position'))) throw new Error('Critical prose duplicated marker');
      if (!button('Previous study stop').disabled) throw new Error('Previous critical enabled at start');
      await wait(() => !button('Next study stop').disabled);
      for (const phase of ['opening', 'middlegame', 'endgame']) {
        button('Next study stop').click();
        await wait(() => document.querySelector('.review-move[aria-current="step"] .review-critical-' + phase));
      }
      if (!button('Next study stop').disabled) throw new Error('Next critical enabled at end');
      button('Previous study stop').click();
      await wait(() => document.querySelector('.review-move[aria-current="step"] .review-critical-middlegame'));
      const criticalPath = document.querySelector('.review-move[aria-current="step"]').dataset.reviewPath;
      button('Piece mode').click(); await wait(() => document.querySelector('.piece-mode[open]'));
      if (document.querySelector('.piece-mode .review-critical')) throw new Error('Critical markers leaked into Piece mode');
      button('Return to review').click(); await wait(() => !document.querySelector('.piece-mode'));
      if (document.querySelector('.review-move[aria-current="step"]').dataset.reviewPath !== criticalPath) throw new Error('Piece mode lost critical position');
      button('First position').click(); await wait(() => !document.querySelector('.review-move[aria-current="step"]'));
      if (button('Stockfish').getAttribute('aria-pressed') !== 'false' || button('Maia').getAttribute('aria-pressed') !== 'false') throw new Error('Engines must default off');
      if (document.querySelectorAll('.review-analysis > .analysis-toggles button').length !== 6) throw new Error('Settings, engine toggles and personal comment controls should appear');
      button('Stockfish').click(); await wait(() => document.querySelectorAll('.engine-line').length === 3);
      await wait(() => document.querySelector('svg.cg-shapes line[stroke="#27854c"]'));
      await window.smokeSetting('Evaluation bar', true); await wait(() => document.querySelector('.evaluation-bar'));
      await window.smokeSetting('Stockfish lines', false); await wait(() => !document.querySelector('.engine-line'));
      if (button('Stockfish').getAttribute('aria-pressed') !== 'true') throw new Error('Hiding lines disabled Stockfish');
      button('Stockfish').click(); await wait(() => !document.querySelector('.evaluation-bar'));
      button('Stockfish').click(); await wait(() => document.querySelector('.stockfish-analysis .engine-status')?.textContent.includes('complete'));
      if (document.querySelector('.engine-line') || !document.querySelector('.evaluation-bar')) throw new Error('Stockfish toggle forgot preferences');

      await window.smokeSetting('Stockfish lines', true); await wait(() => document.querySelector('.engine-line'));
      button('Maia').click(); await wait(() => document.querySelector('.maia-candidates')?.textContent.includes('38.0%'));
      await wait(() => document.querySelector('svg.cg-shapes line[stroke="#9155c2"]'));
      await window.smokeSetting('Stockfish arrows', false); await wait(() => !document.querySelector('svg.cg-shapes line[stroke="#27854c"]'));
      if (!document.querySelector('svg.cg-shapes line[stroke="#9155c2"]')) throw new Error('Maia arrows must remain independent');
      await window.smokeSetting('Stockfish arrows', true);
      await window.smokeSetting('Maia rating', 1800);
      await wait(() => document.querySelector('.maia-candidates')?.textContent.includes('42.0%'));
      await window.smokeSetting('Stockfish line count', 1);
      await window.smokeSetting('Maia line count', 1);
      await wait(() => document.querySelectorAll('.engine-line').length === 1 && document.querySelectorAll('.maia-candidates button').length === 1);
      await window.smokeSetting('Maia lines', false);
      await wait(() => !document.querySelector('.maia-candidates button'));
      if (!document.querySelector('svg.cg-shapes line[stroke="#9155c2"]')) throw new Error('Hiding Maia lines hid its arrows');
      button('Maia').click(); await wait(() => !document.querySelector('.maia-analysis'));
      button('Maia').click(); await wait(() => document.querySelector('.maia-analysis .engine-status')?.textContent.includes('complete'));
      if (document.querySelector('.maia-candidates button')) throw new Error('Maia toggle forgot line visibility');
      await window.smokeSetting('Maia lines', true);
      await window.smokeSetting('Stockfish line count', 3);
      await window.smokeSetting('Maia line count', 3);
      await wait(() => document.querySelectorAll('.engine-line').length === 3 && document.querySelectorAll('.maia-candidates button').length === 3);
      document.querySelector('.engine-line button').click(); await wait(() => document.querySelector('.review-move[aria-current="step"]')?.textContent.includes('e4'));
      if (document.querySelector('.personal-move')) throw new Error('Existing book move created a personal branch');
      button('First position').click(); await wait(() => !document.querySelector('.review-move[aria-current="step"]'));
      button('Stockfish').click(); button('Maia').click();
      document.querySelector('[aria-label="Next move"]').click(); await wait(() => document.querySelector('svg.cg-shapes circle'));
      await window.smokeSetting('Game annotations', false); await wait(() => !document.querySelector('svg.cg-shapes circle'));
      await window.smokeSetting('Game annotations', true); await wait(() => document.querySelector('svg.cg-shapes circle'));
      button('Game review settings').click(); await wait(() => document.querySelector('dialog[open]'));
      if (document.querySelector('dialog input:not([type="checkbox"])')) throw new Error('Settings must not expose technical engine configuration');
      button('Done').focus();
    })()`);
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    await window.webContents.executeJavaScript(`(async () => { await window.smokeWait(() => !document.querySelector('dialog')); if (!document.querySelector('.review-shell')) throw new Error('Setup Escape closed review'); })()`);
    await window.webContents.executeJavaScript(`(async () => {
      const wait = window.smokeWait, button = window.smokeButton;
      document.querySelector('[aria-label="First position"]').click();
      button('Stockfish').click(); button('Maia').click();
      await wait(() => document.querySelector('.engine-line button'));
      document.querySelector('.engine-line button').click(); await wait(() => document.querySelector('.review-move[aria-current="step"]')?.textContent.includes('e4'));
      button('Game review settings').click(); await wait(() => document.querySelector('dialog[open]'));
      document.querySelector('[aria-label="Flip board"]').click(); button('Done').click(); await wait(() => !document.querySelector('dialog'));
      document.querySelector('.review-original').open = true;
      document.querySelector('.review-transcript').scrollTop = 25;
      window.beforePiece = { pgn: document.querySelector('.review-original pre').textContent, path: document.querySelector('[aria-current="step"]')?.dataset.reviewPath || '', scroll: document.querySelector('.review-transcript').scrollTop };
      button('Piece mode').focus(); button('Piece mode').click(); await wait(() => document.querySelector('.piece-mode[open] cg-board'));
      if (document.querySelector('.piece-mode').querySelector('svg, .evaluation-bar, .review-comment, .review-move, square.last-move, square.check')) throw new Error('Piece mode leaked annotations');
      if (!document.querySelector('.piece-mode .orientation-black')) throw new Error('Piece mode lost orientation');
      if (document.querySelectorAll('.piece-mode button').length !== 2) throw new Error('Piece mode must have only two minimal controls');
      window.pieceStart = document.querySelector('.piece-board').dataset.fen;
      await wait(() => document.querySelector('.stockfish-analysis .engine-status').textContent.includes('paused'));
    })()`);
    const clickSquare = async square => {
      const point = await window.webContents.executeJavaScript(`(() => {
        const rect = document.querySelector('.piece-mode cg-board').getBoundingClientRect();
        const file = '${square}'.charCodeAt(0) - 97, rank = Number('${square}'[1]) - 1;
        const black = !!document.querySelector('.piece-mode .orientation-black');
        return { x: Math.round(rect.left + ((black ? 7 - file : file) + .5) * rect.width / 8), y: Math.round(rect.top + ((black ? rank : 7 - rank) + .5) * rect.height / 8) };
      })()`);
      window.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point });
      window.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point });
      await new Promise(resolve => setTimeout(resolve, 80));
    };
    await clickSquare('e4'); await clickSquare('e6'); // Illegal in normal chess, permitted here.
    await window.webContents.executeJavaScript(`(async () => {
      const wait = window.smokeWait, button = window.smokeButton;
      await wait(() => document.querySelector('.piece-board').dataset.fen !== window.pieceStart);
      button('Reset position').click(); await wait(() => document.querySelector('.piece-board').dataset.fen === window.pieceStart);
      button('Return to review').click(); await wait(() => !document.querySelector('.piece-mode'));
      if ((document.querySelector('[aria-current="step"]')?.dataset.reviewPath || '') !== window.beforePiece.path || document.querySelector('.review-original pre').textContent !== window.beforePiece.pgn) throw new Error('Return lost review state');
      if (!document.querySelector('.review-board .orientation-black')) throw new Error('Return lost orientation');
      if (button('Stockfish').getAttribute('aria-pressed') !== 'true' || button('Maia').getAttribute('aria-pressed') !== 'true') throw new Error('Return changed enable states');
      await wait(() => document.querySelector('.stockfish-analysis .engine-status').textContent.includes('complete'));
      await new Promise(r => requestAnimationFrame(r));
      if (document.querySelector('.review-transcript').scrollTop !== window.beforePiece.scroll) throw new Error('Return lost scroll');
      button('Piece mode').focus(); button('Piece mode').click(); await wait(() => document.querySelector('.piece-mode[open]'));
    })()`);
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    await window.webContents.executeJavaScript(`(async () => {
      await window.smokeWait(() => !document.querySelector('.piece-mode'));
      if (!document.querySelector('.review-shell')) throw new Error('Piece mode Escape closed review');
      await window.smokeWait(() => document.activeElement?.textContent === 'Piece mode');
      window.smokeButton('First position').click();
      await window.smokeWait(() => !document.querySelector('.review-move[aria-current="step"]'));
    })()`);
    await window.webContents.executeJavaScript(`(async () => {
      const wait = window.smokeWait, button = window.smokeButton;
      if (button('Stockfish').getAttribute('aria-pressed') === 'true') button('Stockfish').click();
      if (button('Maia').getAttribute('aria-pressed') === 'true') button('Maia').click();
      const variation = [...document.querySelectorAll('.review-move')].find(b => b.textContent.includes('d4'));
      variation.click(); await wait(() => document.querySelector('.review-move[aria-current="step"]')?.textContent.includes('d4'));
      window.variationPath = document.querySelector('.review-move[aria-current="step"]').dataset.reviewPath;
      button('Piece mode').click(); await wait(() => document.querySelector('.piece-mode[open]'));
      button('Return to review').click(); await wait(() => !document.querySelector('.piece-mode'));
      if (document.querySelector('.review-move[aria-current="step"]').dataset.reviewPath !== window.variationPath) throw new Error('Piece mode lost variation');
      const settings = await window.chessEngine.settings();
      await window.chessEngine.configure({ ...settings, stockfishPath: '/missing/chess-engine' });
      button('Stockfish').click(); await wait(() => document.querySelector('.stockfish-analysis .engine-error'));
      if (!document.querySelector('.review-comment')) throw new Error('Missing engine blocked book review');
      button('Stockfish').click(); await window.chessEngine.configure(settings);
      document.querySelector('.review-header > button').click(); await wait(() => !document.querySelector('.review-shell'));
      document.querySelectorAll('.result-item')[1].click(); await wait(() => document.querySelector('.review-shell cg-board'));
      if (document.querySelector('.review-critical-navigation')) throw new Error('Critical navigation shown in unmarked game');
      if (button('Stockfish').getAttribute('aria-pressed') !== 'false') throw new Error('Enable state should default off for a new review');
      button('Game review settings').click(); await wait(() => document.querySelector('dialog[open]'));
      if (document.querySelector('[aria-label="Stockfish line count"]').value !== '3' || document.querySelector('[aria-label="Maia line count"]').value !== '3' || document.querySelector('[aria-label="Maia rating"]').value !== '1800') throw new Error('Settings did not persist across reviews');
      button('Done').click(); await wait(() => !document.querySelector('dialog'));

      button('Piece mode').click(); await wait(() => document.querySelector('.piece-board'));
      if (document.querySelector('.piece-board').dataset.fen !== '7k/P7/8/8/8/8/8/7K') throw new Error('Custom starting FEN lost');
      button('Reset position').click(); button('Return to review').click(); await wait(() => !document.querySelector('.piece-mode'));
      if (!document.querySelector('.review-original pre').textContent.includes('25.a8=Q+')) throw new Error('Custom PGN changed');
    })()`);
    assert.equal(hash(), original);
    assert.deepEqual(errors, []);
    console.log('Engine desktop smoke passed: critical markers/navigation/variation study, local subprocess IPC, independent controls, probabilities/rating, arrows, line exploration, setup, free Piece mode/reset/exact restoration/Escape, and archive preservation.');
  } catch (error) { console.error(error); code = 1; }
  finally { clearTimeout(timeout); finishDesktopTest(app, code); }
}
void smoke();
