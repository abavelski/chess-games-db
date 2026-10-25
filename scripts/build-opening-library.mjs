import Database from 'better-sqlite3';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { fileHash, validateBuildPaths, createStaging, stableSourceKey, BUILD_VERSIONS } from '../lib/opening-library-storage.mjs';
import { digest } from '../lib/opening-source-tree.mjs';

// OT-04 only inventories into staging. Playable conversion and publication are
// distinct later phases; this command never labels inventory-only data ready.
export function initializeBuild({ source, staging, output, corpus, resume = false }) {
  validateBuildPaths(source, staging, output, resume);
  stableSourceKey(corpus, 'validate');
  const sourceHash = fileHash(source);
  const input = new Database(source, { readonly: true, fileMustExist: true });
  let db;
  try {
    input.pragma('query_only=ON');
    if (input.pragma('user_version', { simple: true }) !== 1 ||
        !input.prepare("SELECT 1 FROM sqlite_master WHERE name='source_records'").get() ||
        !input.prepare("SELECT 1 FROM sqlite_master WHERE name='import_runs'").get())
      throw new Error('Expected archival opening source schema v1');
    const run = input.prepare('SELECT status FROM import_runs ORDER BY id DESC LIMIT 1').get();
    if (!run || !['extracted','extracted_with_decode_errors'].includes(run.status)) throw new Error('Source extraction is unfinished');
    db = createStaging({ staging, sourceHash, corpus, resume });
    const collection = db.prepare('INSERT OR IGNORE INTO source_collections VALUES (?,?,?,?,?,?,?)');
    const itemInsert = db.prepare('INSERT OR IGNORE INTO source_items VALUES (?,?,?,?,?,?,?,?,?)');
    const checkpoint = db.prepare("INSERT OR IGNORE INTO build_record_state(item_id,input_hash,converter_version,state) VALUES (?,?,?,'pending')");
    db.transaction(() => {
      for (const c of input.prepare('SELECT * FROM source_databases ORDER BY id').iterate()) {
        const key = stableSourceKey(corpus, c.relative_path);
        collection.run(c.id, key, c.relative_path, key.slice(corpus.length + 1), c.format, c.role,
          JSON.stringify({ extractionStatus: c.status, recovery: JSON.parse(c.recovery_actions_json), diagnostics: JSON.parse(c.diagnostics_json) }));
      }
    })();
    // Bounded, atomic inventory batches; document publication uses checkpointItem.
    const query = input.prepare(`SELECT s.id,s.database_id,s.source_record_id,s.record_type,s.source_deleted,
      s.decode_status,s.header_json,s.errors_json,s.decoder_metadata_json,d.relative_path
      FROM source_records s JOIN source_databases d ON d.id=s.database_id WHERE s.id>? ORDER BY s.id LIMIT 256`);
    let lastId = 0, count = 0;
    while (true) {
      const batch = query.all(lastId);
      if (!batch.length) break;
      db.transaction(() => {
        for (const r of batch) {
          const key = stableSourceKey(corpus, r.relative_path, r.source_record_id);
          // Snapshot fingerprint binds all source bytes, including annotation
          // payloads that are not fetched during this inventory phase.
          const hash = digest(JSON.stringify([sourceHash, key, r.header_json, r.decoder_metadata_json]));
          itemInsert.run(r.id, key, r.database_id, r.source_record_id, r.record_type, r.source_deleted, hash, r.decode_status, 'pending');
          checkpoint.run(r.id, hash, BUILD_VERSIONS.builder);
        }
      })();
      count += batch.length;
      lastId = batch.at(-1).id;
    }
    if (fileHash(source) !== sourceHash) throw new Error('Source changed during staging inventory; do not resume this generation');
    return { status: 'building', sourceHash, inventoried: count, next: 'tree/article conversion, validation and publication' };
  } finally { input.close(); if (db) { db.pragma('wal_checkpoint(TRUNCATE)'); db.close(); } }
}
export function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({ args, strict: true, options: {
    source: { type: 'string' }, staging: { type: 'string' }, output: { type: 'string' }, corpus: { type: 'string' }, resume: { type: 'boolean', default: false },
  } });
  for (const name of ['source','staging','output','corpus']) if (!values[name])
    throw new Error('Required: --source PATH --staging PATH --output NEW_PATH --corpus NAMESPACE [--resume]');
  return initializeBuild(values);
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { console.log(JSON.stringify(main(), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
