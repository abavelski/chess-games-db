# Unified local game import plan

Status: implementation in progress, 2026-10-21. See POLICY.md for the frozen
import policy and the task checkboxes below for implementation status.
Tasks below are ordered implementation/review units with acceptance criteria.

## Goal

Provide one documented command in `chess-games-db` that accepts individual books,
book collections, PGN files, or a ChessBase database plus extraction parameters,
and creates a new app-compatible SQLite archive or updates an existing one.
Preserve personal study data, annotated editions, source identities and ordering.
Support incremental reruns without duplicates or rebuilding unaffected indexes.
The first release is a local CLI; an import UI, online fetching of games, and
automatic cross-edition merging are outside scope.

## Findings from the existing code

Paths beginning `cb/` below refer to the sibling project, `../cb` from this repo.
These are observations from source inspection, not results of running imports.

| Existing component | Behavior and integration consequence |
| --- | --- |
| `cb/data/books/ChessBase/run-all.sh` | Delegates to `cb/scripts/import-chessbase.py`; discovers nested CBH, legacy CBV and PGN inputs by book folder, supports book selection, inspection, retry reports and temporary metadata recovery. |
| `cb/scripts/import-book.sh`, `BookDatabaseImport.java`, `PgnDatabaseImport.java` | Initialize the legacy archive through migrations 001–003; store games, positions, lines, guiding texts and raw extraction records. They must not write directly to a v7 target. |
| `cb/data/books/ChessBase/import-manifest.json` | Durable catalogue assigns `book:catalog:chessbase-NNNN:db-NNN` source keys. CB records use original record IDs; PGN records use `ordinal:000001` etc. Preserve this catalogue, including older standalone-book identities. |
| `cb/run-megabase.sh`, `scripts/import-megabase.py`, `MegaDatabaseExport.java`, `scripts/write-megabase.mjs` | Stream selected CBH games as JSON lines into the app's v7 writer, enrich openings and exclusively publish a new file. Default input is `cb/data/mega1/Mega Database 2026.cbh`. Existing outputs are refused; update mode is absent. |
| MegaBase selection | Count, minimum original annotation count, minimum year and comment-language priority. Language filtering chooses the first requested language present anywhere in a game; it does not fill missing comments from lower-priority languages. Deleted records, standalone records and null-move games are skipped. |
| `scripts/migrate-games.mjs` | Converts a consistent read-only snapshot of v3–v6 to a new v7 file, preserves retained IDs/PGN bytes/provenance and valid active opening classifications, rebuilds features/cache, verifies before publishing. It is not a v7 merge or general personal-data transfer tool. |
| `lib/game-writer.mjs` | Transactional source/local-key upserts, stable game IDs/keys, exact PGN checksums, dimensions, features, property cache and opening invalidation. Contradictory mappings fail. Reuse this write boundary. |
| Personal data | `games.favourite` and its index are created lazily on the first star change. `game_personal_analysis` stores JSON and timestamps keyed by game ID; migration 008 is additive. Personal comments and lines refer to UCI move histories from the starting position. |
| Optional positions | Migration 009 adds position tables/triggers without changing base `user_version=7`. Changed PGN hashes invalidate occurrences; installed capabilities, scope, algorithm versions and coverage need separate inspection. |

Schema history to account for: 001 initial archive; 002 raw source records;
003 record classification/training/deletion; 004 opening catalogue; 005 critical
positions; 006 medals; 007 source-neutral games schema. Fresh v7 uses 007 and
008, not sequential replay of the historical archive migrations. Position
extension 009 is opt-in. Favourites are another capability, not a schema version.
Electron currently accepts only v7 and does not migrate archives on open.

Known identity mismatch: migrated games use `legacy:` plus an encoded source/key
pair, while the MegaBase adapter proposes `chessbase:` keys. Updates must resolve
existing `game_sources` first and retain the existing `game_key`; constructing a
new producer key for an existing mapping would be rejected by the shared writer.

Known retention mismatch: the old classifier labels every setup game as a
position, and labels normal-start scores with unknown players as lines. The
MegaBase path also excludes null moves and deleted games, whereas migration
retains hidden games and parser-error games. Freeze an explicit common policy;
do not accidentally inherit one exporter's losses as the new universal rule.

## Proposed pipeline and command contract

Use a small app-owned orchestrator and format adapters:

`inspect → resolve identities → extract to staging → classify/detect conflicts
→ apply shared writer → refresh derived data → verify → publish/report`

