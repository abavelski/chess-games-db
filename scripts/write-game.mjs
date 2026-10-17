import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { upsertGame, deleteGame, rebuildProperties } from '../lib/game-writer.mjs';
const [path,command,file]=process.argv.slice(2);
const db=new Database(path,{fileMustExist:true});
try {
  if(command==='rebuild-cache') console.log(rebuildProperties(db));
  else if(command==='delete') deleteGame(db,Number(file));
  else if(command==='upsert') { const input=JSON.parse(readFileSync(file,'utf8')); input.pgn_zstd=Buffer.from(input.pgn_zstd_base64,'base64'); console.log(upsertGame(db,input)); }
  else throw new Error('Usage: write-game.mjs DATABASE upsert JSON_FILE | delete ID | rebuild-cache');
} finally { db.close(); }
