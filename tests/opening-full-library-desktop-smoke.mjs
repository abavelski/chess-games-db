// Opt-in, local copyrighted library stays external; report contains timings only.
import { app } from 'electron';
import { once } from 'node:events';
import { join, resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { desktopTestDirectory, finishDesktopTest } from './fixtures/desktop-test.mjs';
import { fileHash } from '../lib/opening-library-storage.mjs';
const library = process.env.CHESS_OPENING_LIBRARY;
if (!library) throw new Error('Set CHESS_OPENING_LIBRARY to an external ready library');
const temporary = desktopTestDirectory(); app.setPath('userData', temporary);
writeFileSync(join(temporary, 'opening-library.json'), JSON.stringify({ path: resolve(library) }));
const before = fileHash(library), errors = [];
app.on('browser-window-created', (_event, window) => window.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message); }));
async function smoke() {
  const timeout = setTimeout(() => { console.error('Full-library desktop timeout'); app.exit(1); }, 90000);
  let code = 0;
  try {
    const created = once(app, 'browser-window-created'); await import('../electron/main.mjs'); const [, window] = await created;
    await once(window.webContents, 'did-finish-load');
    const metrics = await window.webContents.executeJavaScript(`(async()=>{
      const until=async p=>{const end=performance.now()+15000;while(!p()){if(performance.now()>end)throw Error('Full library UI timeout: '+p);await new Promise(r=>setTimeout(r,5));}};
      const visible=e=>e&&!e.closest('[hidden]');
      const button=text=>[...document.querySelectorAll('.opening-workspace button')].find(e=>visible(e)&&e.textContent===text);
      const count=()=>document.querySelector('.opening-counters strong')?.textContent;
      const frames=[];let running=true,last=performance.now();const frame=now=>{frames.push(now-last);last=now;if(running)requestAnimationFrame(frame);};requestAnimationFrame(frame);
      const start=performance.now();document.querySelector('[aria-label="Workspaces"] button:nth-child(2)').click();
      await until(()=>count()==='81,301');const firstRootMs=performance.now()-start;
      const path=[];
      for(const [uci,expected] of [['e2e4','50,327'],['c7c5','10,662'],['g1f3','8,316']]){
        const t=performance.now();document.querySelector('[data-opening-reply="'+uci+'"]').click();
        await until(()=>count()===expected);path.push({uci,displayMs:performance.now()-t});
      }
      await until(()=>document.querySelector('.opening-material-card h3 button'));
      let t=performance.now();document.querySelector('.opening-material-card h3 button').click();
      await until(()=>[...document.querySelectorAll('.opening-reading-body')].some(visible));const firstArticleMs=performance.now()-t;
      button('Back to matching material').click();document.querySelector('#opening-games-tab').click();
      await until(()=>button('Open annotated example'));t=performance.now();button('Open annotated example').click();
      await until(()=>document.querySelector('.opening-example-preview .opening-board-container'));const firstReviewMs=performance.now()-t;
      button('Back to study').click();await until(()=>count()==='8,316');
      const cachedDisplayMs=[];
      for(let i=0;i<10;i++){
        t=performance.now();button('Reset path').click();await until(()=>count()==='81,301');cachedDisplayMs.push(performance.now()-t);
        for(const [uci,expected] of [['e2e4','50,327'],['c7c5','10,662'],['g1f3','8,316']]){
          t=performance.now();document.querySelector('[data-opening-reply="'+uci+'"]').click();await until(()=>count()===expected);cachedDisplayMs.push(performance.now()-t);
        }
      }
      // Explicit discovery stays responsive while a worker handles the query.
      const anchorButton=button('Find other move orders');
      if(!anchorButton)throw Error('Position discovery action unavailable');t=performance.now();anchorButton.click();
      await until(()=>document.querySelector('.opening-session-label')?.textContent.includes('Position anchor')&&/^[0-9,]+$/.test(count()??''));const anchorMs=performance.now()-t;
      running=false;return {firstRootMs,path,firstArticleMs,firstReviewMs,anchorMs,frames,cachedDisplayMs};
    })()`);
    const frames = metrics.frames.sort((a,b) => a-b); delete metrics.frames;
    const cached = metrics.cachedDisplayMs.sort((a,b) => a-b); delete metrics.cachedDisplayMs;
    const report = { ...metrics, frameGapMs: { samples: frames.length, p50: frames[Math.ceil(frames.length*.5)-1], p95: frames[Math.ceil(frames.length*.95)-1], max: frames.at(-1) }, processMemory: app.getAppMetrics().map(p => ({ type: p.type, memory: p.memory })), unchangedLibrary: fileHash(library) === before };
    report.cachedDisplayMs = { samples: cached.length, p50: cached[Math.ceil(cached.length*.5)-1], p95: cached[Math.ceil(cached.length*.95)-1], max: cached.at(-1) };
    assert.equal(report.unchangedLibrary, true); assert.deepEqual(errors, []);
    const output = process.env.CHESS_OPENING_UI_REPORT;
    if (output) writeFileSync(output, JSON.stringify(report, null, 2));
    console.log('Full-library desktop metrics:', JSON.stringify(report));
  } catch (error) { console.error(error); code = 1; }
  finally { clearTimeout(timeout); finishDesktopTest(app, code); }
}
void smoke();
