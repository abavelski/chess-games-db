# Annotated games database, schema 7

The desktop opens v7 read-only. Ordinary initialization creates a fresh v7 file;
legacy v3–v6 conversion is explicit and always writes a new output. Migrations
001–006 describe the previous archive and are unchanged. Migration 007 defines
the fresh games schema, not an in-place ALTER sequence.

One row is an annotated edition. Neither matching scores, names, nor PGN hashes
merge editions. Integer IDs and durable `game_key` identify a game independently
of source links. Compressed PGNs, original headers, dates/results/ECO, timestamps
and Unicode spellings are preserved exactly. SHA-256 covers decoded UTF-8 bytes;
compressed frames are independent Zstandard frames. Reads verify size, decoding
and checksum. The list never reads PGN blobs.

| Table | Responsibility |
| --- | --- |
| games | Durable identity, original metadata, typed year/result/completeness, event/site links, hidden provenance, exact PGN and extras |
| players / game_players | Exact names and separate white/black roles; missing names have no link |
| annotators / game_annotators | Exact whole credits, original credit order, multiple annotators |
| events / sites | Stable exact dimension identities plus normalized search keys |
| sources / game_sources | Optional many-valued references, stable source/local keys, kind, location, section, sequence, one primary reference |
| game_features | Input hash, extractor version/status, critical/medal counts, comment/variation/NAG/board annotation facts |
| property_options | Rebuildable normalized option dictionary and global distinct-game counts |
| property_cache_state | Content/cache revisions and cache algorithm/build timestamp |
| migration_manifest | Converter policy, input identity, verification status and summary |
| opening_* / game_opening* | Revisioned offline Lichess taxonomy, classifications and matches |
| position_index_meta / position_keys | Optional v7 derived position schema version and collision-verified Polyglot/pawn keys |
| game_position_occurrences / game_position_index_state | Optional game/ply/viewer-path occurrences and per-game PGN hash, algorithm, scope and build status |

Game-owned relations cascade on explicit game deletion; referenced dimensions and
sources restrict deletion. Reverse indexes begin with game ID, with additional
player/role/game, source/local key, year, result, completeness, event/site, ECO and
nonunique hash indexes. JSON fields require objects; role, status, Boolean, hash,
count and key constraints are enforced. Only one primary reference is permitted;
the writer assigns one to each sourced game. Unsourced reads have a neutral label.

Reliable legacy `book:catalog:…:db-N` collections share a source option through
`extras_json.collection_key`, without merging source IDs. Source section options
retain section identities; collection rank and original sequence retain ordering.
Matching titles never establish shared identity. Exact spellings remain distinct
even when Unicode-normalized search keys collide. Alias normalization is deferred.

Result preserves its original string and derives white_win, black_win, draw,
unfinished or unknown. Completeness is complete, partial or unknown and requires
trusted evidence for either known value. A decisive result does not prove a full
score; `*` does not prove a partial score. Migration keeps all `record_kind=game`
rows, including training, unannotated and hidden games. Original training/deletion
and game-specific extraction metadata survive in provenance JSON. Text-reader
payloads, standalone records and raw extraction bytes are excluded, with identities
and reasons in a separate local report. Only referenced sources survive.

Features are unknown while pending, stale or failed, distinct from known zero.
Extraction uses the review parser and includes variations. Invalid starting
positions or unreachable moves produce explicit parser errors without dropping
games. Medals count distinct labels per move; critical positions count marked
moves; combined study markers use their union. All original tags remain in PGN.

## Writes and caches

All imports, metadata updates, feature writes and game deletions use
`lib/game-writer.mjs`; see the [producer contract](tasks/annotated-games-db/writer.md).
Stable source keys/local record keys find an existing edition. Reimports preserve
ID, game key and created_at. Renames do not create editions. Contradictory mappings
roll back. PGN changes remove opening classifications and reset feature state.
Never use INSERT OR REPLACE or infer identities from hashes.

The writer removes old distinct property contributions and adds new contributions
in one transaction, including source title/type changes affecting linked games.
Zero-use suggestions disappear without deleting stable dimension IDs. Revision
updates commit with the cache. To rebuild from authoritative typed data:

