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
