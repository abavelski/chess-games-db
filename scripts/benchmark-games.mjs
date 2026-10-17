import Database from 'better-sqlite3';
import {performance} from 'node:perf_hooks';
import {copyFileSync,statSync,constants} from 'node:fs';
import {ChessArchive} from '../electron/database.mjs';
import {rebuildProperties} from '../lib/game-writer.mjs';
import {GAME_FROM,gameQuery} from '../electron/queries.mjs';
const [path,larger]=process.argv.slice(2);
if(!path)throw new Error('Usage: benchmark-games.mjs DATABASE [NEW_SYNTHETIC_DATABASE]');
if(larger){
 copyFileSync(path,larger,constants.COPYFILE_EXCL);
 const db=new Database(larger);db.pragma('foreign_keys=ON');
 const offset=db.prepare('SELECT max(id)+1 n FROM games').get().n;
 db.transaction(()=>{
  for(let scale=1;scale<4;scale++) {
   const shift=offset*scale;
   const columns=db.prepare('PRAGMA table_info(games)').all().map(r=>r.name);
   db.exec(`INSERT INTO games(${columns}) SELECT ${columns.map(c=>c==='id'?`id+${shift}`:c==='game_key'?`game_key||':synthetic:${scale}'`:c)} FROM games WHERE id<${offset}`);
   for(const table of ['game_players','game_annotators','game_features','game_openings','game_opening_matches']) {
    const fields=db.prepare(`PRAGMA table_info(${table})`).all().map(r=>r.name);
    db.exec(`INSERT INTO ${table}(${fields}) SELECT ${fields.map(c=>c==='game_id'?`game_id+${shift}`:c)} FROM ${table} WHERE game_id<${offset}`);
   }
   const fields=db.prepare('PRAGMA table_info(game_sources)').all().map(r=>r.name).filter(c=>c!=='id');
   db.exec(`INSERT INTO game_sources(${fields}) SELECT ${fields.map(c=>c==='game_id'?`game_id+${shift}`:c==='source_game_key'?`source_game_key||':synthetic:${scale}'`:c)} FROM game_sources WHERE game_id<${offset}`);
  }
  rebuildProperties(db);db.exec('ANALYZE');
 })();db.close();
}
for(const file of [path,...(larger?[larger]:[])]) {
 const archive=new ChessArchive(file);
 const scenarios={
  firstPage:()=>archive.searchGames({}),
  filteredPage:()=>archive.searchGames({properties:{completeness:['unknown'],result:['draw']}}),
  openingFacets:()=>archive.openingFacets({properties:{result:['draw']}}),
  dropdown:()=>archive.propertyOptions({property:'players',query:'ka',filters:{properties:{result:['draw']}}}),
  dropdownGlobal:()=>archive.propertyOptions({property:'players',query:'ka'}),
 };
 const timings={};
 for(const [name,fn] of Object.entries(scenarios)) {
  const start=performance.now();fn();const cold=performance.now()-start,values=[];
  for(let i=0;i<20;i++){archive.optionCache.clear();const s=performance.now();fn();values.push(performance.now()-s);}
  values.sort((a,b)=>a-b);timings[name]={coldMs:cold,p50:values[10],p95:values[19]};
 }
 const q=gameQuery({properties:{result:['draw']}});
 const plans=archive.db.prepare('EXPLAIN QUERY PLAN SELECT g.id'+GAME_FROM+q.where+' ORDER BY '+q.orderBy+' LIMIT 40').all(q.params);
 const sizes=archive.db.prepare('SELECT name,sum(pgsize) bytes FROM dbstat GROUP BY name ORDER BY bytes DESC LIMIT 12').all();
 console.log(JSON.stringify({games:archive.catalog().totals.games,bytes:statSync(file).size,timings,plans,sizes},null,2));archive.close();
}
