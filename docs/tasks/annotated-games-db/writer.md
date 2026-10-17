# Shared game writer contract (v7)

Fresh initialization uses only migration 007. Never apply it in place to a legacy
archive. `init-db.py` refuses legacy upgrades. Electron opens v7 read-only.

Local PGN and future network producers call `upsertGame(db, input)` in
`lib/game-writer.mjs`, or run `node scripts/run-archive-tool.mjs
scripts/write-game.mjs DATABASE upsert INPUT.json`. JSON inputs carry
`pgn_zstd_base64`; the library takes a Uint8Array `pgn_zstd`. Supply its decoded
SHA-256, original `headers_json`, metadata and optional `annotators` array of whole
credits. A comma never splits a credit. Metadata updates preserve integer IDs,
`game_key` and `created_at`. Imports with stable keys update annotated editions;
PGN hashes are deliberately nonunique. Exact names, including search collisions,
remain separate dimensions. Explicit completeness needs trusted evidence.

Supply `sources: [{source: {source_key,title,kind,…}, source_game_key,
is_primary,sequence,section,locator,url}]`. Keys belong to the producer and must
survive title/file renames. A linked source/local key identifies the edition.
Additional links attach only explicitly; contradictory mappings roll back the
whole transaction. Omitted links stay linked. Source title changes preserve IDs.
Unsourced games must reuse their returned durable `game_key` on later writes.
Migration uses `legacy:` plus a JSON array of original source/record keys.

The writer validates compressed data and checksum, maintains dimensions, distinct
property contributions and content/cache revisions atomically, and invalidates
opening labels and marker/annotation facts on PGN changes. `{derive:false}` exposes
unknown feature values until `writeFeatures` succeeds. Parser failures preserve
original data with error status. `deleteGame` removes contributions and cascades
game-owned relations. `rebuildProperties` repairs the cache from authoritative data.
All production writers must use these functions; direct SQL mutations are outside
this contract. Source deletion is restricted while referenced.

The external extraction producer is not in this repository. Its format adapter,
web fetching, reconciliation, and import UI remain separate integration work.