Move the required extraction support into a versioned tools module in this
repository, retaining provenance/licenses and relevant tests. The final command
must work without a sibling `cb` checkout. During development, an explicit
extractor-project option may bridge to `cb`; do not retain a hidden dependency.
Do not copy the experimental exporters unrelated to this pipeline.

Illustrative future CLI (not implemented commands):

```sh
npm run import:games -- inspect --books-root /path/to/books --manifest /path/to/import-manifest.json
npm run import:games -- create --books-root /path/to/books --book 'Фишер' --manifest /path/to/import-manifest.json --output /path/to/new.sqlite3
npm run import:games -- create --input '/path/to/Mega Database 2026.cbh' --source-key chessbase:mega-database-2026 --count 100000 --min-annotations 20 --min-year 1950 --languages ru,en --output /path/to/mega.sqlite3
npm run import:games -- update --input /path/to/collection.pgn --source-key pgn:my-collection --target /path/to/existing.sqlite3 --dry-run
npm run import:games -- update --input /path/to/collection.pgn --source-key pgn:my-collection --target /path/to/existing.sqlite3 --report /path/to/new-import-report.json
```

Resolve user paths relative to the invocation directory; bundled tools resolve
relative to their own module. Use explicit source and destination options with
no implicit writes to a default archive. Book roots and manifest locations are
configurable; titles, charset, report paths and extraction settings are recorded.
Inspection must not register keys or modify the manifest. Dry-run may use scratch
files but must leave source, target and durable manifest unchanged.

## Data protection and duplicate policy

- Importers own source PGNs/metadata/provenance and rebuildable derived data.
  Personal favourites, saved comments/lines and their timestamps are user-owned.
  Pass only allowlisted producer fields to the writer; imported JSON cannot
  supply target integer IDs or overwrite personal fields.
- Same durable source plus source-local key means a repeat import, preserving
  game ID, `game_key`, `created_at`, all existing source links and personal data.
  Unchanged records should be no-ops. Never use `INSERT OR REPLACE` or remove and
  recreate a game as an update strategy.
- Do not delete games because they disappear from an input or fail a filter.
  Preserve source-deletion provenance and define visibility separately; a deleted
  flag from one linked source must not silently hide other live references.
- Validate saved personal JSON against a proposed PGN using the existing personal
  merge/validation rules, including root FEN, move legality and comment anchors.
  If it no longer attaches, retain the previous game and personal data unchanged
  and report a conflict. Do not silently drop, relocate or reset notes. Root
  changes with personal data require explicit reconciliation even if moves are
  still legal. A conflict report identifies the staged record for a later rerun.
- CB record renumbering, source replacement, PGN insertion/removal/reordering and
  ambiguous repeated PGN blocks require reconciliation. Ordinals and filenames
  alone cannot prove continuity after those changes. Persist source revision and
  record evidence sufficient to detect drift; separate harmless renames from a
  different edition. Never match identities by mutable title or file hash alone.
- Exact decoded PGN SHA-256 is a duplicate *candidate*, not a global unique key.
  Distinct sources/editions remain separate by default even for identical bytes.
  A versioned root-position plus legal mainline fingerprint can find likely same
  encounters despite differing comments/headers; verify full canonical content
  after hash lookup. Same moves with different annotations are separate editions.
  Unknown/malformed scores remain unclassified candidates, never guessed matches.
- First release reports cross-source candidates without automatic merge. An
  explicit, reviewed source alias/reconciliation mapping may link a confirmed
  same edition to an existing game. Conflicting existing mappings fail; combining
  two already-studied rows and their personal data is deferred.

## Implementation tasks

### UI-01 — Inventory archives, identities and import policy

- [x] Add read-only inventory of schema versions, optional extensions, source/key
  conventions, legacy catalogue identities, personal-data coverage and unknown
  schema objects. Include supplied v7 archives and legacy fixtures, not a presumed
  single canonical local filename.
- [x] Freeze eligibility, training/deleted behavior, null-move/parser failures,
  genuine FEN-start games, completeness, language transformation and partial-scan
  semantics. Preserve exact PGN blocks for PGN input and supported full-fidelity
  ChessBase annotations. Report every exclusion and its reason.
- [x] Define source revision evidence and extraction-profile identity: a different
  language policy can change PGN bytes for the same CB record. Default to conflict
  on an unrequested profile change; require an explicit source-update choice or
  a separately identified edition. Filters are not evidence of source deletion.

Acceptance: inventory leaves input bytes unchanged; fixture counts reconcile;
each supported historical state has an explicit path to v7 or a clear refusal.

