import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { initializeGames, upsertGame } from '../lib/game-writer.mjs';
import { prepareImportStorage } from '../lib/import/storage.mjs';
import { planSource } from '../lib/import/planning.mjs';
import { applySource, validateReplacement, assertImportCompatible } from '../lib/import/apply.mjs';
import { frame, hash } from './fixtures/opening-archive.mjs';
function fixture(){const db=new Database(':memory:');initializeGames(db);const pgn='1. e4 e5 (1... c5) *';const id=upsertGame(db,{pgn_zstd:frame(pgn),pgn_sha256:hash(pgn),sources:[{source:{source_key:'s',title:'S'},source_game_key:'1'}]});db.exec('ALTER TABLE games ADD COLUMN favourite INTEGER DEFAULT 0');db.prepare('UPDATE games SET favourite=1').run();db.prepare('INSERT INTO game_personal_analysis VALUES(?,?,?)').run(id,JSON.stringify({lines:[],comments:[{moves:['e2e4','c7c5'],text:'note'}]}),'original-time');prepareImportStorage(db);return {db,id,pgn};}
function stage(pgn){const s=new Database(':memory:');s.exec('CREATE TABLE records(key TEXT PRIMARY KEY,sequence INTEGER,pgn_sha256 TEXT,pgn_zstd BLOB,metadata TEXT)');s.prepare('INSERT INTO records VALUES(?,?,?,?,?)').run('1',1,hash(pgn),frame(pgn),JSON.stringify({headers:{}}));return s;}
const entry={sourceKey:'s',title:'S',format:'.pgn',path:'/fixture.pgn',locator:'fixture.pgn'},extraction={profile:{policy:'test'},revision:{sha256:'rev'}};
test('removed author branch conflicts; safe replacement preserves user data and durable identity',()=>{
 const {db,id,pgn}=fixture();assertImportCompatible(db);
 let s=stage('1. e4 e5 *');const options={reconciliation:{'1':{key:'1',expectedSha256:hash(pgn)}},validateReplacement};
 assert.equal(planSource(db,s,entry,extraction,options).conflict,1);s.close();
 s=stage('1. e4 {new} e5 (1... c5) *');assert.equal(planSource(db,s,entry,extraction,options).update,1);
 const old=db.prepare('SELECT * FROM games').get(),personal=db.prepare('SELECT * FROM game_personal_analysis').get();
 applySource(db,s,entry,extraction,{runId:'test'});
 const updated=db.prepare('SELECT * FROM games').get();for(const key of ['id','game_key','created_at','favourite'])assert.equal(updated[key],old[key]);
 assert.deepEqual(db.prepare('SELECT * FROM game_personal_analysis').get(),personal);s.close();db.close();
});
test('stale notes and injected failures roll back the whole source',()=>{
 const {db,pgn}=fixture();let s=stage('1. e4 {new} e5 (1... c5) *');
 const options={reconciliation:{'1':{key:'1',expectedSha256:hash(pgn)}},validateReplacement};
 planSource(db,s,entry,extraction,options);assert.throws(()=>applySource(db,s,entry,extraction,{runId:'failure',failAfter:1}),/Injected/);
 assert.equal(db.prepare('SELECT pgn_sha256 FROM games').get().pgn_sha256,hash(pgn));assert.equal(db.prepare('SELECT count(*) n FROM import_sources').get().n,0);
 db.prepare("UPDATE game_personal_analysis SET updated_at='newer'").run();assert.throws(()=>applySource(db,s,entry,extraction,{runId:'stale'}),/edited since planning/);s.close();db.close();
});
