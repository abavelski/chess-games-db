import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {mkdtempSync,rmSync,readFileSync,existsSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {legacyFixtureArchive} from './fixtures/opening-archive.mjs';
import {migrateGames} from '../scripts/migrate-games.mjs';
for(const version of [3,4,5,6]) test(`explicit migration v${version} preserves bytes and restarts safely`,async()=>{
 const dir=mkdtempSync(join(tmpdir(),'games-migration-')),input=join(dir,'old.db'),output=join(dir,'new.db');
 try {
  const db=legacyFixtureArchive(input);
  if(version===3) for(const table of ['game_opening_matches','game_openings','opening_state','opening_entries','opening_nodes','opening_revisions']) db.exec('DROP TABLE '+table);
  for(const name of ['005_critical_positions','006_medals'].slice(0,Math.max(0,version-4))) db.exec(readFileSync(new URL('../db/migrations/'+name+'.sql',import.meta.url),'utf8'));
  db.pragma('user_version='+version);
  db.prepare("UPDATE games SET record_kind='position' WHERE id=3").run();
  db.close(); const before=readFileSync(input);
  assert.equal((await migrateGames({input,output,dryRun:true})).inventory.retained,3);
  assert.equal(existsSync(output),false);
  await assert.rejects(migrateGames({input,output,interruptAfter:1}),/interrupted/);
  assert.equal(existsSync(output),false);
  const report=await migrateGames({input,output}); assert.equal(report.verifiedGames,3);
  assert.deepEqual(readFileSync(input),before);
  const result=new Database(output); assert.equal(result.prepare("SELECT 1 FROM sqlite_master WHERE name='source_records'").get(),undefined); result.close();
  await assert.rejects(migrateGames({input,output}),/exists/);
  const alias=join(dir,'alias'); symlinkSync(input,alias); await assert.rejects(migrateGames({input,output:alias}),/exists/);
 } finally {rmSync(dir,{recursive:true,force:true});}
});
test('corruption fails without publishing an output',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'games-corrupt-')),input=join(dir,'old.db'),output=join(dir,'new.db');
 try {const db=legacyFixtureArchive(input);db.prepare("UPDATE games SET pgn_sha256=? WHERE id=1").run('a'.repeat(64));db.close();await assert.rejects(migrateGames({input,output}),/Corrupt/);assert.equal(existsSync(output),false);} finally {rmSync(dir,{recursive:true,force:true});}
});
test('WAL snapshot includes committed rows and collection identities remain distinct from sections',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'games-wal-')),input=join(dir,'old.db'),output=join(dir,'new.db');let db;
 try {
  db=legacyFixtureArchive(input);db.pragma('journal_mode=WAL');db.pragma('wal_autocheckpoint=0');
  db.prepare("UPDATE sources SET source_key='book:catalog:test:db-001'").run();
  db.prepare("INSERT INTO sources(id,source_key,title) VALUES(2,'book:catalog:test:db-002','Fixture book')").run();
  db.prepare('UPDATE games SET source_id=2 WHERE id=2').run();
  const before=readFileSync(input);
  const report=await migrateGames({input,output});assert.equal(report.verifiedGames,4);assert.deepEqual(readFileSync(input),before);
  const result=new Database(output);
  assert.equal(result.prepare("SELECT count(*) n FROM property_options WHERE property_key='source' AND value_key='book:catalog:test'").get().n,1);
  assert.equal(result.prepare("SELECT game_count n FROM property_options WHERE property_key='source' AND value_key='book:catalog:test'").get().n,4);
  assert.equal(result.prepare("SELECT count(*) n FROM property_options WHERE property_key='sourceSection'").get().n,2);
  result.close();
 } finally {db?.close();rmSync(dir,{recursive:true,force:true});}
});
test('malformed setup PGN is preserved with unknown features, not treated as byte corruption',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'games-malformed-')),input=join(dir,'old.db'),output=join(dir,'new.db');
 try {
  const db=legacyFixtureArchive(input,['[FEN "bad"]\n\n1. e4 *']);db.close();
  const report=await migrateGames({input,output});assert.equal(report.verifiedGames,1);assert.equal(report.inventory.parseErrors.length,1);
  const result=new Database(output);assert.equal(result.prepare('SELECT status FROM game_features').get().status,'error');assert.equal(result.prepare("SELECT game_count n FROM property_options WHERE property_key='medals' AND value_key='unknown'").get().n,1);result.close();
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('converter preserves the published taxonomy and removes staging, stale and excluded classifications',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'games-openings-')),input=join(dir,'old.db'),output=join(dir,'new.db');
 try {
  const db=legacyFixtureArchive(input);
  db.prepare("UPDATE games SET record_kind='position' WHERE id=3").run();
  for(const id of ['active','staging']) {
   db.prepare('INSERT INTO opening_revisions(id,upstream_commit,content_sha256,algorithm_version,status) VALUES(?,?,?,?,?)').run(id,'commit','checksum','algorithm',id==='active'?'complete':'staging');
   db.prepare('INSERT INTO opening_nodes VALUES(?,?,?,?,?)').run(id,'node','Name','["Name"]',null);
   db.prepare('INSERT INTO opening_entries VALUES(?,?,?,?,?,?,?,?)').run(id,'entry','node','A00','Name','1.e4','e2e4','position');
  }
  db.prepare("INSERT INTO opening_state VALUES(1,'active')").run();
  for(const [revision,id] of [['active',1],['active',2],['active',3],['staging',1]]) {
   const hash=id===2?'f'.repeat(64):db.prepare('SELECT pgn_sha256 hash FROM games WHERE id=?').get(id).hash;
   db.prepare('INSERT INTO game_openings VALUES(?,?,?,?,?,?,?)').run(revision,id,hash,'matched','entry',1,null);
   db.prepare('INSERT INTO game_opening_matches VALUES(?,?,?,?)').run(revision,id,'entry',1);
  }
  db.close();const report=await migrateGames({input,output});assert.equal(report.openings.copied,1);assert.equal(report.openings.discarded,3);
  const result=new Database(output);assert.deepEqual(result.prepare('SELECT id FROM opening_revisions').all(),[{id:'active'}]);assert.equal(result.prepare('SELECT game_id FROM game_openings').get().game_id,1);assert.equal(result.prepare('SELECT id FROM opening_nodes').get().id,'node');result.close();
 } finally {rmSync(dir,{recursive:true,force:true});}
});
