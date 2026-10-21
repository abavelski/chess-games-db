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
  writeFileSync(input,pgn+'\n[White "C"]\n\n1. d4 d5 *\n');
  r=await importGames({mode:'update',input,sourceKey:'s',target,unenriched:true},{failAfter:1});assert.equal(r.status,'failed');
  const backup=new Database(r.backup.path);assert.equal(backup.prepare('SELECT favourite FROM games').get().favourite,1);backup.close();assert.equal(writer.prepare('SELECT count(*) n FROM games').get().n,1);writer.close();
 }finally{rmSync(dir,{recursive:true,force:true});}
});
