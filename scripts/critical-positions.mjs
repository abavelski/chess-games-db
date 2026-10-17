import Database from 'better-sqlite3';
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePgn } from '../electron/database.mjs';
import { extractFeatures, FEATURE_VERSION } from '../lib/game-policy.mjs';
import { assertGames, writeFeatures } from '../lib/game-writer.mjs';

export function backfillCriticalPositions(path, { rebuild = false, progress = () => {} } = {}) {
 const db=new Database(path,{fileMustExist:true});
 try {
  assertGames(db);
  return db.transaction(()=>{
   const rows=db.prepare("SELECT g.* FROM games g LEFT JOIN game_features f ON f.game_id=g.id WHERE "+(rebuild?'1':"f.game_id IS NULL OR f.status!='complete' OR f.pgn_sha256!=g.pgn_sha256 OR f.extractor_version!=?")).all(...(rebuild?[]:[FEATURE_VERSION]));
   let marked=0,positions=0,medals=0,errors=0;
   for(const [i,row] of rows.entries()) {
    const facts=extractFeatures(decodePgn(row));writeFeatures(db,row.id,{...facts,pgn_sha256:row.pgn_sha256});
    if(facts.status==='error')errors++;
    if(facts.critical_position_count||facts.medal_count)marked++;
    positions+=facts.critical_position_count??0;medals+=facts.medal_count??0;
    if((i+1)%1000===0)progress(i+1);
   }
   return {processed:rows.length,marked,positions,medals,errors};
  }).immediate();
 } finally {db.close();}
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: { database: { type: 'string' }, rebuild: { type: 'boolean' } } });
    if (!values.database) throw new Error('Usage: npm run critical-positions -- --database <archive> [--rebuild]');
    console.log(JSON.stringify(backfillCriticalPositions(values.database, { rebuild: values.rebuild, progress: n => console.error(`Indexed ${n} games…`) }), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
