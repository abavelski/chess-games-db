import {desktopTestDirectory,finishDesktopTest} from './fixtures/desktop-test.mjs';
import {app,dialog} from 'electron';
import {once} from 'node:events';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {writeFileSync} from 'node:fs';
import Database from 'better-sqlite3';
import {initializeGames} from '../lib/game-writer.mjs';
import {importGames} from '../scripts/import-games.mjs';
import {hash} from '../lib/import/discovery.mjs';
const temporary=desktopTestDirectory();app.setPath('userData',temporary);
const input=join(temporary,'source.pgn'),target=join(temporary,'imported.db'),other=join(temporary,'closed-target.db');
const original='[White "Imported"]\n[Black "Opponent"]\n\n1. e4 {Author root move} e5 (1... c5) *\n';
writeFileSync(input,original);
async function smoke(){
 let code=0;const timer=setTimeout(()=>app.exit(1),45000);
 try{
  const createdArchive=await importGames({mode:'create',input,sourceKey:'desktop:import',output:target,unenriched:true,positions:'all'});assert.equal(createdArchive.status,'completed',JSON.stringify(createdArchive));
  const empty=new Database(other);initializeGames(empty);empty.close();writeFileSync(join(temporary,'archive.json'),JSON.stringify({path:target}));
  const created=once(app,'browser-window-created');await import('../electron/main.mjs');const [,window]=await created;await once(window.webContents,'did-finish-load');
  const run=body=>window.webContents.executeJavaScript(`(async()=>{${body}})()`);
  const waitUi=`const wait=async predicate=>{const until=Date.now()+7000;while(!predicate()){if(Date.now()>until)throw new Error('Import UI timed out: '+predicate);await new Promise(r=>setTimeout(r,20));}};`;
  const id=await run(`${waitUi}
   await wait(()=>document.querySelector('.game-result-row .favourite-button') && document.querySelector('.game-results')?.getAttribute('aria-busy')==='false');
   document.querySelector('.game-result-row .favourite-button').click();
   await wait(()=>document.querySelector('.game-result-row .favourite-button')?.getAttribute('aria-pressed')==='true');
   document.querySelector('.result-item').click();await wait(()=>document.querySelector('.review-board cg-board'));
   const list=await chessArchive.searchGames({});const id=list.rows[0].id;
   await chessArchive.savePersonal(id,{lines:[['e2e4','c7c5','g1f3']],comments:[{moves:[],text:'Saved root'},{moves:['e2e4','c7c5'],text:'Saved variation'}]});return id;
  `);
  dialog.showOpenDialog=async()=>({canceled:false,filePaths:[other]});await run('await chessArchive.openDatabase();');
  writeFileSync(input,original.replace('Author root move','Updated author comment'));
  const reconcile=join(temporary,'reconcile.json');writeFileSync(reconcile,JSON.stringify({records:{'desktop:import':{'ordinal:000001':{key:'ordinal:000001',expectedSha256:hash(original)}}}}));
  const updated=await importGames({mode:'update',input,sourceKey:'desktop:import',target,unenriched:true,positions:'resume',reconcile});assert.equal(updated.status,'completed',JSON.stringify(updated));
  dialog.showOpenDialog=async()=>({canceled:false,filePaths:[target]});await run('await chessArchive.openDatabase();');
  const loaded=once(window.webContents,'did-finish-load');window.webContents.reload();await loaded;
  await run(`${waitUi}
   await wait(()=>document.querySelector('.result-item'));document.querySelector('.result-item').click();await wait(()=>document.querySelector('.review-board cg-board'));
   const game=await chessArchive.getGame(${id});
   if(!game.favourite || !game.pgn.includes('Updated author comment'))throw new Error('Updated review lost source content or favourite');
   if(game.personal.comments.length!==2 || game.personal.lines.length!==1)throw new Error('Updated review lost personal content');
  `);
  console.log('Unified import desktop passed: create, review, favourite, root/variation notes, close target, update, reopen and review.');
 }catch(error){console.error(error);code=1;}finally{clearTimeout(timer);finishDesktopTest(app,code);}
}
smoke();
