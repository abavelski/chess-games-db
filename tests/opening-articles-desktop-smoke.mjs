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
      if(document.querySelector('[aria-label="Opening reading language"], [aria-label="Article reading language"]'))throw Error('Language selector remains');
      if(!reader.textContent.includes('English has no explanatory body. Showing German (GERMAN)'))throw Error('Language fallback is not visible');
      if(!reader.textContent.includes('Original synthetic prose explaining'))throw Error('Explanatory prose lost');
      if(!reader.textContent.includes('Linked example')||!reader.textContent.includes('Same source chapter'))throw Error('Model-game evidence labels lost');
      window.readingBody=reader.querySelector('.opening-reading-body');readingBody.scrollTop=180;window.savedArticleScroll=readingBody.scrollTop;
      if(savedArticleScroll<100)throw Error('Fixture must exercise real article scrolling');
      window.sourceArticleLink=[...reader.querySelectorAll('.opening-prose-link')].find(b=>b.textContent==='Example');
      sourceArticleLink.focus({preventScroll:true});sourceArticleLink.click();
      await waitArticle(()=>document.querySelector('.opening-workspace .review-shell .review-board')?.dataset.fen);
      if(!document.querySelector('.opening-workspace .review-shell').textContent.includes('unvalidated'))throw Error('Raw numeric hint must not become an invented source ply');
      if(!document.querySelector('.opening-workspace .review-shell .review-board').dataset.fen.startsWith('rnbqkbnr/pppppppp/'))throw Error('Unvalidated hint did not open source root');
      document.querySelector('.opening-workspace .review-header-actions button:last-child').click();
      await waitArticle(()=>articleVisible()&&Math.abs(readingBody.scrollTop-savedArticleScroll)<1);
      if(document.activeElement!==sourceArticleLink)throw Error('Returning did not restore article link focus');
      if(document.querySelector('.opening-layout').getClientRects().length)throw Error('Article must have its own page without explorer board or continuations');
      if(document.querySelector('.opening-heading').getClientRects().length)throw Error('Explorer header remained on article page');
      const originalCounters=document.querySelector('.opening-counters').textContent;
      articleButton('Back to articles').click();
      const studyCard=()=>[...document.querySelectorAll('.opening-material-card')].find(c=>!c.closest('[hidden]')&&c.textContent.includes('Synthetic Sicilian plans'));
      await waitArticle(()=>!articleVisible()&&studyCard());
      window.studyAction=[...studyCard().querySelectorAll('button')].find(b=>b.textContent==='Study this article');
      studyAction.focus();studyAction.click();
      await waitArticle(()=>articleVisible()?.textContent.includes('Original synthetic prose explaining'));
      if(document.querySelector('.opening-layout').getClientRects().length)throw Error('Study action did not open dedicated page');
      if(document.querySelector('.opening-counters').textContent!==originalCounters)throw Error('Study action changed previous article selection');
      articleButton('Back to articles').click();
      await waitArticle(()=>!articleVisible()&&studyCard());
      if(document.activeElement!==studyAction)throw Error('Article selection focus not restored');
      studyAction.click();await waitArticle(()=>articleVisible());
      const ambiguous=articleVisible().querySelector('.opening-controlled-link details');ambiguous.open=true;
      ambiguous.querySelector('button:not(:disabled)').click();await waitArticle(()=>document.querySelector('.opening-workspace .review-shell .review-board')?.dataset.fen);
      if(!document.querySelector('.opening-workspace .review-shell').textContent.includes('Synthetic White 5'))throw Error('Ambiguous link guessed the wrong occurrence');
      document.querySelector('.opening-workspace .review-header-actions button:last-child').click();await waitArticle(()=>articleVisible());
      if(!articleVisible().querySelector('.opening-controlled-link .opening-unavailable'))throw Error('Unavailable source link disappeared');
      if([...document.querySelectorAll('button')].some(b=>b.textContent==='Browse all article titles'))throw Error('Removed catalogue button remains');
      // Resume a hostile source article directly to preserve reader security coverage.
      await new Promise(resolve=>setTimeout(resolve,250));
      const saved=await openingStudy.settings(), catalog=(await openingStudy.status()).catalog;
      const unsafe=(await openingStudy.articleCatalog({revision:catalog.revision,query:'Unsafe'})).items[0];
      await openingStudy.settings({session:{...saved.session,explorer:{...saved.session.explorer,articleView:'reader',articleReturnView:'catalog',readerKeys:[{key:unsafe.key,id:1}]}}});
    })()`);
    window.reload(); await once(window.webContents, 'did-finish-load');
    await window.webContents.executeJavaScript(`(async()=>{
      const until=async p=>{const end=Date.now()+7000;while(!p()){if(Date.now()>end)throw Error('Article resume timeout');await new Promise(r=>setTimeout(r,20));}};
      await until(()=>document.querySelector('.opening-article-page:not([hidden]) .opening-article-diagram cg-board'));
      const safe=document.querySelector('.opening-article-reader');
      if(!safe.textContent.includes('Safe words')||!safe.textContent.includes('retained'))throw Error('Malformed source lost readable text');
      if(safe.querySelector('script,style,iframe,object,embed,img[src],[onclick],[onerror],[onload]'))throw Error('Source active HTML entered the app DOM');
      if(safe.querySelectorAll('.opening-article-diagram cg-board').length!==1)throw Error('Validated diagram did not render locally');
      if(!safe.textContent.includes('invalid or unsupported FEN'))throw Error('Unavailable diagram notice missing');
      if(document.querySelector('.opening-layout').getClientRects().length)throw Error('Reload restored inline article');
      document.querySelector('.opening-article-page-header button').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
      await until(()=>document.querySelector('.opening-layout').getClientRects().length);
      if(document.querySelector('.opening-article-page').getClientRects().length)throw Error('Escape did not return to article selection');
      await new Promise(resolve=>setTimeout(resolve,250));
      const saved=await openingStudy.settings();
      await openingStudy.settings({session:{...saved.session,explorer:{...saved.session.explorer,articleView:'catalog',kind:'games',page:7}}});
    })()`);
    window.reload(); await once(window.webContents, 'did-finish-load');
    await window.webContents.executeJavaScript(`(async()=>{
      const end=Date.now()+7000;
      while(!document.querySelector('#opening-articles-tab[aria-selected="true"]')){if(Date.now()>end)throw Error('Legacy catalogue did not restore Articles');await new Promise(r=>setTimeout(r,20));}
      if(document.querySelector('.opening-article-catalog')||[...document.querySelectorAll('button')].some(b=>b.textContent==='Browse all article titles'))throw Error('Removed title catalogue returned');
    })()`);
    assert.deepEqual(requests, []); assert.deepEqual(errors, []);
    assert.deepEqual([archivePath,args.source,args.output].map(fileHash), hashes);
    console.log('Opening articles desktop smoke passed');
  } catch (error) { console.error(error); code = 1; }
  finally { clearTimeout(timeout); finishDesktopTest(app, code); }
}
void smoke();
