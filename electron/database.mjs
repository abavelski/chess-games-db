import Database from 'better-sqlite3';
import { resolve } from 'node:path';
import { decodePgn, searchKey } from '../lib/game-policy.mjs';
import { gameQuery, GAME_FROM, PROPERTIES, propertyClause, validateSelections } from './queries.mjs';
import { activeOpeningRevision, openingSelection, openingLabels, openingFacets } from './opening-read.mjs';

function requiredId(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Invalid record ID.');
  return id;
}

export { decodePgn } from '../lib/game-policy.mjs';

export class ChessArchive {
 constructor(path) {
  this.path=resolve(path);
  const db=new Database(this.path,{readonly:true,fileMustExist:true});
  try {
   const version=db.pragma('user_version',{simple:true});
   if(version!==7) throw new Error('This app supports database schema 7 (found '+version+'). Use npm run migrate:games -- --input OLD --output NEW for schemas 3–6.');
   db.pragma('foreign_keys=ON');db.function('unicode_key',{deterministic:true},searchKey);
   this.db=db; this.optionCache=new Map();
  } catch(error) {db.close();throw error;}
 }
 close(){this.db.close();}
 catalog(){
  const sources=this.db.prepare('SELECT s.*,count(DISTINCT l.game_id) game_count FROM sources s LEFT JOIN game_sources l ON l.source_id=s.id GROUP BY s.id ORDER BY title,s.id').all();
  const games=this.db.prepare('SELECT count(*) n FROM games WHERE hidden=0').get().n;
  return {path:this.path,sources,capabilities:{openings:true,criticalPositions:true,studyMarkers:true},totals:{games}};
 }
 predicate(filters={}) {
  validateSelections(this.db,filters.properties);
  const q=gameQuery(filters),revision=activeOpeningRevision(this.db,true);
  const selection=openingSelection(this.db,revision,filters.openingNodeId);
  if(selection.clause){q.where+=' AND '+selection.clause;Object.assign(q.params,selection.params);}
  return q;
 }
 searchGames(filters={}) {
  const q=this.predicate(filters);
  const total=this.db.prepare('SELECT count(*) n'+GAME_FROM+q.where).get(q.params).n;
  const rows=this.db.prepare(`SELECT ${GAME_COLUMNS}${GAME_FROM}${q.where} ORDER BY ${q.orderBy} LIMIT @limit OFFSET @offset`).all({...q.params,limit:q.pageSize,offset:q.offset});
  return {rows:openingLabels(this.db,activeOpeningRevision(this.db,true),rows),total,page:q.page,pageSize:q.pageSize};
 }
 openingFacets(filters){validateSelections(this.db,filters?.properties);return openingFacets(this.db,true,filters);}
 getGame(id){
  const row=this.db.prepare(`SELECT ${GAME_COLUMNS},g.headers_json,g.extras_json,g.pgn_sha256,g.pgn_zstd,g.created_at,g.updated_at,s.source_key${GAME_FROM} WHERE g.id=?`).get(requiredId(id));
  if(!row)return null;
  const {pgn_zstd,...metadata}=row;
  return openingLabels(this.db,activeOpeningRevision(this.db,true),[{...metadata,pgn:decodePgn(row)}])[0];
 }
 propertyOptions({property,query='',filters={},cursor=0,limit=30}={}) {
  if(!PROPERTIES.includes(property))throw new Error('Invalid property');
  if(typeof query!=='string'||query.length>150)throw new Error('Invalid option query');
  if(!Number.isSafeInteger(Number(cursor))||Number(cursor)<0||Number(cursor)>1000000)throw new Error('Invalid cursor');
  if(!Number.isInteger(limit)||limit<1||limit>50)throw new Error('Invalid option limit');
  validateSelections(this.db,filters.properties);
  const own=filters.properties?.[property]??[];
  const other={...filters,properties:{...filters.properties,[property]:[]}};
  const q=this.predicate(other);
  const key=JSON.stringify([this.db.prepare('SELECT content_revision FROM property_cache_state').get().content_revision,activeOpeningRevision(this.db,true),property,query,other,cursor,limit,own]);
  if(this.optionCache.has(key))return this.optionCache.get(key);
  const normalized=searchKey(query),upper=normalized+'\uffff';
  const options=this.db.prepare(`SELECT value_key id,label,game_count count FROM property_options WHERE property_key=? AND search_key>=? AND search_key<? ORDER BY search_key,value_key LIMIT ? OFFSET ?`).all(property,normalized,upper,limit+1,Number(cursor));
  const more=options.length>limit;options.length=Math.min(options.length,limit);
  for(const id of own) if(!options.some(o=>o.id===id)) {
   const cached=this.db.prepare('SELECT value_key id,label,game_count count FROM property_options WHERE property_key=? AND value_key=?').get(property,id);
   const table={source:'sources',players:'players',white:'players',black:'players',annotators:'annotators',event:'events',site:'sites'}[property];
   const label=cached?.label??(table&&id!=='missing'?this.db.prepare(`SELECT ${property==='source'?'title':'display_name'} label FROM ${table} WHERE id=?`).get(id)?.label:id);
   options.push(cached??{id,label:label??id,count:0});
  }
  const contextual=q.where!==' WHERE g.hidden=0';
  if(contextual) for(const option of options) option.count=this.db.prepare('SELECT count(*) n'+GAME_FROM+q.where+' AND '+propertyClause(property,'option')).get({...q.params,option:JSON.stringify([option.id])}).n;
  const result={options,cursor:more?String(Number(cursor)+limit):null};
  if(this.optionCache.size>=100)this.optionCache.clear();this.optionCache.set(key,result);return result;
 }
}
const GAME_COLUMNS=`g.id,g.game_key,g.white,g.black,g.event,g.site,g.date,g.year,g.result,g.result_code,g.completeness,g.eco,g.game_type,g.start_fen,g.annotator,
 ps.source_id,ps.source_game_key,coalesce(s.title,'Unsourced game') source_title,s.author source_author,
 CASE WHEN f.status='complete' THEN f.critical_position_count END critical_position_count,
 CASE WHEN f.status='complete' THEN f.medal_count END medal_count,
 CASE WHEN f.status='complete' THEN f.critical_position_count>0 END has_critical_positions,
 CASE WHEN f.status='complete' THEN f.medal_count>0 END has_medals,
 CASE WHEN f.status='complete' THEN f.critical_position_count>0 OR f.medal_count>0 END has_study_markers`;
