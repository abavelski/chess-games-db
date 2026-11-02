import Database from 'better-sqlite3';
import { existsSync, statSync, writeFileSync, readFileSync, linkSync, unlinkSync } from 'node:fs';
import { fileHash, validateBuildPaths, inspectManifest, cleanupDerived, stableSourceKey, BUILD_VERSIONS } from './opening-library-storage.mjs';
import { readSourceTree, normalizeAnnotations, digest } from './opening-source-tree.mjs';
import { verifyGeneratedTree } from './opening-tree-converter.mjs';
import { parseSearchPosition } from './position-hash.mjs';
import os from 'node:os';

const fail = message => { throw new Error(`Publication refused: ${message}`); };
const BLOCK_KEYS = new Set(['type','children','text','anchor','level','ordered','fen']);
const BLOCK_TYPES = new Set(['group','paragraph','heading','list','item','quote','strong','emphasis','code','link','unavailable','break','text','diagram']);
function schemaHash(db) {
  return digest(JSON.stringify(db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type,name")
    .all().map(row => ({ ...row, sql: row.sql.replace(/\s+/g, ' ').trim() }))));
}
function validateBlocks(blocks, targets, depth = 0) {
  if (!Array.isArray(blocks) || depth > 256) fail('Invalid or excessive reading-block nesting');
  for (const b of blocks) {
    if (!b || !BLOCK_TYPES.has(b.type) || Object.keys(b).some(k => !BLOCK_KEYS.has(k))) fail('Unsafe reading block');
    if (b.type === 'diagram') parseSearchPosition(b.fen);
    if (b.type === 'link' && !targets.has(b.anchor)) fail('Reading link lacks a controlled target');
    if (b.children) validateBlocks(b.children, targets, depth + 1);
  }
}

