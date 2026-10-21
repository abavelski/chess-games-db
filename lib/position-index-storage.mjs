import { POSITION_HASH_ALGORITHM, PAWN_HASH_ALGORITHM } from './position-hash.mjs';

export const POSITION_INDEX_SCHEMA_VERSION = 1;

const tables = {
  position_index_meta: ['singleton', 'schema_version', 'hash_algorithm', 'pawn_algorithm'],
  position_keys: ['id', 'zobrist_hash', 'exact_key', 'pawn_hash', 'pawn_signature'],
  game_position_index_state: ['game_id', 'pgn_sha256', 'algorithm_id', 'indexer_version', 'scope', 'status', 'diagnostic', 'created_at', 'updated_at', 'completed_at'],
  game_position_occurrences: ['id', 'game_id', 'position_id', 'path', 'ply', 'is_mainline'],
};
const objects = {
  ...Object.fromEntries(Object.keys(tables).map(table => [table, 'table'])),
  searchable_game_position_occurrences: 'view',
  game_position_index_invalidate_pgn: 'trigger',
  position_keys_pawn_lookup: 'index',
  game_position_index_state_coverage: 'index',
  game_position_occurrences_position: 'index',
  game_position_occurrences_game: 'index',
};

/**
 * Read-only capability probe. "installed" means a structurally compatible
 * extension, not that any games are indexed or safe to return as search hits.
 * Missing is "unavailable"; damaged or older partial installs are incompatible.
 */
export function positionIndexCapability(db) {
  const names = Object.keys(objects);
  const placeholders = names.map(() => '?').join(',');
  const existing = new Map(db.prepare(
    'SELECT name, type FROM sqlite_master WHERE name IN (' + placeholders + ')',
  ).all(...names).map(row => [row.name, row.type]));
  if (!existing.size) return { status: 'unavailable' };
  for (const [name, type] of Object.entries(objects)) {
    if (existing.get(name) !== type) return { status: 'incompatible' };
  }
  for (const [table, columns] of Object.entries(tables)) {
    const actual = new Set(db.pragma('table_info(' + table + ')').map(row => row.name));
    if (columns.some(column => !actual.has(column))) return { status: 'incompatible' };
  }
  const info = db.prepare(
    'SELECT schema_version,hash_algorithm,pawn_algorithm FROM position_index_meta WHERE singleton=1',
  ).get();
  if (info?.schema_version !== POSITION_INDEX_SCHEMA_VERSION ||
      info.hash_algorithm !== POSITION_HASH_ALGORITHM ||
      info.pawn_algorithm !== PAWN_HASH_ALGORITHM) return { status: 'incompatible' };
  const unique = db.pragma('index_list(position_keys)').some(index =>
    index.unique && db.pragma('index_info(' + index.name + ')')
      .map(column => column.name).join(',') === 'zobrist_hash,exact_key');
  if (!unique) return { status: 'incompatible' };
  return {
    status: 'installed',
    schemaVersion: POSITION_INDEX_SCHEMA_VERSION,
    hashAlgorithm: POSITION_HASH_ALGORITHM,
    pawnAlgorithm: PAWN_HASH_ALGORITHM,
  };
}
