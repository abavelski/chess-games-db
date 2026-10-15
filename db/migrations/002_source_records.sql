ALTER TABLE sources ADD COLUMN extras_json TEXT CHECK (
    extras_json IS NULL OR (json_valid(extras_json) AND json_type(extras_json) = 'object')
);

-- Includes guiding texts and failed records, keyed in the unfiltered CB record order.
CREATE TABLE source_records (
    id INTEGER PRIMARY KEY,
    source_id INTEGER NOT NULL REFERENCES sources(id) ON DELETE RESTRICT,
    source_record_key TEXT NOT NULL CHECK (length(trim(source_record_key)) > 0),
    record_type TEXT NOT NULL CHECK (record_type IN ('game', 'text')),
    status TEXT NOT NULL CHECK (status IN ('extracted', 'failed')),
    raw_moves BLOB,
    raw_annotations BLOB,
    metadata_json TEXT NOT NULL CHECK (json_valid(metadata_json) AND json_type(metadata_json) = 'object'),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (source_id, source_record_key)
);
