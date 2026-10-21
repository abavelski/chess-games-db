import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initializeGames,upsertGame } from '../lib/game-writer.mjs';
import { frame,hash } from './fixtures/opening-archive.mjs';
import { refreshDerived,verifyArchive } from '../lib/import/derived.mjs';
test('unchanged position rows survive and changed hashes become unsearchable until explicit resume',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'derived-'));const path=join(dir,'test.db');const db=new Database(path);
 try {
  initializeGames(db);const first='1. e4 e5 *',second='1. d4 d5 *';
  const id=upsertGame(db,{pgn_zstd:frame(first),pgn_sha256:hash(first)});
  await refreshDerived(db,path,{positions:'all'});
  const rows=db.prepare('SELECT * FROM game_position_occurrences').all();
  upsertGame(db,{id,event:'Metadata only'});await refreshDerived(db,path,{positions:'resume'});
  assert.deepEqual(db.prepare('SELECT * FROM game_position_occurrences').all(),rows);
  upsertGame(db,{id,pgn_zstd:frame(second),pgn_sha256:hash(second)});
  assert.equal(db.prepare('SELECT count(*) n FROM searchable_game_position_occurrences').get().n,0);
  await refreshDerived(db,path,{positions:'resume'});assert.equal(db.prepare('SELECT scope FROM game_position_index_state').get().scope,'all');
  assert.equal(verifyArchive(db).verifiedGames,1);db.prepare('UPDATE property_options SET game_count=99').run();assert.throws(()=>verifyArchive(db),/cache differs/);
 } finally {db.close();rmSync(dir,{recursive:true,force:true});}
});
