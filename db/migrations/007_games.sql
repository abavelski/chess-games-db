-- Fresh v7 schema. Legacy archives require the explicit converter.
CREATE TABLE sources (
 id INTEGER PRIMARY KEY, source_key TEXT NOT NULL UNIQUE CHECK(length(trim(source_key))>0),
 kind TEXT NOT NULL DEFAULT 'other' CHECK(kind IN ('book','website','pgn_collection','manual','other')),
 title TEXT NOT NULL, author TEXT, url TEXT, original_file TEXT,
 parent_id INTEGER REFERENCES sources(id) ON DELETE RESTRICT,
 extras_json TEXT CHECK(extras_json IS NULL OR (json_valid(extras_json) AND json_type(extras_json)='object')),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE players(id INTEGER PRIMARY KEY, display_name TEXT NOT NULL UNIQUE CHECK(length(display_name)>0), search_key TEXT NOT NULL);
CREATE INDEX players_search ON players(search_key,id);
CREATE TABLE annotators(id INTEGER PRIMARY KEY, display_name TEXT NOT NULL UNIQUE CHECK(length(display_name)>0), search_key TEXT NOT NULL);
CREATE INDEX annotators_search ON annotators(search_key,id);
CREATE TABLE events(id INTEGER PRIMARY KEY, display_name TEXT NOT NULL UNIQUE CHECK(length(display_name)>0), search_key TEXT NOT NULL);
CREATE INDEX events_search ON events(search_key,id);
CREATE TABLE sites(id INTEGER PRIMARY KEY, display_name TEXT NOT NULL UNIQUE CHECK(length(display_name)>0), search_key TEXT NOT NULL);
CREATE INDEX sites_search ON sites(search_key,id);
CREATE TABLE games (
 id INTEGER PRIMARY KEY, game_key TEXT NOT NULL UNIQUE CHECK(length(trim(game_key))>0),
 white TEXT, black TEXT, event TEXT, site TEXT, annotator TEXT, date TEXT,
 year INTEGER CHECK(year IS NULL OR (typeof(year)='integer' AND year BETWEEN 1 AND 9999)),
 event_id INTEGER REFERENCES events(id) ON DELETE RESTRICT, site_id INTEGER REFERENCES sites(id) ON DELETE RESTRICT,
 result TEXT, result_code TEXT NOT NULL CHECK(result_code IN ('white_win','black_win','draw','unfinished','unknown')),
 completeness TEXT NOT NULL DEFAULT 'unknown' CHECK(completeness IN ('complete','partial','unknown')), completeness_evidence TEXT,
 eco TEXT, game_type TEXT, start_fen TEXT, hidden INTEGER NOT NULL DEFAULT 0 CHECK(hidden IN (0,1)),
 headers_json TEXT NOT NULL CHECK(json_valid(headers_json) AND json_type(headers_json)='object'),
 extras_json TEXT CHECK(extras_json IS NULL OR (json_valid(extras_json) AND json_type(extras_json)='object')),
 pgn_zstd BLOB NOT NULL CHECK(typeof(pgn_zstd)='blob' AND length(pgn_zstd)>0),
 pgn_sha256 TEXT NOT NULL CHECK(length(pgn_sha256)=64 AND pgn_sha256 NOT GLOB '*[^0-9a-f]*'),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE game_players (
 game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
 player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE RESTRICT,
 role TEXT NOT NULL CHECK(role IN ('white','black')), original_name TEXT NOT NULL, PRIMARY KEY(game_id,role)
);
CREATE INDEX game_players_reverse ON game_players(player_id,role,game_id);
CREATE TABLE game_annotators (
 game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
 annotator_id INTEGER NOT NULL REFERENCES annotators(id) ON DELETE RESTRICT,
 original_credit TEXT NOT NULL, credit_order INTEGER NOT NULL CHECK(credit_order>=0),
 PRIMARY KEY(game_id,annotator_id), UNIQUE(game_id,credit_order)
);
CREATE INDEX game_annotators_reverse ON game_annotators(annotator_id,game_id);
CREATE TABLE game_sources (
 id INTEGER PRIMARY KEY, game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
 source_id INTEGER NOT NULL REFERENCES sources(id) ON DELETE RESTRICT,
 source_game_key TEXT NOT NULL CHECK(length(trim(source_game_key))>0), locator TEXT, url TEXT, section TEXT, sequence INTEGER,
 is_primary INTEGER NOT NULL DEFAULT 0 CHECK(is_primary IN (0,1)),
 UNIQUE(source_id,source_game_key), UNIQUE(game_id,source_id,source_game_key)
);
CREATE INDEX game_sources_game ON game_sources(game_id,source_id);
CREATE UNIQUE INDEX game_sources_primary ON game_sources(game_id) WHERE is_primary=1;
CREATE TABLE game_features (
 game_id INTEGER PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE,
 pgn_sha256 TEXT NOT NULL CHECK(length(pgn_sha256)=64 AND pgn_sha256 NOT GLOB '*[^0-9a-f]*'),
 extractor_version TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('pending','complete','error')),
 critical_position_count INTEGER CHECK(critical_position_count>=0), medal_count INTEGER CHECK(medal_count>=0),
 comments INTEGER CHECK(comments IN (0,1)), variations INTEGER CHECK(variations IN (0,1)),
 nags INTEGER CHECK(nags IN (0,1)), board_annotations INTEGER CHECK(board_annotations IN (0,1)), annotated INTEGER CHECK(annotated IN (0,1)),
 diagnostic TEXT, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK(status='complete' OR (critical_position_count IS NULL AND medal_count IS NULL AND comments IS NULL AND variations IS NULL AND nags IS NULL AND board_annotations IS NULL AND annotated IS NULL)),
 CHECK(status!='complete' OR (critical_position_count IS NOT NULL AND medal_count IS NOT NULL AND comments IS NOT NULL AND variations IS NOT NULL AND nags IS NOT NULL AND board_annotations IS NOT NULL AND annotated IS NOT NULL))
);
CREATE TABLE property_options (
 property_key TEXT NOT NULL, value_key TEXT NOT NULL, label TEXT NOT NULL, search_key TEXT NOT NULL, numeric_value INTEGER,
 game_count INTEGER NOT NULL CHECK(game_count>=0), PRIMARY KEY(property_key,value_key)
);
CREATE INDEX property_options_search ON property_options(property_key,search_key,value_key);
CREATE TABLE property_cache_state (
 singleton INTEGER PRIMARY KEY CHECK(singleton=1), content_revision INTEGER NOT NULL DEFAULT 0,
 cache_revision INTEGER NOT NULL DEFAULT 0, algorithm_version TEXT NOT NULL DEFAULT 'properties-1', built_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO property_cache_state(singleton) VALUES(1);
CREATE TABLE migration_manifest (singleton INTEGER PRIMARY KEY CHECK(singleton=1), manifest_json TEXT NOT NULL CHECK(json_valid(manifest_json)));
CREATE INDEX games_year_v7 ON games(year,id);
CREATE INDEX games_result_code_v7 ON games(result_code,id);
CREATE INDEX games_completeness_v7 ON games(completeness,id);
CREATE INDEX games_event_id_v7 ON games(event_id,id);
CREATE INDEX games_site_id_v7 ON games(site_id,id);
CREATE INDEX games_pgn_sha256_v7 ON games(pgn_sha256,id);
CREATE INDEX games_eco_v7 ON games(eco,id);
CREATE INDEX games_hidden_v7 ON games(hidden,id);
-- Derived data only. A single pointer publishes a completed revision atomically.
CREATE TABLE opening_revisions (
    id TEXT PRIMARY KEY,
    upstream_commit TEXT NOT NULL,
    content_sha256 TEXT NOT NULL,
    algorithm_version TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'staging' CHECK (status IN ('staging', 'complete')),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    completed_at TEXT
);
CREATE TABLE opening_state (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    revision_id TEXT NOT NULL REFERENCES opening_revisions(id)
);
CREATE TABLE opening_nodes (
    revision_id TEXT NOT NULL REFERENCES opening_revisions(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    label TEXT NOT NULL,
    path_json TEXT NOT NULL CHECK (json_valid(path_json)),
    parent_id TEXT,
    PRIMARY KEY (revision_id, id),
    FOREIGN KEY (revision_id, parent_id) REFERENCES opening_nodes(revision_id, id)
);
CREATE INDEX opening_nodes_parent ON opening_nodes(revision_id, parent_id);
CREATE TABLE opening_entries (
    revision_id TEXT NOT NULL,
    id TEXT NOT NULL,
    node_id TEXT NOT NULL,
    eco TEXT NOT NULL,
    name TEXT NOT NULL,
    pgn TEXT NOT NULL,
    uci TEXT NOT NULL,
    position_key TEXT NOT NULL,
    PRIMARY KEY (revision_id, id),
    FOREIGN KEY (revision_id, node_id) REFERENCES opening_nodes(revision_id, id)
);
CREATE INDEX opening_entries_position ON opening_entries(revision_id, position_key);
CREATE TABLE game_openings (
    revision_id TEXT NOT NULL REFERENCES opening_revisions(id) ON DELETE CASCADE,
    game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    pgn_sha256 TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('matched', 'unmatched', 'invalid')),
    primary_entry_id TEXT,
    matched_ply INTEGER,
    diagnostic TEXT,
    PRIMARY KEY (revision_id, game_id),
    FOREIGN KEY (revision_id, primary_entry_id) REFERENCES opening_entries(revision_id, id),
    CHECK ((status = 'matched' AND primary_entry_id IS NOT NULL AND matched_ply > 0)
        OR (status != 'matched' AND primary_entry_id IS NULL AND matched_ply IS NULL))
);
CREATE TABLE game_opening_matches (
    revision_id TEXT NOT NULL,
    game_id INTEGER NOT NULL,
    entry_id TEXT NOT NULL,
    ply INTEGER NOT NULL CHECK (ply > 0),
    PRIMARY KEY (revision_id, game_id, entry_id, ply),
    FOREIGN KEY (revision_id, game_id) REFERENCES game_openings(revision_id, game_id) ON DELETE CASCADE,
    FOREIGN KEY (revision_id, entry_id) REFERENCES opening_entries(revision_id, id)
);
CREATE INDEX game_opening_matches_entry ON game_opening_matches(revision_id, entry_id, game_id);
CREATE INDEX game_openings_game ON game_openings(game_id,revision_id);
CREATE INDEX game_opening_matches_game ON game_opening_matches(game_id,revision_id);
CREATE VIEW game_property_values AS
SELECT g.id game_id, 'players' property_key, CAST(d.id AS TEXT) value_key, d.display_name label, NULL numeric_value FROM games g JOIN game_players l ON l.game_id=g.id JOIN players d ON d.id=l.player_id WHERE g.hidden=0 AND 1
UNION
SELECT g.id game_id, 'players' property_key, CAST('missing' AS TEXT) value_key, 'Missing' label, NULL numeric_value FROM games g  WHERE g.hidden=0 AND NOT EXISTS(SELECT 1 FROM game_players l WHERE l.game_id=g.id)
UNION
SELECT g.id game_id, 'white' property_key, CAST(d.id AS TEXT) value_key, d.display_name label, NULL numeric_value FROM games g JOIN game_players l ON l.game_id=g.id JOIN players d ON d.id=l.player_id WHERE g.hidden=0 AND l.role='white'
UNION
SELECT g.id game_id, 'white' property_key, CAST('missing' AS TEXT) value_key, 'Missing' label, NULL numeric_value FROM games g  WHERE g.hidden=0 AND NOT EXISTS(SELECT 1 FROM game_players l WHERE l.game_id=g.id AND l.role='white')
UNION
SELECT g.id game_id, 'black' property_key, CAST(d.id AS TEXT) value_key, d.display_name label, NULL numeric_value FROM games g JOIN game_players l ON l.game_id=g.id JOIN players d ON d.id=l.player_id WHERE g.hidden=0 AND l.role='black'
UNION
SELECT g.id game_id, 'black' property_key, CAST('missing' AS TEXT) value_key, 'Missing' label, NULL numeric_value FROM games g  WHERE g.hidden=0 AND NOT EXISTS(SELECT 1 FROM game_players l WHERE l.game_id=g.id AND l.role='black')
UNION
SELECT g.id game_id, 'annotators' property_key, CAST(d.id AS TEXT) value_key, d.display_name label, NULL numeric_value FROM games g JOIN game_annotators l ON l.game_id=g.id JOIN annotators d ON d.id=l.annotator_id WHERE g.hidden=0 AND 1
UNION
SELECT g.id game_id, 'annotators' property_key, CAST('missing' AS TEXT) value_key, 'Missing' label, NULL numeric_value FROM games g  WHERE g.hidden=0 AND NOT EXISTS(SELECT 1 FROM game_annotators l WHERE l.game_id=g.id)
UNION
SELECT g.id game_id, 'source' property_key, CAST(d.id AS TEXT) value_key, d.title label, NULL numeric_value FROM games g JOIN game_sources l ON l.game_id=g.id JOIN sources d ON d.id=l.source_id WHERE g.hidden=0 AND 1
UNION
SELECT g.id game_id, 'source' property_key, CAST('missing' AS TEXT) value_key, 'Missing' label, NULL numeric_value FROM games g  WHERE g.hidden=0 AND NOT EXISTS(SELECT 1 FROM game_sources l WHERE l.game_id=g.id)
UNION
SELECT g.id game_id, 'sourceType' property_key, CAST(s.kind AS TEXT) value_key, s.kind label, NULL numeric_value FROM games g JOIN game_sources l ON l.game_id=g.id JOIN sources s ON s.id=l.source_id WHERE g.hidden=0 AND 1
UNION
SELECT g.id game_id, 'sourceType' property_key, CAST('missing' AS TEXT) value_key, 'Missing' label, NULL numeric_value FROM games g  WHERE g.hidden=0 AND NOT EXISTS(SELECT 1 FROM game_sources l WHERE l.game_id=g.id)
UNION
SELECT g.id game_id, 'event' property_key, CAST(d.id AS TEXT) value_key, d.display_name label, NULL numeric_value FROM games g JOIN events d ON d.id=g.event_id WHERE g.hidden=0 AND 1
UNION
SELECT g.id game_id, 'event' property_key, CAST('missing' AS TEXT) value_key, 'Missing' label, NULL numeric_value FROM games g  WHERE g.hidden=0 AND g.event_id IS NULL
UNION
SELECT g.id game_id, 'site' property_key, CAST(d.id AS TEXT) value_key, d.display_name label, NULL numeric_value FROM games g JOIN sites d ON d.id=g.site_id WHERE g.hidden=0 AND 1
UNION
SELECT g.id game_id, 'site' property_key, CAST('missing' AS TEXT) value_key, 'Missing' label, NULL numeric_value FROM games g  WHERE g.hidden=0 AND g.site_id IS NULL
UNION
SELECT g.id game_id, 'year' property_key, CAST(coalesce(g.year,'missing') AS TEXT) value_key, coalesce(CAST(g.year AS TEXT),'Missing') label, g.year numeric_value FROM games g  WHERE g.hidden=0 AND 1
UNION
SELECT g.id game_id, 'result' property_key, CAST(coalesce(g.result_code,'missing') AS TEXT) value_key, coalesce(CAST(g.result_code AS TEXT),'Missing') label, NULL numeric_value FROM games g  WHERE g.hidden=0 AND 1
UNION
SELECT g.id game_id, 'completeness' property_key, CAST(coalesce(g.completeness,'missing') AS TEXT) value_key, coalesce(CAST(g.completeness AS TEXT),'Missing') label, NULL numeric_value FROM games g  WHERE g.hidden=0 AND 1
UNION
SELECT g.id game_id, 'eco' property_key, CAST(coalesce(g.eco,'missing') AS TEXT) value_key, coalesce(CAST(g.eco AS TEXT),'Missing') label, NULL numeric_value FROM games g  WHERE g.hidden=0 AND 1
UNION
SELECT g.id game_id, 'annotations' property_key, CAST(CASE WHEN f.status='complete' AND f.pgn_sha256=g.pgn_sha256 THEN CASE WHEN f.annotated THEN 'yes' ELSE 'no' END ELSE 'unknown' END AS TEXT) value_key, CASE WHEN f.status='complete' AND f.pgn_sha256=g.pgn_sha256 THEN CASE WHEN f.annotated THEN 'Yes' ELSE 'No' END ELSE 'Unknown' END label, NULL numeric_value FROM games g LEFT JOIN game_features f ON f.game_id=g.id WHERE g.hidden=0 AND 1
UNION
SELECT g.id game_id, 'medals' property_key, CAST(CASE WHEN f.status='complete' AND f.pgn_sha256=g.pgn_sha256 THEN CASE WHEN f.medal_count>0 THEN 'yes' ELSE 'no' END ELSE 'unknown' END AS TEXT) value_key, CASE WHEN f.status='complete' AND f.pgn_sha256=g.pgn_sha256 THEN CASE WHEN f.medal_count>0 THEN 'Yes' ELSE 'No' END ELSE 'Unknown' END label, NULL numeric_value FROM games g LEFT JOIN game_features f ON f.game_id=g.id WHERE g.hidden=0 AND 1
UNION
SELECT g.id game_id, 'criticalPositions' property_key, CAST(CASE WHEN f.status='complete' AND f.pgn_sha256=g.pgn_sha256 THEN CASE WHEN f.critical_position_count>0 THEN 'yes' ELSE 'no' END ELSE 'unknown' END AS TEXT) value_key, CASE WHEN f.status='complete' AND f.pgn_sha256=g.pgn_sha256 THEN CASE WHEN f.critical_position_count>0 THEN 'Yes' ELSE 'No' END ELSE 'Unknown' END label, NULL numeric_value FROM games g LEFT JOIN game_features f ON f.game_id=g.id WHERE g.hidden=0 AND 1
UNION
SELECT g.id game_id, 'studyMarkers' property_key, CAST(CASE WHEN f.status='complete' AND f.pgn_sha256=g.pgn_sha256 THEN CASE WHEN (f.medal_count>0 OR f.critical_position_count>0) THEN 'yes' ELSE 'no' END ELSE 'unknown' END AS TEXT) value_key, CASE WHEN f.status='complete' AND f.pgn_sha256=g.pgn_sha256 THEN CASE WHEN (f.medal_count>0 OR f.critical_position_count>0) THEN 'Yes' ELSE 'No' END ELSE 'Unknown' END label, NULL numeric_value FROM games g LEFT JOIN game_features f ON f.game_id=g.id WHERE g.hidden=0 AND 1;
