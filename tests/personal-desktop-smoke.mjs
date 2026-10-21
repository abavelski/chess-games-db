import { desktopTestDirectory, finishDesktopTest } from './fixtures/desktop-test.mjs';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import { fixtureArchive } from './fixtures/opening-archive.mjs';

const temporary = desktopTestDirectory(); app.setPath('userData', temporary);
const path = join(temporary, 'games.db');
const db = fixtureArchive(path, ['1.e4 {Book note [%crit opening]} (1.d4 d5) e5 2.Nf3 *', '[SetUp "1"]\n[FEN "7k/P7/8/8/8/8/8/7K w - - 0 25"]\n\n25.a8=Q+ *']); db.close();
writeFileSync(join(temporary, 'archive.json'), JSON.stringify({ path }));
const errors = [];
app.on('browser-window-created', (_event, window) => {
  window.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message); });
  window.webContents.on('preload-error', (_event, _path, error) => errors.push(error.message));
});
async function smoke() {
  let code = 0;
  const timeout = setTimeout(() => { console.error('Personal desktop timeout'); app.exit(1); }, 45000);
  try {
    const created = once(app, 'browser-window-created'); await import('../electron/main.mjs'); const [, window] = await created;
    await once(window.webContents, 'did-finish-load');
    const run = script => window.webContents.executeJavaScript(`(async () => { ${script} })()`);
    await run(`
      window.wait = async predicate => { const end = Date.now() + 7000; while (!predicate()) { if (Date.now() > end) throw new Error('Timed out: ' + predicate); await new Promise(r => setTimeout(r, 20)); } };
      window.button = text => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === text || b.getAttribute('aria-label') === text);
      window.current = () => document.querySelector('.review-move[aria-current="step"]');
      window.rememberBoard = () => {
        window.boardBeforeMove = document.querySelector('.review-board cg-board');
        window.kingsBeforeMove = [...boardBeforeMove.querySelectorAll('piece.king')];
      };
      window.checkBoard = () => {
        if (document.querySelector('.review-board cg-board') !== boardBeforeMove) throw new Error('Personal move remounted the board');
        for (const king of kingsBeforeMove) {
          if (!king.isConnected || king.parentElement !== boardBeforeMove || king.classList.contains('anim')) throw new Error('Personal move recreated or animated an unmoved king');
        }
      };
      window.checkInlineComment = () => {
        const move = current(), comment = move.parentElement.querySelector('.personal-comment');
        if (!comment || comment.textContent.includes('My comment:')) throw new Error('Unexpected personal comment label');
        const moveRect = move.getBoundingClientRect(), commentRect = comment.getClientRects()[0];
        if (commentRect.left < moveRect.right || commentRect.top > moveRect.bottom || commentRect.bottom < moveRect.top) throw new Error('Personal comment must start beside its move');
      };
      window.comment = async text => {
        if (!document.querySelector('.personal-comment-editor textarea')) {
          button('Add comment').click();
          await wait(() => document.querySelector('.personal-comment-editor textarea'));
        }
        const textarea = document.querySelector('.personal-comment-editor textarea');
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(textarea, text);
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
      };
      await wait(() => document.querySelector('.result-item')); document.querySelector('.result-item').click();
      await wait(() => document.querySelector('.review-board cg-board') && button('Add comment') && !button('Add comment').disabled);
      if (document.querySelector('textarea')) throw new Error('Editor should start hidden');
      if (!button('Save my comments').disabled || !button('Delete my lines and comments').disabled) throw new Error('Empty game actions should be disabled');
      for (const label of ['Add comment', 'Save my comments', 'Delete my lines and comments']) {
        const action = button(label);
        if (!action.closest('.analysis-toggles') || !action.title || action.textContent.trim() || !action.querySelector('svg')) throw new Error('Comment actions should be toolbar icons with hover descriptions');
      }
      if (document.querySelector('.personal-tools') || document.querySelector('.personal-comment-editor')) throw new Error('Removed comment labels still visible');
      button('Add comment').click(); await wait(() => document.querySelector('textarea'));
      button('Add comment').click(); await wait(() => !document.querySelector('textarea'));
    `);
    const click = async square => {
      const point = await run(`
        const rect = document.querySelector('.review-board cg-board').getBoundingClientRect();
        const square = ${JSON.stringify(square)}, file = square.charCodeAt(0) - 97, rank = Number(square[1]) - 1;
        const black = !!document.querySelector('.review-board .orientation-black');
        return { x: Math.round(rect.left + ((black ? 7-file : file) + .5)*rect.width/8), y: Math.round(rect.top + ((black ? rank : 7-rank) + .5)*rect.height/8) };
      `);
      window.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point });
      window.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point });
      await new Promise(resolve => setTimeout(resolve, 90));
    };
    await click('e2'); await click('e4');
    await run(`await wait(() => current()?.textContent.includes('e4')); if (document.querySelector('.personal-move')) throw new Error('Book move duplicated'); await comment('Inline note'); await wait(() => document.querySelector('.personal-comment')); checkInlineComment(); await comment(''); await wait(() => !document.querySelector('.personal-comment')); button('First position').click();`);
    await click('d2'); await click('d4');
    await run(`await wait(() => current()?.textContent.includes('d4')); if (document.querySelector('.personal-move')) throw new Error('Book variation duplicated'); button('First position').click();`);
    await run('rememberBoard();');
    await click('c2'); await click('c4');
    await run(`await wait(() => current()?.classList.contains('personal-move')); checkBoard(); if (!current().textContent.includes('c4')) throw new Error('Wrong branch selected'); window.ownPath = current().dataset.reviewPath; await comment('My own branch note'); await wait(() => document.querySelector('.personal-comment')?.textContent.includes('My own branch note')); checkInlineComment();`);
    await run('rememberBoard();');
    await click('e7'); await click('e5');
    await run(`await wait(() => current()?.textContent.includes('e5')); checkBoard(); button('First position').click(); await wait(() => !current()); await comment('My starting note'); await wait(() => document.querySelector('.personal-comment')?.textContent.includes('My starting note')); document.querySelector('[data-review-path="' + ownPath + '"]').click(); await wait(() => current()?.dataset.reviewPath === ownPath); if (document.querySelector('textarea').value !== 'My own branch note') throw new Error('Comment lost on navigation');`);
    await run(`button('Game review settings').click(); await wait(() => document.querySelector('dialog[open]')); button('Flip board').click(); button('Done').click(); await wait(() => document.querySelector('.review-board .orientation-black')); rememberBoard();`);
    await click('c7'); await click('c5');
    await run(`
      await wait(() => current()?.textContent.includes('c5')); checkBoard();
      if (!document.querySelector('.review-board .orientation-black')) throw new Error('Personal move reset orientation');
      if (document.querySelectorAll('.personal-move').length !== 3) throw new Error('Branch was lost');
      button('Save my comments').click(); await wait(() => button('Save my comments')?.disabled && button('Save my comments').getAttribute('aria-busy') === 'false');
      const game = (await window.chessArchive.searchGames({personalOnly:true})).rows[0]; window.gameId = game.id;
      const detail = await window.chessArchive.getGame(game.id);
      if (detail.personal.lines.length !== 2 || detail.personal.comments.length !== 2) throw new Error('Analysis not saved');
      if (detail.pgn.includes('c4') || !detail.pgn.includes('Book note')) throw new Error('Book PGN changed');
      button('Back to games').click(); await wait(() => !document.querySelector('.review-shell'));
      document.querySelector('.personal-filter input').click(); await wait(() => document.querySelectorAll('.result-item').length === 1);
      document.querySelector('.result-item').click(); await wait(() => document.querySelectorAll('.personal-move').length === 3);
      button('Game review settings').click(); await wait(() => document.querySelector('dialog[open]'));
      button('Study stops').click(); button('Done').click();
      await wait(() => !document.querySelector('.review-original'));
      button('Add comment').click(); await wait(() => document.querySelector('textarea'));
      if (document.querySelectorAll('.personal-move').length !== 3) throw new Error('Study hid personal branches');
      document.querySelector('.personal-move').click(); await wait(() => current()?.classList.contains('personal-move'));
      button('First position').click(); await wait(() => !current() && document.querySelector('textarea').value === 'My starting note'); await comment('Edited after reopening');
      button('Back to games').click(); await wait(() => document.querySelector('.unsaved-changes-dialog[open]'));
      if ((await window.chessArchive.getGame(gameId)).personal.comments.find(c => !c.moves.length).text !== 'My starting note') throw new Error('Leaving review saved without permission');
      button('Cancel').click(); await wait(() => !document.querySelector('.unsaved-changes-dialog'));
      if (document.querySelector('textarea').value !== 'Edited after reopening') throw new Error('Cancel lost edits');
      button('Back to games').click(); await wait(() => document.querySelector('.unsaved-changes-dialog[open]'));
      button('Discard').click(); await wait(() => !document.querySelector('.review-shell'));
      if ((await window.chessArchive.getGame(gameId)).personal.comments.find(c => !c.moves.length).text !== 'My starting note') throw new Error('Discard overwrote saved comments');
      document.querySelector('.result-item').click(); await wait(() => button('Add comment') && !button('Add comment').disabled); button('Add comment').click(); await wait(() => document.querySelector('textarea')?.value === 'My starting note');
      await comment('Explicitly saved on leaving'); await wait(() => !button('Save my comments').disabled);
      button('Back to games').click(); await wait(() => document.querySelector('.unsaved-changes-dialog[open]'));
      button('Save').click(); await wait(() => !document.querySelector('.review-shell'));
      if ((await window.chessArchive.getGame(gameId)).personal.comments.find(c => !c.moves.length).text !== 'Explicitly saved on leaving') throw new Error('Dialog Save did not save');
      document.querySelector('.result-item').click(); await wait(() => button('Delete my lines and comments') && !button('Delete my lines and comments').disabled);
      if (document.querySelector('textarea')) throw new Error('Reopened editor should be hidden');
      button('Delete my lines and comments').click(); await wait(() => button('Delete my lines and comments').disabled && button('Save my comments').getAttribute('aria-busy') === 'false');
      if (document.querySelector('.personal-comment, .personal-move')) throw new Error('Deleted analysis remains in review');
      const deleted = await window.chessArchive.getGame(gameId);
      if (deleted.personal.comments.length || deleted.personal.lines.length || !deleted.pgn.includes('Book note')) throw new Error('Delete must remove saved lines and comments and preserve book annotations');
      if (!button('Save my comments').disabled) throw new Error('Delete left analysis dirty');
      if ((await window.chessArchive.searchGames({ personalOnly: true })).total) throw new Error('Deleted game still matches personal analysis filter');
      button('Back to games').click(); await wait(() => !document.querySelector('.review-shell'));
      document.querySelector('.personal-filter input').click(); await wait(() => document.querySelectorAll('.result-item').length === 2);
      document.querySelectorAll('.result-item')[1].click(); await wait(() => document.querySelector('.review-board cg-board') && button('Add comment') && !button('Add comment').disabled);
    `);
    await click('a7'); await click('a8');
    await run(`
      await wait(() => button('knight')); button('knight').click(); await wait(() => current()?.textContent.includes('a8=N'));
      if (!current().classList.contains('personal-move')) throw new Error('Underpromotion not personal');
      if (button('Delete my lines and comments').disabled) throw new Error('Delete must be enabled for lines without comments');
      button('Delete my lines and comments').click();
      await wait(() => button('Delete my lines and comments').disabled && button('Save my comments').getAttribute('aria-busy') === 'false');
      if (!button('Save my comments').disabled || document.querySelector('.personal-move') || current()) throw new Error('Delete did not clear unsaved line and return to a book position');
      const games = (await window.chessArchive.searchGames({pageSize:100})).rows;
      const detail = await window.chessArchive.getGame(games[1].id);
      if (detail.personal.lines.length || detail.personal.comments.length) throw new Error('Delete left personal analysis in database');
    `);
    await click('a7'); await click('a8');
    await run(`await wait(() => button('knight')); button('knight').click(); await wait(() => current()?.textContent.includes('a8=N')); button('First position').click();`);
    await click('a7'); await click('a8');
    await run(`await wait(() => button('queen')); button('queen').click(); await wait(() => current()?.textContent.includes('a8=Q')); if (current().classList.contains('personal-move')) throw new Error('Book promotion duplicated'); if (document.querySelectorAll('.personal-move').length !== 1) throw new Error('Underpromotion lost');`);
    await run(`button('Back to games').click(); await wait(() => document.querySelector('.unsaved-changes-dialog[open]'));`);
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    await run(`await wait(() => !document.querySelector('.unsaved-changes-dialog')); if (!document.querySelector('.personal-move')) throw new Error('Dialog Escape lost unsaved line'); document.querySelector('.review-header > button').focus();`);
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    await run(`
      await wait(() => document.querySelector('.unsaved-changes-dialog[open]')); button('Discard').click();
      await wait(() => !document.querySelector('.review-shell'));
      const games = (await window.chessArchive.searchGames({pageSize:100})).rows;
      const detail = await window.chessArchive.getGame(games[1].id);
      if (detail.personal.lines.length || detail.personal.comments.length) throw new Error('Discard saved an unsaved line');
    `);
    assert.deepEqual(errors, []);
    console.log('Personal review desktop passed: board moves, reuse, branches, comments, save/reopen/filter, explicit save/discard/cancel on exit, and underpromotion.');
  } catch (error) { console.error(error); code = 1; }
  finally { clearTimeout(timeout); finishDesktopTest(app, code); }
}
void smoke();
