# Database structure

## Initialization

From the project root:

```sh
python3 scripts/init-db.py data/chess-books.sqlite3
```

Requires Python 3 with SQLite foreign key and JSON function support (SQLite
3.38+ includes JSON by default). No Python packages, Java dependencies, or
Zstandard library are needed to initialize the database. The path is relative
to the working directory; parent directories are created as needed.

The initializer applies numbered migrations through `003_record_classification.sql`
and sets SQLite's `PRAGMA user_version` to `3` in one transaction. Existing
version-1/2 databases are upgraded without losing rows. Repeating initialization
on a version-3 database preserves all rows. An immediate write transaction serializes
concurrent initializers; failures roll back schema changes and the version.
Newer schema versions are rejected. An unversioned database with conflicting
tables fails rather than silently adopting an unknown schema. Future schema
changes should add numbered migrations and extend the initializer; do not edit
an already applied migration. The SQL file is intended for this runner.

**Every future database connection must execute `PRAGMA foreign_keys = ON`
before starting a transaction.** This is a connection setting, not a persistent
property of the database file. The initializer enables and verifies it for its
own connection.

## Structure

There are three tables: `sources`, `games`, and `source_records`. Integer primary keys are internal join keys; stable
import identities are the text keys described below. Optional unknown fields
use SQL `NULL`. Text is Unicode. All three tables have UTC `created_at` and
`updated_at` timestamps in `YYYY-MM-DDTHH:MM:SS.sssZ` format, defaulting to now.
Importers preserve `created_at` and explicitly set `updated_at` during updates;
there are no timestamp triggers.

### `sources`: books

| Field | Meaning |
| --- | --- |
| `id` | Integer primary key. |
| `source_key` | Required, nonempty, unique stable book identity. |
| `title` | Required book title. |
| `author` | Author/editor text, nullable. |
| `original_file` | Original file name or provenance path, nullable; never identity. |
| `extras_json` | Optional valid JSON object for source metadata, including encoding and decoded source settings. |
| `created_at`, `updated_at` | Row creation and last import/update times. |

### `games`: annotated games within books

| Field | Meaning |
| --- | --- |
| `id` | Integer primary key. |
| `source_id` | Required foreign key to `sources.id`; source deletion is restricted while games reference it. |
| `source_game_key` | Required, nonempty stable record identity within the source. Unique together with `source_id`. |
| `white`, `black` | Original player names, nullable. |
| `event`, `site` | Event and location text, nullable. |
| `date` | Original PGN date text, including partial dates such as `1993.??.??`; nullable. |
| `year` | Known year as an integer from 1 to 9999; `NULL` for an unknown year. |
| `result`, `eco` | Original result and ECO strings, nullable; unconventional source values are allowed. |
| `game_type` | Optional legacy/speed classification such as `standard`, `rapid`, `blitz`, `correspondence`, or an importer-defined value. No closed enumeration. |
| `record_kind` | Required browsing category: `game`, `position`, `line`, or `text`; never an import filter. |
| `is_training`, `is_deleted` | Required integer Boolean source labels (`0` or `1`). |
| `training_magnitude` | Required nonnegative original header magnitude; zero when absent. |
| `start_fen` | Setup PGN's exact FEN tag, or NULL for a normal-start score/text. |
| `annotator` | Original annotator text, nullable. |
| `headers_json` | Valid JSON object containing all original PGN tag names and string values, including unknown/custom tags; defaults to `{}`. |
| `pgn_zstd` | Required nonempty BLOB: one independently compressed complete UTF-8 PGN. |
| `pgn_sha256` | Required 64-character lowercase hexadecimal SHA-256 of the exact uncompressed UTF-8 bytes. Indexed, **not unique**. |
| `extras_json` | Optional valid JSON object for metadata PGN cannot represent, such as ChessBase IDs, raw annotation references, or extraction provenance. |
| `created_at`, `updated_at` | Row creation and last import/update times. |

The unique `(source_id, source_game_key)` index also indexes queries by source.
Separate indexes cover `white`, `black`, `year`, `eco`, `event`, `annotator`, and
`pgn_sha256`. Text indexes use SQLite's default binary collation: exact stored
names are searchable without changing Unicode spelling. There are no separate
player, move, position, or annotation tables.

### `source_records`: original records and extraction state

