import Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import { openSync, closeSync, readSync, readFileSync, existsSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { SOURCE_TREE_VERSION, ANNOTATION_VERSION, digest } from './opening-source-tree.mjs';

export const OPENING_APPLICATION_ID = 1330924610;
export const OPENING_FORMAT = 'opening-study-library';
export const BUILD_VERSIONS = Object.freeze({ builder: 'opening-builder-v2', parser: SOURCE_TREE_VERSION,
  annotations: ANNOTATION_VERSION, sanitizer: 'opening-blocks-v1', position: 'polyglot-standard-v1' });
export function fileHash(path) {
  const hash = createHash('sha256'), buffer = Buffer.alloc(8 * 1024 * 1024);
  const fd = openSync(path, 'r');
  try { let count; while ((count = readSync(fd, buffer, 0, buffer.length, null))) hash.update(buffer.subarray(0, count)); }
  finally { closeSync(fd); }
  return hash.digest('hex');
}
const canonical = path => {
  const full = existsSync(path) ? realpathSync(path) : resolve(realpathSync(dirname(resolve(path))), basename(path));
  return process.platform === 'win32' ? full.toLowerCase() : full;
};
export function validateBuildPaths(source, staging, output, resume = false) {
  if (!existsSync(source) || !statSync(source).isFile()) throw new Error('Source file is missing');
  const paths = [source, staging, output].map(canonical);
  if (new Set(paths).size !== 3) throw new Error('Source, staging and output must be different paths');
  const present = [source, staging, output].filter(existsSync).map(p => statSync(p));
  for (let i = 0; i < present.length; i++) for (let j = i + 1; j < present.length; j++)
    if (present[i].dev === present[j].dev && present[i].ino === present[j].ino)
      throw new Error('Source, staging and output are filesystem aliases');
  if (existsSync(output)) throw new Error('Output already exists; choose a new generation');
  if (statSync(dirname(resolve(staging))).dev !== statSync(dirname(resolve(output))).dev)
    throw new Error('Staging and output must be on the same filesystem for atomic publication');
  if (existsSync(staging) !== resume) throw new Error(resume ? 'Resume staging file is missing' : 'Staging exists; use --resume or choose a new path');
  if (existsSync(source + '-wal') && statSync(source + '-wal').size) throw new Error('Source must be a closed snapshot without a live WAL');
}
export function stableSourceKey(corpus, path, nativeId = null) {
  if (typeof corpus !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,95}$/.test(corpus)) throw new Error('Invalid corpus namespace');
  const normalized = path.replaceAll('\\', '/').normalize('NFC').toLowerCase();
  if (!normalized || normalized.startsWith('/') || normalized.includes(':') || normalized.split('/').includes('..'))
    throw new Error('Source identity must use a relative database path');
  return `${corpus}:${normalized}${nativeId === null ? '' : ':' + nativeId}`;
}
export function inspectManifest(db, { allowBuilding = false } = {}) {
  if (db.pragma('application_id', { simple: true }) !== OPENING_APPLICATION_ID || db.pragma('user_version', { simple: true }) !== 1)
    throw new Error('Not a supported opening runtime library (source archives and Games files cannot be loaded here)');
  const manifest = db.prepare('SELECT * FROM library_manifest WHERE id=1').get();
  if (!manifest || manifest.format !== OPENING_FORMAT || manifest.schema_version !== 1 ||
      !/^[0-9a-f]{64}$/.test(manifest.revision) || !/^[0-9a-f]{64}$/.test(manifest.source_hash) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(manifest.library_uuid) ||
      JSON.parse(manifest.builder_versions).position !== BUILD_VERSIONS.position)
    throw new Error('Invalid or incompatible opening library manifest');
  if (!allowBuilding && manifest.status !== 'ready') throw new Error('Opening library is unfinished; finish the offline builder first');
  const capabilities = JSON.parse(manifest.capabilities), coverage = JSON.parse(manifest.coverage);
  if (manifest.status === 'ready' && (
    !capabilities.sourceTree || !capabilities.exactPositions ||
    !['sourceItems','processedItems','searchableDocuments','quarantinedDocuments','unsupportedAnnotations']
      .every(key => Number.isSafeInteger(coverage[key]) && coverage[key] >= 0) ||
    coverage.sourceItems !== coverage.processedItems ||
    db.prepare("SELECT 1 FROM build_record_state WHERE state!='complete' LIMIT 1").get() ||
    db.prepare("SELECT 1 FROM source_items WHERE validation_status='pending' LIMIT 1").get()
  )) throw new Error('Invalid ready manifest or unfinished coverage');
  return { ...manifest, capabilities, coverage };
}
export function openOpeningLibrary(path) {
  if (existsSync(path + '-wal') && statSync(path + '-wal').size)
    throw new Error('Opening library has an active WAL; close its writer and finish publication first');
  const db = new Database(path, { readonly: true, fileMustExist: true });
  try { db.pragma('query_only=ON'); db.pragma('foreign_keys=ON'); return { db, manifest: inspectManifest(db) }; }
  catch (error) { db.close(); throw error; }
}
export function createStaging({ staging, sourceHash, corpus, resume = false }) {
  const db = new Database(staging, { fileMustExist: resume });
  try {
    db.pragma('foreign_keys=ON');
    if (resume) {
      const m = inspectManifest(db, { allowBuilding: true });
      if (m.status === 'ready' || m.source_hash !== sourceHash || m.corpus !== corpus ||
          JSON.stringify(JSON.parse(m.builder_versions)) !== JSON.stringify(BUILD_VERSIONS))
        throw new Error('Incompatible resume inputs or converter versions; create a new generation');
    } else {
      db.transaction(() => {
        db.exec(readFileSync(new URL('../db/opening-library-v1.sql', import.meta.url), 'utf8'));
        db.prepare('INSERT INTO library_manifest VALUES (1,?,?,?,?,?,?,?,?,?,?,?)').run(
          OPENING_FORMAT, 1, randomUUID(), digest(JSON.stringify([sourceHash, corpus, BUILD_VERSIONS])),
          corpus, sourceHash, JSON.stringify(BUILD_VERSIONS), 'building', new Date().toISOString(), '{}', '{}');
      })();
    }
    db.pragma('journal_mode=WAL'); db.pragma('synchronous=NORMAL');
    db.pragma('cache_size=-131072');
    return db;
  } catch (error) { db.close(); throw error; }
}
export function checkpointItem(db, itemId, processItem) {
  return db.transaction(() => {
    const item = db.prepare('SELECT * FROM source_items WHERE id=?').get(itemId);
    const state = db.prepare('SELECT * FROM build_record_state WHERE item_id=?').get(itemId);
    if (!item || !state || state.input_hash !== item.input_hash || state.converter_version !== BUILD_VERSIONS.builder)
      throw new Error('Item checkpoint identity mismatch');
    if (state.state === 'complete') return false;
    const result = processItem(item);
    if (!['accepted','metadata_only','quarantined','deleted'].includes(result.status)) throw new Error('Invalid item disposition');
    db.prepare('UPDATE source_items SET validation_status=? WHERE id=?').run(result.status, itemId);
    db.prepare("UPDATE build_record_state SET state='complete',node_count=?,annotation_count=?,checkpoint=? WHERE item_id=?")
      .run(result.nodes ?? 0, result.annotations ?? 0, new Date().toISOString(), itemId);
    return true;
  })();
}
export function cleanupDerived(db) {
  // No unfinished accepted nodes are ever committed by checkpointItem.
  db.exec(`DELETE FROM move_prefixes WHERE id NOT IN (SELECT prefix_id FROM study_nodes);
    DELETE FROM prefix_roots WHERE id NOT IN (SELECT root_id FROM move_prefixes);
    DELETE FROM positions WHERE id NOT IN (SELECT position_id FROM study_nodes)
      AND id NOT IN (SELECT position_id FROM move_prefixes) AND id NOT IN (SELECT position_id FROM prefix_roots);`);
}
