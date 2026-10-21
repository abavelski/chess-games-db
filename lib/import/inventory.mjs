import { IMPORT_SCHEMA } from './storage.mjs';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { inventory as legacyInventory } from '../game-policy.mjs';

const quote = name => '"' + name.replaceAll('"', '""') + '"';
export function inspectArchive(db) {
  const version = db.pragma('user_version', { simple: true });
  const objects = db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all();
  const tables = new Set(objects.filter(o => o.type === 'table').map(o => o.name));
  const columns = table => tables.has(table) ? db.prepare(`PRAGMA table_info(${quote(table)})`).all().map(c => c.name) : [];
  const count = table => tables.has(table) ? db.prepare(`SELECT count(*) n FROM ${quote(table)}`).get().n : 0;
  const known = new Database(':memory:');
  try {
    if ([3,4,5,6,7].includes(version)) {
      const migrations = ['007_games','008_personal_analysis','009_position_index'];
      if (version === 7) {
       for (const name of migrations) known.exec(readFileSync(new URL(`../../db/migrations/${name}.sql`, import.meta.url), 'utf8'));
       known.exec(IMPORT_SCHEMA);
      }
    }
    const knownObjects = new Set(known.prepare('SELECT name FROM sqlite_master').all().map(o => o.name));
    const personalTables = objects.filter(o => o.type === 'table' && /personal|notes|favour|study/i.test(o.name)).map(o => ({ name: o.name, rows: count(o.name), columns: columns(o.name) }));
    const report = {
      version, path: version === 7 ? 'native-v7' : [3,4,5,6].includes(version) ? 'explicit-new-output-migration' : 'refuse-unsupported-schema',
      total: count('games'), sources: tables.has('sources') ? db.prepare('SELECT source_key,title FROM sources ORDER BY source_key').all() : [],
      capabilities: { importMetadata: tables.has('import_sources'), favourites: columns('games').includes('favourite'), personalAnalysis: tables.has('game_personal_analysis'), positions: tables.has('position_index_meta'), openings: tables.has('opening_state') },
      personalTables, favouriteCount: columns('games').includes('favourite') ? db.prepare('SELECT count(*) n FROM games WHERE favourite=1').get().n : 0,
      objects, unknownObjects: version === 7 ? objects.filter(o => !knownObjects.has(o.name) && o.name !== 'games_favourite') : objects,
      gameColumns: columns('games'),
    };
    if (report.capabilities.positions) {
      report.positions = { metadata: db.prepare('SELECT * FROM position_index_meta').all(), coverage: db.prepare('SELECT scope,status,algorithm_id,indexer_version,count(*) n FROM game_position_index_state GROUP BY scope,status,algorithm_id,indexer_version').all() };
    }
    if (version === 7) {
      report.keyConventions = db.prepare("SELECT CASE WHEN game_key LIKE 'legacy:%' THEN 'legacy' WHEN game_key LIKE 'chessbase:%' THEN 'chessbase' ELSE 'other' END convention,count(*) n FROM games GROUP BY convention").all();
      report.sourceLinks = count('game_sources');
    } else if ([3,4,5,6].includes(version)) report.legacy = legacyInventory(db);
    report.migrationRequiresPersonalReview = version !== 7 && (personalTables.length > 0 || report.capabilities.favourites);
    return report;
  } finally { known.close(); }
}
export function inventoryArchive(path) {
  const db = new Database(path, { readonly: true, fileMustExist: true });
  try { return db.transaction(() => inspectArchive(db))(); } finally { db.close(); }
}
