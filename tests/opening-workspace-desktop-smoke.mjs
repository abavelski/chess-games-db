import { app, dialog } from 'electron';
import { once } from 'node:events';
import { join } from 'node:path';
import { writeFileSync, readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { desktopTestDirectory, finishDesktopTest } from './fixtures/desktop-test.mjs';
import { fixtureArchive } from './fixtures/opening-archive.mjs';
import { createOpeningSource } from './fixtures/opening-study-source.mjs';
import { initializeBuild } from '../scripts/build-opening-library.mjs';
import { publishOpeningLibrary } from '../lib/opening-publication.mjs';
import { fileHash } from '../lib/opening-library-storage.mjs';

const temporary = desktopTestDirectory(); app.setPath('userData', temporary);
const archivePath = join(temporary, 'games.sqlite');
const games = fixtureArchive(archivePath, ['1. e4 c5 *', '1. d4 d5 *']); games.close();
writeFileSync(join(temporary, 'archive.json'), JSON.stringify({ path: archivePath }));
writeFileSync(join(temporary, 'opening-library.json'), JSON.stringify({ path: join(temporary, 'missing.sqlite') }));
const args = { source: join(temporary, 'source.sqlite'), staging: join(temporary, 'staging.sqlite'),
  output: join(temporary, 'opening-ready.sqlite'), corpus: 'synthetic', progress: () => {} };
createOpeningSource(args.source); initializeBuild(args);
initializeBuild({ ...args, resume: true, phase: 'trees' }); initializeBuild({ ...args, resume: true, phase: 'articles' }); publishOpeningLibrary(args);
const hashes = [archivePath,args.source,args.output].map(fileHash);
let nextPath = args.source;
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [nextPath] });
const errors = [];
app.on('browser-window-created', (_event, window) => {
  window.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message); });
  window.webContents.on('preload-error', (_event, _path, error) => errors.push(error.message));
});
let stage = 'importing application';
const timeout = setTimeout(() => { console.error('Opening workspace desktop smoke timed out at', stage, errors); app.exit(1); }, 30000);
async function smoke() {
let code = 0;
try {
  const created = once(app, 'browser-window-created'); await import('../electron/main.mjs');
  stage = 'waiting for window';
  const [, window] = await created; stage = 'waiting for renderer load'; await once(window.webContents, 'did-finish-load');
  stage = 'opening workspace status and wrong source file';
  await window.webContents.executeJavaScript(`(async () => {
    window.waitOpeningWorkspace = async predicate => { const until=Date.now()+7000; while(!predicate()) { if(Date.now()>until)throw Error('Opening workspace UI did not update: '+predicate);await new Promise(r=>setTimeout(r,25)); } };
    await waitOpeningWorkspace(()=>document.querySelectorAll('.result-item').length===2);
    if ((await chessArchive.getCatalog()).path!==${JSON.stringify(archivePath)}) throw Error('Games archive missing');
    document.querySelector('[aria-label="Workspaces"] button:nth-child(2)').click();
    await waitOpeningWorkspace(()=>document.querySelector('.opening-empty')&&document.querySelector('.opening-workspace [role="alert"]'));
    document.querySelector('.opening-heading button').click();
    await waitOpeningWorkspace(()=>document.querySelector('.opening-workspace [role="alert"]')?.textContent.includes('supported opening runtime library'));
    if (await openingStudy.status().then(s=>s.catalog)) throw Error('Source v1 must not load as a ready library');
  })()`);
  nextPath = archivePath;
  stage = 'rejecting games archive';
  await window.webContents.executeJavaScript(`(async()=>{
    document.querySelector('.opening-heading button').click();
    await new Promise(r=>setTimeout(r,150));
    if ((await openingStudy.status()).catalog) throw Error('Games v7 must not load as opening library');
  })()`);
  nextPath = args.output;
  stage = 'loading ready opening library';
  await window.webContents.executeJavaScript(`(async()=>{
    document.querySelector('.opening-heading button').click();
    await waitOpeningWorkspace(()=>document.querySelector('.opening-library-info')?.textContent.includes('Library ready'));
    const selected=await openingStudy.status();if(selected.path!==${JSON.stringify(args.output)})throw Error('Wrong opening file');
    if ((await chessArchive.getCatalog()).path!==${JSON.stringify(archivePath)})throw Error('Opening picker replaced Games archive');
    document.querySelector('[aria-label="Workspaces"] button:first-child').click();
    await waitOpeningWorkspace(()=>!document.querySelector('.result-item')?.closest('[hidden]'));
    if(document.querySelectorAll('.result-item').length!==2)throw Error('Games results were not preserved');
    if(typeof openingStudy.executeSql!=='undefined'||typeof openingStudy.openPath!=='undefined'||typeof window.require!=='undefined')throw Error('Renderer has database/filesystem authority');
    document.querySelector('.result-item').click();
    await waitOpeningWorkspace(()=>document.querySelector('.review-shell [aria-label="Next move"]')&&!document.querySelector('.review-shell [aria-label="Next move"]').disabled);
    document.querySelector('.review-shell [aria-label="Next move"]').click();
    await waitOpeningWorkspace(()=>document.querySelector('.review-move[aria-current="step"]')?.textContent.includes('e4'));
    document.querySelector('[aria-label="Workspaces"] button:nth-child(2)').click();
  })()`);
  window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Right' });
  window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Right' });
  await window.webContents.executeJavaScript(`(async()=>{
    await new Promise(r=>setTimeout(r,80));
    if(!document.querySelector('.review-move[aria-current="step"]')?.textContent.includes('e4'))throw Error('Hidden Games review consumed opening-workspace keyboard input');
    document.querySelector('[aria-label="Workspaces"] button:first-child').click();
    await waitOpeningWorkspace(()=>!document.querySelector('.review-shell').closest('.workspace-pane').hidden);
    if(!document.querySelector('.review-move[aria-current="step"]')?.textContent.includes('e4'))throw Error('Games review route was not preserved');
  })()`);
  const preference = JSON.parse(readFileSync(join(temporary, 'opening-library.json'), 'utf8'));
  assert.equal(preference.path, args.output);
  assert.deepEqual([archivePath,args.source,args.output].map(fileHash), hashes);
  assert.deepEqual(errors, []);
  console.log('Opening workspace desktop smoke passed');
} catch (error) { console.error(error); code = 1; }
finally { clearTimeout(timeout); finishDesktopTest(app, code); }
}
void smoke();
