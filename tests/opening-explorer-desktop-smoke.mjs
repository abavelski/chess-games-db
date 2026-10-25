import { app } from 'electron';
import { once } from 'node:events';
import { join } from 'node:path';
import { writeFileSync, mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { desktopTestDirectory, finishDesktopTest } from './fixtures/desktop-test.mjs';
import { fixtureArchive } from './fixtures/opening-archive.mjs';
import { createOpeningSource } from './fixtures/opening-study-source.mjs';
import { initializeBuild } from '../scripts/build-opening-library.mjs';
import { publishOpeningLibrary } from '../lib/opening-publication.mjs';
import { fileHash } from '../lib/opening-library-storage.mjs';
import { OpeningWorkerClient } from '../electron/opening-query-client.mjs';

const temporary = desktopTestDirectory(); app.setPath('userData', temporary);
const archivePath = join(temporary, 'games.sqlite'), games = fixtureArchive(archivePath, ['1. e4 *']); games.close();
writeFileSync(join(temporary, 'archive.json'), JSON.stringify({ path: archivePath }));
const args = { source: join(temporary, 'source.sqlite'), staging: join(temporary, 'staging.sqlite'), output: join(temporary, 'ready.sqlite'), corpus: 'synthetic', progress: () => {} };
createOpeningSource(args.source); initializeBuild(args); initializeBuild({ ...args, resume: true, phase: 'trees' });
initializeBuild({ ...args, resume: true, phase: 'articles' }); publishOpeningLibrary(args);
writeFileSync(join(temporary, 'opening-library.json'), JSON.stringify({ path: args.output }));
const hashes = [archivePath,args.source,args.output].map(fileHash);
const originalCall = OpeningWorkerClient.prototype.call;
let slowE4 = false, exploreCalls = 0;
OpeningWorkerClient.prototype.call = function(method, request) {
  if (method === 'explore') exploreCalls++;
  const result = originalCall.call(this, method, request);
  return method === 'explore' && slowE4 && request.moves?.join(' ') === 'e2e4'
    ? result.then(value => new Promise(resolve => setTimeout(() => resolve(value), 300))) : result;
};
const errors = [];
app.on('browser-window-created', (_event, window) => {
  window.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message); });
  window.webContents.on('preload-error', (_event, _path, error) => errors.push(error.message));
});
async function smoke() {
  const timeout = setTimeout(() => { console.error('Opening explorer desktop smoke timed out'); app.exit(1); }, 40000);
  let code = 0;
  try {
    const created = once(app, 'browser-window-created'); await import('../electron/main.mjs'); const [, window] = await created;
    await once(window.webContents, 'did-finish-load');
    await window.webContents.executeJavaScript(`(async()=>{
      window.waitExplorer=async predicate=>{const until=Date.now()+7000;while(!predicate()){if(Date.now()>until)throw Error('Explorer did not update: '+predicate);await new Promise(r=>setTimeout(r,20));}};
      window.explorerCounts=()=>[...document.querySelectorAll('.opening-counters strong')].map(e=>Number(e.textContent.replace(/[^0-9]/g,'')));
      window.expectExplorer=async(games,lines)=>{try{await waitExplorer(()=>document.querySelector('.opening-continuations')?.getAttribute('aria-busy')==='false'&&explorerCounts()[0]===games&&explorerCounts()[1]===lines);}catch(error){throw Error('Stage '+window.explorerStage+' expected '+games+'/'+lines+'; actual '+JSON.stringify(explorerCounts())+'; path '+document.querySelector('.opening-breadcrumb')?.textContent+'; focus '+document.activeElement?.outerHTML.slice(0,200)+'; errors '+[...document.querySelectorAll('[role=alert]')].map(e=>e.textContent).join(' | '));}};
      window.explorerButton=text=>[...document.querySelectorAll('.opening-explorer button')].find(b=>b.textContent===text);
      window.changeExplorer=(selector,value)=>{const el=document.querySelector(selector);const proto=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:el.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,value);el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));};
      document.querySelector('[aria-label="Workspaces"] button:nth-child(2)').click();
      await expectExplorer(6,10);if(document.querySelectorAll('[aria-label="Study material"] [role="tab"]').length!==2||document.querySelector('#opening-comments-tab'))throw Error('Only articles and games should be shown');window.originalOpeningBoard=document.querySelector('.opening-board-container cg-board');
      if(document.querySelector('.opening-session-label')||explorerButton('Undo')||explorerButton('Start')||document.querySelector('.opening-board-panel').textContent.includes('White to move'))throw Error('Removed board headings or controls remain');
      const reset=explorerButton('Reset path'), find=explorerButton('Find other move orders');
      if(reset.nextElementSibling!==find)throw Error('Find other move orders must follow Reset path');
      window.explorerStage='row';
      document.querySelector('[data-opening-reply="e2e4"]').click();await expectExplorer(3,6);
      if(document.querySelector('.opening-board-container cg-board')!==originalOpeningBoard)throw Error('Board remounted during move/query');
      document.querySelector('.opening-board-container').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}));await expectExplorer(6,10);
    })()`);
    async function square(file, rank) {
      const point = await window.webContents.executeJavaScript(`(async()=>{const board=document.querySelector('.opening-board-container cg-board');board.scrollIntoView({block:'center'});await new Promise(r=>setTimeout(r,60));const b=board.getBoundingClientRect();return{x:Math.round(b.left+(${file}+.5)*b.width/8),y:Math.round(b.top+(8-${rank}+.5)*b.height/8)};})()`);
      window.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point });
      window.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point });
      await new Promise(resolve => setTimeout(resolve, 80));
    }
    await window.webContents.executeJavaScript("window.explorerStage='mouse'");
    await square(4,2); await square(4,4);
    await window.webContents.executeJavaScript(`(async()=>{await expectExplorer(3,6);document.querySelector('.opening-board-container').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}));await expectExplorer(6,10);window.explorerStage='keyboard';document.querySelector('[data-opening-reply="e2e4"]').focus();})()`);
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
    window.webContents.sendInputEvent({ type: 'char', keyCode: '\r' });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
    await window.webContents.executeJavaScript(`(async()=>{
      await expectExplorer(3,6);explorerButton('Reset path').click();await expectExplorer(6,10);
      window.explorerStage='transposition';
      for(const uci of ['g1f3','d7d5','g2g3']){await waitExplorer(()=>document.querySelector('[data-opening-reply="'+uci+'"]'));document.querySelector('[data-opening-reply="'+uci+'"]').click();await new Promise(r=>setTimeout(r,30));}
      await expectExplorer(1,1);explorerButton('Find other move orders').click();await expectExplorer(2,2);
      if(!document.querySelector('.opening-anchor-status').textContent.includes('Position anchor'))throw Error('Anchor mode not labeled');
      explorerButton('Return to previous move order').click();await expectExplorer(1,1);
      if(document.querySelectorAll('.opening-breadcrumb [aria-current="step"]').length!==1)throw Error('Move order not restored');
      explorerButton('Reset path').click();await expectExplorer(6,10);
      window.explorerStage='article scope';
      await waitExplorer(()=>explorerButton('Study this article'));explorerButton('Study this article').click();
      await waitExplorer(()=>explorerButton('Limit explorer to this article'));explorerButton('Limit explorer to this article').click();await expectExplorer(1,3);
      await waitExplorer(()=>explorerButton('Back to articles'));explorerButton('Back to articles').click();await waitExplorer(()=>document.querySelector('.opening-layout').getClientRects().length);
      explorerButton('Find other move orders').click();await expectExplorer(1,3);
      explorerButton('Reset path').click();await expectExplorer(6,10);
      if(document.querySelector('.opening-filter-chip,.opening-anchor-status')||explorerButton('Return to previous move order'))throw Error('Reset retained article scope or previous anchor');
      if(document.querySelector('.opening-board-container').dataset.fen!=='rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1')throw Error('Reset did not restore standard start');
    })()`);
    const beforeLanguage = exploreCalls;
    await window.webContents.executeJavaScript(`(async()=>{if(document.querySelector('[aria-label="Opening reading language"]'))throw Error('Language selector remains');await new Promise(r=>setTimeout(r,100));if(explorerCounts()[1]!==10)throw Error('Reading language changed counters');})()`);
    assert.equal(exploreCalls, beforeLanguage);
    slowE4 = true;
    // Use the board now that the optional text move-entry UI is removed.
    await square(4,2); await square(4,4); await square(2,7); await square(2,5);
    await window.webContents.executeJavaScript(`(async()=>{
      await expectExplorer(1,1);await new Promise(r=>setTimeout(r,400));
      if(explorerCounts()[0]!==1||!document.querySelector('.opening-breadcrumb [aria-current="step"]').textContent.includes('c5'))throw Error('Stale response replaced the current board/results');
      explorerButton('Reset path').click();await expectExplorer(6,10);
    })()`);
    await square(0,2); await square(0,3);
    await window.webContents.executeJavaScript(`(async()=>{
      await expectExplorer(0,0);if(!document.querySelector('.opening-continuations').textContent.includes('No indexed continuation'))throw Error('Unsupported legal branch needs an explicit message');
      document.querySelector('.opening-board-container').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}));await expectExplorer(6,10);
      // Seed a valid saved setup for the existing promotion/resume check;
      // custom FEN entry is no longer exposed in the workspace.
      await new Promise(r=>setTimeout(r,250));
      const saved=await openingStudy.settings();
      await openingStudy.settings({session:{...saved.session,explorer:{...saved.session.explorer,kind:'comments',page:7,route:{mode:'position',rootFen:'4k3/P7/8/8/8/8/8/4K3 w - - 0 1',moves:[],filters:{}}}}});
      window.explorerTestHelpers=[waitExplorer,explorerCounts,expectExplorer,explorerButton].map(fn=>fn.toString());
    })()`);
    const helpers = await window.webContents.executeJavaScript('explorerTestHelpers');
    window.reload(); await once(window.webContents, 'did-finish-load');
    await window.webContents.executeJavaScript(`(async()=>{
      ${['waitExplorer','explorerCounts','expectExplorer','explorerButton'].map((name, i) => `window.${name}=${helpers[i]};`).join('\n')}
      await expectExplorer(0,0);
    })()`);
    await window.webContents.executeJavaScript(`if(!document.querySelector('#opening-games-tab[aria-selected="true"]')||!document.querySelector('.opening-pagination').textContent.includes('Page 1 of'))throw Error('Saved source comments view did not reset to game records');`);
    slowE4 = false;
    await square(0,7); await square(0,8);
    await window.webContents.executeJavaScript(`(async()=>{
      await waitExplorer(()=>document.querySelector('[aria-label="Choose opening promotion"]'));
      if(document.querySelector('.opening-breadcrumb [aria-current="step"]'))throw Error('Promotion advanced before selection');
      [...document.querySelectorAll('.opening-promotion button')].find(b=>b.textContent==='knight').click();
      await waitExplorer(()=>document.querySelector('.opening-board-container').dataset.fen.startsWith('N3k3/'));
      await expectExplorer(0,0);document.querySelector('.opening-board-container').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}));await expectExplorer(0,0);
      if(!document.querySelector('.opening-board-container').dataset.fen.startsWith('4k3/P7/'))throw Error('Promotion undo lost anchor root');
      explorerButton('Reset path').click();await expectExplorer(6,10);
      if(document.querySelector('.opening-board-container').dataset.fen!=='rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1')throw Error('Reset from custom FEN did not return to standard start');
      await new Promise(r=>setTimeout(r,250));const saved=await openingStudy.settings();
      if(saved.session.explorer.route.mode!=='prefix'||saved.session.explorer.route.moves.length||Object.keys(saved.session.explorer.route.filters).length||saved.session.explorer.previous)throw Error('Saved reset retained filters, moves or previous anchor');
    })()`);
    window.setSize(920,650);
    await window.webContents.executeJavaScript(`(async()=>{await new Promise(r=>setTimeout(r,120));if(document.documentElement.scrollWidth>document.documentElement.clientWidth)throw Error('Opening explorer overflows narrow window');})()`);
    if (process.env.CHESS_OPENING_SCREENSHOTS) {
      mkdirSync(process.env.CHESS_OPENING_SCREENSHOTS, { recursive: true });
      writeFileSync(join(process.env.CHESS_OPENING_SCREENSHOTS, 'explorer.png'), (await window.webContents.capturePage()).toPNG());
    }
    assert.deepEqual([archivePath,args.source,args.output].map(fileHash), hashes); assert.deepEqual(errors, []);
    console.log('Opening explorer desktop smoke passed');
  } catch (error) { console.error(error); code = 1; }
  finally { clearTimeout(timeout); finishDesktopTest(app, code); }
}
void smoke();
