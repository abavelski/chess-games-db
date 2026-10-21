# Annotated Games Explorer

A local **Electron + React + SQLite** desktop game browser. Filter annotated games, open one in full-screen review, and return to the same list.

Built on the schema and migration system in this repository, with the **[Lichess PGN Viewer](https://github.com/lichess-org/pgn-viewer)** (which uses Chessground) for the board, move navigation, comments, and variations.

## Local analysis and Piece mode

Game review supports local full Stockfish and Maia 3 79M analysis. The toolbar has **Game review settings** (gear icon), **Stockfish**, and **Maia**. The two engine buttons turn analysis on/off using your saved preferences. Open **Game review settings** to flip the board or configure independent line visibility, line counts (1/3/5), arrows, the evaluation bar, game board annotations, and Maia’s human rating. Technical installation settings stay in the local engine configuration file. Maia shows move probabilities. Click a suggested move or move a piece legally on the review board to explore. Existing book or personal moves navigate to that position; new moves create personal sidelines highlighted in teal with the same font as book variations. Lines remain available throughout the review. Pawn promotion offers all four choices.

The score uses numbered White/Black columns, full-width comments, and smaller nested variations. Drag the board’s lower-right corner to resize it; double-click to reset. The preferred size is remembered locally and adjusts to the available window. See [layout and component reuse](docs/tasks/review-layout/README.md).

ChessBase critical-position tags appear as small colored diamonds beside moves: blue for opening, red for middlegame, and green for endgame. Hover for the phase. The previous/next critical-position buttons beside **Piece mode** follow score order, including variations, and stop at either end. These are study bookmarks; select one and open Piece mode to explore it. Unrecognized critical tags remain readable in the commentary.

**Piece mode** hides everything except a free board and two controls. Move either side's pieces without chess legality constraints; **Reset position** restores the entry position, and **Return to review** (or Escape) restores the previous review, including its variation, temporary branch, orientation, scroll, focus, and engine switches. Analysis pauses while Piece mode is open. No study action edits the source PGN or archive.

See [local engine installation](docs/tasks/local-engine-review/SETUP.md), [implementation tasks](docs/tasks/local-engine-review/README.md), and [verification results](docs/tasks/local-engine-review/VERIFICATION.md). Engines default off when opening a review. Display preferences, line count, and human rating are remembered locally.

## Run the desktop app

Prerequisites: **Node.js 22+**, npm, and (if developing on Linux) the system dependencies required by Electron. Native SQLite bindings are rebuilt for Electron automatically during installation.

```sh
npm install
npm run dev
```

For Stockfish and Maia on a fresh checkout, follow the [macOS and Windows engine setup guide](docs/tasks/local-engine-review/SETUP.md). Engine binaries, Python environments, weights, and `.local-engines/engines.json` are local assets and are not committed. The guide covers development, `npm start`, and packaged production configuration.

For a production build or local installer:

For a fresh Windows computer, see the short [Windows release and installation checklist](docs/windows-release.md), including which database and engine files to copy.

```sh
npm run build      # typecheck and bundle the React renderer
npm start          # run the built desktop app without a development server
npm run dist:dir   # unpacked desktop app
npm run dist       # installer/DMG/AppImage (depends on platform)
npm test           # SQL filter/query unit tests
npm run test:desktop # full offline Electron regression suite (requires a graphical session)
npm run benchmark:positions -- --games 240 --samples 80 # disposable fixture only
```

The app opens the previously selected database if present, and during development also looks for `data/annotated-games.sqlite3`. Otherwise, click **Open database** to select an existing SQLite file. **The database is not included in Git or any installer.** The app never writes to the archive and does not create an empty replacement if a file is missing.

## Browse and study

- Searchable multiselects cover sources, source types, event, year, result, and study markers. Year ranges remain available.
- Values within a property use OR; different properties use AND. Empty selections impose no constraint. Missing/unknown values are explicit options. Selected chips remain available at zero matches; dropdown counts apply other filters.
- Click the star beside a game or its review title to save or remove it from favourites immediately. **Favourites only** combines with search, properties, years and openings. The first star change adds a boolean `games.favourite` column to the same database; browsing alone does not change the archive.
- Use the **Add comment** icon beside Stockfish and Maia to show or hide the editor at any position, including the start and book variations. The editor is hidden by default. Personal comments appear inline with distinct colour and highlighting. The **Save my comments** icon persists personal lines and comments and is enabled only while changes are unsaved. The **Delete my lines and comments** icon removes all personal lines and comments in this game from both the review and database, preserving book moves and annotations; it is enabled whenever saved or unsaved personal lines or comments exist. **Back to games** or **Esc** asks you to save or discard unsaved changes, with Cancel to keep reviewing. Nothing is saved automatically when leaving. Save failures keep the review open with an error. The first save applies `db/migrations/008_personal_analysis.sql` to create `game_personal_analysis`, keyed by game ID, in the existing archive. Fresh archives include this table. This is an optional additive extension of schema 7: browsing never migrates an existing database, and applying it preserves any previously saved personal analysis. Original PGN bytes and annotations stay intact. **My lines or comments** filters games with saved personal analysis and combines with the other filters.
- Exact Unicode spellings and whole annotator credits are preserved. Known catalogue collections appear once under Source; their section identities remain stored. Source order uses collection, section and original record sequence.
- A game can have several sources or none. Different annotated editions remain distinct even when their moves or hashes match. Completeness remains unknown without trusted source evidence; `*` alone does not mean partial.
- The **Opening** section retains offline name search and the family → line → subline hierarchy, with descendant/transposition matching. Source ECO stays separate from derived Lichess ECO.
- Click a game to open **full-screen game review** in the same window. **Back to games** or **Esc** returns to the same filters, page, scroll position, and focused game.
- Review shortcuts: **← / →** previous/next move, **Home / End** (or **↑ / ↓**) first/last position, **Shift+← / Shift+→** first/last position, and **F** to flip the board. Text input and editing keys retain their normal behavior.
- The board supports annotated moves, variations, colored arrows, and square highlights. Commentary, all PGN headers, and the unchanged original PGN are available in review.
- Standalone texts, positions, lines, book reading and extraction-record APIs are removed from v7. Game comments, variations and study annotations remain in the exact PGN. Source-deleted games stay hidden.
- PGNs are decompressed locally and **SHA-256 is verified before display**.

The app uses a narrow, context-isolated Electron preload and parameterized, bounded SQL. The renderer does not receive arbitrary SQL execution, database handles, or access to Node.js. Large and invalid PGNs display an error instead of bypassing integrity checks. Deleted-in-source games are excluded from the browser.

### Schema version

The desktop accepts **schema v7 only** and never migrates files. Convert a legacy v3–v6 archive explicitly to a new output:

```sh
npm run migrate:games -- --input data/chess-books.sqlite3 --output data/annotated-games.sqlite3 --dry-run > data/migration-inventory.json
npm run migrate:games -- --input data/chess-books.sqlite3 --output data/annotated-games.sqlite3 --report data/migration-report.json > data/migration-result.json
```

Conversion retains games, IDs, exact PGNs, source provenance and valid active opening classifications. It removes standalone records and raw extraction archives, rebuilds features/options, verifies checksums, mappings and database integrity, and publishes only a verified output. Existing outputs and aliases are refused. No network is used. Parser limitations preserve games with unknown/error features; corrupt compressed bytes or checksums fail conversion. Reports contain local source identities: keep them under ignored `data/`.

Rollback: reopen the original file with the previous application version. The original is never converted in place. To create an empty v7 file, use `python3 scripts/init-db.py data/empty-games.sqlite3`; this does not import games. Initialization refuses legacy files and directs you to the converter.

See [docs/database.md](docs/database.md) for the schema, stable identifiers, PGN compression and reimport rules.

## Technical layout

| Path | Purpose |
| --- | --- |
| `electron/main.mjs` | Desktop window, local database dialog, restricted IPC |
| `electron/preload.cjs` | Context-isolated renderer API |
| `electron/database.mjs` | Read-only SQLite access, Zstandard decoding, checksum validation |
| `electron/queries.mjs` | Parameterized filtering, sort whitelists, safe paging |
| `src/App.tsx` | Games-only browser, filters, and review navigation |
| `lib/game-writer.mjs` | Shared transactional imports, features and property cache |
| `lib/position-hash.mjs` | Pure Polyglot position/pawn fingerprint contract (PS-01) |
| `lib/position-mainline.mjs` | Pure, strict one-PGN mainline extraction, root/ply/viewer paths, and diagnostics (PS-03) |
| `lib/position-index-storage.mjs` | Read-only detection of the optional position-index schema (PS-02) |
| `scripts/position-index.mjs` | Legacy explicit position-storage installer (PS-02) |
| `scripts/positions.mjs` / `lib/position-builder.mjs` | Offline position index build, rebuild, resume, status and per-game atomic publication (PS-04) |
| `electron/position-search.mjs` / `electron/database.mjs` | Collision-safe mainline position lookup, coverage and shared game filters (PS-05) |
| `src/PositionSearchBoard.tsx` / `src/position-search-board.mjs` | Keyboard-accessible legal-move board, undo/reset and explicit search in the browser (PS-06) |
| `src/review-navigation.mjs` / `src/GameReview.tsx` | Verify searched positions against original PGN and reviewer board, choose safe Study-stops navigation (PS-07) |
| `scripts/migrate-games.mjs` | Explicit read-only legacy snapshot conversion |
| `src/PgnBoard.tsx` | Lichess viewer integration |
| `db/migrations/` | Versioned schema migrations |
| `scripts/init-db.py` | Fresh v7 initializer |

The source code is licensed under **GPL-3.0-or-later**, in keeping with the Lichess PGN Viewer license. No custom chess engine is included; the optional exact-position search UI uses a separately built offline position index (played mainlines by default, opt-in author variations). Named opening matches are derived from the Lichess catalogue; live Explorer statistics are a separate future feature.

## Optional offline position-search index (PS-02–PS-04)

A local archive can optionally receive the **derived position-index tables**, without changing its original PGNs or schema version. The PS-03 extractor computes per-ply hashes and reviewer paths; the offline PS-04 builder persists complete, checksum-verified mainlines. **Position search UI is available from PS-06**, but only backed by an explicitly built index. PS-07 verifies stored paths against original PGN and opens matching review positions, safely handling stale indexes and Study stops. Neither opening an archive nor starting the desktop app installs or builds the extension.

From a development checkout with Node.js 22+ and dependencies installed, **make a consistent copy** and opt in explicitly. Close other writers; SQLite's online backup command also captures committed WAL transactions. Use a *new destination file*, then select that copy using **Change database** in the app:

```sh
sqlite3 data/annotated-games.sqlite3 ".backup 'data/games.positions.sqlite3'"
npm run positions -- init --database data/games.positions.sqlite3
npm run positions -- build --database data/games.positions.sqlite3 --batch-size 25
npm run positions -- status --database data/games.positions.sqlite3
npm run positions -- rebuild --database data/games.positions.sqlite3 --dry-run
# Optional full replay after troubleshooting or an algorithm update:
npm run positions -- rebuild --database data/games.positions.sqlite3
npm run positions -- status --database data/games.positions.sqlite3
```

If the `sqlite3` command-line tool is unavailable, use another SQLite-compatible *online backup* tool; only use a filesystem copy after all database connections, including WAL writers, are closed. Neither the installer nor the app makes a backup for you.

All commands require an explicit existing schema-7 archive path. `init` is idempotent; `build` resumes by skipping current completed games, and `rebuild` replays them without dropping valid old results ahead of publication. `build --dry-run` checks PGNs and reports prospective counts without writing. `--max-games N` bounds attempted games per invocation; `--batch-size N` limits the scan window (1–1000). Repeat `build` to resume after interruption. `status` distinguishes absent schema, unindexed, stale, invalid and complete coverage, including database size and stored occurrence totals. A failed or corrupt PGN gets a per-game diagnostic and no partial hits. Indexing is local and never starts engines or network calls. Hidden games and separately annotated editions are stored individually; search excludes hidden games and returns one earliest matching occurrence per visible game. PGN changes invalidate rows in the writer transaction, and deletions cascade; orphaned keys are reclaimed after builds. `getCatalog().capabilities.positionIndex.status` reports schema capability only, not coverage. See [PS-04](docs/tasks/position-search/04-index-builder.md) and the [PS-08 release measurements](docs/tasks/position-search/08-mvp-verification.md).

### Recovery and index scope

The optional index defaults to **standard-chess root and mainline** positions. PS-09 can additionally index nested original author PGN variations on explicit request; the browser and API default to mainline search and allow opt-in **Include annotated variations** after building with `--include-variations`. Pawn signatures are not yet exposed as a pawn-structure search UI. Keys include side to move, castling and Polyglot en-passant semantics; equivalent transpositions match even when move orders or matching plies differ. Repeated occurrences of the same position within one game produce one result (earliest ply), while different annotated editions remain separate.

If `status` reports `unindexed` or `stale`, repeat `build` on the **copy**. Use `rebuild --dry-run` to preview a full replay, then `rebuild` to regenerate derived rows. Invalid source PGNs or checksum failures are reported, not silently skipped as conclusive no-matches; correcting an invalid PGN requires fixing/reimporting its source separately. If the extension is incompatible or a copy becomes damaged, restore a **fresh verified archive copy** from the original and rerun `init → build → status`. You can always reopen the original unindexed archive. Neither searching nor starting Electron automatically installs, repairs or updates the index. Explicit favourite and personal-note actions remain the only review/browser writes.

To measure your own archive **without modifying it**, run `npm run benchmark:positions -- --database /path/to/archive.sqlite3 --samples 80`. The benchmark opens the supplied schema-7 archive read-only, makes a temporary SQLite backup, performs indexing on that copy, and removes it afterward. Omitting `--database` benchmarks a deterministic, generated fixture (240 games by default). For example, a measured **240-game fixture copy** increased from **520,192 to 847,872 bytes** after indexing (**+327,680 bytes / 320 KiB**); real archive sizes depend on its scores. Results include hardware, build/rebuild time, additional file size, query plans, duplicate occurrences, coverage and warmed p50/p95 latency; do not treat [fixture measurements](docs/tasks/position-search/08-mvp-verification.md) as performance guarantees for your archive.

### Optional author-variation index (PS-09)

After installing the derived index on an archive **copy**, opt in to author variation replay and check independent all-lines coverage:

```sh
npm run positions -- build --database data/games.positions.sqlite3 --include-variations
npm run positions -- status --database data/games.positions.sqlite3
npm run positions -- rebuild --database data/games.positions.sqlite3 --include-variations --dry-run
```

`status` reports `allComplete` and `variationIncomplete`. Valid nested source PGN sidelines receive exact reviewer paths, plies, position hashes and pawn signatures. Invalid sidelines are diagnosed and retain their game's valid mainline, without claiming complete variation coverage. **Saved personal lines are excluded.** PS-10 enables the **Include annotated variations** checkbox for search results and verified review-at-variation navigation. Normal queries remain mainline-only, even when an archive contains all-lines occurrences. See [PS-09 implementation](docs/tasks/position-search/09-variation-indexing.md).

## Position search API (PS-05)

With an explicitly built index (`npm run positions -- build --database PATH`), the app's read-only archive API supports `searchByPosition(fen, filters)` over the Electron preload/IPC boundary. The query accepts a validated four- or six-field standard-chess FEN, computes Polyglot keys on the trusted side, checks the full position key against collisions, and combines matches with the **same** filters and sorting as `searchGames`. It returns `{ rows, total, page, pageSize, coverage }`; each row includes `match: { path, ply, isMainline, type }` with `type` of `playedGame` or `sourceVariation` for verified reviewer navigation. Pass `scope: 'includeSourceVariations'` in the filter object to search both played positions and indexed author sidelines; the default `'mainline'` scope preserves MVP behavior.

`coverage.status` is `unavailable`, `incompatible`, `partial`, or `complete`; `coverage.isComplete` and the scope-specific visible-game counts `complete`, `mainlineOnly`, `invalid`, `building`, `partial`, `stale`, `unsupported`, `unindexed` are essential. In incomplete coverage, `rows` and `total` reflect **indexed games only**, so a zero result is not conclusive. Hidden games are excluded and repeated positions yield just one preferred occurrence per game (played mainline first, otherwise earliest ply, shortest and stable path). In opt-in variation mode, archives with mainline-only indexes still return their known played hits but warn explicitly that author-variation coverage is incomplete. Only complete all-lines index coverage makes zero results exhaustive. Neither searching nor opening the archive installs an extension, scans/decompresses source PGN, or starts any background indexing. The interactive search board is implemented in PS-06; PS-07 validates and opens the exact match in review.

## Search by position in the games browser (PS-06)

Open an archive with an offline index and select **Search by position** below the opening filter. Check **Include annotated variations** to include indexed source-authored sidelines; matches seen only in annotations are labelled separately and open at the verified branch. Repeated matches produce one card per game, favouring the played occurrence. The option works by keyboard and preserves other filters, sorting, and review-return state. The board starts at the normal chess setup; click a piece, then a highlighted legal destination. Square buttons can also be operated with keyboard arrow keys and Enter/Space (Escape cancels a selection). The board supports castling, en passant, explicit promotion choices, **Undo**, **Reset board** and **Flip**. It shows SAN move history, the side to move, and the current FEN.

Click **Search position** to search; moving a piece by itself never runs a database query. Exact-position matches appear in the existing game list with a ply label and combine with all currently selected source, year, opening, favourites and personal filters. Pagination resets when the searched position or a filter changes. Changing the board after a search shows a reminder until you search again. The board, search results, pagination and browser scroll remain intact when opening a review and returning. **Clear position search** returns to normal games while preserving all unrelated filters and the board's move history.

If the archive has no index, the browser shows how to explicitly build one; incomplete indexes show complete/unindexed/building/stale/invalid counts and never mistake an unindexed zero for a definite no-match. A fully indexed zero is labelled as no games reaching this exact position under the filters. The interactive board remains separate from the free-move **Piece mode**. Opening a matching row now verifies the stored occurrence against the original PGN and jumps to that exact position. A missing/stale index path or viewer mismatch produces a notice and safely opens at game start. If **Study stops** hides the target, review opens at the nearest revealed mainline ancestor with an explanation, without revealing hidden continuations. Back preserves filters, page, board, moves, scroll and focus.

## Opening catalogue enrichment

The desktop app writes favourites and personal lines/comments into the same database. Enrichment is an explicit, offline-capable
maintenance step; start with a copy of your archive. Install dependencies with
`npm install`. The commands below use Electron's Node runtime so SQLite uses the
same native ABI as the app; no browser window is opened.

```sh
cp data/annotated-games.sqlite3 data/games.openings.sqlite3
npm run openings -- download --commit a6189a30dc273ccb21fc2536a9a2fefd5592a67a --out data/openings-a6189a3
npm run openings -- enrich --input data/openings-a6189a3 --database data/games.openings.sqlite3 --dry-run
npm run openings -- enrich --input data/openings-a6189a3 --database data/games.openings.sqlite3
```

The pinned upstream catalogue is [Lichess chess-openings](https://github.com/lichess-org/chess-openings),
released under CC0. Download creates a new directory containing all five TSVs and
a checksummed manifest; no network is needed to classify games afterward. For a
newer catalogue, use its full commit SHA and a new directory. Optional taxonomy
fixes can be supplied as `overrides.json` mapping full upstream names to arrays
of labels; put the file's SHA-256 in manifest field `overrides`.

Interrupted runs resume when the same command is repeated. `--max-games N` caps
a run for staged processing (exit code 2 means not published yet). `--rebuild`
starts a fresh classification run. Source games, headers, ECO and PGNs are never
rewritten. Corrupt/illegal games are reported as invalid; unmatched games remain
browsable. Publication replaces the active revision only after all games have a
result. The JSON report includes coverage, diagnostics by status, and the count
of derived/source ECO differences. Changing PGN, catalogue or algorithm causes
reclassification; the previous published revision remains available during work.

After enrichment, launch the app and use **Change database** to select the enriched
copy (or select the same archive again to refresh its metadata). The app remembers
the selected file. Opening filters and labels work entirely offline; no Lichess
account, token, or Explorer API is involved. The deepest named catalogue position
is an opening classification, not a claim about where chess theory ends.

Future producers must use the [shared writer contract](docs/tasks/annotated-games-db/writer.md). Local PGN adapters, network fetching, name reconciliation and a new import UI are deferred. See [release verification](docs/tasks/annotated-games-db/verification.md) for migration, desktop and performance measurements. This release supersedes historical book-archive preservation and v3–v6 reader compatibility plans.