```sh
node scripts/run-archive-tool.mjs scripts/write-game.mjs data/annotated-games.sqlite3 rebuild-cache
npm run study-markers -- --database data/annotated-games.sqlite3 --rebuild
```

The game_property_values view defines distinct contributions for every visible
game. Cached counts are global. Contextual dropdown counts ignore their own
selection, apply other filters and opening selection, and count bounded candidate
values using grouped indexed queries. Dictionaries use NFKC Unicode lowercase
prefix search, not SQLite NOCASE. Context caches include content revision, active
opening revision, property, query, cursor and filters. Rebuilding is safe to rerun.

## Reads

`searchGames(filters)` and `openingFacets(filters)` share whitelisted predicates.
Categorical selections are `properties: {white: ["12"], result: ["draw"]}` with
OR within one property and AND across properties. Empty arrays impose no constraint;
missing/unknown values are explicit. Invalid IDs and excessive selections fail.
`propertyOptions({property,query,filters,cursor,limit})` returns bounded stable
IDs, labels, contextual counts, and a cursor. Selected values remain present at
zero matches. Relations use EXISTS and never multiply pages or totals.

Opening facets ignore their own opening selection. Valid labels require matching
PGN hashes and the active completed revision. Earlier named positions, descendants
and transpositions retain the previous semantics. Original source ECO remains
separate. Unenriched, unmatched, invalid and stale states remain distinguishable.
Offline enrichment publishes a complete revision atomically; migration copies
only the active completed catalogue and matching-hash retained classifications.

## Conversion and rollback

