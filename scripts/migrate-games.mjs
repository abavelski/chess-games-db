import Database from 'better-sqlite3';
import { mkdtempSync, rmSync, lstatSync, realpathSync, writeFileSync, statSync, linkSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { performance } from 'node:perf_hooks';
import { inventory, decodePgn, legacyGameKey, POLICY_VERSION } from '../lib/game-policy.mjs';
import { initializeGames, upsertGame, rebuildProperties } from '../lib/game-writer.mjs';
import { groupBooks, sequenceSql } from '../electron/books.mjs';
const exists = path => { try { lstatSync(path); return true; } catch(error) { if(error.code==='ENOENT') return false; throw error; } };
function copyRows(src,dst,table,where='',params=[]) {
 const columns=src.prepare(`PRAGMA table_info(${table})`).all().map(r=>r.name);
 const insert=dst.prepare(`INSERT INTO ${table}(${columns}) VALUES(${columns.map(()=>'?')})`);
 for(const row of src.prepare(`SELECT * FROM ${table} ${where}`).iterate(...params)) insert.run(...columns.map(c=>row[c]));
}
function copyOpenings(src,dst,version) {
 if(version<4) return {copied:0,discarded:0};
 const active=src.prepare("SELECT r.id FROM opening_state s JOIN opening_revisions r ON r.id=s.revision_id WHERE r.status='complete'").get()?.id;
 const total=src.prepare('SELECT count(*) n FROM game_openings').get().n;
 if(!active) return {copied:0,discarded:total};
 copyRows(src,dst,'opening_revisions','WHERE id=?',[active]);
 copyRows(src,dst,'opening_nodes','WHERE revision_id=?',[active]);
 copyRows(src,dst,'opening_entries','WHERE revision_id=?',[active]);
 const insert=dst.prepare('INSERT INTO game_openings VALUES(?,?,?,?,?,?,?)');
 let copied=0;
 for(const r of src.prepare('SELECT * FROM game_openings WHERE revision_id=?').iterate(active)) {
  const game=dst.prepare('SELECT pgn_sha256 FROM games WHERE id=?').get(r.game_id);
  if(!game || game.pgn_sha256!==r.pgn_sha256) continue;
  insert.run(r.revision_id,r.game_id,r.pgn_sha256,r.status,r.primary_entry_id,r.matched_ply,r.diagnostic); copied++;
 }
 const match=dst.prepare('INSERT INTO game_opening_matches VALUES(?,?,?,?)');
 for(const r of src.prepare('SELECT * FROM game_opening_matches WHERE revision_id=?').iterate(active)) {
  if(dst.prepare('SELECT 1 FROM game_openings WHERE revision_id=? AND game_id=?').get(active,r.game_id)) match.run(r.revision_id,r.game_id,r.entry_id,r.ply);
 }
 dst.prepare('INSERT INTO opening_state VALUES(1,?)').run(active);
 return {active,copied,discarded:total-copied};
}
export async function migrateGames({input,output,dryRun=false,report:reportPath,interruptAfter=Infinity}) {
 const started=performance.now(); input=realpathSync(input); output=resolve(output);
 if(exists(output)) throw new Error('Output already exists (including aliases/symlinks); choose a new path');
 if(join(realpathSync(dirname(output)),output.split(/[\\/]/).at(-1))===input) throw new Error('Input/output alias');
 if(reportPath && (exists(reportPath)||resolve(reportPath)===output||resolve(reportPath)===input)) throw new Error('Report must use a new separate path');
 const scratch=mkdtempSync(join(tmpdir(),'games-snapshot-'));
 const destination=join(dirname(output),`.games-${process.pid}-${Date.now()}.tmp`);
 let src,dst,source;
 const report={status:'failed',input,output,policy:POLICY_VERSION,targetVersion:7,inputBytes:statSync(input).size};
 try {
  source=new Database(input,{readonly:true,fileMustExist:true});
  await source.backup(join(scratch,'snapshot.sqlite3')); source.close(); source=null;
  src=new Database(join(scratch,'snapshot.sqlite3'),{readonly:true,fileMustExist:true});
  if(src.pragma('integrity_check',{simple:true})!=='ok' || src.pragma('foreign_key_check').length) throw new Error('Input integrity/foreign-key check failed');
  const knownTables=new Set(['sources','games','source_records','opening_revisions','opening_state','opening_nodes','opening_entries','game_openings','game_opening_matches']);
  const unknownTables=src.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().filter(t=>!knownTables.has(t.name));
  if(unknownTables.length)throw new Error('Unknown legacy extensions require explicit inventory and transfer before conversion: '+unknownTables.map(t=>t.name).join(', '));
  const personalColumns=src.pragma('table_info(games)').filter(c=>/favour|personal|notes/i.test(c.name));
  const personalTables=src.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().filter(t=>/personal|notes|study/i.test(t.name));
  if(personalColumns.length || personalTables.length) throw new Error('Legacy personal extensions require explicit inventory and transfer before conversion; this converter does not copy them');
  report.inventory=src.transaction(()=>inventory(src))();
  if(report.inventory.corrupt.length) throw new Error('Corrupt input PGN bytes/checksum; see inventory');
  if(dryRun) { report.status='dry-run'; return report; }
  dst=new Database(destination); initializeGames(dst);
  dst.transaction(()=>{
   dst.pragma('defer_foreign_keys=ON');
   dst.prepare('INSERT INTO migration_manifest VALUES(1,?)').run(JSON.stringify({...report,status:'building'}));
   const sections=new Map();
   for(const book of groupBooks(src.prepare('SELECT *,0 game_count FROM sources').all())) for(const [rank,section] of book.sections.entries()) sections.set(section.id,{...section,collection_key:book.id,rank});
   const sourceRead=src.prepare('SELECT * FROM sources WHERE id=?');
   const rawRead=src.prepare('SELECT metadata_json FROM source_records WHERE source_id=? AND source_record_key=?');
   let n=0;
   for(const row of src.prepare(`SELECT g.*,${sequenceSql('g','extras_json','source_game_key')} sequence FROM games g WHERE record_kind='game' ORDER BY id`).iterate()) {
    const sourceRow=sourceRead.get(row.source_id),section=sections.get(row.source_id);
    const raw=JSON.parse(rawRead.get(row.source_id,row.source_game_key)?.metadata_json??'{}');
    const extras=JSON.parse(row.extras_json??'{}');
    // Keep game provenance, discard text-reader payloads and raw extraction bytes.
    delete extras.chapterText; delete raw.chapterText;
    if(!extras.completeness && raw.completeness) extras.completeness=raw.completeness;
    Object.assign(extras,{legacy:{source_key:sourceRow.source_key,source_game_key:row.source_game_key,is_deleted:row.is_deleted,is_training:row.is_training,metadata:raw}});
    const sourceExtras={...JSON.parse(sourceRow.extras_json??'{}'),collection_key:section.collection_key,section_rank:section.rank};
    delete sourceExtras.chapterText;
    upsertGame(dst,{...row,game_key:legacyGameKey(sourceRow.source_key,row.source_game_key),hidden:row.is_deleted,
      extras_json:JSON.stringify(extras),sources:[{source:{...sourceRow,kind:'book',extras_json:JSON.stringify(sourceExtras)},source_game_key:row.source_game_key,is_primary:true,section:section.label,sequence:raw.recordId??raw.ordinal??row.sequence}]});
    if(++n>=interruptAfter) throw new Error('Injected interrupted conversion');
   }
   report.openings=copyOpenings(src,dst,report.inventory.version);
   report.propertyOptions=rebuildProperties(dst);
  })();
  const expected=src.prepare("SELECT id,pgn_zstd,pgn_sha256,headers_json,created_at,updated_at,source_id,source_game_key FROM games WHERE record_kind='game' ORDER BY id").all();
  const actual=dst.prepare('SELECT id,pgn_zstd,pgn_sha256,headers_json,created_at,updated_at FROM games ORDER BY id').all();
  if(expected.length!==actual.length) throw new Error('Retained ID coverage mismatch');
  for(const [i,a] of actual.entries()) {
   const e=expected[i];
   for(const k of ['id','pgn_sha256','headers_json','created_at','updated_at']) if(e[k]!==a[k]) throw new Error(`Game ${e.id}: ${k} mismatch`);
   if(!Buffer.from(e.pgn_zstd).equals(a.pgn_zstd)) throw new Error('Compressed bytes mismatch');
   decodePgn(a);
   if(!dst.prepare('SELECT 1 FROM game_sources WHERE game_id=? AND source_id=? AND source_game_key=?').get(e.id,e.source_id,e.source_game_key)) throw new Error('Source mapping mismatch');
  }
  const cache=()=>JSON.stringify(dst.prepare('SELECT * FROM property_options ORDER BY property_key,value_key').all());
  const before=cache(); rebuildProperties(dst); if(before!==cache()) throw new Error('Cache mismatch');
  if(dst.pragma('foreign_key_check').length || dst.pragma('integrity_check',{simple:true})!=='ok') throw new Error('Destination integrity failure');
  report.features=dst.prepare('SELECT status,count(*) n FROM game_features GROUP BY status').all();
  dst.exec('ANALYZE'); report.status='complete'; report.verifiedGames=actual.length;
  report.elapsedMs=performance.now()-started;
  dst.prepare('UPDATE migration_manifest SET manifest_json=?').run(JSON.stringify(report));
  dst.pragma('wal_checkpoint(TRUNCATE)'); dst.close(); dst=null;
  report.outputBytes=statSync(destination).size;
  // Hard-link publication is atomic and refuses replacement if another process creates output.
  linkSync(destination,output); unlinkSync(destination);
  return report;
 } catch(error) {report.error=error.message; throw Object.assign(error,{migrationReport:report});}
 finally {
  source?.close(); src?.close(); dst?.close();
  for(const path of [destination,destination+'-wal',destination+'-shm']) rmSync(path,{force:true});
  rmSync(scratch,{recursive:true,force:true});
  report.elapsedMs=performance.now()-started;
  if(reportPath) writeFileSync(reportPath,JSON.stringify(report,null,2),{flag:'wx'});
 }
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 try {
  const {values}=parseArgs({options:{input:{type:'string'},output:{type:'string'},'dry-run':{type:'boolean'},report:{type:'string'}}});
  if(!values.input||!values.output) throw new Error('Usage: npm run migrate:games -- --input OLD --output NEW [--dry-run] [--report LOCAL.json]');
  const report=await migrateGames({...values,dryRun:values['dry-run']});
  console.log(JSON.stringify(report,null,2));
  console.error(`${report.status}: ${report.inventory.retained} games retained; ${report.inventory.excluded.length} excluded; ${Math.round(report.elapsedMs)} ms`);
 } catch(error) {console.error(JSON.stringify(error.migrationReport??{error:error.message},null,2));process.exitCode=1;}
}