### UI-02 — Consolidate and pin extraction dependencies

Depends on UI-01.

- [x] Package only the necessary Java/Python adapters, annotation converter,
  language handling, CBV unpacker and temporary-copy recovery with tests/licenses.
- [x] Preserve current pins: Morphy `5e7682c105858a72bb6fd3fad7dad9aadd68a31a`,
  uncbv `bf93b9d2d5b70db300d572231e95abf199010503`; Maven currently uses
  SQLite JDBC 3.46.1.0, zstd-jni 1.5.6-9, SLF4J 2.0.16 and Jackson 2.18.2.
  Record changes to pins deliberately, including annotation-output differences.
- [x] Provide dependency preflight/setup for JDK 21+, Maven, Git, Python 3,
  Node 22+ and npm dependencies. Rust/Cargo is needed only for first CBV tool
  build. Run SQLite JS under `scripts/run-archive-tool.mjs` for Electron's ABI.
  Avoid requiring CB tooling for plain PGN input where practical.
- [x] Separate explicit dependency/catalogue downloads from offline import;
  reuse installed pinned tools without fetching/building on every invocation.
  Document macOS/Windows execution, path separators and Unicode paths.

Acceptance: a clean checkout can prepare tools and import fixtures without `cb`;
after setup, offline reruns succeed and missing dependencies fail before writes.

### UI-03 — Build discovery and stable source registry

Depends on UI-01–02.

- [x] Discover individual CBH/CBV/PGN and book trees, validate mandatory CBH
  sidecars, list unsupported formats explicitly, and avoid importing both an
  archive and its unpacked equivalent. Surface uncertain filename heuristics.
- [x] Load the existing catalogue without reallocating keys; support preserving
  keys through moves/renames and importing older standalone-source mappings.
  Make new registry entries atomic and recoverable with their import run.
- [x] Implement source/record reconciliation plans for PGN ordinal drift, CB
  renumbering and changed source editions. Refuse ambiguous updates by default.

Acceptance: discovery/inspection is read-only; repeated discovery, a renamed book
and an archive/unpacked pair preserve identities; ambiguous drift is reported.

### UI-04 — Implement a common staged extraction protocol

Depends on UI-02–03.

- [x] Define versioned streaming records: stable source/local key, sequence,
  original headers, PGN bytes/hash/compression, eligibility, extraction profile,
  provenance, recovery actions and diagnostics. Separate stdout data from logs.
- [x] Adapt CBH books, CBV temporary unpacking and direct PGN blocks; reuse the
  annotation converter rather than the lossy En Croissant exporter. Preserve
  Unicode, CRLF/BOM and whitespace for UTF-8 PGN; record legacy decoding choices.
- [x] Support count/year/annotation/language parameters with the existing
  MegaBase semantics, explicit full-scan mode, bounded memory and cancellation.
  Record scan completeness and all skipped/failed categories.
- [x] Validate archive members and extraction destinations, keep sources read-only,
  constrain recovery to disposable copies, and detect changes to all relevant
  source sidecars during extraction, not only CBH size/mtime.

Acceptance: synthetic CBH, legacy CBV and PGN fixtures preserve expected content;
producer errors/truncated streams cannot appear as a successful complete import.

### UI-05 — Implement identity resolution and duplicate reporting

Depends on UI-03–04.

- [x] Resolve target source/local mappings before assigning new game keys, including
  migrated `legacy:` keys and existing MegaBase keys. Handle multiple source links
  without contradictory remapping or duplicated list rows.
- [x] Implement exact-byte and likely-encounter candidate reports under the policy
  above. Persist/version any fingerprint index with checksum invalidation; avoid
  decompressing the entire archive on every small update or making hashes unique.
- [x] Produce deterministic insert/no-op/update/conflict/duplicate-candidate plans;
  support explicit confirmed same-edition aliases, with no automatic cross-source
  merging. Annotated variants and ambiguous identical PGN occurrences stay distinct.

Acceptance: reruns add no duplicate rows; title/path changes keep IDs; equal moves
with different commentary survive; contradictory and drifted mappings fail safely.

### UI-06 — Protect personal data and apply transactional updates

Depends on UI-05.

- [x] Inspect optional favourites and personal-analysis storage, snapshot expected
  user-owned values and apply only producer-owned changes through the shared writer.
  Preserve unknown extensions; fail safely where compatibility cannot be established.
- [x] Validate personal move histories/comment anchors before PGN replacement;
  implement the conflict behavior above, with no personal-data mutation on failure.