| Field | Meaning |
| --- | --- |
| `id` | Integer primary key. |
| `source_id` | Required foreign key to `sources.id`, with `ON DELETE RESTRICT`. |
| `source_record_key` | Required, nonblank stable identity within a source; unique together with `source_id`. |
| `record_type` | Required `game` or `text`; this source-level type is separate from the browsing classification in `games.record_kind`. |
| `status` | Required `extracted` or `failed`. |
| `raw_moves` | Nullable BLOB retaining original move/record bytes; for PGN inputs, UTF-8 PGN bytes. |
| `raw_annotations` | Nullable BLOB retaining original annotation bytes when available. |
| `metadata_json` | Required valid JSON object with extraction provenance, format/encoding, source IDs/offsets, or errors. No default. |
| `created_at`, `updated_at` | Required UTC text timestamps, defaulting to insertion time. |

Raw byte fields have BLOB affinity but no explicit `typeof` check. Writers must
bind byte values. JSON checks enforce an object, not a fixed set of keys.
Neither source-record status nor record type is inferred from a join.

### Relationships and constraints

`sources.id` is the parent key for both `games.source_id` and
`source_records.source_id`. Both child tables prevent deletion of a referenced
source when foreign keys are enabled. There is no cascade, and no direct foreign
key between `games` and `source_records`. Where import conventions align the
keys, correlate using both `source_id` and
`games.source_game_key = source_records.source_record_key`; SQL does not enforce
that correspondence or require every original record to have an archived game.

Integer primary keys are local row identities, without `AUTOINCREMENT`.
Stable text keys identify reimports. Empty titles and arbitrary result/ECO
strings are permitted. Nonblank key checks use SQLite `trim()`; they do not
normalize spelling. These are ordinary SQLite tables, not `STRICT` tables:
affinity and explicit `CHECK` constraints define validation. In particular,
`training_magnitude` is checked for nonnegativity but has no explicit integer
type check. Timestamps have no format check or automatic update trigger.

### Classification and position representation

`record_kind` defaults to `game`; `is_training`, `is_deleted`, and
`training_magnitude` default to zero. Import conventions classify guiding texts
as `text`, setup/zero-mainline records as `position`, normal-start named-player
scores with moves as `game`, and other normal-start move records as `line`.
These rules are importer behavior, not SQL validation. Training and source
deletion flags are independent of kind; a source deletion label does not delete
an archived row. `game_type` remains an unrestricted optional legacy/speed label.

`start_fen` stores a setup record's original FEN tag, with `NULL` for ordinary
starting positions or texts. SQL does not validate FEN syntax. This field does
not index every position reached during play. Moves, comments, variations,
training directives, and annotations remain in PGN and optional raw bytes/JSON.

### Indexes and query implications

Unique constraints create indexes on `sources(source_key)`,
`games(source_id, source_game_key)`, and
`source_records(source_id, source_record_key)`. The child composite indexes also
support filtering by `source_id` as their leftmost column.

Named single-column indexes on `games` cover `white`, `black`, `year`, `eco`,
`event`, `annotator`, `pgn_sha256`, `record_kind`, `is_training`, and `is_deleted`.
There are no dedicated indexes on title, date, result, site, game type, FEN,
JSON paths, extraction status, or raw bytes. Default text collation is binary;
case/accent-insensitive, substring, and Unicode-normalized search need explicit
query behavior and potentially new indexes. The hash index is nonunique:
matching PGN bytes do not imply matching source identities.

For browsing, select metadata and page results in a deterministic order (with
`id` as a tie-breaker); fetch the PGN BLOB when opening a record. Bind all query
parameters. Prefer read-only connections for the GUI, for example Python's
`sqlite3.connect("file:data/chess-books.sqlite3?mode=ro", uri=True)`, so a missing
archive raises an error instead of silently creating an empty file.

## Stable identifier rules

- Choose a durable identifier for each book edition/database, such as an ISBN
  plus volume/database label, publisher catalog ID, or a manually assigned
  catalog slug. Use a namespace and deterministic serialization, for example
  `book:isbn:9780000000002:vol-1:main` or `book:catalog:example-edition:main`.
  Document the chosen namespace and normalization in the future importer.
  For multiple databases in a volume, include a stable subdatabase label.
  A different edition should normally get a different key.
- If no external book ID exists, assign a catalog slug once and retain it in a
  durable manifest outside the source file. The same catalog identifier must
  always produce the same `source_key`. Never derive identity from an absolute
  path, file timestamps, mutable title/author metadata, or a file/content hash.
  Moving or renaming the book only changes `original_file`.
