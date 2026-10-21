import { decodePgn } from '../game-policy.mjs';
import { extractMainlinePositions } from '../position-mainline.mjs';
import { hash } from './discovery.mjs';
export const FINGERPRINT_VERSION='root-mainline-1';
export const IMPORT_SCHEMA=`
CREATE TABLE IF NOT EXISTS import_sources(source_key TEXT PRIMARY KEY,profile_json TEXT NOT NULL,revision_json TEXT NOT NULL,run_id TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS import_record_keys(source_key TEXT NOT NULL,input_key TEXT NOT NULL,revision TEXT NOT NULL,local_key TEXT NOT NULL,PRIMARY KEY(source_key,input_key,revision));
CREATE TABLE IF NOT EXISTS import_records(source_key TEXT NOT NULL,local_key TEXT NOT NULL,pgn_sha256 TEXT NOT NULL,revision TEXT NOT NULL,PRIMARY KEY(source_key,local_key));
CREATE INDEX IF NOT EXISTS import_records_hash ON import_records(source_key,pgn_sha256,local_key);
CREATE TABLE IF NOT EXISTS import_fingerprints(game_id INTEGER PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE,pgn_sha256 TEXT NOT NULL,version TEXT NOT NULL,fingerprint TEXT,canonical TEXT);
CREATE INDEX IF NOT EXISTS import_fingerprints_hash ON import_fingerprints(version,fingerprint);
CREATE TABLE IF NOT EXISTS import_run_games(run_id TEXT NOT NULL,game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,PRIMARY KEY(run_id,game_id));
CREATE TABLE IF NOT EXISTS import_runs(id TEXT PRIMARY KEY,status TEXT NOT NULL,report_json TEXT NOT NULL,registry_json TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TRIGGER IF NOT EXISTS import_fingerprints_invalidate AFTER UPDATE OF pgn_sha256 ON games WHEN old.pgn_sha256!=new.pgn_sha256 BEGIN DELETE FROM import_fingerprints WHERE game_id=new.id; END;
`;
export const hasTable=(db,name)=>!!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
export function fingerprint(pgn) {
 const result=extractMainlinePositions(pgn);
 if(result.status!=='complete' || result.occurrences.length<2) return {version:FINGERPRINT_VERSION,fingerprint:null,canonical:null};
 const canonical=JSON.stringify([FINGERPRINT_VERSION,result.occurrences[0].verificationKey,result.occurrences.at(-1).path]);
 return {version:FINGERPRINT_VERSION,fingerprint:hash(canonical),canonical};
}
export function saveFingerprint(db,id,sha,pgn) {
 const fp=fingerprint(pgn);
 db.prepare('INSERT INTO import_fingerprints VALUES(?,?,?,?,?) ON CONFLICT(game_id) DO UPDATE SET pgn_sha256=excluded.pgn_sha256,version=excluded.version,fingerprint=excluded.fingerprint,canonical=excluded.canonical').run(id,sha,fp.version,fp.fingerprint,fp.canonical);
}
export function prepareImportStorage(db) {
 db.exec(IMPORT_SCHEMA);
 // Checksum-indexed backfill once, then only missing/stale games. NULL canonical
 // records invalid scores too, so failed parsers are not retried every import.
 let last=0;
 const pending=db.prepare('SELECT g.id,g.pgn_zstd,g.pgn_sha256 FROM games g LEFT JOIN import_fingerprints f ON f.game_id=g.id WHERE g.id>? AND (f.game_id IS NULL OR f.pgn_sha256!=g.pgn_sha256 OR f.version!=?) ORDER BY g.id LIMIT 50');
 for (;;) {
  const rows=pending.all(last,FINGERPRINT_VERSION);if(!rows.length) break;
  db.transaction(()=>{for(const row of rows) saveFingerprint(db,row.id,row.pgn_sha256,decodePgn(row));})();
  last=rows.at(-1).id;
 }
}
