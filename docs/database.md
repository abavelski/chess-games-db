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

The additive position-index tables are not yet implemented. PS-01 provides the shared, pure standard-chess Polyglot fingerprint in [`lib/position-hash.mjs`](../lib/position-hash.mjs), independent of the existing named-opening key. It returns unsigned 64-bit `bigint` hashes, explicit signed SQLite mappings, normalized four-field collision-verification keys, and exact two-color pawn signatures. See [PS-01 contract and validation rules](tasks/position-search/01-hash-contract.md). No archive migration or opening-query behavior changed.
