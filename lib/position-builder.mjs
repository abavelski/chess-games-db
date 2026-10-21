import { decodePgn } from './game-policy.mjs';
import { assertGames } from './game-writer.mjs';
import { extractMainlinePositions, extractAllPositions, MAINLINE_EXTRACTOR_VERSION, VARIATION_EXTRACTOR_VERSION } from './position-mainline.mjs';
import { positionIndexCapability } from './position-index-storage.mjs';
import { POSITION_HASH_ALGORITHM } from './position-hash.mjs';

// Increment this when publication or replay semantics change. Old versions
// remain stored but are never mistaken for current index coverage.
export const POSITION_INDEXER_VERSION = 'position-builder-v1:' + MAINLINE_EXTRACTOR_VERSION;
export const POSITION_INDEX_SCOPE = 'mainline';
export const ALL_POSITION_INDEXER_VERSION = 'position-builder-v2:' + VARIATION_EXTRACTOR_VERSION;
export const ALL_POSITION_INDEX_SCOPE = 'all';

function requireExtension(db) {
  assertGames(db);
  const capability = positionIndexCapability(db);
  if (capability.status !== 'installed') {
    throw new Error('Position index ' + capability.status + '; run npm run positions -- init --database PATH first');
  }
}

function isCurrent(row, includeVariations = false) {
  const mainline = row.scope === POSITION_INDEX_SCOPE && row.indexer_version === POSITION_INDEXER_VERSION;
  const all = row.scope === ALL_POSITION_INDEX_SCOPE && row.indexer_version === ALL_POSITION_INDEXER_VERSION;
  return row.status === 'complete' && row.indexed_sha === row.pgn_sha256 &&
    row.algorithm_id === POSITION_HASH_ALGORITHM &&
    (all || (!includeVariations && mainline));
}

/** Read-only coverage: an installed schema is not necessarily a built index. */
export function positionBuildStatus(db) {
  assertGames(db);
  const capability = positionIndexCapability(db);
  const total = db.prepare('SELECT count(*) AS n FROM games').get().n;
  const bytes = db.pragma('page_count', { simple: true }) *
    db.pragma('page_size', { simple: true });
  if (capability.status !== 'installed') {
    return { capability: capability.status, coverage: 'unavailable',
      total, complete: 0, invalid: 0, stale: 0, unindexed: total,
      positions: 0, occurrences: 0, hidden: db.prepare('SELECT count(*) AS n FROM games WHERE hidden=1').get().n,
      databaseBytes: bytes };
  }
  const coverage = db.prepare(
    "WITH categorized AS (" +
    " SELECT g.hidden, CASE" +
    " WHEN s.game_id IS NULL THEN 'unindexed'" +
    " WHEN s.pgn_sha256=g.pgn_sha256 AND s.algorithm_id=? AND ((s.indexer_version=? AND s.scope='mainline') OR (s.indexer_version=? AND s.scope='all')) AND s.status='complete' THEN 'complete'" +
    " WHEN s.pgn_sha256=g.pgn_sha256 AND s.algorithm_id=? AND ((s.indexer_version=? AND s.scope='mainline') OR (s.indexer_version=? AND s.scope='all')) AND s.status='failed' THEN 'invalid'" +
    " ELSE 'stale' END AS kind" +
    " FROM games g LEFT JOIN game_position_index_state s ON s.game_id=g.id)" +
    " SELECT coalesce(sum(kind='complete'),0) AS complete," +
    " coalesce(sum(kind='invalid'),0) AS invalid," +
    " coalesce(sum(kind='stale'),0) AS stale," +
    " coalesce(sum(kind='unindexed'),0) AS unindexed," +
    " coalesce(sum(hidden=1),0) AS hidden FROM categorized"
  ).get(POSITION_HASH_ALGORITHM, POSITION_INDEXER_VERSION, ALL_POSITION_INDEXER_VERSION,
    POSITION_HASH_ALGORITHM, POSITION_INDEXER_VERSION, ALL_POSITION_INDEXER_VERSION);
  const allComplete = db.prepare(
    "SELECT count(*) AS n FROM games g JOIN game_position_index_state s ON s.game_id=g.id" +
    " WHERE s.status='complete' AND s.scope='all' AND s.indexer_version=?" +
    " AND s.algorithm_id=? AND s.pgn_sha256=g.pgn_sha256"
  ).get(ALL_POSITION_INDEXER_VERSION, POSITION_HASH_ALGORITHM).n;
  return {
    capability: 'installed',
    coverage: total === 0 ? 'empty' : coverage.complete === total ? 'complete' : 'partial',
    total, ...coverage,
    allComplete, variationIncomplete: total - allComplete,
    positions: db.prepare('SELECT count(*) AS n FROM position_keys').get().n,
    occurrences: db.prepare('SELECT count(*) AS n FROM game_position_occurrences').get().n,
    databaseBytes: bytes,
  };
}

