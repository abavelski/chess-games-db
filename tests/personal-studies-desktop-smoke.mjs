import { app } from 'electron';
import { once } from 'node:events';
import { join } from 'node:path';
import { existsSync, writeFileSync, readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { desktopTestDirectory, finishDesktopTest } from './fixtures/desktop-test.mjs';
import { fixtureArchive } from './fixtures/opening-archive.mjs';

const dir=desktopTestDirectory();app.setPath('userData',dir);
const archive=join(dir,'games.db'),db=fixtureArchive(archive,['1. e4 e5 *']);db.close();
writeFileSync(join(dir,'archive.json'),JSON.stringify({path:archive}));
const before=readFileSync(archive),studyPath=join(dir,'personal-studies.sqlite3');
const timeout=setTimeout(()=>{console.error('Personal studies desktop timeout');app.exit(1);},30000);
async function smoke() {
let code=0;
try {
 const created=once(app,'browser-window-created');await import('../electron/main.mjs');const [,win]=await created;await once(win.webContents,'did-finish-load');
 assert.equal(existsSync(studyPath),false);
 await win.webContents.executeJavaScript(`(async()=>{
  window.studyWait=async fn=>{const end=Date.now()+6000;while(!fn()){if(Date.now()>end)throw Error('Study UI timeout: '+fn);await new Promise(r=>setTimeout(r,25));}};
  await studyWait(()=>document.querySelector('.result-item'));
  document.querySelector('.result-item').click();await studyWait(()=>document.querySelector('[aria-label="Next move"]'));
  document.querySelector('[aria-label="Next move"]').click();await studyWait(()=>document.querySelector('.review-move[aria-current="step"]'));
  window.studyGamePath=document.querySelector('.review-move[aria-current="step"]').dataset.reviewPath;
  document.querySelector('[aria-label="Workspaces"] button:nth-child(3)').click();
  await studyWait(()=>document.querySelector('.personal-studies-workspace')?.textContent.includes('personal-studies.sqlite3'));
  if(!document.querySelector('.review-shell').closest('[hidden]'))throw Error('Games was not suspended');
  if(typeof personalStudies.sql!=='undefined'||typeof personalStudies.openPath!=='undefined')throw Error('Unrestricted study authority');
  document.querySelector('[aria-label="Workspaces"] button:first-child').click();
  await studyWait(()=>!document.querySelector('.review-shell').closest('[hidden]'));
  if(document.querySelector('.review-move[aria-current="step"]').dataset.reviewPath!==studyGamePath)throw Error('Games move was lost');
  document.querySelector('[aria-label="Workspaces"] button:nth-child(2)').click();await studyWait(()=>document.querySelector('.opening-workspace'));
  document.querySelector('[aria-label="Workspaces"] button:nth-child(3)').click();
  await studyWait(()=>!document.querySelector('.personal-studies-workspace').closest('[hidden]'));
  if((await openingStudy.settings()).workspace!=='openings')throw Error('Studies replaced games/openings preference');
 })()`);
 assert.equal(existsSync(studyPath),true);assert.deepEqual(readFileSync(archive),before);
 console.log('Personal studies desktop passed: lazy storage, three workspaces, preserved Games move and preference.');
}catch(error){console.error(error);code=1;}finally{clearTimeout(timeout);finishDesktopTest(app,code);}
}
void smoke();
