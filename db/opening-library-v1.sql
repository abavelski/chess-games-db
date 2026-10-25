PRAGMA application_id = 1330924610;
PRAGMA user_version = 1;
CREATE TABLE library_manifest (
 id INTEGER PRIMARY KEY CHECK(id=1), format TEXT NOT NULL CHECK(format='opening-study-library'),
 schema_version INTEGER NOT NULL CHECK(schema_version=1), library_uuid TEXT NOT NULL,
 revision TEXT NOT NULL, corpus TEXT NOT NULL, source_hash TEXT NOT NULL,
 builder_versions TEXT NOT NULL CHECK(json_valid(builder_versions)),
 status TEXT NOT NULL CHECK(status IN ('building','validating','ready')),
 created_at TEXT NOT NULL, capabilities TEXT NOT NULL CHECK(json_valid(capabilities)),
 coverage TEXT NOT NULL CHECK(json_valid(coverage))
);
CREATE TABLE source_collections (
 id INTEGER PRIMARY KEY, stable_key TEXT NOT NULL UNIQUE, original_path TEXT NOT NULL,
 normalized_path TEXT NOT NULL UNIQUE, format TEXT NOT NULL,
 role TEXT NOT NULL CHECK(role IN ('main_games','theory')), provenance TEXT NOT NULL CHECK(json_valid(provenance))
);
CREATE TABLE source_items (
 id INTEGER PRIMARY KEY, stable_key TEXT NOT NULL UNIQUE,
 collection_id INTEGER NOT NULL REFERENCES source_collections(id), native_id INTEGER NOT NULL CHECK(native_id>0),
 kind TEXT NOT NULL CHECK(kind IN ('game','article')), deleted INTEGER NOT NULL CHECK(deleted IN (0,1)),
 input_hash TEXT NOT NULL, decode_status TEXT NOT NULL,
 validation_status TEXT NOT NULL CHECK(validation_status IN ('pending','accepted','metadata_only','quarantined','deleted')),
 UNIQUE(collection_id,native_id)
);
CREATE TABLE build_record_state (
 item_id INTEGER PRIMARY KEY REFERENCES source_items(id), input_hash TEXT NOT NULL,
 converter_version TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('pending','complete')),
 node_count INTEGER NOT NULL DEFAULT 0 CHECK(node_count>=0),
 annotation_count INTEGER NOT NULL DEFAULT 0 CHECK(annotation_count>=0), checkpoint TEXT
);
CREATE TABLE quality_issues (
 id INTEGER PRIMARY KEY, item_id INTEGER REFERENCES source_items(id), stage TEXT NOT NULL,
 severity TEXT NOT NULL CHECK(severity IN ('info','warning','error')), code TEXT NOT NULL,
 source_location TEXT, detail TEXT NOT NULL CHECK(length(detail)<=8192), disposition TEXT NOT NULL
);
CREATE TABLE positions (
 id INTEGER PRIMARY KEY, hash INTEGER NOT NULL, exact_key TEXT NOT NULL, UNIQUE(hash,exact_key)
);
CREATE TABLE prefix_roots (
 id INTEGER PRIMARY KEY, position_id INTEGER NOT NULL UNIQUE REFERENCES positions(id)
);
CREATE TABLE move_prefixes (
 id INTEGER PRIMARY KEY, root_id INTEGER NOT NULL REFERENCES prefix_roots(id),
 parent_id INTEGER REFERENCES move_prefixes(id), depth INTEGER NOT NULL CHECK(depth>=0),
 move_uci TEXT, position_id INTEGER NOT NULL REFERENCES positions(id),
 CHECK((parent_id IS NULL AND depth=0 AND move_uci IS NULL) OR (parent_id IS NOT NULL AND depth>0 AND move_uci IS NOT NULL))
);
CREATE UNIQUE INDEX prefix_root_unique ON move_prefixes(root_id) WHERE parent_id IS NULL;
CREATE UNIQUE INDEX prefix_child_unique ON move_prefixes(parent_id,move_uci) WHERE parent_id IS NOT NULL;
CREATE TABLE study_documents (
 id INTEGER PRIMARY KEY, item_id INTEGER NOT NULL UNIQUE REFERENCES source_items(id),
 white TEXT, black TEXT, event TEXT, played_date TEXT, result TEXT, eco TEXT, annotator TEXT,
 search_text TEXT NOT NULL, start_fen TEXT NOT NULL, root_prefix_id INTEGER NOT NULL REFERENCES move_prefixes(id),
 tree_hash TEXT NOT NULL, annotation_hash TEXT NOT NULL,
 annotation_coverage TEXT NOT NULL CHECK(annotation_coverage IN ('complete','partial')),
 node_count INTEGER NOT NULL CHECK(node_count>=0), leaf_count INTEGER NOT NULL CHECK(leaf_count>=0)
);
CREATE TABLE study_nodes (
 id INTEGER PRIMARY KEY, document_id INTEGER NOT NULL REFERENCES study_documents(id),
 parent_id INTEGER, child_ordinal INTEGER NOT NULL CHECK(child_ordinal>=0),
 move_uci TEXT, san TEXT, ply INTEGER NOT NULL CHECK(ply>=0), source_index INTEGER NOT NULL CHECK(source_index>=-1),
 source_path TEXT NOT NULL, viewer_path TEXT NOT NULL,
 prefix_id INTEGER NOT NULL REFERENCES move_prefixes(id), position_id INTEGER NOT NULL REFERENCES positions(id),
 is_mainline INTEGER NOT NULL CHECK(is_mainline IN (0,1)),
 leaf_lo INTEGER NOT NULL CHECK(leaf_lo>=0), leaf_hi INTEGER NOT NULL CHECK(leaf_hi>leaf_lo),
 UNIQUE(document_id,id), UNIQUE(document_id,source_path), UNIQUE(document_id,source_index),
 UNIQUE(document_id,parent_id,child_ordinal),
 FOREIGN KEY(document_id,parent_id) REFERENCES study_nodes(document_id,id),
 CHECK((parent_id IS NULL AND ply=0 AND source_index=-1 AND move_uci IS NULL) OR
       (parent_id IS NOT NULL AND ply>0 AND source_index>=0 AND move_uci IS NOT NULL))
);
CREATE UNIQUE INDEX study_root_unique ON study_nodes(document_id) WHERE parent_id IS NULL;
CREATE INDEX study_prefix ON study_nodes(prefix_id,document_id,leaf_lo,leaf_hi);
CREATE INDEX study_position ON study_nodes(position_id,document_id,id);
CREATE INDEX study_children ON study_nodes(parent_id,move_uci,document_id,id);
CREATE INDEX study_order ON study_nodes(parent_id,child_ordinal);
CREATE TABLE node_annotations (
 id INTEGER PRIMARY KEY, document_id INTEGER NOT NULL REFERENCES study_documents(id), node_id INTEGER,
 source_sequence INTEGER NOT NULL CHECK(source_sequence>=0), source_type TEXT NOT NULL,
 source_language TEXT, language TEXT, placement TEXT NOT NULL CHECK(placement IN ('root','before','after')),
 payload_json TEXT NOT NULL CHECK(json_valid(payload_json)), original_json TEXT NOT NULL CHECK(json_valid(original_json)),
 payload_hash TEXT NOT NULL, support_status TEXT NOT NULL CHECK(support_status IN ('supported','unsupported','unmapped')),
 UNIQUE(document_id,source_sequence), FOREIGN KEY(document_id,node_id) REFERENCES study_nodes(document_id,id)
);
CREATE INDEX annotations_node ON node_annotations(node_id,source_sequence);
CREATE INDEX annotations_language ON node_annotations(language,document_id);
CREATE INDEX source_filter ON source_items(collection_id,validation_status,id);
CREATE TABLE articles (
 id INTEGER PRIMARY KEY, item_id INTEGER NOT NULL UNIQUE REFERENCES source_items(id),
 title TEXT NOT NULL, search_title TEXT NOT NULL
);
CREATE INDEX article_title ON articles(search_title,id);
CREATE TABLE article_versions (
 id INTEGER PRIMARY KEY, article_id INTEGER NOT NULL REFERENCES articles(id),
 source_language TEXT NOT NULL, language TEXT NOT NULL, title TEXT,
 blocks_json TEXT NOT NULL CHECK(json_valid(blocks_json)), plain_text TEXT NOT NULL,
 meaningful INTEGER NOT NULL CHECK(meaningful IN (0,1)), source_hash TEXT NOT NULL, sanitizer_version TEXT NOT NULL,
 UNIQUE(article_id,source_language)
);
CREATE TABLE article_targets (
 id INTEGER PRIMARY KEY, version_id INTEGER NOT NULL REFERENCES article_versions(id), anchor_key TEXT NOT NULL,
 kind TEXT NOT NULL, document_id INTEGER REFERENCES study_documents(id), article_id INTEGER REFERENCES articles(id),
 raw_position_hint TEXT, node_id INTEGER REFERENCES study_nodes(id), status TEXT NOT NULL,
 evidence_json TEXT NOT NULL CHECK(json_valid(evidence_json)), UNIQUE(version_id,anchor_key)
);
CREATE TABLE article_document_relations (
 id INTEGER PRIMARY KEY, article_id INTEGER NOT NULL REFERENCES articles(id),
 document_id INTEGER NOT NULL REFERENCES study_documents(id),
 evidence_kind TEXT NOT NULL CHECK(evidence_kind IN ('explicit_link','same_source')),
 UNIQUE(article_id,document_id,evidence_kind)
);
CREATE INDEX relation_document ON article_document_relations(document_id,article_id);
CREATE TABLE relation_evidence (
 id INTEGER PRIMARY KEY, relation_id INTEGER NOT NULL REFERENCES article_document_relations(id),
 source_locator TEXT NOT NULL, details_json TEXT NOT NULL CHECK(json_valid(details_json))
);
