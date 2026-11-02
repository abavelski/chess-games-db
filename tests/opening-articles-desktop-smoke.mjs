import { app, session } from 'electron';
import { once } from 'node:events';
import { join } from 'node:path';
import { configureFakeEngines } from './fixtures/fake-engine-config.mjs';
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
configureFakeEngines(temporary);
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
    await window.webContents.executeJavaScript(`(async()=>{try{
      window.waitArticle=async predicate=>{const until=Date.now()+7000;while(!predicate()){if(Date.now()>until)throw Error('Article UI did not update: '+predicate);await new Promise(r=>setTimeout(r,20));}};
      window.articleVisible=()=>[...document.querySelectorAll('.opening-article-reader')].find(e=>!e.closest('[hidden]'));
      window.articleButton=text=>[...document.querySelectorAll('.opening-explorer button')].find(e=>e.textContent===text&&!e.closest('[hidden]'));
      window.articleInput=(selector,value)=>{const el=document.querySelector(selector);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}));};
      document.querySelector('[aria-label="Workspaces"] button:nth-child(2)').click();
      await waitArticle(()=>document.querySelector('.opening-article-open'));
      document.querySelector('[data-opening-reply="e2e4"]').click();
      await waitArticle(()=>document.querySelector('.opening-board-panel .opening-board-container').dataset.fen.includes('/4P3/')&&document.querySelector('.opening-continuations').getAttribute('aria-busy')==='false'&&[...document.querySelectorAll('.opening-article-card')].some(c=>c.querySelector('h3').textContent==='Synthetic Sicilian plans'));
      window.articleContextFen=document.querySelector('.opening-board-panel .opening-board-container').dataset.fen;
      [...document.querySelectorAll('.opening-article-card')].find(c=>c.querySelector('h3').textContent==='Synthetic Sicilian plans').querySelector('.opening-article-open').click();
      await waitArticle(()=>articleVisible()?.querySelector('.opening-reading-body'));
      const reader=articleVisible();
      const articleFen=articleContextFen.replace(' e3 ', ' - ');
      await waitArticle(()=>reader.querySelector('.opening-article-board').dataset.fen===articleFen);
      window.articleGround=reader.querySelector('.opening-article-board cg-board');
      reader.querySelector('.opening-fen-link').click();
      await waitArticle(()=>reader.querySelector('.opening-article-board').dataset.fen.startsWith('4k3/'));
      if(reader.querySelector('.opening-article-board cg-board')!==articleGround)throw Error('Selecting an article FEN remounted the shared board');
      const resize=reader.querySelector('[aria-label="Resize board"]'),beforeSize=Number(resize.getAttribute('aria-valuenow'));
      resize.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}));
      await waitArticle(()=>Number(resize.getAttribute('aria-valuenow'))<beforeSize);
      if(!localStorage.getItem('review-board-size-v1'))throw Error('Article resizing did not use the shared preference');
      const tool=text=>[...reader.querySelectorAll('.analysis-toggles button')].find(b=>b.textContent===text);
      if(tool('Stockfish').getAttribute('aria-pressed')!=='false'||tool('Maia').getAttribute('aria-pressed')!=='false')throw Error('Article engines must start off');
      tool('Stockfish').click();tool('Maia').click();
      await waitArticle(()=>reader.querySelector('.stockfish-analysis .engine-status')?.textContent.includes('complete')&&reader.querySelector('.maia-analysis .engine-status')?.textContent.includes('complete'));
      await waitArticle(()=>reader.querySelector('.engine-line button')&&reader.querySelector('.maia-candidates button'));
      reader.querySelector('.engine-line button').click();
      await waitArticle(()=>reader.querySelector('.opening-article-board').dataset.fen.startsWith('4k3/8/8/8/4P3/8/8/4K3 b'));
      reader.querySelector('[aria-label="First position"]').click();
      await waitArticle(()=>reader.querySelector('.opening-article-board').dataset.fen.startsWith('4k3/8/8/8/8/8/4P3/4K3 w'));
      tool('Piece mode').focus();tool('Piece mode').click();
      await waitArticle(()=>reader.querySelector('.piece-mode[open] cg-board'));
      await waitArticle(()=>reader.querySelector('.stockfish-analysis .engine-status').textContent.includes('paused'));
      [...reader.querySelectorAll('.piece-mode button')].find(b=>b.textContent==='Return to review').click();
      await waitArticle(()=>!reader.querySelector('.piece-mode'));
      if(document.activeElement!==tool('Piece mode'))throw Error('Piece mode did not restore article toolbar focus');
      if(reader.querySelector('.opening-article-board cg-board')!==articleGround)throw Error('Analysis or Piece mode remounted the article board');
      tool('Stockfish').click();tool('Maia').click();
      reader.querySelector('.opening-fen-link').click();
      await waitArticle(()=>reader.querySelector('.opening-article-board').dataset.fen.startsWith('4k3/'));
      if(document.querySelector('[aria-label="Opening reading language"], [aria-label="Article reading language"]'))throw Error('Language selector remains');
      if(!reader.textContent.includes('English has no explanatory body. Showing German (GERMAN)'))throw Error('Language fallback is not visible');
      if(!reader.textContent.includes('Original synthetic prose explaining'))throw Error('Explanatory prose lost');
      if(reader.textContent.includes('(unavailable)')||reader.textContent.includes('Games for the article')||reader.textContent.includes('Related Products in the ChessBase Shop'))throw Error('Dead source navigation remains');
      if(!reader.textContent.includes('by Synthetic Writer'))throw Error('Author credit should remain as plain text');
      if(/Why this example|Same chapter|Same source chapter|Limit explorer|safe reading fallback/.test(reader.textContent)||reader.querySelector('.opening-provenance'))throw Error('Removed article clutter remains');
      if(!reader.textContent.includes('Synthetic Open · 2024.05.12 · B20')||!reader.textContent.includes('Annotated by Synthetic Author')||!reader.textContent.includes('1-0'))throw Error('Model game details missing');
      const card=reader.querySelector('.opening-game-card'), hit=card.querySelector('.opening-game-open');
      if(!reader.querySelector('.opening-reading-body').contains(card))throw Error('Model games must continue the article');
      const cb=card.getBoundingClientRect(),hb=hit.getBoundingClientRect();
      if(Math.abs(cb.width-hb.width)>2||Math.abs(cb.height-hb.height)>2)throw Error('Game card hit target does not cover the card');
      const board=reader.querySelector('.opening-article-board').getBoundingClientRect(),text=reader.querySelector('.opening-reading-body').getBoundingClientRect();
      if(board.right>text.left)throw Error('Shared review board must sit to the left of the article');
      window.readingBody=reader.querySelector('.opening-reading-body');readingBody.scrollTop=180;window.savedArticleScroll=readingBody.scrollTop;
      if(savedArticleScroll<100)throw Error('Fixture must exercise real article scrolling');
      window.sourceArticleLink=[...reader.querySelectorAll('.opening-prose-link')].find(b=>b.textContent==='Example');
      sourceArticleLink.focus({preventScroll:true});sourceArticleLink.click();
      await waitArticle(()=>document.querySelector('.opening-workspace > .review-shell .review-board')?.dataset.fen);
      if(!document.querySelector('.opening-workspace > .review-shell').textContent.includes('unvalidated'))throw Error('Raw numeric hint must not become an invented source ply');
      if(!document.querySelector('.opening-workspace > .review-shell .review-board').dataset.fen.startsWith('rnbqkbnr/pppppppp/'))throw Error('Unvalidated hint did not open source root');
      document.querySelector('.opening-workspace > .review-shell .review-header-actions button:last-child').click();
      await waitArticle(()=>articleVisible()&&Math.abs(readingBody.scrollTop-savedArticleScroll)<1);
      if(document.activeElement!==sourceArticleLink)throw Error('Returning did not restore article link focus');
      if(!reader.querySelector('.opening-article-board').dataset.fen.startsWith('4k3/'))throw Error('Returning from review reset the current article board');
      const model=articleVisible().querySelector('.opening-game-open');model.focus({preventScroll:true});model.click();
      await waitArticle(()=>document.querySelector('.opening-workspace > .review-shell .review-board')?.dataset.fen);
      if(!document.querySelector('.opening-workspace > .review-shell').textContent.includes('Synthetic White 1'))throw Error('Model card opened the wrong game');
      document.querySelector('.opening-workspace > .review-shell .review-header-actions button:last-child').click();
      await waitArticle(()=>articleVisible()&&Math.abs(readingBody.scrollTop-savedArticleScroll)<1);
      if(document.activeElement!==model)throw Error('Model card focus was not restored');
      if(document.querySelector('.opening-layout').getClientRects().length)throw Error('Article must have its own page without explorer board or continuations');
      if(document.querySelector('.opening-heading').getClientRects().length)throw Error('Explorer header remained on article page');
      const originalCounters=document.querySelector('.opening-counters').textContent;
      articleButton('Back to articles').click();
      const studyCard=()=>[...document.querySelectorAll('.opening-material-card')].find(c=>!c.closest('[hidden]')&&c.textContent.includes('Synthetic Sicilian plans'));
      await waitArticle(()=>!articleVisible()&&studyCard());
      window.studyAction=studyCard().querySelector('.opening-article-open');
      if(studyCard().textContent.includes('Study this article')||studyCard().textContent.includes('Read the explanation and explore its model games.'))throw Error('Redundant article actions remain');
      const area=studyAction.getBoundingClientRect(), bounds=studyCard().getBoundingClientRect();
      if(Math.abs(area.width-bounds.width)>2||Math.abs(area.height-bounds.height)>2)throw Error('Article hit target does not cover its card');
      if(document.elementFromPoint(bounds.right-8,bounds.bottom-8)!==studyAction)throw Error('Article card background is not clickable');
      studyAction.focus();studyAction.click();
      await waitArticle(()=>articleVisible()?.textContent.includes('Original synthetic prose explaining'));
      if(document.querySelector('.opening-layout').getClientRects().length)throw Error('Study action did not open dedicated page');
      if(document.querySelector('.opening-counters').textContent!==originalCounters)throw Error('Study action changed previous article selection');
      articleButton('Back to articles').click();
      await waitArticle(()=>!articleVisible()&&studyCard());
      if(document.activeElement!==studyAction)throw Error('Article selection focus not restored');
      studyAction.click();await waitArticle(()=>articleVisible());
      const ambiguous=articleVisible().querySelector('.opening-controlled-link details');ambiguous.open=true;
      ambiguous.querySelector('button:not(:disabled)').click();await waitArticle(()=>document.querySelector('.opening-workspace > .review-shell .review-board')?.dataset.fen);
      if(!document.querySelector('.opening-workspace > .review-shell').textContent.includes('Synthetic White 5'))throw Error('Ambiguous link guessed the wrong occurrence');
      document.querySelector('.opening-workspace > .review-shell .review-header-actions button:last-child').click();await waitArticle(()=>articleVisible());
      if(articleVisible().querySelector('.opening-controlled-link .opening-unavailable'))throw Error('Dead source link placeholder remains');
      if([...document.querySelectorAll('button')].some(b=>b.textContent==='Browse all article titles'))throw Error('Removed catalogue button remains');
      // Resume a hostile source article directly to preserve reader security coverage.
      await new Promise(resolve=>setTimeout(resolve,250));
      const saved=await openingStudy.settings(), catalog=(await openingStudy.status()).catalog;
      const unsafe=(await openingStudy.articleCatalog({revision:catalog.revision,query:'Unsafe'})).items[0];
      if(saved.session.explorer.readerKeys[0].startFen!==articleContextFen)throw Error('Article matching position was not saved');
      await openingStudy.settings({session:{...saved.session,explorer:{...saved.session.explorer,articleView:'reader',articleReturnView:'catalog',readerKeys:[{key:unsafe.key,id:1,startFen:articleContextFen}]}}});
      }catch(error){throw Error(error.stack);}
    })()`);
    window.reload(); await once(window.webContents, 'did-finish-load');
    await window.webContents.executeJavaScript(`(async()=>{
      const until=async p=>{const end=Date.now()+7000;while(!p()){if(Date.now()>end)throw Error('Article resume timeout');await new Promise(r=>setTimeout(r,20));}};
      await until(()=>document.querySelector('.opening-article-page:not([hidden]) .opening-article-diagram cg-board'));
      const safe=document.querySelector('.opening-article-reader');
      if(!safe.textContent.includes('Safe words')||!safe.textContent.includes('retained'))throw Error('Malformed source lost readable text');
      if(safe.querySelector('script,style,iframe,object,embed,img[src],[onclick],[onerror],[onload]'))throw Error('Source active HTML entered the app DOM');
      if(safe.querySelectorAll('.opening-article-diagram cg-board').length!==1)throw Error('Validated diagram did not render locally');
      if(/invalid or unsupported FEN|Source diagram unavailable/.test(safe.textContent))throw Error('Dead FEN placeholder remains');
      const board=safe.querySelector('.opening-article-board'),fen=safe.querySelector('.opening-fen-link');
      window.resumedArticleFen=board.dataset.fen;
      if(!resumedArticleFen.includes('/4P3/')||resumedArticleFen.startsWith('4k3/'))throw Error('Reload did not restore saved explorer position');
      fen.click();await until(()=>board.dataset.fen.startsWith('4k3/8/8/8/8/8/4P3/4K3 w'));
      safe.querySelector('.opening-diagram-select').click();await until(()=>board.dataset.fen.startsWith('rnbqkbnr/pppppppp/'));
      fen.click();await until(()=>board.dataset.fen.startsWith('4k3/8/8/8/8/8/4P3/4K3 w'));
    })()`);
    // Exercise real pointer input on the shared board after selecting a prose FEN.
    async function square(file, rank) {
      const point=await window.webContents.executeJavaScript(`(()=>{const b=document.querySelector('.opening-article-board cg-board').getBoundingClientRect();return{x:Math.round(b.left+(${file}+.5)*b.width/8),y:Math.round(b.top+(8-${rank}+.5)*b.height/8)};})()`);
      window.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...point});
      window.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...point});
      await new Promise(resolve=>setTimeout(resolve,80));
    }
    await square(4,2);await square(4,4);
    await window.webContents.executeJavaScript(`(async()=>{
      const until=async p=>{const end=Date.now()+7000;while(!p()){if(Date.now()>end)throw Error('Article board timeout');await new Promise(r=>setTimeout(r,20));}};
      const safe=document.querySelector('.opening-article-reader'),board=safe.querySelector('.opening-article-board');
      const action=text=>[...safe.querySelectorAll('.opening-article-board button')].find(b=>b.textContent===text);
      await until(()=>board.dataset.fen.startsWith('4k3/8/8/8/4P3/8/8/4K3 b'));
      safe.querySelector('[aria-label="Previous move"]').click();await until(()=>board.dataset.fen.startsWith('4k3/8/8/8/8/8/4P3/4K3 w'));
      safe.querySelector('[aria-label="Next move"]').click();await until(()=>board.dataset.fen.startsWith('4k3/8/8/8/4P3/8/8/4K3 b'));
      action('Reset position').click();await until(()=>board.dataset.fen.startsWith('4k3/8/8/8/8/8/4P3/4K3 w'));
      const piecesBefore=board.dataset.fen.split(' ')[0],ground=board.querySelector('cg-board');
      action('Switch side to move').click();await until(()=>board.dataset.fen.split(' ')[1]==='b');
      if(board.dataset.fen.split(' ')[0]!==piecesBefore||!board.textContent.includes('Black to move'))throw Error('Switching turns moved pieces or did not update the turn indicator');
      action('Switch side to move').click();await until(()=>board.dataset.fen.split(' ')[1]==='w');
      action('Start from beginning').click();await until(()=>board.dataset.fen==='rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
      if(board.querySelector('cg-board')!==ground)throw Error('Turn switch or standard reset remounted the shared board');
      safe.querySelector('[aria-label="Game review settings"]').click();await until(()=>safe.querySelector('.engine-setup[open]'));safe.querySelector('[aria-label="Flip board"]').click();[...safe.querySelectorAll('button')].find(b=>b.textContent==='Done').click();await until(()=>safe.querySelector('.opening-article-board .orientation-black'));
      if(action('Starting position'))throw Error('Redundant Starting position button remains');
    })()`);
    const resizeStart=await window.webContents.executeJavaScript(`(()=>{
      const reader=document.querySelector('.opening-article-reader'),handle=reader.querySelector('[data-board-resize]').getBoundingClientRect();
      return{x:Math.round(handle.left+handle.width/2),y:Math.round(handle.top+handle.height/2),width:reader.querySelector('cg-board').getBoundingClientRect().width};
    })()`);
    window.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,x:resizeStart.x,y:resizeStart.y});
    window.webContents.sendInputEvent({type:'mouseMove',button:'left',modifiers:['leftButtonDown'],x:resizeStart.x-80,y:resizeStart.y-80});
    window.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,x:resizeStart.x-80,y:resizeStart.y-80});
    const resized=await window.webContents.executeJavaScript(`(async()=>{
      await new Promise(r=>setTimeout(r,100));
      const reader=document.querySelector('.opening-article-reader'),board=reader.querySelector('.opening-article-board cg-board').getBoundingClientRect();
      return{width:board.width,height:board.height,footer:reader.querySelector('.review-board-footer').getBoundingClientRect().bottom,viewport:innerHeight};
    })()`);
    assert.ok(resized.width<resizeStart.width-50,'Article board shrinks when dragging the shared resize handle');
    assert.ok(Math.abs(resized.width-resized.height)<1&&resized.footer<=resized.viewport,'Resized article board remains square and controls fit');
    if(process.env.CHESS_ARTICLE_SCREENSHOT) writeFileSync(process.env.CHESS_ARTICLE_SCREENSHOT.replace(/\.png$/, '-wide.png'),(await window.webContents.capturePage()).toPNG());
    window.setMinimumSize(0,0);window.setSize(640,800);
    await window.webContents.executeJavaScript(`(async()=>{
      await new Promise(resolve=>setTimeout(resolve,100));
      const safe=document.querySelector('.opening-article-reader'),board=safe.querySelector('.opening-article-board').getBoundingClientRect(),body=safe.querySelector('.opening-reading-body').getBoundingClientRect();
      if(board.right>body.left||document.documentElement.scrollWidth>innerWidth)throw Error('Narrow shared review layout overlaps or overflows');
    })()`);
    if(process.env.CHESS_ARTICLE_SCREENSHOT) writeFileSync(process.env.CHESS_ARTICLE_SCREENSHOT,(await window.webContents.capturePage()).toPNG());
    await window.webContents.executeJavaScript(`(async()=>{
      const until=async p=>{const end=Date.now()+7000;while(!p()){if(Date.now()>end)throw Error('Article navigation timeout');await new Promise(r=>setTimeout(r,20));}};
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
  } catch (error) { console.error(error.stack || error); code = 1; }
  finally { clearTimeout(timeout); finishDesktopTest(app, code); }
}
void smoke();
