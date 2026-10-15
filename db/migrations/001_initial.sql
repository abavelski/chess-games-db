-- Applied transactionally by scripts/init-db.py; version is tracked in user_version.
CREATE TABLE sources (
    id INTEGER PRIMARY KEY,
    source_key TEXT NOT NULL UNIQUE CHECK (length(trim(source_key)) > 0),
    title TEXT NOT NULL,
    author TEXT,
    original_file TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE games (
    id INTEGER PRIMARY KEY,
    source_id INTEGER NOT NULL REFERENCES sources(id) ON DELETE RESTRICT,
    source_game_key TEXT NOT NULL CHECK (length(trim(source_game_key)) > 0),
    white TEXT,
    black TEXT,
    event TEXT,
    site TEXT,
    date TEXT,
    year INTEGER CHECK (year IS NULL OR (typeof(year) = 'integer' AND year BETWEEN 1 AND 9999)),
    result TEXT,
    eco TEXT,
    game_type TEXT,
    annotator TEXT,
    headers_json TEXT NOT NULL DEFAULT '{}'
        CHECK (json_valid(headers_json) AND json_type(headers_json) = 'object'),
    pgn_zstd BLOB NOT NULL CHECK (typeof(pgn_zstd) = 'blob' AND length(pgn_zstd) > 0),
    pgn_sha256 TEXT NOT NULL CHECK (
        length(pgn_sha256) = 64 AND pgn_sha256 NOT GLOB '*[^0-9a-f]*'
    ),
    extras_json TEXT CHECK (
        extras_json IS NULL OR (json_valid(extras_json) AND json_type(extras_json) = 'object')
    ),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (source_id, source_game_key)
);

-- The unique (source_id, source_game_key) index also serves source-only queries.
CREATE INDEX games_white_idx ON games(white);
CREATE INDEX games_black_idx ON games(black);
CREATE INDEX games_year_idx ON games(year);
CREATE INDEX games_eco_idx ON games(eco);
CREATE INDEX games_event_idx ON games(event);
CREATE INDEX games_annotator_idx ON games(annotator);
CREATE INDEX games_pgn_sha256_idx ON games(pgn_sha256);