- Prefer the original ChessBase record ID/index for `source_game_key`, for
  example `cb:record:123`. Retain the original index, its numbering convention,
  and any stable subdatabase prefix; do not renumber after filtering annotated
  games, skipping guiding texts, or encountering extraction errors.
- If original IDs are unavailable, use a stable externally assigned per-record
  key stored in a durable manifest. As a last resort use `ordinal:000123`, a
  one-based ordinal in the complete, unfiltered source order, counting each
  source record, including texts/skipped records. This fallback is stable only
  while the original record ordering remains unchanged. Persist the mapping;
  reordering, insertion, deletion, or ChessBase compaction that renumbers IDs
  requires explicit reconciliation before reimport, or a new source revision
  key. Do not silently guess matches from players, dates, or move text.

Never use `pgn_sha256` as game identity: annotation changes must replace the
same row. Identical PGN in different books remains separate because uniqueness
is scoped to `source_id`; identical PGN at distinct source records is also
allowed.

## Inserts and reimports

The following SQL describes the import contract. Bind values as parameters,
enable foreign keys, and use a
transaction for related book/game writes. Upsert a source, then select its ID
on the same connection (do not rely on `last_insert_rowid()` after an update):

```sql
INSERT INTO sources (source_key, title, author, original_file)
VALUES (:source_key, :title, :author, :original_file)
ON CONFLICT (source_key) DO UPDATE SET
    title = excluded.title,
    author = excluded.author,
    original_file = excluded.original_file,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now');

SELECT id FROM sources WHERE source_key = :source_key;
```

Bind that ID as `source_id` and upsert games using
`ON CONFLICT (source_id, source_game_key) DO UPDATE`. Writers must supply all
searchable metadata and classification fields, including `record_kind`,
`is_training`, `training_magnitude`, `is_deleted`, and `start_fen`, as well as
the PGN frame, checksum, headers, and optional extras. Updating only legacy
columns would leave classification stale. Source upserts must also replace
`extras_json` when supplied by the importer.

Upsert original records using
`ON CONFLICT (source_id, source_record_key) DO UPDATE`, replacing `record_type`,
`status`, both raw BLOBs, and `metadata_json`, and advancing `updated_at`.
Preserve the primary key and `created_at`. Failed extraction metadata may be
stored while retaining an existing successfully archived game; consumers must
inspect status rather than assume every raw record has a readable PGN.

Reimports replace all game metadata and compressed PGN, including clearing
previous values when the new value is `NULL`. Row IDs and `created_at` remain
unchanged. Use `INSERT ... ON CONFLICT DO UPDATE`, never `INSERT OR REPLACE`
(which deletes/recreates rows). Idempotence concerns identity and stored content;
`updated_at` advances even on an otherwise identical import.

Reimporting **does not automatically delete games no longer present in the
source**. Future deletion/synchronization needs an explicit, separately designed
policy that distinguishes an authoritative full extraction from filters,
partial runs, and extraction failures.

## PGN storage and compression

Encode each complete extracted PGN as UTF-8 exactly once, compute SHA-256 over
those exact bytes, then compress that same byte sequence as a single standard
Zstandard frame. Store the frame as a bound SQLite BLOB, without Base64 or text
encoding. Each row must decompress independently: no shared dictionary,
cross-game compression stream, or external compression state. Recommended
convention: level 3, content size included, frame checksum enabled. Compression
level is not identity and may change without changing `pgn_sha256`.

To read a game, decompress its frame with a standard Zstandard library, verify
the SHA-256 against `pgn_sha256`, and decode UTF-8 strictly. Future import/read
code must validate the frame and checksum; SQLite only checks the BLOB's type
and nonempty length and the hash's format, not their contents or correspondence.
Zstandard dependencies belong to those future tools, not this initializer.

The PGN BLOB is the authoritative archive of the extracted PGN. Preserve the
entire headers and movetext, comments, nested variations, NAGs, evaluation
directives, whitespace/newlines, and Unicode text. Do not strip annotations,
normalize Unicode, alter line endings, or parse/re-serialize PGN for storage.
Searchable columns and `headers_json` are derived copies and must never be used
to reconstruct the archival PGN. If malformed PGN contains duplicate tags or
header order matters, the original PGN retains them even though the JSON object
cannot express duplicate keys/order semantics. This preserves what extraction
emits; binary/media ChessBase data absent from PGN needs provenance or references
in `extras_json` and is not recovered by this schema.