export function validateCompleteLibrary(db, input, progress = () => {}) {
  const expectedSchema = new Database(':memory:');
  try {
    expectedSchema.exec(readFileSync(new URL('../db/opening-library-v1.sql', import.meta.url), 'utf8'));
    if (schemaHash(db) !== schemaHash(expectedSchema)) fail('Runtime schema fingerprint mismatch');
  } finally { expectedSchema.close(); }
  const pending = db.prepare("SELECT count(*) n FROM build_record_state WHERE state!='complete'").get().n;
  if (pending || db.prepare("SELECT 1 FROM source_items WHERE validation_status='pending' LIMIT 1").get()) fail(`${pending} unfinished source items`);
  const total = input.prepare('SELECT count(*) n FROM source_records').get().n;
  if (db.prepare('SELECT count(*) n FROM source_items').get().n !== total) fail('Source item inventory mismatch');
  const manifest = inspectManifest(db, { allowBuilding: true });
  const itemGet = db.prepare('SELECT * FROM source_items WHERE id=?');
  for (const r of input.prepare(`SELECT s.id,s.database_id,s.source_record_id,s.record_type,s.source_deleted,
    s.header_json,s.decoder_metadata_json,d.relative_path FROM source_records s JOIN source_databases d ON d.id=s.database_id ORDER BY s.id`).iterate()) {
    const item = itemGet.get(r.id), key = stableSourceKey(manifest.corpus, r.relative_path, r.source_record_id);
    const hash = digest(JSON.stringify([manifest.source_hash, key, r.header_json, r.decoder_metadata_json]));
    if (!item || item.stable_key !== key || item.input_hash !== hash || item.collection_id !== r.database_id ||
        item.native_id !== r.source_record_id || item.kind !== r.record_type || item.deleted !== r.source_deleted)
      fail(`Source item identity ${r.id}`);
  }
  const annotationTotal = input.prepare('SELECT count(*) n FROM game_annotations').get().n;
  const accounted = db.prepare('SELECT coalesce(sum(annotation_count),0) n FROM build_record_state').get().n;
  if (annotationTotal !== accounted) fail(`Annotation inventory mismatch: ${annotationTotal} source, ${accounted} accounted`);
  const acceptedAnnotations = db.prepare(`SELECT coalesce(sum(b.annotation_count),0) n FROM build_record_state b
    JOIN source_items s ON s.id=b.item_id WHERE s.kind='game' AND s.validation_status='accepted'`).get().n;
  if (acceptedAnnotations !== db.prepare('SELECT count(*) n FROM node_annotations').get().n) fail('Accepted annotation count mismatch');
  const invariantQueries = [
    [`SELECT 1 FROM source_items s WHERE s.kind='game' AND s.validation_status='accepted' AND NOT EXISTS(SELECT 1 FROM study_documents d WHERE d.item_id=s.id) LIMIT 1`, 'accepted game document'],
    [`SELECT 1 FROM study_documents d JOIN source_items s ON s.id=d.item_id JOIN build_record_state b ON b.item_id=s.id
      WHERE s.kind!='game' OR s.validation_status!='accepted' OR b.node_count!=d.node_count+1 LIMIT 1`, 'document disposition/checkpoint'],
    [`SELECT 1 FROM source_items s WHERE s.kind='article' AND s.validation_status='accepted' AND NOT EXISTS(SELECT 1 FROM articles a WHERE a.item_id=s.id) LIMIT 1`, 'accepted article catalog'],
    [`SELECT 1 FROM study_nodes n JOIN study_nodes p ON p.id=n.parent_id WHERE p.document_id!=n.document_id OR n.ply!=p.ply+1 LIMIT 1`, 'source parent/ply'],
    [`SELECT 1 FROM study_nodes n JOIN move_prefixes p ON p.id=n.prefix_id WHERE n.position_id!=p.position_id OR n.ply!=p.depth OR n.move_uci IS NOT p.move_uci LIMIT 1`, 'node-prefix position/move'],
    [`SELECT 1 FROM move_prefixes c JOIN move_prefixes p ON p.id=c.parent_id WHERE c.depth!=p.depth+1 OR c.root_id!=p.root_id LIMIT 1`, 'prefix parent/root'],
    [`SELECT 1 FROM study_nodes n JOIN study_nodes p ON p.id=n.parent_id WHERE n.leaf_lo<p.leaf_lo OR n.leaf_hi>p.leaf_hi LIMIT 1`, 'descendant intervals'],
    [`SELECT 1 FROM study_nodes n JOIN (SELECT parent_id,min(leaf_lo) lo,max(leaf_hi) hi,sum(leaf_hi-leaf_lo) size FROM study_nodes WHERE parent_id IS NOT NULL GROUP BY parent_id) c
      ON c.parent_id=n.id WHERE n.leaf_lo!=c.lo OR n.leaf_hi!=c.hi OR n.leaf_hi-n.leaf_lo!=c.size LIMIT 1`, 'child interval partition'],
    [`SELECT 1 FROM study_nodes n WHERE NOT EXISTS(SELECT 1 FROM study_nodes c WHERE c.parent_id=n.id) AND n.leaf_hi!=n.leaf_lo+1 LIMIT 1`, 'terminal interval'],
    [`SELECT 1 FROM study_documents d JOIN study_nodes r ON r.document_id=d.id AND r.parent_id IS NULL WHERE r.leaf_lo!=0 OR r.leaf_hi!=d.leaf_count OR r.prefix_id!=d.root_prefix_id LIMIT 1`, 'root intervals/prefix'],
    [`SELECT 1 FROM article_targets WHERE status='resolved' AND document_id IS NULL AND article_id IS NULL LIMIT 1`, 'controlled link resolution'],
  ];
  for (const [sql, name] of invariantQueries) if (db.prepare(sql).get()) fail(`${name} invariant`);
  const sourceGet = input.prepare('SELECT g.*,s.errors_json FROM games g JOIN source_records s ON s.id=g.id WHERE g.id=?');
  const sourceAnnotations = input.prepare('SELECT sequence,move_index,annotation_type,language,text,payload_json FROM game_annotations WHERE game_id=? ORDER BY sequence');
  const nodesGet = db.prepare(`SELECT n.*,p.exact_key,CAST(p.hash AS TEXT) hash_text FROM study_nodes n JOIN positions p ON p.id=n.position_id WHERE n.document_id=? ORDER BY n.source_index`);
  const annotationsGet = db.prepare('SELECT * FROM node_annotations WHERE document_id=? ORDER BY source_sequence');
  let verified = 0;
  // Bounded by one source document. No all-library trees or PGN decompression cache.
  for (const document of db.prepare('SELECT * FROM study_documents ORDER BY id').iterate()) {
    const source = sourceGet.get(document.item_id), sourceRows = sourceAnnotations.all(document.item_id);
    const tree = readSourceTree(source), normalized = normalizeAnnotations(tree, sourceRows);
    verifyGeneratedTree(tree, normalized);
    if (tree.treeHash !== document.tree_hash || tree.moveCount !== document.node_count || tree.leafCount !== document.leaf_count ||
        document.annotation_hash !== digest(JSON.stringify(sourceRows)) || source.start_fen !== document.start_fen) fail(`Document identity ${document.item_id}`);
    const stored = nodesGet.all(document.id);
    if (stored.length !== tree.nodes.length) fail(`Node count ${document.item_id}`);
    for (const [i, n] of tree.nodes.entries()) {
      const s = stored[i];
      if (s.source_index !== n.sourceIndex || s.source_path !== n.path.join('.') || s.viewer_path !== n.viewerPath ||
          s.move_uci !== n.uci || s.san !== n.san || s.exact_key !== n.exactKey || s.hash_text !== n.hash.toString() ||
          s.leaf_lo !== n.leafLo || s.leaf_hi !== n.leafHi || Boolean(s.is_mainline) !== n.mainline)
        fail(`Source-node mapping ${document.item_id}/${n.sourceIndex}`);
    }
    const annotations = annotationsGet.all(document.id);
    if (annotations.length !== normalized.length) fail(`Annotation count ${document.item_id}`);
    for (const [i, a] of normalized.entries()) {
      const s = annotations[i], sourceNode = tree.nodes.find(n => n.sourceIndex === a.sourceIndex);
      const storedNode = stored.find(n => n.id === s.node_id);
      if (s.source_sequence !== a.sequence || s.source_type !== a.type || s.source_language !== a.sourceLanguage ||
          s.language !== a.language || s.placement !== a.placement || s.support_status !== a.status ||
          s.payload_json !== JSON.stringify(a.payload) || s.original_json !== JSON.stringify(a.original) || s.payload_hash !== a.payloadHash ||
          (sourceNode ? storedNode?.source_path !== sourceNode.path.join('.') : s.node_id !== null))
        fail(`Annotation provenance ${document.item_id}/${a.sequence}`);
    }
    verified++;
    if (verified % 500 === 0) progress(`Verified ${verified} complete source trees`);
  }
  const bodyGet = input.prepare('SELECT content FROM article_bodies WHERE article_id=? AND language=?');
  const targetsGet = db.prepare('SELECT anchor_key FROM article_targets WHERE version_id=?');
  for (const version of db.prepare('SELECT * FROM article_versions ORDER BY id').iterate()) {
    const body = bodyGet.get(version.article_id, version.source_language);
    if (!body || digest(body.content) !== version.source_hash || version.sanitizer_version !== BUILD_VERSIONS.sanitizer) fail('Article body identity mismatch');
    validateBlocks(JSON.parse(version.blocks_json), new Set(targetsGet.all(version.id).map(t => t.anchor_key)));
  }
  const sourceBodies = input.prepare('SELECT count(*) n FROM article_bodies b JOIN source_records s ON s.id=b.article_id WHERE s.source_deleted=0').get().n;
  if (sourceBodies !== db.prepare('SELECT count(*) n FROM article_versions').get().n) fail('Article language inventory mismatch');
  return { sourceItems: total, processedItems: total, sourceAnnotations: annotationTotal,
    searchableDocuments: verified, quarantinedDocuments: db.prepare("SELECT count(*) n FROM source_items WHERE validation_status='quarantined'").get().n,
    unsupportedAnnotations: db.prepare("SELECT count(*) n FROM node_annotations WHERE support_status!='supported'").get().n,
    indexedNodes: db.prepare('SELECT count(*) n FROM study_nodes').get().n,
    sourceLines: db.prepare('SELECT coalesce(sum(leaf_count),0) n FROM study_documents').get().n,
    articles: db.prepare('SELECT count(*) n FROM articles').get().n,
    readableVersions: db.prepare('SELECT count(*) n FROM article_versions WHERE meaningful=1').get().n,
    sourceScope: 'Main collection games and Theory games/articles; excluded collections and media are not included',
  };
}

