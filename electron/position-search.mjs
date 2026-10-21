import { POSITION_HASH_ALGORITHM } from '../lib/position-hash.mjs';
import { POSITION_INDEXER_VERSION } from '../lib/position-builder.mjs';
import { positionIndexCapability } from '../lib/position-index-storage.mjs';

// Position queries are deliberately read-only. Only a FEN crosses the IPC
// boundary; signed Zobrist bigint keys are computed in the trusted main process.
const FILTER_KEYS = new Set([
  'properties', 'openingNodeId', 'search', 'yearFrom', 'yearTo', 'sort',
  'page', 'pageSize', 'favouritesOnly', 'personalOnly',
]);
const SORTS = new Set(['book', 'newest', 'oldest', 'year_desc', 'year_asc', 'white', 'source']);

export function validatePositionSearchRequest(fen, filters = {}) {
  if (typeof fen !== 'string' || fen.length > 256 || !fen.trim()) {
    throw new Error('Position search requires a standard-chess FEN (up to 256 characters)');
  }
  if (filters === null || typeof filters !== 'object' || Array.isArray(filters)) {
    throw new Error('Invalid position search filters');
  }
  if (Object.keys(filters).some(key => !FILTER_KEYS.has(key))) {
    throw new Error('Unsupported position search filter');
  }
  if (filters.search !== undefined &&
      (typeof filters.search !== 'string' || filters.search.length > 200)) {
    throw new Error('Invalid or excessive search text');
  }
  if (filters.openingNodeId !== undefined && filters.openingNodeId !== null &&
      (typeof filters.openingNodeId !== 'string' || filters.openingNodeId.length > 200)) {
    throw new Error('Invalid opening selection');
  }
  if (filters.sort !== undefined && !SORTS.has(filters.sort)) {
    throw new Error('Invalid position search sort');
  }
  for (const field of ['page', 'pageSize']) {
    if (filters[field] !== undefined && (!Number.isSafeInteger(filters[field]) ||
        filters[field] < 1 || filters[field] > (field === 'page' ? 100000 : 100))) {
      throw new Error('Invalid position search ' + field);
    }
  }
  for (const field of ['yearFrom', 'yearTo']) {
    if (filters[field] !== undefined && filters[field] !== '' &&
        !(typeof filters[field] === 'number' || typeof filters[field] === 'string')) {
      throw new Error('Invalid year');
    }
  }
  // This bounds the complete request as well as per-property selections.
  // The existing validateSelections/predicate checks individual option IDs.
  if (JSON.stringify(filters).length > 32768) throw new Error('Excessive position search filters');
}

/**
 * Archive-wide *visible-game* coverage. Missing/failed/stale games are
 * reported even when the requested position happens to have no indexed hits.
 * Hidden provenance is indexed by PS-04 but never affects user-facing counts.
 */
export function positionSearchCoverage(db) {
  const capability = positionIndexCapability(db);
  const total = db.prepare('SELECT count(*) n FROM games WHERE hidden=0').get().n;
  const empty = { complete: 0, invalid: 0, building: 0, partial: 0,
    stale: 0, unsupported: 0, unindexed: total };
  if (capability.status !== 'installed') {
    return { status: capability.status, isComplete: false, total, ...empty };
  }
  const result = db.prepare(`
    WITH classified AS (
      SELECT CASE
        WHEN st.game_id IS NULL THEN 'unindexed'
        WHEN st.pgn_sha256 != g.pgn_sha256 THEN 'stale'
        WHEN st.algorithm_id != @algorithm OR st.indexer_version != @version
          OR st.scope != 'mainline' THEN 'unsupported'
        WHEN st.status = 'complete' THEN 'complete'
        WHEN st.status = 'failed' THEN 'invalid'
        WHEN st.status = 'building' THEN 'building'
        WHEN st.status = 'partial' THEN 'partial'
        ELSE 'stale' END category
      FROM games g LEFT JOIN game_position_index_state st ON st.game_id=g.id
      WHERE g.hidden=0
    ) SELECT
      coalesce(sum(category='complete'),0) complete,
      coalesce(sum(category='invalid'),0) invalid,
      coalesce(sum(category='building'),0) building,
      coalesce(sum(category='partial'),0) partial,
      coalesce(sum(category='stale'),0) stale,
      coalesce(sum(category='unsupported'),0) unsupported,
      coalesce(sum(category='unindexed'),0) unindexed
    FROM classified
  `).get({ algorithm: POSITION_HASH_ALGORITHM, version: POSITION_INDEXER_VERSION });
  const isComplete = result.complete === total;
  return { status: isComplete ? 'complete' : 'partial', isComplete, total, ...result };
}

/**
 * The lookup by (zobrist_hash,exact_key) occurs separately using the unique
 * covering index in position_keys. The materialized CTE then scans only
 * occurrences of that position via game_position_occurrences_position, not
 * every PGN/game. ROW_NUMBER eliminates repeated visits deterministically
 * before existing game predicates, sorting and paging are applied.
 */
export const POSITION_HITS_CTE = `
  WITH position_hits AS MATERIALIZED (
    SELECT o.game_id, o.ply, o.path,
      row_number() OVER(PARTITION BY o.game_id ORDER BY o.ply, o.path) hit_rank
    FROM game_position_occurrences o INDEXED BY game_position_occurrences_position
    JOIN game_position_index_state st ON st.game_id=o.game_id
    JOIN games indexed_game ON indexed_game.id=o.game_id
    WHERE o.position_id=@positionId AND o.is_mainline=1
      AND st.status='complete' AND st.scope='mainline'
      AND st.pgn_sha256=indexed_game.pgn_sha256
      AND st.algorithm_id=@positionAlgorithm AND st.indexer_version=@positionVersion
  )`;

export const POSITION_HIT_PARAMS = Object.freeze({
  positionAlgorithm: POSITION_HASH_ALGORITHM,
  positionVersion: POSITION_INDEXER_VERSION,
});