## Reading order in the desktop app

Book order uses numeric `extras_json.recordId` (ChessBase) or `extras_json.ordinal`
(PGN), with known stable-key suffixes and finally local row IDs as fallbacks.
Original-record lists use the same fields in `metadata_json`. Keys such as
`cb:record:10` must not be sorted lexicographically before `cb:record:2`.

Section order is derived in memory from natural filename/path ordering, with
front matter first and named Russian learning stages ordered numerically. It is
an approximation, not an authoritative chapter-order field. The archive is not
modified. The book reader joins source records to games by source ID and stable
record key, retaining failed records as placeholders and including games without
matching source records. It includes source-deleted records with a visible label.
Reading progress is stored in renderer local storage, scoped to archive path and
book identity, using source ID and stable record key rather than a list offset.

## Later extensions

Add versioned migrations for derived search structures without changing the
archival PGN or stable identities. Position indexing could add tables keyed by
`game_id`, normalized position key/FEN, ply, and variation path. Full-text search
could use an FTS5 virtual table for extracted comments and headers, linked to
`games.id`. AI embeddings could live in a separate table or vector index with
`game_id`, passage/variation identity, model name/version, dimensions, and the
PGN checksum used to generate them. Derived records should be invalidated or
rebuilt when `pgn_sha256` changes and removed when their game is deleted. These
features are not part of the current three-table schema.

## Migration history

| Migration | Change |
| --- | --- |
| `001_initial.sql` | Creates sources and games, stable identities, PGN storage, metadata constraints, and initial search indexes. |
| `002_source_records.sql` | Adds source metadata JSON and the original-record archive table. |
| `003_record_classification.sql` | Adds browsing kind, training/deletion labels, setup FEN, and kind/flag indexes. |

Migration 003 backfills `text` from the guiding-text game type, `position` from
`SetUp=1`, and `line` from missing/placeholder player names; remaining rows become
`game`. It copies the FEN header into `start_fen`. It does not decompress PGN or
infer all importer classifications. Existing training/deletion flags begin at
zero and require source-aware reimport to populate. Existing IDs, timestamps,
PGN frames, and hashes are preserved.

The SQL files are migration inputs, not a standalone schema dump. Run the
initializer to apply them in order and update `PRAGMA user_version`. Its
`BEGIN IMMEDIATE` serializes initialization writers and all migrations run in
one transaction. Use a backup before future migrations of an existing archive.

## Derived openings (schema v4)

Migration 004 adds `opening_revisions`, `opening_state`, `opening_nodes`,
`opening_entries`, `game_openings`, and `game_opening_matches`. Source tables are
unchanged. Node IDs identify full label paths; entry IDs identify upstream
ECO/name/canonical-line tuples. Both are stable across revisions. Position keys
omit move counters and include only legally available en-passant squares.

`opening_state` publishes one completed revision atomically. Staging revisions
remain invisible. Classification stores the input PGN hash, status, primary
entry and matched ply; matches retain every named mainline position reached.
Readers ignore classifications whose input hash differs from `games.pgn_sha256`.
An invalid game has diagnostics, no authoritative primary entry, and no matches.
Original source ECO remains separate from derived ECO. Electron accepts v3/v4,
reports opening capability only for v4, and never migrates the archive itself.

Opening read API: `openingFacets(filters)` returns `supported`, active `revision`,
filtered `total`, `classified`, `unclassified`, and available taxonomy nodes with
`id`, `parentId`, `label`, `path`, and distinct-game `count`. It returns the whole
available tree so a client can search paths and scope children locally. Counts
apply existing game filters but ignore `openingNodeId`; only active nondeleted
games contribute. A game's several named matches never multiply totals.

`searchGames` accepts `openingNodeId` (a stable path ID, or `unclassified`).
Selections match any named mainline position under that node or its descendants,
including earlier matched positions and transpositions. Invalid IDs fail clearly.
Rows and details include `opening`: `status`, nullable `name`, derived `eco`,
`nodeId`, `matchedPly`, and a `path` array. Original `eco` is unchanged.
Unclassified includes unmatched, invalid, stale, and not-yet-enriched games;
`opening.status` distinguishes those states. v3/empty-v4 lists retain normal ECO
and return `unenriched` without reading absent tables. List labels use one bounded
metadata query per page and never decompress PGNs.
