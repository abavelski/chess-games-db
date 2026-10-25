import { app, session } from 'electron';
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
const archivePath = join(temporary, 'games.sqlite'), games = fixtureArchive(archivePath, ['1. e4 *']); games.close();
writeFileSync(join(temporary, 'archive.json'), JSON.stringify({ path: archivePath }));
const args = { source: join(temporary, 'source.sqlite'), staging: join(temporary, 'staging.sqlite'), output: join(temporary, 'ready.sqlite'), corpus: 'synthetic', progress: () => {} };
createOpeningSource(args.source); initializeBuild(args); initializeBuild({ ...args, resume: true, phase: 'trees' });
initializeBuild({ ...args, resume: true, phase: 'articles' }); publishOpeningLibrary(args);
writeFileSync(join(temporary, 'opening-library.json'), JSON.stringify({ path: args.output }));
const hashes = [archivePath,args.source,args.output].map(fileHash), requests = [], errors = [];
app.on('ready', () => session.defaultSession.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, done) => {
  const remote = /^https?:/i.test(details.url) || details.url === 'file:///secret';
  if (remote) requests.push(details.url); done({ cancel: remote });
}));
app.on('browser-window-created', (_event, window) => {
  window.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message); });
  window.webContents.on('preload-error', (_event, _path, error) => errors.push(error.message));
});
async function smoke() {
  const timeout = setTimeout(() => { console.error('Opening article desktop smoke timed out'); app.exit(1); }, 35000);
  let code = 0;
  try {
    const created = once(app, 'browser-window-created'); await import('../electron/main.mjs'); const [, window] = await created;
    await once(window.webContents, 'did-finish-load');
    await window.webContents.executeJavaScript(`(async()=>{
      window.waitArticle=async predicate=>{const until=Date.now()+7000;while(!predicate()){if(Date.now()>until)throw Error('Article UI did not update: '+predicate);await new Promise(r=>setTimeout(r,20));}};
      window.articleVisible=()=>[...document.querySelectorAll('.opening-article-reader')].find(e=>!e.closest('[hidden]'));
      window.articleButton=text=>[...document.querySelectorAll('.opening-explorer button')].find(e=>e.textContent===text&&!e.closest('[hidden]'));
      window.articleInput=(selector,value)=>{const el=document.querySelector(selector);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}));};
      document.querySelector('[aria-label="Workspaces"] button:nth-child(2)').click();
      await waitArticle(()=>document.querySelector('.opening-material-card h3 button'));
      [...document.querySelectorAll('.opening-material-card h3 button')].find(b=>b.textContent==='Synthetic Sicilian plans').click();
      await waitArticle(()=>articleVisible()?.querySelector('.opening-reading-body'));
      const reader=articleVisible();
      if(!reader.textContent.includes('English has no explanatory body. Showing German (GERMAN)'))throw Error('Language fallback is not visible');
      if(!reader.textContent.includes('Original synthetic prose explaining'))throw Error('Explanatory prose lost');
      if(!reader.textContent.includes('Linked example')||!reader.textContent.includes('Same source chapter'))throw Error('Model-game evidence labels lost');
      window.readingBody=reader.querySelector('.opening-reading-body');readingBody.scrollTop=180;window.savedArticleScroll=readingBody.scrollTop;
      if(savedArticleScroll<100)throw Error('Fixture must exercise real article scrolling');
      window.sourceArticleLink=[...reader.querySelectorAll('.opening-prose-link')].find(b=>b.textContent==='Example');
      sourceArticleLink.focus({preventScroll:true});sourceArticleLink.click();
      await waitArticle(()=>document.querySelector('.opening-example-preview .opening-board-container'));
      if(!document.querySelector('.opening-example-preview').textContent.includes('unvalidated'))throw Error('Raw numeric hint must not become an invented source ply');
      if(!document.querySelector('.opening-example-preview .opening-board-container').dataset.fen.startsWith('rnbqkbnr/pppppppp/'))throw Error('Unvalidated hint did not open source root');
      document.querySelector('.opening-example-preview > button').click();
      await waitArticle(()=>articleVisible()&&Math.abs(readingBody.scrollTop-savedArticleScroll)<1);
      if(document.activeElement!==sourceArticleLink)throw Error('Returning did not restore article link focus');
      [...articleVisible().querySelectorAll('button')].find(b=>b.textContent==='Study this article').click();
      await waitArticle(()=>document.querySelector('.opening-counters strong')?.textContent==='1');
      if(!articleVisible()||!document.querySelector('.opening-filter-chip'))throw Error('Study article did not preserve reader and apply direct scope');
      document.querySelector('[aria-label="Clear article filter"]').click();
      await waitArticle(()=>document.querySelector('.opening-counters strong')?.textContent==='6');
      const ambiguous=articleVisible().querySelector('.opening-controlled-link details');ambiguous.open=true;
      ambiguous.querySelector('button:not(:disabled)').click();await waitArticle(()=>document.querySelector('.opening-example-preview .opening-board-container'));
      if(!document.querySelector('.opening-example-preview').textContent.includes('Synthetic White 5'))throw Error('Ambiguous link guessed the wrong occurrence');
      document.querySelector('.opening-example-preview > button').click();await waitArticle(()=>articleVisible());
      if(!articleVisible().querySelector('.opening-controlled-link .opening-unavailable'))throw Error('Unavailable source link disappeared');
      articleButton('Browse all article titles').click();articleInput('[aria-label="Article title search"]','standalone');
      await waitArticle(()=>[...document.querySelectorAll('.opening-article-catalog h3 button')].some(b=>b.textContent==='Standalone synthetic essay'));
      [...document.querySelectorAll('.opening-article-catalog h3 button')].find(b=>b.textContent==='Standalone synthetic essay').click();
      await waitArticle(()=>articleVisible()?.textContent.includes('No playable linked examples'));
      if(!articleVisible().textContent.includes('An essay without playable examples remains available'))throw Error('Standalone essay cannot be read');
      articleButton('Browse all article titles').click();articleInput('[aria-label="Article title search"]','Unsafe');
      await waitArticle(()=>document.querySelector('.opening-article-catalog h3 button')?.textContent==='Unsafe synthetic source example');
      document.querySelector('.opening-article-catalog h3 button').click();
      await waitArticle(()=>articleVisible()?.querySelector('cg-board'));
      const safe=articleVisible();
      if(!safe.textContent.includes('Safe words')||!safe.textContent.includes('retained'))throw Error('Malformed source lost readable text');
      if(safe.querySelector('script,style,iframe,object,embed,img[src],[onclick],[onerror],[onload]'))throw Error('Source active HTML entered the app DOM');
      if(safe.querySelectorAll('.opening-article-diagram cg-board').length!==1)throw Error('Validated diagram did not render locally');
      if(!safe.textContent.includes('invalid or unsupported FEN'))throw Error('Unavailable diagram notice missing');
    })()`);
    assert.deepEqual(requests, []); assert.deepEqual(errors, []);
    assert.deepEqual([archivePath,args.source,args.output].map(fileHash), hashes);
    console.log('Opening articles desktop smoke passed');
  } catch (error) { console.error(error); code = 1; }
  finally { clearTimeout(timeout); finishDesktopTest(app, code); }
}
void smoke();