See [README migration commands](../README.md#schema-version). The converter backs
up a read-only SQLite connection to a consistent snapshot including committed WAL
contents. Input integrity, inventory and checksums are verified first. A temporary
destination is populated transactionally, verified, analyzed and closed, then
published with an atomic exclusive hard link on the destination filesystem.
Failure leaves no apparently complete output; reruns restart with a fresh temp.
Existing outputs, symlinks and report aliases are refused. Unsupported versions
fail clearly. No fetching is performed. Reports contain actual input counts and
excluded identities; keep them local. Rollback is reopening the original with the
previous app. Historical book/raw archive preservation plans are superseded.

## Position search hash contract (PS-01)

PS-01 provides the shared, pure standard-chess Polyglot fingerprint in [`lib/position-hash.mjs`](../lib/position-hash.mjs), independent of the existing named-opening key. It returns unsigned 64-bit `bigint` hashes, explicit signed SQLite mappings, normalized four-field collision-verification keys, and exact two-color pawn signatures. See [PS-01 contract and validation rules](tasks/position-search/01-hash-contract.md). No archive migration or opening-query behavior changed.

## Optional position-index extension (PS-02)

`db/migrations/009_position_index.sql` is **not** part of schema 7 initialization and is never installed on archive open. With a backup, run `npm run position-index -- install --database PATH`; the explicit CLI checks schema 7, enables foreign keys, installs atomically, rejects incompatible partial installs, and keeps `user_version=7`. Existing archives without 009 remain fully usable. `ChessArchive.positionIndexCapability()` is read-only and reports `unavailable`, `incompatible`, or `installed`, also surfaced in `catalog().capabilities.positionIndex`. Installed means schema-compatible, **not** that any games are indexed. PS-04 adds offline index construction, and PS-05 adds a read-only search API. The graphical search board remains a later task.

`position_keys` stores signed SQLite `zobrist_hash`, four-field `exact_key` (Polyglot EP rule), signed `pawn_hash`, and exact white:black pawn-bitboard signature. Its composite unique key `(zobrist_hash, exact_key)` permits forced hash collisions, and its `(pawn_hash,pawn_signature)` index supports independently verified pawn matching. Bind signed 64-bit `bigint` via `BigInt.asIntN(64, hash)`, read through `safeIntegers()`, reverse-map with `BigInt.asUintN(64, signed)`; never use JSON or `Number` for hashes.

`game_position_occurrences` links games to position keys, recording nonnegative ply, mainline flag and a viewer path. `(game_id,path)` is unique, including the empty root path at ply 0; shared positions can occur in distinct editions or at multiple paths. Queries use indexed position and reverse-game lookups. `game_position_index_state` stores the input PGN SHA-256, algorithm ID, indexer version, scope (`mainline`/`all`), `building`/`partial`/`failed`/`complete`/`stale` status, diagnostic, and timestamps. `searchable_game_position_occurrences` exposes only **complete**, PGN-hash-current, Polyglot-v1 rows; the future query layer must additionally enforce indexer version and compatible scope. Trigger `game_position_index_invalidate_pgn` removes stale occurrences and marks the state stale **inside the same transaction** as any PGN SHA change (including reimports via `lib/game-writer.mjs`). Game deletion cascades to state/occurrences, but shared position keys are retained.

Full contract: [PS-02](tasks/position-search/02-position-storage.md). No original records, personal analyses, opening classifications, migration version, or existing filter semantics are changed by installation.

## PS-03 replay contract (no archive writes)

`lib/position-mainline.mjs` exports `extractMainlinePositions(pgn)` and `MAINLINE_EXTRACTOR_VERSION = 'position-mainline-v1'`. It validates one standard-chess source PGN (including optional `SetUp`/`FEN` custom starts), independently rejects malformed or skipped mainline tokens, and emits the actual root at `path=''`, `ply=0` plus one record per legal mainline node. Each move appends the same `scalachessCharPair` used by the existing PGN reviewer; non-root ply uses the viewer's absolute move number (including custom FEN fullmove counters). Hashes, signed SQLite mappings, four-field verification key and exact pawn signature use PS-01. If any part of a score is invalid, the function returns `status='invalid'`, a diagnostic and **no** occurrences, preventing partial matches from becoming authoritative. PGN bytes, headers and annotation variations are unchanged; PS-04 will own checksum validation, status persistence and transactional publication. See [PS-03](tasks/position-search/03-mainline-replay.md).

## PS-04 offline index builder

Use `npm run positions -- init --database PATH`, then `npm run positions -- build --database PATH`; inspect `status` or run `rebuild` for a full replay. Use `--dry-run` for no writes and `--max-games N` / `--batch-size N` for bounded, resumable work. Each PGN is decoded with a SHA-256 check and replayed as a complete mainline (including root); keys are deduplicated by hash **and** exact position, while each path is stored separately. The game occurrences and matching checksum/indexer version are published in one SQLite transaction. A malformed PGN becomes a failed index state with a diagnostic and zero hits. Old correct per-game rows survive a failed replacement transaction, and the v7 archive's original game data is not modified. Any PGN hash change in `upsertGame` invalidates derived data via migration 009's trigger; deletions cascade; subsequent builds reclaim orphan keys.

`status` returns `unavailable` when the optional schema is missing, otherwise per-game `complete`, `invalid`, `stale` and `unindexed` counts, total rows and SQLite size. Hidden games are indexed for consistency but must be excluded by future user-facing searches. Building the index never happens when opening an archive and does not enable the future search UI. See [PS-04](tasks/position-search/04-index-builder.md).

## PS-05 collision-safe, read-only search API

`ChessArchive.searchByPosition(fen, filters)` returns `{rows,total,page,pageSize,coverage}` through `archive:position-search` and the typed preload facade, without accepting hashes or SQL from the renderer. It requires a strict standard-chess four- or six-field FEN, hashes with PS-01, checks the **signed hash and exact key** using the composite SQLite index, and then looks up mainline occurrences by indexed `position_id`. The query checks the current game PGN digest, the pinned Polyglot algorithm, supported builder version and mainline scope; a window rank chooses the earliest ply and then path per game. The existing `gameQuery`/opening-selection predicates, whitelisted sort and paging are reused without PGN decoding. Each game has a `match: {path,ply,isMainline:true}` alongside the normal list metadata/opening label.

Coverage is computed for visible games without altering the archive. It reports missing extension, incompatible extension or complete/partial indexed coverage, with separate complete, invalid, building, partial, stale, unsupported and unindexed counts. If coverage is incomplete, totals reflect **only currently searchable games**, not a trustworthy absence of matches. Hidden editions never appear. The archive does not migrate or build on opening; PS-06 adds the UI. Regression fixtures and query plans are in `tests/position-search.check.mjs`. See [PS-05](tasks/position-search/05-search-api.md).