- [x] Use bounded per-source transactions after staging extraction. A failed source
  rolls back its writes; earlier successful sources may remain committed and are
  listed in a partial report. Do not hold a database write lock during extraction.
- [x] Detect target edits since planning under the apply transaction. Never apply
  a stale dry-run plan over newer notes/favourites; revalidate or stop with conflict.

Acceptance: unchanged/changed reimports preserve personal JSON/timestamps,
favourites, IDs, keys and creation times; incompatible notes retain old PGNs;
injected failures leave no partial source updates or orphaned relations.

### UI-07 — Coordinate schema compatibility and derived data

Depends on UI-06.

- [x] Create new targets directly as v7. Refuse implicit in-place v3–v6 conversion;
  direct users to explicit new-output migration, verifying any personal extensions
  before conversion rather than assuming the existing converter copies them.
- [x] Preserve valid opening revisions/classifications and unchanged position
  indexes. Refresh changed games' annotation/critical/medal features and property
  caches using the existing writer; verify invalidation remains transactional.
- [x] Reuse a checksummed local opening catalogue (current pin
  `a6189a30dc273ccb21fc2536a9a2fefd5592a67a`); allow explicit unenriched import
  with coverage status rather than a hidden network download. Keep source ECO.
- [x] Leave position indexing opt-in; when requested, build/resume the installed
  mainline/all-variation scope. Report absent/stale/failed/complete coverage without
  exposing stale hits. Do not bump base schema just because 008/009 exist.

Acceptance: fresh and incrementally updated targets open in the desktop; cache
rebuilds agree; unchanged derived rows survive and changed-PGN results cannot leak.

### UI-08 — Finish CLI, backups, publication and run reports

Depends on UI-04–07.

- [ ] Implement inspect/create/update, meaningful help, option validation and
  read-only dry-run; publish the definitive examples and defaults.
- [ ] Create mode stages on the destination filesystem and publishes exclusively
  after verification; refuse existing outputs, symlink/hardlink aliases and
  sidecars. An existing target requires explicit update mode.
- [ ] Before update, make and verify a SQLite online backup including committed
  WAL data. Require the desktop/other writers closed throughout the update window;
  add a shared maintenance guard to desktop write paths if needed to enforce this.
  Verify concurrent edits cannot be lost; do not replace a live target file with
  a stale staged copy. Document backup location and exact restore procedure.
- [ ] Record run/source/profile/tool versions, source revision evidence, identities,
  counts, conflicts, failures, backup and derived coverage in a new local report.
  Exit nonzero on failures/conflicts with an explicit partial/completed status.
  Retry uses durable run identities, not overwritten human reports alone.
- [ ] Resume completed sources safely, clean abandoned scratch files and terminate
  child processes on cancellation. Verify target integrity, foreign keys, checksums,
  cache equivalence and user-owned data before reporting success.

Acceptance: create failure publishes nothing; update failure is recoverable from
a verified backup; retries are idempotent; dry-run writes no target/manifest data;
reports distinguish an intentional subset from an incomplete failed scan.

### UI-09 — Verify the full workflow and document operation

Depends on UI-08.

- [ ] Add isolated integration fixtures across v3–v6 conversion and v7 capability
  combinations (favourites, personal analysis, openings, position scopes, unknown
  extensions). Never use the user's archives as writable test fixtures.
- [ ] Exercise create → open/review → favourite/add personal line and comments →
  close → update → reopen/search/review. Cover root and variation comments,
  changed FEN/mainline/removed author branches, duplicate candidates, stable keys,
  malformed input, source drift, concurrent edits, crash/cancel and rollback.
- [ ] Run relevant extractor Java/Python tests plus `npm test`, `npm run build`
  and `npm run test:desktop`. Measure a small incremental rerun against a larger
  disposable archive for bounded memory, index use and no-op/derived-work costs.
- [ ] Document setup, supported format limits, identity/manifest backup, language
  profiles, duplicates, dry-run, update/restore and retry. Provide recipes for one
  book, all books, PGN and a MegaBase subset; retire redundant integration paths
  only after parity is demonstrated. Real-book validation uses disposable outputs
  and a read-only source with a locally retained verification report.

Acceptance: tests prove personal data and annotation fidelity across the full
workflow; documented commands work from a checkout without sibling-project paths.

## Completion gate

All nine tasks must pass before calling the unified importer ready. The release
must create and update v7 archives, preserve source and user identities, report
duplicate candidates conservatively, and recover from interrupted imports.
No production archive rebuild, bulk import, reconciliation or destructive merge
is authorized by this planning commit.
