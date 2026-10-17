import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {initializeGames,upsertGame} from '../lib/game-writer.mjs';
import {ChessArchive} from '../electron/database.mjs';
import {frame,hash} from './fixtures/opening-archive.mjs';
test('game reads share predicates with contextual options and handle unsourced editions',()=>{
 const dir=mkdtempSync(join(tmpdir(),'games-read-')),path=join(dir,'games.db');
 try {
 const db=new Database(path);initializeGames(db);
 const pgn='1. e4 *',game={white:'École',pgn_zstd:frame(pgn),pgn_sha256:hash(pgn),annotators:['Doe, Jane','Other']};
 const id=upsertGame(db,game);
 upsertGame(db,{...game,year:2000,sources:[{source:{source_key:'s',title:'Site',kind:'website'},source_game_key:'one'},{source:{source_key:'b',title:'Book',kind:'book'},source_game_key:'two'}]});
 db.close();const archive=new ChessArchive(path);
 assert.equal(archive.searchGames().total,2);assert.equal(archive.getGame(id).source_title,'Unsourced game');
 assert.equal(archive.searchGames({search:'éCOLE'}).total,2);
 assert.equal(archive.searchGames({properties:{source:['missing']}}).total,1);
 assert.equal(archive.searchGames({properties:{sourceType:['book','website'],annotations:['no']}}).total,1);
 const options=archive.propertyOptions({property:'year',filters:{properties:{source:['missing'],year:['2000']}}});
 assert.equal(options.options.find(o=>o.id==='2000').count,0);
 assert.equal(options.options.find(o=>o.id==='missing').count,1);
 assert.equal(archive.openingFacets({properties:{source:['missing']}}).total,1);
 assert.throws(()=>archive.searchGames({properties:{white:['99999']}}),/Invalid/);
 assert.equal(archive.propertyOptions({property:'white',query:'éC'}).options.length,1);
 archive.close();
 }finally{rmSync(dir,{recursive:true,force:true});}
});
