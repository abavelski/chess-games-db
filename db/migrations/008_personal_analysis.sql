-- Optional, additive personal-analysis storage for schema-7 games archives.
-- Apply on explicit personal-analysis save (or when creating a fresh archive).
-- Browsing an existing archive remains read-only. Keep user_version at 7:
-- the base games schema and all existing maintenance tools remain compatible.
-- IF NOT EXISTS preserves data saved by earlier builds that created this
-- exact table lazily. The caller owns the transaction and foreign-key setup.
CREATE TABLE IF NOT EXISTS game_personal_analysis (
    game_id INTEGER PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE,
    data_json TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
