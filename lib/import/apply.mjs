import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';
import { PgnParser, startingPosition } from 'chessops/pgn';
import { makeFen } from 'chessops/fen';
import { validatePersonal } from '../../src/personal.mjs';
import { assertGames, initializeGames, upsertGame } from '../game-writer.mjs';
import { decodePgn } from '../game-policy.mjs';
import { IMPORT_SCHEMA, hasTable, saveFingerprint } from './storage.mjs';
import { ownedSnapshot } from './planning.mjs';

export function assertImportCompatible(db) {
 assertGames(db);
 const known=new Database(':memory:');
 try {
  initializeGames(known);known.exec(readFileSync(new URL('../../db/migrations/009_position_index.sql',import.meta.url),'utf8'));
  known.exec('ALTER TABLE games ADD COLUMN favourite INTEGER NOT NULL DEFAULT 0 CHECK(favourite IN (0,1)); CREATE INDEX games_favourite_idx ON games(id) WHERE favourite=1;'+IMPORT_SCHEMA);
  const objects=new Map(known.prepare("SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'").all().map(o=>[o.name,o]));
  for(const o of db.prepare("SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'").all()) {
   if(o.type==='trigger' && (!objects.has(o.name) || o.sql.replace(/\s+/g,' ').trim()!==objects.get(o.name).sql.replace(/\s+/g,' ').trim())) throw new Error('Unknown/modified trigger prevents safe import: '+o.name);
   if(o.type==='table' && objects.has(o.name)) {
    const columns=known.prepare(`PRAGMA table_info("${o.name}")`).all().map(c=>c.name);
    const actual=db.prepare(`PRAGMA table_info("${o.name}")`).all().map(c=>c.name);
    for(const c of actual) if(!columns.includes(c)) throw new Error('Unknown column prevents safe import: '+o.name+'.'+c);
    for(const c of columns) if(!(o.name==='games' && c==='favourite') && !actual.includes(c))throw new Error('Missing required column prevents safe import: '+o.name+'.'+c);
   }
  }
 } finally {known.close();}
}
function root(pgn) {
 let fen;new PgnParser((game,error)=>{if(error) throw error;fen??=makeFen(startingPosition(game.headers).unwrap().toSetup());}).parse(pgn);
 if(!fen) throw new Error('Missing starting position');return fen;
}
export function validateReplacement(db,old,pgn) {
 const personal=hasTable(db,'game_personal_analysis')?db.prepare('SELECT * FROM game_personal_analysis WHERE game_id=?').get(old.id):null;
 if(!personal) return;
 const value=JSON.parse(personal.data_json);
 if(root(decodePgn(old))!==root(pgn)) throw new Error('Personal analysis requires explicit root-position reconciliation');
 validatePersonal(value,pgn);
}
export function producerInput(row,entry,extraction,key) {
 const metadata=JSON.parse(row.metadata),h=metadata.headers;
 if(!h || typeof h!=='object' || Object.values(h).some(v=>typeof v!=='string')) throw new Error('Invalid producer headers');
 const input={pgn_zstd:row.pgn_zstd,pgn_sha256:row.pgn_sha256,headers_json:JSON.stringify(h)};
 for(const [field,header] of Object.entries({white:'White',black:'Black',event:'Event',site:'Site',annotator:'Annotator',date:'Date',result:'Result',eco:'ECO',start_fen:'FEN'})) input[field]=h[header]??null;
 const year=Number((h.Date??'').slice(0,4));input.year=Number.isInteger(year)&&year>=1&&year<=9999?year:null;
 input.extras_json=JSON.stringify({importPolicy:extraction.profile.policy,sourceDeleted:metadata.sourceDeleted??false,trainingMagnitude:metadata.trainingMagnitude??0});
 const source={source_key:entry.sourceKey,title:entry.title,kind:entry.sourceKey.startsWith('book:')?'book':entry.format==='.pgn'?'pgn_collection':'book',original_file:entry.path};
 const collection=/^(book:catalog:.+):db-\d+$/.exec(entry.sourceKey);
 if(collection)source.extras_json=JSON.stringify({collection_key:collection[1]});
 input.sources=[{source,source_game_key:key,sequence:metadata.recordId??row.sequence,section:entry.locator,locator:entry.locator}];
 return input;
}
function userOwned(db) {
 const digest=createHash('sha256');
 if(db.pragma('table_info(games)').some(c=>c.name==='favourite')) for(const row of db.prepare('SELECT id,favourite FROM games WHERE favourite!=0 ORDER BY id').iterate()) digest.update(JSON.stringify(row));
 if(hasTable(db,'game_personal_analysis')) for(const row of db.prepare('SELECT * FROM game_personal_analysis ORDER BY game_id').iterate()) digest.update(JSON.stringify(row));
 return digest.digest('hex');
}
export function applySource(db,stage,entry,extraction,{runId,signal,failAfter,registryJson=null}={}) {
 if(stage.prepare("SELECT 1 FROM plan WHERE action='conflict'").get()) throw new Error('Source has unresolved conflicts');
 return db.transaction(()=>{
  const before=userOwned(db);let applied=0;
  // Plan and validate the complete source before any game changes.
  let last=0;
  for(;;) {
   const row=stage.prepare('SELECT r.*,p.action,p.game_id,p.snapshot,p.resolved_key FROM records r JOIN plan p USING(key) WHERE sequence>? ORDER BY sequence LIMIT 1').get(last);
   if(!row) break;last=row.sequence;
   if(signal?.aborted) throw new Error('Import cancelled');
   if(row.game_id) {
    if(ownedSnapshot(db,row.game_id)!==row.snapshot) throw new Error('Target edited since planning: '+row.key);
    const old=db.prepare('SELECT * FROM games WHERE id=?').get(row.game_id);
    if(old.pgn_sha256!==row.pgn_sha256) validateReplacement(db,old,decodePgn(row));
   } else if(db.prepare('SELECT 1 FROM game_sources l JOIN sources s ON s.id=l.source_id WHERE s.source_key=? AND l.source_game_key=?').get(entry.sourceKey,row.resolved_key)) throw new Error('New mapping appeared since planning');
  }
  last=0;
  for(;;) {
   const row=stage.prepare('SELECT r.*,p.action,p.game_id,p.resolved_key FROM records r JOIN plan p USING(key) WHERE sequence>? ORDER BY sequence LIMIT 1').get(last);
   if(!row) break;last=row.sequence;
   if(signal?.aborted) throw new Error('Import cancelled');
   if(row.action!=='noop') {
    const input=producerInput(row,entry,extraction,row.resolved_key);
    if(input.sources[0].source.extras_json) {
     const existing=db.prepare('SELECT extras_json FROM sources WHERE source_key=?').get(entry.sourceKey);
     input.sources[0].source.extras_json=JSON.stringify({...JSON.parse(existing?.extras_json??'{}'),...JSON.parse(input.sources[0].source.extras_json)});
    }
    if(row.game_id) input.game_key=db.prepare('SELECT game_key FROM games WHERE id=?').get(row.game_id).game_key;
    const id=upsertGame(db,input);
    saveFingerprint(db,id,row.pgn_sha256,decodePgn(row));
    db.prepare('INSERT OR IGNORE INTO import_run_games VALUES(?,?)').run(runId,id);applied++;
    if(failAfter && applied>=failAfter) throw new Error('Injected source failure');
   }
   db.prepare('INSERT INTO import_record_keys VALUES(?,?,?,?) ON CONFLICT(source_key,input_key,revision) DO UPDATE SET local_key=excluded.local_key').run(entry.sourceKey,row.key,extraction.revision.sha256,row.resolved_key);
   db.prepare('INSERT INTO import_records VALUES(?,?,?,?) ON CONFLICT(source_key,local_key) DO UPDATE SET pgn_sha256=excluded.pgn_sha256,revision=excluded.revision').run(entry.sourceKey,row.resolved_key,row.pgn_sha256,extraction.revision.sha256);
  }
  db.prepare('INSERT INTO import_sources VALUES(?,?,?,?) ON CONFLICT(source_key) DO UPDATE SET profile_json=excluded.profile_json,revision_json=excluded.revision_json,run_id=excluded.run_id').run(entry.sourceKey,JSON.stringify(extraction.profile),JSON.stringify(extraction.revision),runId);
  db.prepare('INSERT INTO import_runs(id,status,report_json,registry_json) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET report_json=excluded.report_json,registry_json=excluded.registry_json').run(runId,'applying',JSON.stringify({lastCommittedSource:entry.sourceKey}),registryJson);
  if(userOwned(db)!==before) throw new Error('User-owned data changed during import');
  return {applied};
 }).immediate();
}
