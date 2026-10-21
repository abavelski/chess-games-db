-- PS-02: explicit, idempotent derived extension of schema 7.
-- Run: npm run position-index -- install --database PATH
-- Caller owns the transaction and enables foreign keys. Do not bump user_version.
-- Hash integers are signed SQLite INTEGER mapped from unsigned Polyglot bigint.
CREATE TABLE IF NOT EXISTS position_index_meta (
 singleton INTEGER PRIMARY KEY CHECK(singleton=1),
 schema_version INTEGER NOT NULL CHECK(schema_version=1),
 hash_algorithm TEXT NOT NULL CHECK(hash_algorithm='polyglot-standard-v1'),
 pawn_algorithm TEXT NOT NULL CHECK(pawn_algorithm='polyglot-pawns-v1')
);
INSERT OR IGNORE INTO position_index_meta VALUES(1,1,'polyglot-standard-v1','polyglot-pawns-v1');

CREATE TABLE IF NOT EXISTS position_keys (
 id INTEGER PRIMARY KEY,
 zobrist_hash INTEGER NOT NULL CHECK(typeof(zobrist_hash)='integer'),
 exact_key TEXT NOT NULL CHECK(length(exact_key) BETWEEN 5 AND 120 AND exact_key=trim(exact_key)),
 pawn_hash INTEGER NOT NULL CHECK(typeof(pawn_hash)='integer'),
 pawn_signature TEXT NOT NULL CHECK(
  length(pawn_signature)=33 AND substr(pawn_signature,17,1)=':'
  AND substr(pawn_signature,1,16) NOT GLOB '*[^0-9a-f]*'
  AND substr(pawn_signature,18,16) NOT GLOB '*[^0-9a-f]*'
 ),
 UNIQUE(zobrist_hash,exact_key)
);
CREATE INDEX IF NOT EXISTS position_keys_pawn_lookup ON position_keys(pawn_hash,pawn_signature,id);

CREATE TABLE IF NOT EXISTS game_position_index_state (
 game_id INTEGER PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE,
 pgn_sha256 TEXT NOT NULL CHECK(length(pgn_sha256)=64 AND pgn_sha256 NOT GLOB '*[^0-9a-f]*'),
 algorithm_id TEXT NOT NULL CHECK(length(trim(algorithm_id))>0),
 indexer_version TEXT NOT NULL CHECK(length(trim(indexer_version))>0),
 scope TEXT NOT NULL CHECK(scope IN ('mainline','all')),
 status TEXT NOT NULL CHECK(status IN ('building','partial','failed','complete','stale')),
 diagnostic TEXT CHECK(diagnostic IS NULL OR length(diagnostic)<=1000),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 completed_at TEXT,
 CHECK((status='complete' AND completed_at IS NOT NULL) OR (status!='complete' AND completed_at IS NULL))
);
CREATE INDEX IF NOT EXISTS game_position_index_state_coverage
 ON game_position_index_state(status,scope,algorithm_id,indexer_version,game_id);

CREATE TABLE IF NOT EXISTS game_position_occurrences (
 id INTEGER PRIMARY KEY,
 game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
 position_id INTEGER NOT NULL REFERENCES position_keys(id) ON DELETE RESTRICT,
 path TEXT NOT NULL CHECK(length(path)<=4096),
 ply INTEGER NOT NULL CHECK(typeof(ply)='integer' AND ply>=0),
 is_mainline INTEGER NOT NULL CHECK(is_mainline IN (0,1)),
 CHECK(path!='' OR (ply=0 AND is_mainline=1)),
 UNIQUE(game_id,path)
);
CREATE INDEX IF NOT EXISTS game_position_occurrences_position
 ON game_position_occurrences(position_id,is_mainline,game_id);
CREATE INDEX IF NOT EXISTS game_position_occurrences_game
 ON game_position_occurrences(game_id,is_mainline,position_id,ply);

-- Safe read surface: never yield partial/failed/stale rows or rows built for
-- different PGN bytes or a different hash standard. API consumers still bind
-- a supported indexer_version and compatible scope.
CREATE VIEW IF NOT EXISTS searchable_game_position_occurrences AS
SELECT o.id,o.game_id,o.position_id,o.path,o.ply,o.is_mainline,
 s.scope,s.indexer_version,s.algorithm_id
FROM game_position_occurrences o
JOIN games g ON g.id=o.game_id
JOIN game_position_index_state s ON s.game_id=o.game_id
WHERE s.status='complete' AND s.pgn_sha256=g.pgn_sha256
 AND s.algorithm_id='polyglot-standard-v1';

-- Invalidate in the same transaction as *any* PGN SHA update, including
-- imports outside the shared writer. Metadata-only writes are unaffected.
CREATE TRIGGER IF NOT EXISTS game_position_index_invalidate_pgn
AFTER UPDATE OF pgn_sha256 ON games
WHEN OLD.pgn_sha256!=NEW.pgn_sha256
BEGIN
 DELETE FROM game_position_occurrences WHERE game_id=NEW.id;
 UPDATE game_position_index_state
  SET status='stale',completed_at=NULL,updated_at=CURRENT_TIMESTAMP,
      diagnostic='PGN changed; rebuild position index'
 WHERE game_id=NEW.id;
END;
