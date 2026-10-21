import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { completeness, decodePgn, extractFeatures, FEATURE_VERSION, resultCode, searchKey } from './game-policy.mjs';
export function initializeGames(db) {
  if (db.pragma('user_version', { simple: true }) !== 0 || db.prepare("SELECT 1 FROM sqlite_master WHERE type='table'").get()) throw new Error('Destination must be empty');
  db.pragma('foreign_keys = ON');
  db.transaction(() => {
    // 009_position_index.sql is opt-in via scripts/position-index.mjs only.
    for (const name of ['007_games.sql', '008_personal_analysis.sql']) db.exec(readFileSync(new URL('../db/migrations/' + name, import.meta.url), 'utf8'));
    db.pragma('user_version=7');
  })();
}
export function assertGames(db) {
  if (db.pragma('user_version', { simple: true }) !== 7) throw new Error('Schema 7 required; use npm run migrate:games -- --input OLD --output NEW');
  db.pragma('foreign_keys=ON');
}
const now = () => new Date().toISOString();
function dimension(db, table, value) {
  if (value == null || value === '' || value === '?') return null;
  db.prepare(`INSERT INTO ${table}(display_name,search_key) VALUES(?,?) ON CONFLICT(display_name) DO NOTHING`).run(value,searchKey(value));
  return db.prepare(`SELECT id FROM ${table} WHERE display_name=?`).get(value).id;
}
function contributions(db,id) { return db.prepare('SELECT * FROM game_property_values WHERE game_id=?').all(id); }
function adjust(db, rows, delta) {
  const insert = db.prepare(`INSERT INTO property_options(property_key,value_key,label,search_key,numeric_value,game_count) VALUES(?,?,?,?,?,1)
    ON CONFLICT(property_key,value_key) DO UPDATE SET game_count=game_count+1,label=excluded.label,search_key=excluded.search_key`);
  const remove = db.prepare('UPDATE property_options SET game_count=game_count-1 WHERE property_key=? AND value_key=?');
  for (const row of rows) {
    if (delta > 0) insert.run(row.property_key,row.value_key,row.label,searchKey(row.label),row.numeric_value);
    else remove.run(row.property_key,row.value_key);
  }
  db.prepare('DELETE FROM property_options WHERE game_count=0').run();
}
function revision(db) { db.prepare('UPDATE property_cache_state SET content_revision=content_revision+1,cache_revision=content_revision+1,built_at=?').run(now()); }
export function rebuildProperties(db) {
  assertGames(db);
  return db.transaction(() => {
    db.prepare('DELETE FROM property_options').run();
    const rows = db.prepare('SELECT property_key,value_key,label,numeric_value,count(*) n FROM game_property_values GROUP BY property_key,value_key').all();
    const insert = db.prepare('INSERT INTO property_options VALUES(?,?,?,?,?,?)');
    for (const r of rows) insert.run(r.property_key,r.value_key,r.label,searchKey(r.label),r.numeric_value,r.n);
    db.prepare('UPDATE property_cache_state SET cache_revision=content_revision,built_at=?').run(now());
    return rows.length;
  })();
}
export function writeFeatures(db,id,features) {
  assertGames(db);
  return db.transaction(() => {
    const game = db.prepare('SELECT pgn_sha256 FROM games WHERE id=?').get(id);
    if (!game) throw new Error('Unknown game');
    if (features.pgn_sha256 && features.pgn_sha256 !== game.pgn_sha256) throw new Error('Stale feature input hash');
    adjust(db,contributions(db,id),-1);
    db.prepare('DELETE FROM game_features WHERE game_id=?').run(id);
    const keys = ['critical_position_count','medal_count','comments','variations','nags','board_annotations','annotated'];
    db.prepare(`INSERT INTO game_features(game_id,pgn_sha256,extractor_version,status,${keys.join(',')},diagnostic) VALUES(${Array(12).fill('?')})`)
      .run(id,game.pgn_sha256,FEATURE_VERSION,features.status,...keys.map(k=>features[k]??null),features.diagnostic??null);
    adjust(db,contributions(db,id),1); revision(db);
  })();
}
export function upsertGame(db,input,{ derive = true } = {}) {
  assertGames(db);
  return db.transaction(() => {
    const links = input.sources ?? [];
    const linked = new Set();
    const sourceRows = links.map(link => {
      const source = link.source;
      if (!source?.source_key?.trim() || !link.source_game_key?.trim()) throw new Error('Stable source and source-local keys required');
      const old = db.prepare('SELECT * FROM sources WHERE source_key=?').get(source.source_key);
      if (!old) {
        const cols = ['source_key','title','kind','author','url','original_file','extras_json','created_at','updated_at'];
        if (source.id) cols.unshift('id');
        db.prepare(`INSERT INTO sources(${cols}) VALUES(${cols.map(()=>'?')})`).run(...cols.map(k => source[k] ?? (k==='kind'?'other':k.endsWith('_at')?now():null)));
      } else {
        const changed=['title','kind'].some(k=>source[k]!==undefined&&source[k]!==old[k]);
        const affected=changed?db.prepare('SELECT DISTINCT game_id FROM game_sources WHERE source_id=?').all(old.id):[];
        for(const r of affected)adjust(db,contributions(db,r.game_id),-1);
        // A renamed source keeps its identity; omitted fields retain their values.
        for (const key of ['title','author','url','original_file','extras_json','kind']) if (source[key] !== undefined) db.prepare(`UPDATE sources SET ${key}=?,updated_at=? WHERE id=?`).run(source[key],now(),old.id);
        for(const r of affected)adjust(db,contributions(db,r.game_id),1);
      }
      const source_id = old?.id ?? db.prepare('SELECT id FROM sources WHERE source_key=?').get(source.source_key).id;
      const mapped = db.prepare('SELECT game_id FROM game_sources WHERE source_id=? AND source_game_key=?').get(source_id,link.source_game_key);
      if (mapped) linked.add(mapped.game_id);
      return { ...link, source_id };
    });
    const byKey = input.game_key ? db.prepare('SELECT * FROM games WHERE game_key=?').get(input.game_key) : null;
    const byId = input.id ? db.prepare('SELECT * FROM games WHERE id=?').get(input.id) : null;
    if (byKey) linked.add(byKey.id);
    if (byId) linked.add(byId.id);
    if (linked.size > 1) throw new Error('Contradictory game/source mappings');
    const old = linked.size ? db.prepare('SELECT * FROM games WHERE id=?').get([...linked][0]) : null;
    if (old && input.game_key && old.game_key !== input.game_key) throw new Error('Cannot change durable game key');
    if (old && input.id && old.id !== input.id) throw new Error('Contradictory game ID');
    // Validate compressed bytes even when derived extraction is deferred.
    const data = { ...old,...input };
    const pgn = decodePgn(data);
    const extra = typeof data.extras_json === 'string' ? JSON.parse(data.extras_json) : {};
    const complete = completeness(extra);
    if (input.completeness && input.completeness !== 'unknown' && !input.completeness_evidence?.trim()) throw new Error('Completeness requires evidence');
    const values = {
      game_key: old?.game_key ?? input.game_key ?? randomUUID(),
      white: data.white??null,black:data.black??null,event:data.event??null,site:data.site??null,
      annotator: input.annotators ? input.annotators.map(a=>typeof a==='string'?a:a.credit).join('; ') : data.annotator??null,
      date:data.date??null,year:data.year??null,event_id:dimension(db,'events',data.event),site_id:dimension(db,'sites',data.site),
      result:data.result??null,result_code:resultCode(data.result),completeness:input.completeness??complete.value,
      completeness_evidence:input.completeness_evidence??complete.evidence,eco:data.eco??null,game_type:data.game_type??null,start_fen:data.start_fen??null,
      hidden:data.hidden??0,headers_json:data.headers_json??'{}',extras_json:data.extras_json??null,pgn_zstd:data.pgn_zstd,pgn_sha256:data.pgn_sha256,
      created_at:old?.created_at??input.created_at??now(),updated_at:input.updated_at??now(),
    };
    if (old) adjust(db,contributions(db,old.id),-1);
    const columns=Object.keys(values);
    let id=old?.id??input.id;
    if (old) db.prepare(`UPDATE games SET ${columns.map(k=>k+'=@'+k)} WHERE id=@id`).run({...values,id});
    else {
      if (id) values.id=id;
      const keys=Object.keys(values);
      id=Number(db.prepare(`INSERT INTO games(${keys}) VALUES(${keys.map(k=>'@'+k)})`).run(values).lastInsertRowid);
    }
    db.prepare('DELETE FROM game_players WHERE game_id=?').run(id);
    for (const role of ['white','black']) {
      const player=dimension(db,'players',values[role]);
      if (player) db.prepare('INSERT INTO game_players VALUES(?,?,?,?)').run(id,player,role,values[role]);
    }
    const credits=input.annotators??(old && input.annotator===undefined
      ? db.prepare('SELECT original_credit FROM game_annotators WHERE game_id=? ORDER BY credit_order').all(id).map(r=>r.original_credit)
      : values.annotator?[values.annotator]:[]);
    db.prepare('DELETE FROM game_annotators WHERE game_id=?').run(id);
    const seen=new Set();
    for (const [i,credit] of credits.entries()) {
      const original=typeof credit==='string'?credit:credit.credit;
      const a=dimension(db,'annotators',original);
      if (a && !seen.has(a)) { db.prepare('INSERT INTO game_annotators VALUES(?,?,?,?)').run(id,a,original,i); seen.add(a); }
    }
    if (sourceRows.some(l=>l.is_primary)) db.prepare('UPDATE game_sources SET is_primary=0 WHERE game_id=?').run(id);
    for (const link of sourceRows) db.prepare(`INSERT INTO game_sources(game_id,source_id,source_game_key,locator,url,section,sequence,is_primary) VALUES(?,?,?,?,?,?,?,?)
      ON CONFLICT(source_id,source_game_key) DO UPDATE SET locator=excluded.locator,url=excluded.url,section=excluded.section,sequence=excluded.sequence,is_primary=excluded.is_primary`)
      .run(id,link.source_id,link.source_game_key,link.locator??null,link.url??null,link.section??null,link.sequence??null,Number(!!link.is_primary));
    // Sourced games always have exactly one deterministic primary reference.
    if (!db.prepare('SELECT 1 FROM game_sources WHERE game_id=? AND is_primary=1').get(id)) db.prepare('UPDATE game_sources SET is_primary=1 WHERE id=(SELECT min(id) FROM game_sources WHERE game_id=?)').run(id);
    const changed=!old || old.pgn_sha256!==values.pgn_sha256;
    if (changed) {
      db.prepare('DELETE FROM game_openings WHERE game_id=?').run(id);
      db.prepare('DELETE FROM game_features WHERE game_id=?').run(id);
      db.prepare("INSERT INTO game_features(game_id,pgn_sha256,extractor_version,status) VALUES(?,?,?,'pending')").run(id,values.pgn_sha256,FEATURE_VERSION);
    }
    adjust(db,contributions(db,id),1); revision(db);
    if (derive && (changed || input.rebuildFeatures)) writeFeatures(db,id,extractFeatures(pgn));
    return id;
  }).immediate();
}
export function deleteGame(db,id) {
  assertGames(db);
  return db.transaction(() => { adjust(db,contributions(db,id),-1); db.prepare('DELETE FROM games WHERE id=?').run(id); revision(db); })();
}
