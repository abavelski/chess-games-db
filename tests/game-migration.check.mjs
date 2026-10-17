import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {mkdtempSync,rmSync,readFileSync,existsSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fixtureArchive} from './fixtures/opening-archive.mjs';
import {migrateGames} from '../scripts/migrate-games.mjs';
for(const version of [3,4,5,6]) test(`explicit migration v${version} preserves bytes and restarts safely`,async()=>{
 const dir=mkdtempSync(join(tmpdir(),'games-migration-')),input=join(dir,'old.db'),output=join(dir,'new.db');
 try {
  const db=fixtureArchive(input);
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
 try {const db=fixtureArchive(input);db.prepare("UPDATE games SET pgn_sha256=? WHERE id=1").run('a'.repeat(64));db.close();await assert.rejects(migrateGames({input,output}),/Corrupt/);assert.equal(existsSync(output),false);} finally {rmSync(dir,{recursive:true,force:true});}
});
