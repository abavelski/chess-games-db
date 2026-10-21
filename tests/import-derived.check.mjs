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
test('incremental opening refresh keeps the active revision and unaffected classifications byte-for-byte',async()=>{
 const {catalogueFiles}=await import('./fixtures/opening-archive.mjs'),{buildCatalogue,digest}=await import('../electron/openings.mjs');
 const dir=mkdtempSync(join(tmpdir(),'opening-import-')),path=join(dir,'test.db'),db=new Database(path);
 try{
  initializeGames(db);const a='1. e4 e5 *',b='1. d4 d5 *';
  const one=upsertGame(db,{eco:'Z99',pgn_zstd:frame(a),pgn_sha256:hash(a)}),two=upsertGame(db,{pgn_zstd:frame(b),pgn_sha256:hash(b)});
  const catalogue={catalogue:buildCatalogue(catalogueFiles),manifest:{commit:'a'.repeat(40)},checksum:digest(JSON.stringify(catalogueFiles))};
  await refreshDerived(db,path,{catalogue});const revision=db.prepare('SELECT revision_id FROM opening_state').get().revision_id,old=db.prepare('SELECT * FROM game_openings WHERE game_id=?').get(one);
  const next=b.replace('d5','d5 {new}');upsertGame(db,{id:two,pgn_zstd:frame(next),pgn_sha256:hash(next)});
  const result=await refreshDerived(db,path,{catalogue});assert.equal(result.openings.processed,1);assert.equal(db.prepare('SELECT revision_id FROM opening_state').get().revision_id,revision);assert.deepEqual(db.prepare('SELECT * FROM game_openings WHERE game_id=?').get(one),old);assert.equal(db.prepare('SELECT eco FROM games WHERE id=?').get(one).eco,'Z99');
 }finally{db.close();rmSync(dir,{recursive:true,force:true});}
});
