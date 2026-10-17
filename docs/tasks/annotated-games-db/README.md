# Annotated games database: next-version plan

Status: implemented, 2026-10-17. All six tasks completed in order, with one local
commit per task. See [verification](verification.md), [policy](policy.md), and
[writer contract](writer.md). Original plan and acceptance criteria follow.

## Goal and scope

Make the annotated game the central browsing and storage unit. Remove standalone
texts, positions, lines, puzzles, book reading, and extraction-record browsing.
Keep the existing game review experience, including comments, variations, NAGs,
arrows, highlights, medals, critical-position navigation, study reveal, Piece
mode, temporary analysis, Stockfish/Maia, shortcuts, and return-to-list state.
Comments and positions within a game are part of the game and remain intact.

Treat source, players, annotators, event, location, year, result, completeness,
and study markers as filterable properties. Sources can be books, websites, PGN
collections, or manually supplied material. Keep the current offline Lichess
opening catalogue and classification semantics.

This release includes the new schema, explicit old-to-new migration, shared
game-write contract, read API, searchable multiselect filters, and regression
verification. Automated internet fetching, website-specific parsers, name
reconciliation scripts, Explorer statistics, and a new import UI are separate
work. The write contract must allow future local-PGN and internet importers
without another structural redesign.

## Current implementation and data

Code inspection: `scripts/init-db.py` targets schema v6; Electron accepts v3–v6.
`games` contains several record kinds and requires a single book-oriented
`source_id`. `source_records` retains raw extraction bytes. Opening tables are
revisioned; critical-position and medal counts are derived from PGN. The default
UI already hides other record kinds, but their APIs and optional book mode remain.
Some older task descriptions and database prose still describe earlier versions.

Read-only inventory of `data/chess-books.sqlite3` on the plan date:

| Item | Count |
| --- | ---: |
| Schema | 6 |
| Sources / sections | 279 |
| Games | 13,507 |
| Standalone positions | 36,443 |
| Standalone lines | 596 |
| Texts | 2,145 |
| Raw source records | 52,730 |
| Games marked as training | 25 |
| Games with result `*` | 1,559 |

No current game rows are source-deleted. These counts are a baseline, not hardcoded
migration expectations; migration must inventory its actual input. The extractor
itself is not present in this repository: adapting its producer is a separate
integration dependency, to be documented with the new write contract.

## Recommended model

Use typed columns and relation tables for established properties, with JSON for
uncommon source metadata. A property in the UI does not need to be a generic
entity/attribute/value row in SQL. Typed storage keeps year ranges, constraints,
sorting, and query planning straightforward.

One `games` row represents one annotated edition of a score. Two publications of
the same historical encounter may have different commentary and remain separate
rows. Neither matching moves nor matching PGN hashes should merge them. A game
can have several source references when explicitly linked; automatic cross-source
deduplication is deferred.

Proposed schema v7 (confirm the next unused version at implementation time):

| Table | Responsibility and important fields |
| --- | --- |
| `games` | Preserved integer `id`; unique durable `game_key`; exact `pgn_zstd`, `pgn_sha256`, `headers_json`; original date, numeric year, original result plus constrained result code, completeness, source ECO, game type, setup FEN, annotation status, extras JSON, timestamps. |
| `players` | Integer ID, original display name, derived search key. Exact distinct spellings initially remain distinct. |
| `game_players` | Game ID, player ID, role `white`/`black`, original name. Unique `(game_id, role)`; index `(player_id, role, game_id)`. Missing players have no link. |
| `annotators` / `game_annotators` | Display/search values and many-to-many game links, original credit, credit order. Never split a credit on commas without a format-specific rule: a comma may be part of a name. |
| `events`, `sites` | Reusable exact display values and search keys; nullable foreign keys on `games`. Preserve original PGN values as well. |
| `sources` | Stable unique `source_key`, kind (`book`, `website`, `pgn_collection`, `manual`, `other`), title, author, URL, original file, extras, timestamps. Keep existing IDs/keys where possible. |
| `game_sources` | Game/source links with stable `source_game_key`, locator/URL, section/order metadata, primary-source flag. Unique `(source_id, source_game_key)`, unique `(game_id, source_id, source_game_key)`; one primary source per sourced game via partial unique index. |
| `game_features` | One row per game with PGN input hash, extractor version/status, critical-position and medal counts, annotation-presence facts, timestamps/diagnostics. Counts are unknown until successfully derived. |
| `property_options` | Rebuildable option cache: property key, stable value key, display/search text, typed numeric value where relevant, global distinct-game count. Unique `(property_key, value_key)` and indexed property/search keys. |
| `property_cache_state` | Singleton content revision, cache revision, cache algorithm version and build timestamp, making cache freshness inspectable. |
| Existing opening tables | Preserve `opening_revisions`, `opening_state`, `opening_nodes`, `opening_entries`, `game_openings`, `game_opening_matches`; retain valid classifications for retained IDs and hashes. |

