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
