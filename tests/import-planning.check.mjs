import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { initializeGames, upsertGame } from '../lib/game-writer.mjs';
import { prepareImportStorage, fingerprint } from '../lib/import/storage.mjs';
import { frame, hash } from './fixtures/opening-archive.mjs';
import { planSource } from '../lib/import/planning.mjs';
function stage(pgn,key='1') {const s=new Database(':memory:');s.exec('CREATE TABLE records(key TEXT PRIMARY KEY,sequence INTEGER,pgn_sha256 TEXT,pgn_zstd BLOB,metadata TEXT)');s.prepare('INSERT INTO records VALUES(?,?,?,?,?)').run(key,1,hash(pgn),frame(pgn),JSON.stringify({headers:{White:'A',Black:'B'}}));return s;}
test('migrated identity wins over producer key; annotations remain separate editions',()=>{
 const db=new Database(':memory:');initializeGames(db);const pgn='1. e4 {one} e5 *';
 const id=upsertGame(db,{game_key:'legacy:stable',white:'A',black:'B',pgn_zstd:frame(pgn),pgn_sha256:hash(pgn),sources:[{source:{source_key:'s',title:'S'},source_game_key:'1'}]});prepareImportStorage(db);
 let s=stage(pgn);assert.equal(planSource(db,s,{sourceKey:'s'},{profile:{}}).noop,1);assert.equal(s.prepare('SELECT game_id FROM plan').get().game_id,id);s.close();
 s=stage('1. e4 {two} e5 *');assert.equal(planSource(db,s,{sourceKey:'other'},{profile:{}}).insert,1);assert.equal(JSON.parse(s.prepare('SELECT candidates FROM plan').get().candidates)[0].reason,'likely-encounter');s.close();
 s=stage('1. d4 d5 *');assert.equal(planSource(db,s,{sourceKey:'s'},{profile:{}}).conflict,1);s.close();
 assert.equal(fingerprint('1. invalid *').fingerprint,null);db.close();
});
test('reviewed inserted/renumbered keys persist for idempotent reruns of the same revision',async()=>{
 const {applySource}=await import('../lib/import/apply.mjs');
 const db=new Database(':memory:');initializeGames(db);prepareImportStorage(db);
 const pgn='1. e4 e5 *',e={sourceKey:'s',title:'S',format:'.pgn',path:'/source',locator:'source'},x={profile:{},revision:{sha256:'one'}};
 let s=stage(pgn);planSource(db,s,e,x);applySource(db,s,e,x,{runId:'first'});s.close();
 const old=db.prepare('SELECT pgn_sha256 FROM games').get().pgn_sha256;
 s=stage('1. d4 d5 *');const y={...x,revision:{sha256:'two'}};
 const mapping={'1':{insert:true,key:'reviewed:new',expectedRevisionSha256:'one'}};
 assert.equal(planSource(db,s,e,y,{reconciliation:mapping}).insert,1);applySource(db,s,e,y,{runId:'inserted'});s.close();
 s=stage('1. d4 d5 *');assert.equal(planSource(db,s,e,y).noop,1);assert.equal(s.prepare('SELECT resolved_key FROM plan').get().resolved_key,'reviewed:new');s.close();
 assert.equal(db.prepare('SELECT count(*) n FROM games').get().n,2);assert.equal(db.prepare('SELECT pgn_sha256 FROM games WHERE id=1').get().pgn_sha256,old);db.close();
});
test('CB record IDs resolve historical cb:record keys as well as MegaBase numeric keys',()=>{
 const db=new Database(':memory:');initializeGames(db);const pgn='1. e4 e5 *';
 const id=upsertGame(db,{game_key:'legacy:cb-record',white:'A',black:'B',pgn_zstd:frame(pgn),pgn_sha256:hash(pgn),sources:[{source:{source_key:'book',title:'Book'},source_game_key:'cb:record:1'}]});prepareImportStorage(db);
 const s=stage(pgn);s.prepare('UPDATE records SET metadata=?').run(JSON.stringify({headers:{White:'A',Black:'B'},recordId:1}));
 assert.equal(planSource(db,s,{sourceKey:'book',format:'.cbh'},{profile:{}}).noop,1);const plan=s.prepare('SELECT * FROM plan').get();assert.equal(plan.game_id,id);assert.equal(plan.resolved_key,'cb:record:1');s.close();db.close();
});
test('reviewed reordering changes source sequence while preserving durable game rows',async()=>{
 const {applySource}=await import('../lib/import/apply.mjs'),db=new Database(':memory:');initializeGames(db);prepareImportStorage(db);
 const e={sourceKey:'s',title:'S',format:'.pgn',path:'/source',locator:'source'},x={profile:{},revision:{sha256:'first'}};
 let s=stage('1. e4 e5 *','1');planSource(db,s,e,x);applySource(db,s,e,x,{runId:'first'});s.close();
 const old=db.prepare('SELECT * FROM games').get();s=stage('1. e4 e5 *','2');s.prepare('UPDATE records SET sequence=2').run();
 const next={...x,revision:{sha256:'next'}};
 assert.equal(planSource(db,s,e,next,{reconciliation:{'2':{key:'1',expectedSha256:old.pgn_sha256}}}).update,1);applySource(db,s,e,next,{runId:'next'});
 assert.equal(db.prepare('SELECT sequence FROM game_sources').get().sequence,2);assert.equal(db.prepare('SELECT game_key FROM games').get().game_key,old.game_key);s.close();db.close();
});