All game-owned relations use foreign keys and cascade on explicit game deletion;
shared dimension/source deletion is restricted while referenced. Include reverse
relation indexes beginning with `game_id`. Index year, result code, completeness,
event/site IDs, PGN hash (nonunique), and measured high-use filter combinations.
Keep list queries off PGN blobs. Validate JSON objects, Boolean/status domains,
counts, hashes, role uniqueness, and source-key uniqueness.

Sources are optional properties: a manual game can exist without one. List and
review reads therefore use left joins or a primary-source projection. Multiple
sources or annotators must never multiply list rows, facet counts, or pagination;
filter through `EXISTS`, not unrestricted joins. Preserve current review fields
through a read-model adapter, including a primary-source label and a neutral
fallback for unsourced games.

Source sections currently represent separate `sources` rows. Preserve those stable
identities and map existing book grouping into optional parent-source relationships
or explicit collection metadata. Do not merge records by title. Display a book once
where the existing grouping is reliable; retain section as an optional source
property and keep deterministic source order for existing collections.

### Property meanings

- **Retention:** initially retain `record_kind = 'game'`. Exclude standalone
  position/line/text rows. Training flags do not exclude a game: the 25 training
  games remain games. Preserve source deletion provenance and the current hidden
  behavior if other input files contain deleted games. Audit suspect excluded
  rows before migration; report potential misclassifications for explicit later
  recovery instead of guessing. Future import validation must allow partial games
  and genuine game scores starting from a supplied FEN.
- **Annotated:** do not require a populated Annotator tag. Detect commentary,
  variations, NAGs, diagram/board annotations, medals, and critical markers as
  separate facts. Keep unannotated/unknown games during migration, with an
  annotation-presence filter; a strict annotated-only retention rule would discard
  potentially useful games and needs a separate product decision.
- **Result:** preserve the original string; derive `white_win`, `black_win`,
  `draw`, `unfinished`, or `unknown` for filtering. Do not reject unusual originals.
- **Completeness:** `complete`, `partial`, `unknown`, with evidence/provenance.
  Preserve an explicit trusted source indication. Otherwise default to unknown;
  neither a decisive result nor lack of checkmate proves score completeness.
  Result `*` alone must not force partial. Report how many values remain unknown.
- **Markers:** keep separate medal and critical-position properties and the
  existing combined study-marker filter. Counts follow the current parser,
  including variations. Unknown extraction state differs from zero. Keep markers
  in the unchanged PGN; they are not standalone position records. Typed medal
  categories/phases can be added later if reliably extractable.
- **Names:** preserve exact spellings and original credits; derive Unicode-aware
  search keys separately. Search-key collisions must not merge entities. Future
  alias/canonical mappings can retarget stable IDs and rebuild caches without
  rewriting original PGN. Do not infer shared identities from surname or punctuation.

## Search and cache behavior

Every categorical property gets a searchable dropdown with multiple selection:
source/type, players (either color or White/Black), annotators, event, site, year,
result, completeness, annotation presence, medals, and critical positions. Keep
year-range controls as an additional efficient way to select dates. Keep source
ECO separate from the existing searchable hierarchical Lichess opening selector;
support multiple opening branches with OR semantics if expanding that selector.

Values within one property use OR; different properties use AND. Role-specific
White and Black filters are separate properties. An empty selection means no
constraint; an explicit missing/unknown option is distinct from an empty
selection. Invalid IDs fail clearly. Selected options remain visible even when
other filters make their current count zero. Reset paging when filters change.

Use bounded IPC such as
`propertyOptions({ property, query, filters, cursor, limit })`, plus game search
and existing opening APIs. Whitelist property names/sorts, bind inputs, bound
selection sizes, and return stable IDs, labels, counts and cursors. Debounce search
and ignore stale responses. Dropdowns support keyboard navigation, accessible
labels, removable selection chips, loading/error states, and large option sets
without rendering every player or event.

Dimension tables supply stable categorical identities; `property_options`
materializes discoverable values and global distinct-game counts, including
scalar/Boolean properties. Populate caches during migration and maintain them
transactionally on additions, updates, and deletions through the shared writer.
For updates, remove the old game's distinct contributions before adding the new
ones. Zero-use values disappear from suggestions without destroying stable IDs.
Update the content/cache revisions together. A rebuild command computes an
equivalent cache from authoritative typed data and is safe to rerun.

