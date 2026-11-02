import { app } from 'electron';
import { once } from 'node:events';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { desktopTestDirectory, finishDesktopTest } from './fixtures/desktop-test.mjs';
import { fixtureArchive } from './fixtures/opening-archive.mjs';
import { createOpeningSource } from './fixtures/opening-study-source.mjs';
import { initializeBuild } from '../scripts/build-opening-library.mjs';
import { publishOpeningLibrary } from '../lib/opening-publication.mjs';
import { fileHash } from '../lib/opening-library-storage.mjs';
const temporary = desktopTestDirectory(); app.setPath('userData', temporary);
const archivePath = join(temporary, 'games.sqlite'), archive = fixtureArchive(archivePath, ['1. e4 *']); archive.close();
writeFileSync(join(temporary, 'archive.json'), JSON.stringify({ path: archivePath }));
const args = { source: join(temporary, 'source.sqlite'), staging: join(temporary, 'stage.sqlite'), output: join(temporary, 'ready.sqlite'), corpus: 'synthetic', progress: () => {} };
createOpeningSource(args.source); initializeBuild(args); initializeBuild({ ...args, resume: true, phase: 'trees' }); initializeBuild({ ...args, resume: true, phase: 'articles' }); publishOpeningLibrary(args);
writeFileSync(join(temporary, 'opening-library.json'), JSON.stringify({ path: args.output }));
const paths = [archivePath, args.source, args.output], hashes = paths.map(fileHash), errors = [];
app.on('browser-window-created', (_event, window) => window.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message); }));
const helpers = `window.until=async p=>{const end=Date.now()+7000;while(!p()){if(Date.now()>end)throw Error('Review timeout: '+p);await new Promise(r=>setTimeout(r,20));}};
window.review=()=>document.querySelector('.opening-workspace .review-shell');
window.selectSource=path=>review().querySelector('[data-review-path=\"'+path.split('.').map(n=>String.fromCharCode(256+(Number(n)>>8),256+(Number(n)&255))).join('')+'\"]').click();
window.press=text=>{const b=[...review().querySelectorAll('button')].find(b=>b.textContent.trim()===text||b.getAttribute('aria-label')===text);if(!b)throw Error('Missing '+text);b.click();};`;
async function smoke() {
  const timeout = setTimeout(() => { console.error('Opening review desktop smoke timed out'); app.exit(1); }, 40000);
  let code = 0;
  try {
    const created = once(app, 'browser-window-created'); await import('../electron/main.mjs'); const [, window] = await created;
    await once(window.webContents, 'did-finish-load');
    await window.webContents.executeJavaScript(`(async()=>{${helpers}
      document.querySelector('[aria-label="Workspaces"] button:nth-child(2)').click();
      await until(()=>document.querySelector('#opening-games-tab')); document.querySelector('#opening-games-tab').click();
      await until(()=>[...document.querySelectorAll('.opening-material-card')].some(c=>c.textContent.includes('Synthetic White 1')));
      const card=[...document.querySelectorAll('.opening-game-card')].find(c=>c.textContent.includes('Synthetic White 1'));
      if(card.textContent.includes('Open annotated example'))throw Error('Removed example button text remains');
      const target=card.querySelector('.opening-game-open'), area=target.getBoundingClientRect(), bounds=card.getBoundingClientRect();
      if(Math.abs(area.width-bounds.width)>2||Math.abs(area.height-bounds.height)>2)throw Error('Game hit target does not cover the card');
      if(document.elementFromPoint(bounds.right-8,bounds.bottom-8)!==target)throw Error('Game card background is not clickable');
      target.focus();
    })()`);
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
    window.webContents.sendInputEvent({ type: 'char', keyCode: '\r' });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
    await window.webContents.executeJavaScript(`(async()=>{${helpers}
      await until(()=>review()?.querySelector('.review-move:not(:disabled)'));
      if(!review().textContent.includes('Synthetic root explanation.')||!review().textContent.includes('Unsupported source annotation: Evaluations'))throw Error('Root annotation coverage lost');
      if([...review().querySelectorAll('label')].some(label=>label.textContent.includes('Show all source languages')))throw Error('Review language control remains');
      if(!review().querySelector('.review-transcript')||!review().querySelector('[aria-label="Resize board"]'))throw Error('Shared review UI missing');
      selectSource('0.1');await until(()=>review().querySelector('[aria-current="step"]')?.textContent.includes('c6'));
      if(!review().textContent.includes('Prepare a different pawn structure.')||!review().textContent.includes('A second comment in the same language.'))throw Error('Ordered comments lost');
      if(review().textContent.includes('Der c-Bauer'))throw Error('Language selection mixed translations');
      const comments=[...review().querySelectorAll('.review-comment')].map(e=>e.textContent);
      if(comments.findIndex(t=>t.includes('Prepare a different'))>comments.findIndex(t=>t.includes('The c-pawn')))throw Error('Comment placement lost');
      selectSource('0.1.0');await until(()=>review().querySelector('[aria-label="Good move"]'));
      await until(()=>review().querySelector('svg.cg-shapes > g line')&&review().querySelector('svg.cg-shapes > g circle'));
      press('Previous move');await until(()=>!review().querySelector('svg.cg-shapes > g line, svg.cg-shapes > g circle'));
      selectSource('0.1.1');await until(()=>review().querySelector('[aria-current="step"]')?.textContent.includes('Nf3'));
      review().dispatchEvent(new KeyboardEvent('keydown',{key:'f',bubbles:true}));await until(()=>review().querySelector('.orientation-black'));
      await new Promise(r=>setTimeout(r,250));
      const state=await openingStudy.settings();
      if(state.session.review.sourcePath!=='0.1.1'||!state.session.review.flipped)throw Error('Exact review path not saved');
    })()`);
    window.reload(); await once(window.webContents, 'did-finish-load');
    await window.webContents.executeJavaScript(`(async()=>{${helpers}
      await until(()=>review()?.querySelector('[aria-current="step"]')?.textContent.includes('Nf3'));
      if(document.querySelector('.workspace-root').dataset.workspace!=='openings'||!review().querySelector('.orientation-black'))throw Error('Workspace/orientation resume lost');
      press('Back to study'); await until(()=>document.querySelector('#opening-games-tab[aria-selected="true"]'));
      await new Promise(r=>setTimeout(r,250));
      const status=await openingStudy.status(), saved=await openingStudy.settings();
      await openingStudy.settings({session:{...saved.session,revision:'different-revision',review:{key:'wrong',treeHash:'a'.repeat(64),sourcePath:'0',flipped:false}}});
    })()`);
    window.reload(); await once(window.webContents, 'did-finish-load');
    await window.webContents.executeJavaScript(`(async()=>{${helpers}
      await until(()=>document.querySelector('.opening-workspace')?.textContent.includes('different library or revision'));
      if(review())throw Error('Rebuilt library misattached saved source');
      const c=(await openingStudy.status()).catalog;
      const result=await openingStudy.explore({revision:c.revision,mode:'prefix',moves:['e2e4','e7e5'],filters:{}});
      const page=await openingStudy.materials({revision:c.revision,token:result.token,kind:'games'}), doc=page.items[0];
      await new Promise(r=>setTimeout(r,250));
      const old=await openingStudy.settings();
      await openingStudy.settings({session:{...old.session,explorer:{...old.session.explorer,route:{...old.session.explorer.route,moves:['e2e4','e7e5']},flipped:true},review:{key:doc.key,treeHash:doc.treeHash,sourcePath:'0.1',flipped:false}}});
    })()`);
    window.reload(); await once(window.webContents, 'did-finish-load');
    await window.webContents.executeJavaScript(`(async()=>{${helpers}
      await until(()=>review()?.querySelector('.review-move:not(:disabled)'));
      press('Next move');await until(()=>review().querySelector('[aria-current="step"]')?.textContent.includes('Nc3'));
      if(review().querySelectorAll('[aria-current="step"]').length!==1)throw Error('Duplicate siblings collapsed to viewer path');
      press('Back to study');await until(()=>document.querySelector('.opening-explorer .orientation-black'));
      const c=(await openingStudy.status()).catalog, fen='4k3/8/8/8/8/8/4P3/4K3 b - - 17 42';
      const result=await openingStudy.explore({revision:c.revision,mode:'prefix',rootFen:fen,moves:[],filters:{}});
      await new Promise(r=>setTimeout(r,250));
      const page=await openingStudy.materials({revision:c.revision,token:result.token,kind:'games'}), doc=page.items[0], old=await openingStudy.settings();
      await openingStudy.settings({session:{...old.session,review:{key:doc.key,treeHash:doc.treeHash,sourcePath:'0',flipped:false}}});
    })()`);
    window.reload(); await once(window.webContents, 'did-finish-load');
    await window.webContents.executeJavaScript(`(async()=>{${helpers}
      await until(()=>review()?.querySelector('.review-board')?.dataset.fen);
      if(!review().querySelector('.review-board').dataset.fen.endsWith('w - - 18 43'))throw Error('Custom setup root or move counters lost');
      press('First position');await until(()=>review().querySelector('.review-board').dataset.fen.endsWith('b - - 17 42'));
    })()`);
    // Board input can add a temporary analysis variation in the shared viewer.
    for (const [file, rank] of [[4,8],[4,7]]) {
      const point = await window.webContents.executeJavaScript(`(()=>{const b=review().querySelector('cg-board').getBoundingClientRect();return {x:Math.round(b.left+(${file}+.5)*b.width/8),y:Math.round(b.top+(8-${rank}+.5)*b.height/8)};})()`);
      window.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point });
      window.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point });
    }
    await window.webContents.executeJavaScript(`(async()=>{${helpers}
      await until(()=>review().querySelector('[aria-current="step"]')?.textContent.includes('Ke7'));
      if(review().querySelector('[aria-label="Save my comments"]'))throw Error('Source review exposed Games archive saves');
      press('Previous move');await until(()=>review().querySelector('.review-board').dataset.fen.endsWith('b - - 17 42'));
    })()`);
    assert.deepEqual(paths.map(fileHash), hashes); assert.deepEqual(errors, []);
    console.log('Opening review and restart desktop smoke passed');
  } catch (error) { console.error(error); code = 1; }
  finally { clearTimeout(timeout); finishDesktopTest(app, code); }
}
void smoke();