export function publishOpeningLibrary({ source, staging, output, corpus, progress = console.log }) {
  validateBuildPaths(source, staging, output, true);
  if (existsSync(output + '.report.json') || existsSync(output + '.sha256')) fail('Report/checksum destination already exists');
  const sourceHash = fileHash(source), input = new Database(source, { readonly: true, fileMustExist: true });
  const db = new Database(staging, { fileMustExist: true });
  const started = performance.now();
  let report;
  try {
    input.pragma('query_only=ON'); input.pragma('cache_size=-16384');
    db.pragma('foreign_keys=ON'); db.pragma('cache_size=-131072');
    const manifest = inspectManifest(db, { allowBuilding: true });
    if (manifest.source_hash !== sourceHash || manifest.corpus !== corpus || JSON.stringify(JSON.parse(manifest.builder_versions)) !== JSON.stringify(BUILD_VERSIONS))
      fail('Incompatible source or builder version');
    db.prepare("UPDATE library_manifest SET status='validating' WHERE id=1").run();
    cleanupDerived(db);
    const coverage = validateCompleteLibrary(db, input, progress);
    db.exec('ANALYZE');
    if (db.pragma('integrity_check', { simple: true }) !== 'ok' || db.pragma('foreign_key_check').length) fail('SQLite integrity/foreign-key validation');
    if (fileHash(source) !== sourceHash) fail('Source changed during validation');
    const capabilities = { sourceTree: true, typedAnnotations: true, exactPositions: true, articleBlocks: true, ordinalPaths: true };
    db.prepare("UPDATE library_manifest SET status='ready',capabilities=?,coverage=? WHERE id=1")
      .run(JSON.stringify(capabilities), JSON.stringify(coverage));
    const checkpoint = db.pragma('wal_checkpoint(TRUNCATE)');
    if (checkpoint.some(r => r.busy)) fail('Staging is busy; close all readers before publication');
    inspectManifest(db);
    report = { format: 'opening-study-build-report', libraryUUID: manifest.library_uuid, revision: manifest.revision,
      sourceHash, sourceSchemaHash: schemaHash(input), runtimeSchemaHash: schemaHash(db), builderVersions: BUILD_VERSIONS, coverage,
      hardware: { platform: `${os.platform()} ${os.release()}`, cpu: os.cpus()[0]?.model,
        logicalCpus: os.cpus().length, totalMemoryBytes: os.totalmem(), node: process.version },
      dispositions: db.prepare('SELECT kind,validation_status,count(*) records FROM source_items GROUP BY 1,2').all(),
      annotationTypes: db.prepare('SELECT source_type,source_language,support_status,count(*) annotations FROM node_annotations GROUP BY 1,2,3').all(),
      issues: db.prepare('SELECT stage,severity,code,disposition,count(*) issues FROM quality_issues GROUP BY 1,2,3,4').all(),
      quarantined: db.prepare("SELECT s.stable_key,q.code,q.detail,q.disposition FROM quality_issues q JOIN source_items s ON s.id=q.item_id WHERE s.validation_status='quarantined' ORDER BY s.id,q.id").all(),
      integrity: 'ok', foreignKeyViolations: 0, validationSeconds: (performance.now() - started) / 1000,
      limitations: ['Unverified evaluation arrays and scalar conventions remain unsupported', 'External media are unavailable offline',
        'Copies are separate game records and source lines', 'Index coverage is the validated subset, not complete or current opening theory'] };
  } finally { db.close(); input.close(); }
  if (existsSync(staging + '-wal') && statSync(staging + '-wal').size) fail('Final artifact still depends on a WAL');
  report.artifactSHA256 = fileHash(staging);
  report.artifactBytes = statSync(staging).size;
  // Report/checksum precede the atomic creation of the new artifact name. Hard
  // link creation never replaces an existing file, even under a publication race.
  writeFileSync(output + '.report.json', JSON.stringify(report, null, 2), { flag: 'wx' });
  writeFileSync(output + '.sha256', report.artifactSHA256 + '\n', { flag: 'wx' });
  linkSync(staging, output);
  unlinkSync(staging);
  return report;
}
