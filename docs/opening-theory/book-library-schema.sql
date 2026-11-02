PRAGMA user_version = 1;
CREATE TABLE import_runs (
 id INTEGER PRIMARY KEY, started_at TEXT NOT NULL, finished_at TEXT,
 status TEXT NOT NULL, validation_status TEXT NOT NULL DEFAULT 'not_run',
 options_json TEXT NOT NULL, summary_json TEXT
);
CREATE TABLE source_databases (
 id INTEGER PRIMARY KEY, import_run_id INTEGER NOT NULL REFERENCES import_runs(id),
 relative_path TEXT NOT NULL UNIQUE, absolute_path TEXT NOT NULL,
 file_name TEXT NOT NULL, format TEXT NOT NULL, role TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending', source_record_count INTEGER,
 emitted_record_count INTEGER DEFAULT 0, excluded_record_count INTEGER DEFAULT 0,
 recovery_actions_json TEXT NOT NULL DEFAULT '[]', diagnostics_json TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE source_files (
 id INTEGER PRIMARY KEY, database_id INTEGER NOT NULL REFERENCES source_databases(id),
 path TEXT NOT NULL, extension TEXT NOT NULL, byte_size INTEGER NOT NULL,
 mtime_ns INTEGER NOT NULL, original_file_header BLOB
);
CREATE TABLE source_records (
 id INTEGER PRIMARY KEY, database_id INTEGER NOT NULL REFERENCES source_databases(id),
 source_record_id INTEGER NOT NULL, record_type TEXT NOT NULL,
 source_deleted INTEGER NOT NULL, moves_offset INTEGER, annotations_offset INTEGER,
 header_json TEXT NOT NULL, extended_header_json TEXT,
 original_header BLOB, original_extended_header BLOB,
 original_move_framing BLOB, original_annotation_framing BLOB,
 raw_moves_zlib BLOB, raw_annotations_zlib BLOB,
 raw_blob_encoding TEXT NOT NULL DEFAULT 'zlib',
 decode_status TEXT NOT NULL, errors_json TEXT NOT NULL DEFAULT '[]',
 diagnostics_json TEXT NOT NULL DEFAULT '[]', decoder_metadata_json TEXT NOT NULL,
 UNIQUE(database_id,source_record_id)
);
CREATE TABLE source_entities (
 id INTEGER PRIMARY KEY, database_id INTEGER NOT NULL REFERENCES source_databases(id),
 entity_kind TEXT NOT NULL, source_entity_id INTEGER NOT NULL,
 fields_json TEXT NOT NULL, original_entity_record BLOB,
 UNIQUE(database_id,entity_kind,source_entity_id)
);
CREATE TABLE record_entities (
 record_id INTEGER NOT NULL REFERENCES source_records(id), role TEXT NOT NULL,
 entity_id INTEGER NOT NULL REFERENCES source_entities(id), PRIMARY KEY(record_id,role)
);
CREATE TABLE game_identities (
 id INTEGER PRIMARY KEY, identity_key TEXT NOT NULL UNIQUE,
 identity_fields_json TEXT NOT NULL, method TEXT NOT NULL DEFAULT 'exact_decoded_header_fields',
 validation_status TEXT NOT NULL DEFAULT 'not_run'
);
CREATE TABLE games (
 id INTEGER PRIMARY KEY REFERENCES source_records(id),
 identity_id INTEGER REFERENCES game_identities(id),
 white TEXT, black TEXT, event TEXT, site TEXT, played_date TEXT,
 round INTEGER, subround INTEGER, result TEXT, eco TEXT,
 white_elo INTEGER, black_elo INTEGER, annotator TEXT,
 header_fields_json TEXT NOT NULL, start_fen TEXT,
 main_line_ply INTEGER, all_lines_ply INTEGER,
 moves_pgn TEXT, derived_pgn TEXT,
 annotations_decode_status TEXT NOT NULL, dto_metadata_json TEXT NOT NULL
);
CREATE INDEX games_names_date ON games(white,black,played_date);
CREATE INDEX games_identity ON games(identity_id);
CREATE INDEX games_eco ON games(eco);
CREATE TABLE game_annotations (
 id INTEGER PRIMARY KEY, game_id INTEGER NOT NULL REFERENCES games(id),
 sequence INTEGER NOT NULL, move_index INTEGER, annotation_type TEXT NOT NULL,
 language TEXT, text TEXT, payload_json TEXT NOT NULL, UNIQUE(game_id,sequence)
);
CREATE INDEX annotations_game_position ON game_annotations(game_id,move_index);
CREATE TABLE articles (
 id INTEGER PRIMARY KEY REFERENCES source_records(id), primary_title TEXT,
 text_format INTEGER, unknown_format_field INTEGER, header_json TEXT NOT NULL
);
CREATE TABLE article_bodies (
 id INTEGER PRIMARY KEY, article_id INTEGER NOT NULL REFERENCES articles(id),
 language TEXT NOT NULL, title TEXT, content TEXT NOT NULL,
 formatting BLOB, UNIQUE(article_id,language)
);
CREATE TABLE article_links (
 id INTEGER PRIMARY KEY, body_id INTEGER NOT NULL REFERENCES article_bodies(id),
 ordinal INTEGER NOT NULL, line INTEGER, column_no INTEGER,
 raw_start_tag TEXT NOT NULL, href TEXT NOT NULL, label TEXT,
 link_type TEXT, arguments_json TEXT NOT NULL,
 target_database_path TEXT, target_record_hint TEXT, position_hint TEXT,
 target_record_id INTEGER REFERENCES source_records(id),
 resolution_status TEXT NOT NULL DEFAULT 'pending', resolution_json TEXT NOT NULL DEFAULT '{}',
 UNIQUE(body_id,ordinal)
);
CREATE INDEX links_resolution ON article_links(resolution_status);
CREATE TABLE article_game_relations (
 id INTEGER PRIMARY KEY, article_id INTEGER NOT NULL REFERENCES articles(id),
 game_id INTEGER NOT NULL REFERENCES games(id), relation_type TEXT NOT NULL,
 link_id INTEGER REFERENCES article_links(id), position_hint TEXT,
 evidence_json TEXT NOT NULL, validation_status TEXT NOT NULL DEFAULT 'not_run'
);
CREATE INDEX article_games_article ON article_game_relations(article_id);
CREATE INDEX article_games_game ON article_game_relations(game_id);
CREATE TABLE article_link_candidates (
 link_id INTEGER NOT NULL REFERENCES article_links(id), game_id INTEGER NOT NULL REFERENCES games(id),
 evidence_json TEXT NOT NULL, PRIMARY KEY(link_id,game_id)
);
CREATE VIEW article_game_occurrences AS
 SELECT r.article_id,r.game_id AS linked_game_id,g.id AS occurrence_game_id,
        r.relation_type,r.link_id,r.position_hint,
        CASE WHEN g.id=r.game_id THEN 'direct' ELSE 'same_header_identity_unvalidated' END AS occurrence_basis
 FROM article_game_relations r JOIN games direct ON direct.id=r.game_id
 JOIN games g ON g.id=direct.id OR (direct.identity_id IS NOT NULL AND g.identity_id=direct.identity_id);
CREATE VIEW game_catalog AS
 SELECT g.*,s.database_id,s.source_record_id,s.source_deleted,s.decode_status,
 d.relative_path AS source_database,d.role AS source_role
 FROM games g JOIN source_records s ON s.id=g.id JOIN source_databases d ON d.id=s.database_id;
CREATE VIEW article_catalog AS
 SELECT a.*,s.database_id,s.source_record_id,s.decode_status,d.relative_path AS source_database
 FROM articles a JOIN source_records s ON s.id=a.id JOIN source_databases d ON d.id=s.database_id;
