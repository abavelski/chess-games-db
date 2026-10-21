import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,writeFileSync,readFileSync,rmSync,existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importGames } from '../scripts/import-games.mjs';
import { ChessArchive } from '../electron/database.mjs';
import Database from 'better-sqlite3';
const pgn='[White "A"]\n[Black "B"]\n\n1. e4 e5 (1... c5) *\n';
test('create, review, study, close, dry-run, update and reopen preserve study state',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'import-flow-')),input=join(dir,'input.pgn'),target=join(dir,'archive.db');
 try{
  writeFileSync(input,pgn);
  let r=await importGames({mode:'create',input,sourceKey:'pgn:test',output:target,unenriched:true});assert.equal(r.status,'completed',JSON.stringify(r));
  let app=new ChessArchive(target),id=app.db.prepare('SELECT id FROM games').get().id;app.setFavourite(id,true);app.savePersonal(id,{lines:[['e2e4','c7c5','g1f3']],comments:[{moves:[],text:'root'},{moves:['e2e4','c7c5'],text:'variation'}]});
  let blocked=await importGames({mode:'update',input,sourceKey:'pgn:test',target,unenriched:true});assert.equal(blocked.status,'failed');assert.match(blocked.error,/in use/);app.close();
  let db=new Database(target);const old=db.prepare('SELECT * FROM games').get(),personal=db.prepare('SELECT * FROM game_personal_analysis').get();db.close();
  const changed=pgn.replace('e5 (','e5 {new annotation} (');writeFileSync(input,changed);
  const reconcile=join(dir,'mapping.json');writeFileSync(reconcile,JSON.stringify({records:{'pgn:test':{'ordinal:000001':{key:'ordinal:000001',expectedSha256:old.pgn_sha256}}}}));
  const before=readFileSync(target);
  r=await importGames({mode:'update',input,sourceKey:'pgn:test',target,unenriched:true,dryRun:true,reconcile});assert.equal(r.status,'planned',JSON.stringify(r));assert.deepEqual(readFileSync(target),before);
  r=await importGames({mode:'update',input,sourceKey:'pgn:test',target,unenriched:true,reconcile});assert.equal(r.status,'completed',JSON.stringify(r));assert.equal(r.backup.verified,true);
  app=new ChessArchive(target);const updated=app.db.prepare('SELECT * FROM games').get();for(const key of ['id','game_key','created_at','favourite'])assert.equal(updated[key],old[key]);assert.deepEqual(app.db.prepare('SELECT * FROM game_personal_analysis').get(),personal);assert.match(app.getGame(id).pgn,/new annotation/);app.close();
  r=await importGames({mode:'update',input,sourceKey:'pgn:test',target,unenriched:true});assert.equal(r.status,'completed',JSON.stringify(r));assert.equal(r.sources[0].counts.noop,1);assert.equal(r.sources[0].applied,0);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('create conflicts never publish an output; per-source failures restore from verified WAL backup',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'import-failure-')),input=join(dir,'input.pgn'),target=join(dir,'archive.db');
 try{
  writeFileSync(input,pgn);let r=await importGames({mode:'create',input,sourceKey:'s',output:target,unenriched:true},{failAfter:1});assert.equal(r.status,'failed');assert.equal(existsSync(target),false);
  r=await importGames({mode:'create',input,sourceKey:'s',output:target,unenriched:true});assert.equal(r.status,'completed',JSON.stringify(r));
  const writer=new Database(target);writer.pragma('journal_mode=WAL');writer.pragma('wal_autocheckpoint=0');writer.exec('ALTER TABLE games ADD COLUMN favourite INTEGER DEFAULT 0');writer.prepare('UPDATE games SET favourite=1').run();
  writeFileSync(input,pgn+'[White "C"]\n\n1. d4 d5 *\n');
  r=await importGames({mode:'update',input,sourceKey:'s',target,unenriched:true},{failAfter:1});assert.equal(r.status,'failed');
  const backup=new Database(r.backup.path);assert.equal(backup.prepare('SELECT favourite FROM games').get().favourite,1);backup.close();assert.equal(writer.prepare('SELECT count(*) n FROM games').get().n,1);writer.close();
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('multi-book partial commits, durable registry recovery and resume are idempotent',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'import-books-')),root=join(dir,'books'),manifest=join(dir,'catalogue.json'),target=join(dir,'target.db');
 const {mkdirSync}=await import('node:fs');
 try{
  for(const b of ['A','B']){mkdirSync(join(root,b),{recursive:true});writeFileSync(join(root,b,'games.pgn'),pgn.replace('"A"',`"${b}"`));}
  let r=await importGames({mode:'create',booksRoot:root,manifest,output:target,unenriched:true});assert.equal(r.status,'completed',JSON.stringify(r));
  const registry=JSON.parse(readFileSync(manifest,'utf8')),a=registry.books[0].databases[0].source_key,b=registry.books[1].databases[0].source_key;
  const db=new Database(target);const oldHash=db.prepare('SELECT g.pgn_sha256 FROM games g JOIN game_sources l ON l.game_id=g.id JOIN sources s ON s.id=l.source_id WHERE s.source_key=?').get(b).pgn_sha256;db.close();
  writeFileSync(join(root,'A','games.pgn'),pgn+'[White "New"]\n\n1. d4 d5 *\n');writeFileSync(join(root,'B','games.pgn'),pgn.replace('"A"','"Changed"'));
  r=await importGames({mode:'update',booksRoot:root,manifest,target,unenriched:true});assert.equal(r.status,'partial',JSON.stringify(r));assert.equal(r.sources.find(s=>s.sourceKey===a).status,'committed');assert.equal(r.sources.find(s=>s.sourceKey===b).status,'conflict');
  const resume=r.runId,reconcile=join(dir,'reconcile.json');writeFileSync(reconcile,JSON.stringify({records:{[b]:{'ordinal:000001':{key:'ordinal:000001',expectedSha256:oldHash}}}}));
  // Simulate a lost manifest publication. Resume recovers from the target's run row.
  writeFileSync(manifest,JSON.stringify(registry));
  r=await importGames({mode:'update',booksRoot:root,manifest,target,unenriched:true,resume,reconcile});assert.equal(r.status,'completed',JSON.stringify(r));assert.equal(r.sources.find(s=>s.sourceKey===a).status,'resumed-complete');
  const result=new Database(target);assert.equal(result.prepare('SELECT count(*) n FROM games').get().n,3);result.close();
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('unknown triggers and legacy personal extensions fail before unsafe writes',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'import-extensions-')),input=join(dir,'games.pgn'),target=join(dir,'target.db');
 try{
  writeFileSync(input,pgn);let r=await importGames({mode:'create',input,sourceKey:'s',output:target,unenriched:true});assert.equal(r.status,'completed');
  const db=new Database(target);db.exec('CREATE TABLE custom_notes(content TEXT); INSERT INTO custom_notes VALUES (\'keep\')');db.close();
  r=await importGames({mode:'update',input,sourceKey:'s',target,unenriched:true});assert.equal(r.status,'completed',JSON.stringify(r));
  const modified=new Database(target);assert.equal(modified.prepare('SELECT content FROM custom_notes').get().content,'keep');modified.exec('CREATE TRIGGER unsafe AFTER UPDATE ON games BEGIN DELETE FROM game_personal_analysis; END');modified.close();const before=readFileSync(target);
  r=await importGames({mode:'update',input,sourceKey:'s',target,unenriched:true});assert.equal(r.status,'failed');assert.match(r.error,/Unknown\/modified trigger/);assert.deepEqual(readFileSync(target),before);assert.equal(r.backup,undefined);
  const {legacyFixtureArchive}=await import('./fixtures/opening-archive.mjs'),{migrateGames}=await import('../scripts/migrate-games.mjs');
  const legacy=join(dir,'legacy.db'),old=legacyFixtureArchive(legacy);old.exec('ALTER TABLE games ADD COLUMN favourite INTEGER DEFAULT 0');old.close();
  await assert.rejects(migrateGames({input:legacy,output:join(dir,'converted.db')}),/personal extensions|legacy extensions/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('cancelling a source worker leaves no partial game rows or orphaned relations',async()=>{
 const {applyInWorker}=await import('../lib/import/worker.mjs'),{prepareImportStorage}=await import('../lib/import/storage.mjs'),{initializeGames}=await import('../lib/game-writer.mjs'),{frame,hash}=await import('./fixtures/opening-archive.mjs');
 const dir=mkdtempSync(join(tmpdir(),'import-cancel-')),target=join(dir,'target.db'),stagePath=join(dir,'stage.db');
 try{
  const db=new Database(target);initializeGames(db);prepareImportStorage(db);
  const stage=new Database(stagePath);stage.exec('CREATE TABLE records(key TEXT PRIMARY KEY,sequence INTEGER,pgn_sha256 TEXT,pgn_zstd BLOB,metadata TEXT)');
  stage.transaction(()=>{for(let i=1;i<=2000;i++)stage.prepare('INSERT INTO records VALUES(?,?,?,?,?)').run(String(i),i,hash(pgn),frame(pgn),JSON.stringify({headers:{White:'A',Black:'B'}}));})();
  const {planSource}=await import('../lib/import/planning.mjs'),entry={sourceKey:'cancel',title:'Cancel',format:'.pgn',path:'/cancel.pgn',locator:'cancel.pgn'},extraction={profile:{policy:'test'},revision:{sha256:'test'}};
  planSource(db,stage,entry,extraction);stage.close();db.close();
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),150);
  try{await assert.rejects(applyInWorker(target,stagePath,entry,extraction,{runId:'cancelled'},controller.signal),/cancelled/);}finally{clearTimeout(timer);}
  const result=new Database(target);assert.equal(result.prepare('SELECT count(*) n FROM games').get().n,0);assert.equal(result.prepare('SELECT count(*) n FROM game_sources').get().n,0);assert.deepEqual(result.pragma('foreign_key_check'),[]);assert.equal(result.pragma('integrity_check',{simple:true}),'ok');result.close();
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('exclusive create and update refuse sidecars, symlinks and hardlink target aliases',async()=>{
 const {symlinkSync,linkSync}=await import('node:fs');
 const dir=mkdtempSync(join(tmpdir(),'import-aliases-')),input=join(dir,'games.pgn'),target=join(dir,'target.db');
 try{
  writeFileSync(input,pgn);writeFileSync(target+'-wal','orphan');
  await assert.rejects(importGames({mode:'create',input,sourceKey:'s',output:target,unenriched:true}),/existing output or sidecar/);rmSync(target+'-wal');
  symlinkSync(join(dir,'missing'),target);await assert.rejects(importGames({mode:'create',input,sourceKey:'s',output:target,unenriched:true}),/existing output/);rmSync(target);
  const r=await importGames({mode:'create',input,sourceKey:'s',output:target,unenriched:true});assert.equal(r.status,'completed');
  linkSync(target,join(dir,'hardlink'));await assert.rejects(importGames({mode:'update',input,sourceKey:'s',target,unenriched:true}),/aliases/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