Global cached counts do not answer arbitrary filter combinations. Contextual
dropdown counts apply all other filters and ignore that dropdown's own selection;
compute these using indexed distinct-game queries when requested. Search only
the relevant option dictionary first, then count bounded candidates. Do not
materialize the Cartesian product of filter combinations. Measure prefix search
on normalized keys first; use a separate suitable text index only if measured
substring-search requirements justify it. SQLite `NOCASE` alone is insufficient
for Unicode names. In-memory contextual caching must include database content
revision, opening revision, property, query and normalized filters in its key.

## Implementation tasks, in order

### 01 — Freeze data rules and fixtures

Record the retention/completeness/annotation rules above as executable migration
policy. Add an inventory/dry-run report: kind/deletion/training counts, malformed
PGNs, candidate misclassifications, sources, name cardinalities and derived-state
coverage. Use fixtures for comments without annotators, composite credits,
duplicate scores with different annotations, incomplete games, setup games,
unknown metadata, and malformed PGN. Confirm source grouping and import ownership.

Acceptance: counts reconcile and every exclusion has a reason; no input writes.

### 02 — Implement schema and shared writer

Add the v7 schema and initializer support without editing migrations 001–006.
Separate explicit legacy conversion from ordinary initialization: attempting to
upgrade an existing legacy file via `init-db.py` must direct users to the converter,
not silently remove content. Fresh initialization creates the new schema.
Define the shared transactional writer and CLI/library interface for game upserts,
source links, derived-state invalidation and cache updates. Preserve stable IDs
and `created_at`; never use `INSERT OR REPLACE` for reimports.

Future producers use stable source keys and source-local record keys to find an
existing annotated edition. First import assigns a durable game key; migration
derives keys from the preserved legacy source/record identity using an unambiguous
encoding. Renames, moved files and changed annotations must not create duplicates.
Same-source same-key import updates the same game; contradictory mappings fail.
Changed PGN invalidates marker/annotation features and opening classifications.
Opening reads continue to reject stale hashes. A pending feature extraction must
expose unknown options rather than retain stale cached facts.

Acceptance: constrained schema, independent game identity, multiple source and
annotator support, transactional reimport/cache consistency, future PGN-producer
contract documented. Read-only Electron remains the app's operating model.

### 03 — Build the explicit migration command

Provide a command such as
`npm run migrate:games -- --input old.sqlite3 --output games.sqlite3 --dry-run`.
Support legacy v3–v6 inputs; reject newer/unknown schemas. Check capabilities per
version rather than querying columns that do not yet exist.

1. Inventory a consistent read-only SQLite snapshot, using SQLite backup support
   if necessary so WAL contents are included. Never modify the original file.
   Refuse an existing output or input/output aliases, including symlinks.
2. Create a temporary destination using the target schema and a manifest recording
   input identity, versions, policy and migration status. Preserve selected game
   IDs, exact compressed PGN frames, checksums, original headers and timestamps.
3. Copy retained game properties and necessary source provenance, including useful
   game-specific metadata currently found only in corresponding source records.
   Populate dimensions and links. Preserve source/record keys, original record
   ordering, section identity, raw credit strings and deletion provenance.
4. Drop all standalone non-game rows, `source_records` and their raw byte archive,
   obsolete record-kind/training-magnitude browsing fields, and book-reader-only
   metadata. Preserve relevant game annotations/extras and training provenance.
   Only referenced sources/necessary parent sources survive. Log excluded counts
   and stable identities in the migration report, outside the new game database.
5. Copy the active completed opening catalogue and retained matching-hash game
   classifications/matches, preserving taxonomy IDs and the publication pointer.
   Discard staging, stale and orphaned game classifications. Missing legacy
   openings remain unenriched; do not fetch from the network. Report any cleanup.
6. Rebuild feature indexes from unchanged PGN using the existing parser and new
   versioned feature contract, then rebuild property options. Parse failures retain
   original games and bytes, with explicit unknown/error feature status.
7. Verify exact retained ID coverage, source-key mappings, byte/hash equality,
   decoded hashes, counts, cache reconciliation, `foreign_key_check` and
   `integrity_check`. Existing corrupt inputs require a diagnostic failed run;
   do not silently publish a lossy conversion. Parsing limitations are distinct
   from corrupt compressed bytes or checksum mismatch.
