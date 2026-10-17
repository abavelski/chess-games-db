import { upsertGame } from '../lib/game-writer.mjs';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { app, BrowserWindow, dialog } from 'electron';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fixtureArchive, catalogueFiles, hash } from './fixtures/opening-archive.mjs';
import { buildCatalogue } from '../electron/openings.mjs';
import { enrichOpenings } from '../electron/opening-enrichment.mjs';

const temporary = mkdtempSync(join(tmpdir(), 'opening-desktop-'));
app.setPath('userData', temporary);
const path = join(temporary, 'enriched.sqlite3');
const games = [...Array(41).fill('1.e4 e5 2.Nf3 Nc6 *'), '1.e4 e5 2.Nf3 *', '1.Nf3 Nf6 2.d4 d5 *', '1.h3 *', '1.e4 e5 2.Bh6 *'];
const db = fixtureArchive(path, games);
upsertGame(db,{id:41,sources:[{source:{source_key:'other',title:'Other book'},source_game_key:'other',is_primary:true}]});
await enrichOpenings(path, { catalogue: buildCatalogue({ ...catalogueFiles, c: catalogueFiles.c.replace('Two Knights', 'Two Knights with a long descriptive variation name that must fit in both the game list and review header without horizontal overflow') }), manifest: { commit: 'a'.repeat(40) }, checksum: 'desktop-fixture' });
db.prepare('UPDATE games SET pgn_sha256=? WHERE id=40').run('b'.repeat(64));
db.close();
const legacy = join(temporary, 'legacy.sqlite3'), empty = join(temporary, 'empty.sqlite3');
for (const [file, version] of [[legacy, 3], [empty, 7]]) {
  const archive = fixtureArchive(file); archive.pragma('user_version=' + version); archive.close();
}
const originals = [path, legacy, empty].map(file => hash(readFileSync(file)));
writeFileSync(join(temporary, 'archive.json'), JSON.stringify({ path }));
let nextPath = legacy;
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [nextPath] });
const errors = [];
app.on('browser-window-created', (_event, window) => {
  window.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message); });
  window.webContents.on('preload-error', (_event, _path, error) => errors.push(error.message));
});
async function smoke() {
  const timeout = setTimeout(() => { console.error('Opening desktop smoke timed out'); app.exit(1); }, 30000);
  let exitCode = 0;
  try {
    const created = once(app, 'browser-window-created');
    await import('../electron/main.mjs');
    const [, window] = await created;
    await once(window.webContents, 'did-finish-load');
    await window.webContents.executeJavaScript(`(async () => {
      window.waitForOpening = async predicate => {
        const deadline = Date.now() + 6000;
        while (!predicate()) { if (Date.now() > deadline) throw new Error('Opening UI did not update: ' + predicate); await new Promise(resolve => setTimeout(resolve, 25)); }
      };
      window.changeField = (element,value) => {
        const proto = element.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto,'value').set.call(element,value);
        element.dispatchEvent(new Event(element.tagName === 'SELECT' ? 'change' : 'input', { bubbles:true }));
      };
      window.openingSelect = label => [...document.querySelectorAll('.opening-filter label')].find(el => el.querySelector('span')?.textContent === label)?.querySelector('select');
      window.gameCount = n => document.querySelector('.results-titlebar [role="status"]')?.textContent === n + (n === 1 ? ' game' : ' games') && document.querySelectorAll('.result-item').length === Math.min(n,40) && document.querySelector('.game-results')?.getAttribute('aria-busy') === 'false';
      await waitForOpening(() => gameCount(45) && openingSelect('Opening family') && document.querySelector('.opening-filter').getAttribute('aria-busy') === 'false');
      if (document.querySelector('cg-board, .book-open, .sidebar')) throw new Error('Must remain games-only');
      if (!document.querySelector('.game-opening-name').textContent.includes('Two Knights')) throw new Error('Missing game opening label');
      changeField(document.querySelector('.opening-name-search input'),'Open Game');
      await waitForOpening(() => document.querySelector('.opening-search-results button'));
      if (document.querySelector('.opening-search-results button span').textContent !== 'Open Game') throw new Error('Name search must prioritize the family over its many descendants');
      changeField(document.querySelector('.opening-name-search input'),'');
      const family = openingSelect('Opening family');
      const option = [...family.options].find(option => option.textContent.includes('Open Game'));
      changeField(family,option.value);
      await waitForOpening(() => gameCount(41) && openingSelect('Opening line'));
      const line = openingSelect('Opening line');
      changeField(line,[...line.options].find(option => option.textContent.includes('Knight Line')).value);
      await waitForOpening(() => openingSelect('Opening subline'));
      const subline = openingSelect('Opening subline');
      changeField(subline,[...subline.options].find(option => option.textContent.includes('Two Knights')).value);
      await waitForOpening(() => gameCount(40));
      if (!document.querySelector('.opening-breadcrumb').textContent.includes('Open Game / Knight Line / Two Knights')) throw new Error('Missing full breadcrumb');
    })()`);
    window.setSize(920,650);
    await window.webContents.executeJavaScript(`(async () => {
      await new Promise(resolve=>setTimeout(resolve,100));
      if (document.documentElement.scrollWidth>innerWidth) throw new Error('Opening filters must fit minimum window width');
    })()`);
    window.setSize(1510,920);
    await window.webContents.executeJavaScript(`(() => {
      const select = openingSelect('Opening family');
      select.focus();
      if (document.activeElement !== select || select.tabIndex < 0 || !select.labels.length) throw new Error('Opening controls need focus and accessible labels');
      const input = document.querySelector('.opening-name-search input');
      changeField(input,'Knight'); input.focus();
    })()`);
    window.webContents.sendInputEvent({ type:'keyDown', keyCode:'Escape' });
    window.webContents.sendInputEvent({ type:'keyUp', keyCode:'Escape' });
    await window.webContents.executeJavaScript('waitForOpening(() => document.querySelector(".opening-name-search input").value === "" && !document.querySelector(".opening-search-results"))');
    if (process.env.CHESS_SMOKE_SCREENSHOTS) {
      mkdirSync(process.env.CHESS_SMOKE_SCREENSHOTS, { recursive: true });
      writeFileSync(join(process.env.CHESS_SMOKE_SCREENSHOTS, 'browser.png'), (await window.webContents.capturePage()).toPNG());
    }
    await window.webContents.executeJavaScript(`(async () => {
      changeField(openingSelect('Opening family'),[...openingSelect('Opening family').options].find(option => option.textContent.includes('Queen Pawn')).value);
      await waitForOpening(() => gameCount(1));
      if (openingSelect('Opening line')?.value) throw new Error('Changing family must clear descendants');
      document.querySelector('.opening-filter-heading button').click();
      await waitForOpening(() => gameCount(45));
      changeField(document.querySelector('.opening-name-search input'),'two knights');
      await waitForOpening(() => document.querySelectorAll('.opening-search-results button').length === 1);
      document.querySelector('.opening-search-results button').click();
      await waitForOpening(() => gameCount(40));
      const source=[...document.querySelectorAll('.property-filter')].find(el=>el.querySelector(':scope > span')?.textContent==='Source');
      source.querySelector('.property-trigger').click();await waitForOpening(()=>source.querySelector('[role=option]'));
      [...source.querySelectorAll('[role=option]')].find(el=>el.textContent.includes('Other book')).click();
      source.querySelector('[role=combobox]').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
      await waitForOpening(()=>gameCount(1));
      const year = [...document.querySelectorAll('label.field')].find(el => el.querySelector('span')?.textContent === 'Year from').querySelector('input');
      changeField(year,'2000');
      await waitForOpening(() => gameCount(0) && document.querySelector('.empty-results'));
      document.querySelector('.empty-results button').click();
      await waitForOpening(() => gameCount(45) && document.querySelector('.opening-filter').getAttribute('aria-busy') === 'false');
      document.querySelector('.opening-unclassified-toggle input').click();
      await waitForOpening(() => gameCount(3));
      if (openingSelect('Opening family').value !== 'unclassified') throw new Error('Unclassified checkbox must synchronize with the opening selector');
      document.querySelector('.opening-unclassified-toggle input').click();
      await waitForOpening(() => gameCount(45));
      changeField(openingSelect('Opening family'),'unclassified');
      await waitForOpening(() => gameCount(3));
      if (!document.querySelector('.opening-unclassified-toggle input').checked) throw new Error('Opening selector must synchronize with the unclassified checkbox');
      const labels = [...document.querySelectorAll('.game-opening-name')].map(el => el.textContent);
      if (!labels.includes('Opening not enriched') || labels.filter(label => label === 'Unclassified opening').length !== 2) throw new Error('Missing unmatched/invalid/stale states');
      document.querySelector('.opening-filter-heading button').click();
      await waitForOpening(() => gameCount(45));
      changeField(openingSelect('Opening family'),[...openingSelect('Opening family').options].find(option => option.textContent.includes('Open Game')).value);
      await waitForOpening(() => gameCount(41));
      document.querySelector('[aria-label="Next page"]').click();
      await waitForOpening(() => document.querySelector('.pagination').textContent.includes('Page 2 of 2') && document.querySelectorAll('.result-item').length === 1);
      window.scrollTo(0,document.body.scrollHeight);
      window.savedOpeningScroll=window.scrollY;
      window.savedOpeningSelection=openingSelect('Opening family').value;
      document.querySelector('.result-item').click();
      await waitForOpening(() => document.querySelector('.review-shell cg-board'));
      if (!document.querySelector('.review-opening-name').textContent.includes('Knight Line')) throw new Error('Missing review opening');
      if (!document.querySelector('.review-opening-name').textContent.includes('Source ECO A00')) throw new Error('Original and derived ECO must be distinguished');
    })()`);
    window.setSize(920,650);
    await window.webContents.executeJavaScript(`(async () => {
      await new Promise(resolve => setTimeout(resolve,100));
      const board = document.querySelector('cg-board').getBoundingClientRect();
      const controls = document.querySelector('.review-controls').getBoundingClientRect();
      const score = document.querySelector('.review-score').getBoundingClientRect();
      if (board.width<300 || controls.bottom>innerHeight || score.right>innerWidth) throw new Error('Enriched review must fit minimum window');
    })()`);
    window.setSize(1510,920);
    window.webContents.sendInputEvent({ type:'keyDown',keyCode:'Escape' });
    window.webContents.sendInputEvent({ type:'keyUp',keyCode:'Escape' });
    await window.webContents.executeJavaScript(`(async () => {
      await waitForOpening(() => !document.querySelector('.review-shell') && document.activeElement?.classList.contains('result-item'));
      if (openingSelect('Opening family').value !== savedOpeningSelection || !document.querySelector('.pagination').textContent.includes('Page 2 of 2')) throw new Error('Opening selection/page lost on return');
      if (Math.abs(scrollY-savedOpeningScroll)>1) throw new Error('Opening list scroll lost');
      document.querySelector('.result-item').click();
      await waitForOpening(() => document.querySelector('.review-header button'));
      document.querySelector('.review-header button').click();
      await waitForOpening(() => !document.querySelector('.review-shell'));
      window.scrollTo(0,0);
      document.querySelector('.browser-archive button').click();
      await waitForOpening(() => document.querySelector('.browser-header + .notice.error')?.textContent.includes('schema 7'));

    })()`);
    nextPath = empty;
    await window.webContents.executeJavaScript(`(async () => {
      document.querySelector('.browser-archive button').click();
      await waitForOpening(() => document.querySelector('.opening-unavailable')?.textContent.includes('have not been added'));
      if (!document.querySelector('.result-item')) throw new Error('Unenriched archive must remain usable');
    })()`);
    assert.equal(BrowserWindow.getAllWindows().length,1);
    assert.deepEqual(errors,[]);
    assert.deepEqual([path,legacy,empty].map(file=>hash(readFileSync(file))),originals);
    console.log('Opening desktop smoke passed: hierarchy, name search, combined filters, states, pagination, review labels, return state, legacy/empty archives, offline and archive preservation.');
  } catch(error) { console.error(error); exitCode=1; }
  finally {
    clearTimeout(timeout);
    app.on('will-quit',()=>{ rmSync(temporary,{ recursive:true,force:true }); app.exit(exitCode); });
    app.quit();
  }
}
void smoke();