// One transaction per game: old complete data stays intact on SQL errors;
// neither a partial result nor a stale input hash can become searchable.
function publishGame(db, source, extraction, includeVariations) {
  return db.transaction(() => {
    const live = db.prepare('SELECT pgn_sha256 FROM games WHERE id=?').get(source.id);
    if (!live || live.pgn_sha256 !== source.pgn_sha256) return false;
    db.prepare('DELETE FROM game_position_occurrences WHERE game_id=?').run(source.id);
    if (extraction.status === 'complete') {
      const insertKey = db.prepare(
        'INSERT INTO position_keys(zobrist_hash,exact_key,pawn_hash,pawn_signature) VALUES(?,?,?,?)' +
        ' ON CONFLICT(zobrist_hash,exact_key) DO NOTHING');
      const getKey = db.prepare(
        'SELECT id FROM position_keys WHERE zobrist_hash=? AND exact_key=?');
      const insertOccurrence = db.prepare(
        'INSERT INTO game_position_occurrences(game_id,position_id,path,ply,is_mainline) VALUES(?,?,?,?,?)');
      // Cache only the distinct positions within the current game, not the archive.
      const keys = new Map();
      for (const item of extraction.occurrences) {
        const identity = item.sqliteHash.toString() + ':' + item.verificationKey;
        let positionId = keys.get(identity);
        if (positionId === undefined) {
          insertKey.run(item.sqliteHash, item.verificationKey, item.sqlitePawnHash, item.pawnSignature);
          positionId = getKey.get(item.sqliteHash, item.verificationKey).id;
          keys.set(identity, positionId);
        }
        insertOccurrence.run(source.id, positionId, item.path, item.ply, item.is_mainline);
      }
    }
    // All-mode failures with a sound mainline are explicitly downgraded to
    // mainline-only coverage; no potentially broken sideline is published.
    const completed = extraction.status !== 'invalid';
    const allComplete = includeVariations && extraction.status === 'complete';
    db.prepare(
      'INSERT INTO game_position_index_state' +
      ' (game_id,pgn_sha256,algorithm_id,indexer_version,scope,status,diagnostic,completed_at)' +
      ' VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(game_id) DO UPDATE SET' +
      ' pgn_sha256=excluded.pgn_sha256,algorithm_id=excluded.algorithm_id,' +
      ' indexer_version=excluded.indexer_version,scope=excluded.scope,' +
      ' status=excluded.status,diagnostic=excluded.diagnostic,' +
      ' updated_at=CURRENT_TIMESTAMP,completed_at=excluded.completed_at'
    ).run(source.id, source.pgn_sha256, POSITION_HASH_ALGORITHM,
      allComplete ? ALL_POSITION_INDEXER_VERSION : POSITION_INDEXER_VERSION,
      allComplete ? ALL_POSITION_INDEX_SCOPE : POSITION_INDEX_SCOPE,
      completed ? 'complete' : 'failed',
      extraction.diagnostic, completed ? new Date().toISOString() : null);
    return true;
  }).immediate();
}

