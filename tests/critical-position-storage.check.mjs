import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fixtureArchive,frame,hash} from './fixtures/opening-archive.mjs';
import {ChessArchive} from '../electron/database.mjs';
import {upsertGame} from '../lib/game-writer.mjs';
import {backfillCriticalPositions} from '../scripts/critical-positions.mjs';
test('feature backfill handles unknown/error states and rolls back corrupt bytes',()=>{
 const dir=mkdtempSync(join(tmpdir(),'features-')),path=join(dir,'games.db');let archive;
 const db=fixtureArchive(path,['1.e4 {[%crit opening]} (1.d4 {[%crit middlegame]}) e5 *','1.d4 {[%medal tactics,attack,sacrifice]} d5 *','1.e4 e5 2.Ke5 *']);
 try{
 archive=new ChessArchive(path);
 assert.equal(archive.searchGames({properties:{studyMarkers:['yes']}}).total,2);
 assert.equal(archive.searchGames({properties:{studyMarkers:['unknown']}}).total,1);
 assert.equal(archive.getGame(1).critical_position_count,2);
 assert.equal(archive.getGame(2).medal_count,3);
 const pgn='1.d4 d5 *';upsertGame(db,{id:2,pgn_zstd:frame(pgn),pgn_sha256:hash(pgn)},{derive:false});
 assert.equal(archive.getGame(2).medal_count,null);
 assert.equal(backfillCriticalPositions(path).processed,2);
 assert.equal(archive.getGame(2).medal_count,0);
 const old=db.prepare('SELECT * FROM game_features').all();
 db.prepare('UPDATE games SET pgn_sha256=? WHERE id=2').run('a'.repeat(64));
 assert.throws(()=>backfillCriticalPositions(path,{rebuild:true}),/SHA-256/);
 assert.deepEqual(db.prepare('SELECT * FROM game_features').all(),old);
 }finally{archive?.close();db.close();rmSync(dir,{recursive:true,force:true});}
});
