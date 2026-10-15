-- Keep the common PGN archive, with independent content and source-state labels.
ALTER TABLE games ADD COLUMN record_kind TEXT NOT NULL DEFAULT 'game'
    CHECK (record_kind IN ('game', 'position', 'line', 'text'));
ALTER TABLE games ADD COLUMN is_training INTEGER NOT NULL DEFAULT 0 CHECK (is_training IN (0, 1));
ALTER TABLE games ADD COLUMN training_magnitude INTEGER NOT NULL DEFAULT 0 CHECK (training_magnitude >= 0);
ALTER TABLE games ADD COLUMN is_deleted INTEGER NOT NULL DEFAULT 0 CHECK (is_deleted IN (0, 1));
ALTER TABLE games ADD COLUMN start_fen TEXT;

-- Derive only what existing PGNs establish. Reimport fills original source flags.
UPDATE games SET record_kind = CASE
    WHEN game_type = 'guiding-text' THEN 'text'
    WHEN json_extract(headers_json, '$.SetUp') = '1' THEN 'position'
    WHEN white IS NULL OR black IS NULL OR white IN ('', '?', 'NN') OR black IN ('', '?', 'NN') THEN 'line'
    ELSE 'game' END,
    start_fen = json_extract(headers_json, '$.FEN');

CREATE INDEX games_record_kind_idx ON games(record_kind);
CREATE INDEX games_is_training_idx ON games(is_training);
CREATE INDEX games_is_deleted_idx ON games(is_deleted);