function replay(source, includeVariations) {
  try {
    // decodePgn checks compressed/decompressed limits, strict UTF-8 and SHA-256.
    const pgn = decodePgn(source);
    return includeVariations ? extractAllPositions(pgn) : extractMainlinePositions(pgn);
  } catch (error) {
    return { status: 'invalid', diagnostic: String(error.message ?? error).slice(0, 1000),
      occurrences: [] };
  }
}

/** Delete only keys no longer referenced by any game's occurrences. */
export function cleanOrphanPositions(db) {
  requireExtension(db);
  return db.transaction(() => db.prepare(
    'DELETE FROM position_keys WHERE NOT EXISTS (' +
    'SELECT 1 FROM game_position_occurrences o WHERE o.position_id=position_keys.id)'
  ).run().changes).immediate();
}

/**
 * Offline, bounded scanning. Games are replayed outside their publication
 * transaction; the source checksum is rechecked under the write lock.
 * maxGames limits attempted games (not skipped already-complete games).
 * No global "building" marker is published: a stopped run is resumable and
 * any previous complete per-game result remains valid until replacement.
 */
export async function buildPositions(db, {
  batchSize = 25, maxGames = Infinity, rebuild = false, dryRun = false,
  includeVariations = false, shouldStop = () => false, onProgress = () => {},
} = {}) {
  requireExtension(db);
  if (typeof includeVariations !== 'boolean') throw new Error('includeVariations must be boolean');
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 1000) {
    throw new Error('batchSize must be an integer from 1 to 1000');
  }
  if (maxGames !== Infinity && (!Number.isSafeInteger(maxGames) || maxGames < 1)) {
    throw new Error('maxGames must be a positive integer');
  }
  const start = Date.now();
  const metrics = { scanned: 0, skipped: 0, attempted: 0, complete: 0,
    invalid: 0, variationIncomplete: 0, conflicts: 0, occurrences: 0, reclaimed: 0, stopped: false, dryRun };
  const list = db.prepare(
    'SELECT g.id,g.pgn_sha256,g.hidden,s.pgn_sha256 AS indexed_sha,' +
    's.algorithm_id,s.indexer_version,s.scope,s.status' +
    ' FROM games g LEFT JOIN game_position_index_state s ON s.game_id=g.id' +
    ' WHERE g.id>? ORDER BY g.id LIMIT ?'
  );
  const input = db.prepare('SELECT pgn_sha256,pgn_zstd FROM games WHERE id=?');
  let cursor = 0;
  while (!shouldStop() && metrics.attempted < maxGames) {
    const rows = list.all(cursor, batchSize);
    if (!rows.length) break;
    for (const row of rows) {
      if (shouldStop() || metrics.attempted >= maxGames) break;
      cursor = row.id;
      metrics.scanned++;
      if (!rebuild && isCurrent(row, includeVariations)) { metrics.skipped++; continue; }
      const source = input.get(row.id);
      if (!source || source.pgn_sha256 !== row.pgn_sha256) {
        metrics.conflicts++;
        continue;
      }
      const extraction = replay({ ...source, id: row.id }, includeVariations);
      const published = dryRun || publishGame(db, row, extraction, includeVariations);
      if (!published) { metrics.conflicts++; continue; }
      metrics.attempted++;
      metrics[extraction.status === 'invalid' ? 'invalid' : 'complete']++;
      if (includeVariations && extraction.status === 'partial') metrics.variationIncomplete++;
      metrics.occurrences += extraction.occurrences.length;
      onProgress({ gameId: row.id, status: extraction.status,
        diagnostic: extraction.diagnostic, attempted: metrics.attempted,
        occurrences: extraction.occurrences.length, dryRun });
    }
    // Allow the process to handle SIGINT/SIGTERM between bounded batches.
    await new Promise(resolve => setImmediate(resolve));
  }
  metrics.stopped = shouldStop() || metrics.attempted >= maxGames;
  if (!dryRun && !shouldStop()) metrics.reclaimed = cleanOrphanPositions(db);
  metrics.elapsedMs = Date.now() - start;
  metrics.coverage = positionBuildStatus(db);
  return metrics;
}
