import { searchKey } from '../lib/game-policy.mjs';
export const PROPERTIES=Object.freeze(['source','sourceSection','sourceType','players','white','black','annotators','event','site','year','result','completeness','annotations','medals','criticalPositions','studyMarkers','eco']);
export const GAME_FROM=` FROM games g
 LEFT JOIN game_sources ps ON ps.game_id=g.id AND ps.is_primary=1
 LEFT JOIN sources s ON s.id=ps.source_id
 LEFT JOIN game_features f ON f.game_id=g.id AND f.pgn_sha256=g.pgn_sha256`;
const sorts={book:"coalesce(json_extract(s.extras_json,'$.collection_key'),s.source_key,'') COLLATE NOCASE,coalesce(json_extract(s.extras_json,'$.section_rank'),0),s.id,ps.sequence,g.id",newest:'g.id DESC',oldest:'g.id',year_desc:'g.year DESC,g.id DESC',year_asc:'g.year,g.id',white:'g.white COLLATE NOCASE,g.id',source:'s.title COLLATE NOCASE,g.id'};
const int=(value,min,max,fallback)=>{const n=Number(value);return Number.isSafeInteger(n)&&n>=min&&n<=max?n:fallback;};
export function propertyClause(property,parameter) {
 const values=`SELECT value FROM json_each(@${parameter})`;
 const missing=expr=>`(('missing' IN (${values}) AND ${expr}) OR `;
 if(['players','white','black'].includes(property)) {
  const role=property==='players'?'':` AND l.role='${property}'`;
  return missing(`NOT EXISTS(SELECT 1 FROM game_players l WHERE l.game_id=g.id${role})`)+`EXISTS(SELECT 1 FROM game_players l WHERE l.game_id=g.id${role} AND CAST(l.player_id AS TEXT) IN (${values})))`;
 }
 if(property==='annotators') return missing('NOT EXISTS(SELECT 1 FROM game_annotators l WHERE l.game_id=g.id)')+`EXISTS(SELECT 1 FROM game_annotators l WHERE l.game_id=g.id AND CAST(l.annotator_id AS TEXT) IN (${values})))`;
 if(property==='source' || property==='sourceSection' || property==='sourceType') return missing('NOT EXISTS(SELECT 1 FROM game_sources l WHERE l.game_id=g.id)')+`EXISTS(SELECT 1 FROM game_sources l JOIN sources d ON d.id=l.source_id WHERE l.game_id=g.id AND ${property==='source'?"coalesce(json_extract(d.extras_json,'$.collection_key'),CAST(l.source_id AS TEXT))":property==='sourceSection'?'CAST(l.source_id AS TEXT)':'d.kind'} IN (${values})))`;
 const scalar={event:'g.event_id',site:'g.site_id',year:'g.year',result:'g.result_code',completeness:'g.completeness',eco:'g.eco'};
 if(scalar[property]) return `coalesce(CAST(${scalar[property]} AS TEXT),'missing') IN (${values})`;
 const feature={annotations:'f.annotated',medals:'f.medal_count>0',criticalPositions:'f.critical_position_count>0',studyMarkers:'(f.medal_count>0 OR f.critical_position_count>0)'};
 if(feature[property]) return `(CASE WHEN f.status='complete' THEN CASE WHEN ${feature[property]} THEN 'yes' ELSE 'no' END ELSE 'unknown' END) IN (${values})`;
 throw new Error('Invalid property: '+property);
}
export function validateSelections(db,input={}) {
 if(!input || typeof input!=='object' || Array.isArray(input)) throw new Error('Invalid property selections');
 for(const [property,values] of Object.entries(input)) {
  if(!PROPERTIES.includes(property)) throw new Error('Invalid property: '+property);
  if(!Array.isArray(values)||values.length>100||values.some(v=>typeof v!=='string'||v.length>150)) throw new Error('Invalid or excessive selections');
  const table={source:'sources',sourceSection:'sources',players:'players',white:'players',black:'players',annotators:'annotators',event:'events',site:'sites'}[property];
  const domains={sourceType:['book','website','pgn_collection','manual','other','missing'],result:['white_win','black_win','draw','unfinished','unknown'],completeness:['complete','partial','unknown'],annotations:['yes','no','unknown'],medals:['yes','no','unknown'],criticalPositions:['yes','no','unknown'],studyMarkers:['yes','no','unknown']};
  for(const value of values) {
   let valid=value==='missing';
   if(property==='source' && value!=='missing' && !/^[1-9]\d*$/.test(value)) valid=!!db.prepare("SELECT 1 FROM sources WHERE json_extract(extras_json,'$.collection_key')=?").get(value);
   else if(table && value!=='missing') valid=/^[1-9]\d*$/.test(value)&&!!db.prepare(`SELECT 1 FROM ${table} WHERE id=?`).get(value);
   else if(domains[property]) valid=domains[property].includes(value);
   else if(property==='year') valid=value==='missing'||/^[1-9]\d{0,3}$/.test(value);
   else if(property==='eco') valid=value==='missing'||!!db.prepare("SELECT 1 FROM property_options WHERE property_key='eco' AND value_key=?").get(value);
   if(!valid) throw new Error(`Invalid ${property} value: ${value}`);
  }
 }
}
export function gameQuery(input={}, {favouriteColumn=true}={}) {
 const f=input??{},params={},where=['g.hidden=0'];
 if(f.favouritesOnly!==undefined&&typeof f.favouritesOnly!=='boolean')throw new Error('Invalid favourites filter');
 if(f.favouritesOnly)where.push(favouriteColumn?'g.favourite=1':'0');
 for(const [property,values] of Object.entries(f.properties??{})) {
  if(!PROPERTIES.includes(property)) throw new Error('Invalid property: '+property);
  if(!Array.isArray(values)||values.length>100) throw new Error('Invalid selection');
  if(values.length) {const key='p_'+property;where.push(propertyClause(property,key));params[key]=JSON.stringify([...new Set(values)].sort());}
 }
 for(const [key,operator] of [['yearFrom','>='],['yearTo','<=']]) if(f[key]!==undefined&&f[key]!=='') {
  const n=int(f[key],1,9999,null); if(n===null) throw new Error('Invalid year');where.push(`g.year${operator}@${key}`);params[key]=n;
 }
 if(typeof f.search==='string'&&f.search.trim()) {
  params.search=searchKey(f.search.trim().slice(0,200));
  where.push(`(instr(unicode_key(coalesce(g.white,'')||' '||coalesce(g.black,'')||' '||coalesce(g.event,'')||' '||coalesce(g.site,'')||' '||coalesce(g.annotator,'')),@search)>0 OR EXISTS(SELECT 1 FROM game_sources l JOIN sources d ON d.id=l.source_id WHERE l.game_id=g.id AND instr(unicode_key(d.title||' '||coalesce(d.author,'')||' '||l.source_game_key),@search)>0))`);
 }
 const page=int(f.page,1,100000,1),pageSize=int(f.pageSize,1,100,40);
 return {where:' WHERE '+where.join(' AND '),params,orderBy:sorts[f.sort]??sorts.book,page,pageSize,offset:(page-1)*pageSize};
}
