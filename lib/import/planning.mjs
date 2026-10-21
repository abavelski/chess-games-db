import { decodePgn } from '../game-policy.mjs';
import { hash } from './discovery.mjs';
import { fingerprint, hasTable } from './storage.mjs';
export function ownedSnapshot(db,id) {
 const g=db.prepare('SELECT * FROM games WHERE id=?').get(id);
 if(!g) return null;
 const personal=hasTable(db,'game_personal_analysis')?db.prepare('SELECT * FROM game_personal_analysis WHERE game_id=?').get(id)??null:null;
 const links=db.prepare('SELECT l.*,s.source_key,s.title,s.kind,s.original_file FROM game_sources l JOIN sources s ON s.id=l.source_id WHERE game_id=? ORDER BY l.id').all(id);
 const {pgn_zstd,...metadata}=g;
 return hash(JSON.stringify({metadata,personal,links}));
}
export function planSource(db,stage,entry,extraction,{acceptSourceUpdate=false,reconciliation={},aliases={},validateReplacement}={}) {
 stage.exec('CREATE TABLE plan(key TEXT PRIMARY KEY,resolved_key TEXT,action TEXT NOT NULL,game_id INTEGER,snapshot TEXT,diagnostic TEXT,candidates TEXT NOT NULL)');
 const previous=db.prepare('SELECT * FROM import_sources WHERE source_key=?').get(entry.sourceKey);
 const profileChanged=previous && previous.profile_json!==JSON.stringify(extraction.profile);
 const revisionChanged=previous && JSON.parse(previous.revision_json).sha256!==extraction.revision?.sha256;
 const source=db.prepare('SELECT * FROM sources WHERE source_key=?').get(entry.sourceKey);
 const first=stage.prepare('SELECT min(sequence) n FROM records').get().n;
 const counts={insert:0,noop:0,update:0,alias:0,conflict:0,duplicateCandidates:0};
 let last=0;
 for(;;) {
  const row=stage.prepare('SELECT * FROM records WHERE sequence>? ORDER BY sequence LIMIT 1').get(last);
  if(!row) break; last=row.sequence;
  const r=JSON.parse(row.metadata);let key=row.key,conflict=null;
  const mapping=reconciliation[row.key];
  const oldEvidence=db.prepare('SELECT * FROM import_records WHERE source_key=? AND local_key=?').get(entry.sourceKey,key);
  const oldMapping=db.prepare('SELECT g.* FROM games g JOIN game_sources l ON l.game_id=g.id JOIN sources s ON s.id=l.source_id WHERE s.source_key=? AND l.source_game_key=?');
  let old=oldMapping.get(entry.sourceKey,key);
  if(profileChanged && !acceptSourceUpdate) conflict='extraction-profile-change';
  if(mapping) {
   key=mapping.key;old=oldMapping.get(entry.sourceKey,key);
   if(!old || old.pgn_sha256!==mapping.expectedSha256) conflict='stale-reconciliation';
  } else if(old && old.pgn_sha256!==row.pgn_sha256) {
   conflict='changed-record-requires-reconciliation';
  } else if(!old) {
   const matches=db.prepare('SELECT local_key FROM import_records WHERE source_key=? AND pgn_sha256=? LIMIT 2').all(entry.sourceKey,row.pgn_sha256);
   if(matches.length) conflict='record-order-or-number-drift';
  }
  // For an imported historical source there may be no revision evidence yet.
  // Equal bytes are safe to adopt; changed bytes still require reconciliation.
  if(oldEvidence && oldEvidence.pgn_sha256!==row.pgn_sha256 && !mapping) conflict='changed-record-requires-reconciliation';
  if(stage.prepare('SELECT 1 FROM plan WHERE resolved_key=?').get(key)) conflict='contradictory-record-mapping';
  if(revisionChanged && !mapping) {
   const repeated=stage.prepare('SELECT count(*) n FROM records WHERE pgn_sha256=?').get(row.pgn_sha256).n>1 || db.prepare('SELECT count(*) n FROM import_records WHERE source_key=? AND pgn_sha256=?').get(entry.sourceKey,row.pgn_sha256).n>1;
   if(repeated) conflict='ambiguous-repeated-block-after-revision-change';
  }
  const alias=aliases[row.key];
  if(alias) {
   const target=db.prepare('SELECT * FROM games WHERE game_key=?').get(alias.gameKey);
   if(!target || target.pgn_sha256!==alias.expectedSha256 || target.pgn_sha256!==row.pgn_sha256 || (old && old.id!==target.id)) conflict='contradictory-or-different-edition-alias';
   else old=target;
  }
  const pgn=decodePgn(row);
  if(old && old.pgn_sha256!==row.pgn_sha256 && validateReplacement) {
   try {validateReplacement(db,old,pgn);} catch(error) {conflict='personal-analysis: '+error.message;}
  }
  const fp=fingerprint(pgn);
  const candidates=[];
  for(const candidate of db.prepare('SELECT id FROM games WHERE pgn_sha256=? AND id!=? ORDER BY id LIMIT 100').iterate(row.pgn_sha256,old?.id??-1)) candidates.push({id:candidate.id,reason:'exact-bytes'});
  if(fp.fingerprint) for(const candidate of db.prepare('SELECT f.game_id id FROM import_fingerprints f JOIN games g ON g.id=f.game_id AND g.pgn_sha256=f.pgn_sha256 WHERE f.version=? AND f.fingerprint=? AND f.canonical=? AND f.game_id!=? ORDER BY f.game_id LIMIT 100').iterate(fp.version,fp.fingerprint,fp.canonical,old?.id??-1)) {
   if(!candidates.some(c=>c.id===candidate.id)) candidates.push({id:candidate.id,reason:'likely-encounter'});
  }
  const action=conflict?'conflict':alias?'alias':old?'noop':'insert';
  const finalAction=action==='noop' && (old.pgn_sha256!==row.pgn_sha256 || old.white!==(r.headers.White??null) || old.black!==(r.headers.Black??null) || (row.sequence===first && source && ((entry.title!==undefined && source.title!==entry.title) || (entry.path!==undefined && source.original_file!==entry.path))))?'update':action;
  counts[finalAction]++; counts.duplicateCandidates+=candidates.length;
  stage.prepare('INSERT INTO plan VALUES(?,?,?,?,?,?,?)').run(row.key,key,finalAction,old?.id??null,old?ownedSnapshot(db,old.id):null,conflict,JSON.stringify(candidates));
 }
 return counts;
}