8. Analyze indexes and record output size and timings. Close/checkpoint the output
   before atomically renaming the temporary destination to its final name. Failure
   leaves no apparently complete output; rerunning can restart safely. Emit a
   machine-readable report plus concise human summary. Rollback means reopening
   the original database in the previous app.

Acceptance: unchanged original file; no excluded records/raw archive in output;
13,507 retained games on the inspected baseline; all retained annotation bytes
identical; source/order/opening mappings validated; restart and failure tests pass.

### 04 — Replace read API and adapt maintenance scripts

Update `electron/database.mjs`, `queries.mjs`, `opening-read.mjs`, IPC/preload and
`src/types.ts` for v7. Remove book/raw-record endpoints and obligatory source joins.
Implement shared predicate building for search, facets and opening facets so all
filters agree. Return one row per game, deterministic sorting and bounded paging;
adapt `GameDetail` to the existing review component contract.

Update opening enrichment and study-marker scripts: remove `record_kind` and old
deletion-column assumptions, preserve Lichess revision publication, and write the
new feature/cache contract. Support newly added games and changed PGN without
stale labels/counts. Keep original source ECO separate from derived ECO.

Acceptance: API works for sourced/unsourced games, many-valued relations and all
filter combinations. New app targets v7 with a clear migration instruction for
v3–v6 files; retaining two complete readers is outside this release. Reject unknown
future versions and never auto-migrate in Electron.

### 05 — Replace filters and remove archive-only app features

Update `src/App.tsx` with searchable property multiselects and neutral source
labels. Keep existing review/list navigation, sorting, global metadata search,
source order where defined and opening hierarchy. Remove Book/section assumptions
from mandatory controls; section can be an optional source property. Add source
and completeness labels where useful without redesigning review.

Remove `BookReader.tsx`, `BookText.tsx`, book-mode feature flags, raw-record types,
unused book-reader IPC, obsolete styles and book-reader-only tests/scripts.
Audit shared `books.mjs` ordering/grouping and parser utilities before removing
them; keep or extract anything still needed for source ordering or game comments.
Preserve review components and engine behavior; limit changes there to required
data adaptation. Technical cache/migration details stay outside ordinary filters.

Acceptance: all categorical filters searchable/multiselect; Unicode labels work;
no archive-only routes or APIs remain; game review behaves as before.

### 06 — Verify, benchmark and document release

Run fixture migrations for each supported input version, repeated imports,
multiple sources/annotators, missing metadata, aliases kept distinct, corruption,
stale/missing openings and interrupted conversion. Verify cache rebuild matches
incremental updates, including PGN changes and deleting the last use of a value.

Run `npm test`, `npm run build` and `npm run test:desktop` after updating fixture
builders. Desktop checks cover multi-property selections, unknown/zero-match
states, selected options, pagination, returning from review and keyboard access.
Retain review regressions for nested annotations, medals/critical stops and reveal,
Piece mode, board sizing, temporary lines and engine switches. Run existing local
engine verification where configured; document any unavailable optional coverage.

Measure cold/warm game search, total counts, opening facets and dropdown searches
on a migrated copy at current size and a larger synthetic dataset. Record query
plans and p50/p95 timings; initial target on the development machine is warm p95
under 200 ms for bounded dropdown requests and under 300 ms for filtered first
pages including counts. Adjust implementation from measured bottlenecks, not
speculative indexes. Treat targets as release criteria to validate, not promises
about untested hardware. Compare total/file-table sizes and migration runtime.

Update README, `docs/database.md`, maintenance commands and task index to describe
the games model, migration/rollback, read-only app, source-neutral imports,
completeness semantics and deferred normalization. Existing opening/engine plans
remain history; explicitly supersede conflicting book-archive preservation rules
for this release. No production database conversion is part of writing this plan.

## Constructive feedback and decisions to retain

The focus fits the existing UI and removes substantial duplicated extraction data.
The largest design risk is overgeneralizing “everything is a property” into an
untyped schema: use a uniform filter experience over typed data instead.

Preserving annotated editions is essential. Automatically combining games by
players, moves or hashes can discard the exact commentary this project values.
Likewise, completeness must remain an honest unknown until there is evidence;
game result and annotator tags cannot stand in for it.

Cache option dictionaries and global counts, but calculate contextual counts from
the current selection. Precomputing every possible combination would grow rapidly
and complicate imports. Keep all writers on one transaction contract so caches
cannot quietly diverge when internet imports arrive.

Perform this as a new output database and coordinated app release. It provides a
compact file, a measurable migration report and a straightforward rollback while
removing the long-term cost of maintaining the old archive model inside the app.
