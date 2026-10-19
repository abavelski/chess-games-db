import { emptyPersonal, validatePersonal } from '../src/personal.mjs';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
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
 hasFavouriteColumn(){return this.db.pragma('table_info(games)').some(column=>column.name==='favourite');}
 gameColumns(){return GAME_COLUMNS+','+(this.hasFavouriteColumn()?'g.favourite':'0')+' favourite';}
 setFavourite(value,favourite){
  const id=requiredId(value);
  if(typeof favourite!=='boolean')throw new Error('Invalid favourite value.');
  const writer=new Database(this.path,{fileMustExist:true});
  try {
   writer.transaction(()=>{
    if(!writer.prepare('SELECT 1 FROM games WHERE id=? AND hidden=0').get(id))throw new Error('Game is no longer available.');
    if(!writer.pragma('table_info(games)').some(column=>column.name==='favourite')) {
     writer.exec('ALTER TABLE games ADD COLUMN favourite INTEGER NOT NULL DEFAULT 0 CHECK(favourite IN (0,1))');
     writer.exec('CREATE INDEX games_favourite_idx ON games(id) WHERE favourite=1');
    }
    writer.prepare('UPDATE games SET favourite=? WHERE id=?').run(Number(favourite),id);
   })();
   this.optionCache.clear();
   return favourite;
  } finally {writer.close();}
 }
 hasPersonalTable(){return !!this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='game_personal_analysis'").get();}
 getPersonal(id){return this.hasPersonalTable()?JSON.parse(this.db.prepare('SELECT data_json FROM game_personal_analysis WHERE game_id=?').get(id)?.data_json || JSON.stringify(emptyPersonal())):emptyPersonal();}
 savePersonal(value,input){
  const id=requiredId(value),game=this.getGame(id);
  if(!game)throw new Error('Game is no longer available.');
  const personal=validatePersonal(input,game.pgn);
  const writer=new Database(this.path,{fileMustExist:true});
  try {
   writer.pragma('foreign_keys=ON');
   writer.transaction(()=>{
    if(!writer.prepare('SELECT 1 FROM games WHERE id=? AND hidden=0').get(id))throw new Error('Game is no longer available.');
    writer.exec(readFileSync(new URL('../db/migrations/008_personal_analysis.sql', import.meta.url), 'utf8'));
    if(!personal.lines.length&&!personal.comments.length)writer.prepare('DELETE FROM game_personal_analysis WHERE game_id=?').run(id);
    else writer.prepare('INSERT INTO game_personal_analysis(game_id,data_json) VALUES(?,?) ON CONFLICT(game_id) DO UPDATE SET data_json=excluded.data_json,updated_at=CURRENT_TIMESTAMP').run(id,JSON.stringify(personal));
   })();
   this.optionCache.clear();
   return personal;
  } finally {writer.close();}
 }
 close(){this.db.close();}
 catalog(){
  const sources=this.db.prepare('SELECT s.*,count(DISTINCT l.game_id) game_count FROM sources s LEFT JOIN game_sources l ON l.source_id=s.id GROUP BY s.id ORDER BY title,s.id').all();
  const games=this.db.prepare('SELECT count(*) n FROM games WHERE hidden=0').get().n;
  return {path:this.path,sources,capabilities:{openings:true,criticalPositions:true,studyMarkers:true},totals:{games}};
 }
 predicate(filters={}) {
  validateSelections(this.db,filters.properties);
  const q=gameQuery(filters,{favouriteColumn:this.hasFavouriteColumn(),personalTable:this.hasPersonalTable()}),revision=activeOpeningRevision(this.db,true);
  const selection=openingSelection(this.db,revision,filters.openingNodeId);
  if(selection.clause){q.where+=' AND '+selection.clause;Object.assign(q.params,selection.params);}
  return q;
 }
 searchGames(filters={}) {
  const q=this.predicate(filters);
  const total=this.db.prepare('SELECT count(*) n'+GAME_FROM+q.where).get(q.params).n;
  const rows=this.db.prepare(`SELECT ${this.gameColumns()}${GAME_FROM}${q.where} ORDER BY ${q.orderBy} LIMIT @limit OFFSET @offset`).all({...q.params,limit:q.pageSize,offset:q.offset});
  return {rows:openingLabels(this.db,activeOpeningRevision(this.db,true),rows),total,page:q.page,pageSize:q.pageSize};
 }
 openingFacets(filters){validateSelections(this.db,filters?.properties);return openingFacets(this.db,true,filters,{favouriteColumn:this.hasFavouriteColumn(),personalTable:this.hasPersonalTable()});}
 getGame(id){
  const row=this.db.prepare(`SELECT ${this.gameColumns()},g.headers_json,g.extras_json,g.pgn_sha256,g.pgn_zstd,g.created_at,g.updated_at,s.source_key${GAME_FROM} WHERE g.id=?`).get(requiredId(id));
  if(!row)return null;
  const {pgn_zstd,...metadata}=row;
  return openingLabels(this.db,activeOpeningRevision(this.db,true),[{...metadata,personal:this.getPersonal(row.id),pgn:decodePgn(row)}])[0];
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
   const table={source:'sources',sourceSection:'sources',players:'players',white:'players',black:'players',annotators:'annotators',event:'events',site:'sites'}[property];
   const groupedLabel=property==='source'?this.db.prepare("SELECT title label FROM sources WHERE json_extract(extras_json,'$.collection_key')=? ORDER BY id LIMIT 1").get(id)?.label:null;
   const label=cached?.label??groupedLabel??(table&&id!=='missing'?this.db.prepare(`SELECT ${['source','sourceSection'].includes(property)?'title':'display_name'} label FROM ${table} WHERE id=?`).get(id)?.label:id);
   options.push(cached??{id,label:label??id,count:0});
  }
  const contextual=q.where!==' WHERE g.hidden=0';
  if(contextual) {
   const dimensions={players:['game_players','player_id'],white:['game_players','player_id'],black:['game_players','player_id'],annotators:['game_annotators','annotator_id'],sourceSection:['game_sources','source_id']};
   const relation=dimensions[property];
   let expression,from=GAME_FROM,extra='',params={...q.params};
   if(relation) {
    const [table,column]=relation;
    expression='CAST(candidate.'+column+' AS TEXT)';
    // Candidate relation drives indexed primary-key lookups, avoiding one full scan per value.
    from=' FROM '+table+' candidate CROSS JOIN games g ON g.id=candidate.game_id'+GAME_FROM.slice(GAME_FROM.indexOf('\n LEFT JOIN'));
    params.candidates=JSON.stringify(options.filter(o=>o.id!=='missing').map(o=>Number(o.id)));
    extra=' AND candidate.'+column+' IN (SELECT value FROM json_each(@candidates))';
    if(property==='white'||property==='black')extra+=" AND candidate.role='"+property+"'";
   } else {
    const scalars={event:'g.event_id',site:'g.site_id',year:'g.year',result:'g.result_code',completeness:'g.completeness',eco:'g.eco'};
    if(scalars[property])expression="coalesce(CAST("+scalars[property]+" AS TEXT),'missing')";
    else if(property==='sourceType'||property==='source'){from=GAME_FROM+' JOIN game_sources candidate ON candidate.game_id=g.id JOIN sources cs ON cs.id=candidate.source_id';expression=property==='sourceType'?'cs.kind':"coalesce(json_extract(cs.extras_json,'$.collection_key'),CAST(cs.id AS TEXT))";}
    else {
     const facts={annotations:'f.annotated',medals:'f.medal_count>0',criticalPositions:'f.critical_position_count>0',studyMarkers:'(f.medal_count>0 OR f.critical_position_count>0)'};
     expression="CASE WHEN f.status='complete' THEN CASE WHEN "+facts[property]+" THEN 'yes' ELSE 'no' END ELSE 'unknown' END";
    }
    params.candidates=JSON.stringify(options.map(o=>o.id));extra=' AND ('+expression+') IN (SELECT value FROM json_each(@candidates))';
   }
   const counts=new Map(this.db.prepare('SELECT '+expression+' id,count(DISTINCT g.id) n'+from+q.where+extra+' GROUP BY '+expression).all(params).map(r=>[r.id,r.n]));
   for(const option of options)option.count=counts.get(option.id)??0;
   const missing=options.find(o=>o.id==='missing');
   if(missing && (relation||property==='sourceType'||property==='source'))missing.count=this.db.prepare('SELECT count(*) n'+GAME_FROM+q.where+' AND '+propertyClause(property,'option')).get({...q.params,option:'["missing"]'}).n;
  }
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
