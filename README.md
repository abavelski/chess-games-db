# Chess Books Explorer

A local, read-only **Electron + React + SQLite** desktop game browser. Filter annotated games, open one in full-screen review, and return to the same list.

Built on the schema and migration system in this repository, with the **[Lichess PGN Viewer](https://github.com/lichess-org/pgn-viewer)** (which uses Chessground) for the board, move navigation, comments, and variations.

## Local analysis and Piece mode

Game review supports local full Stockfish and Maia 3 79M analysis. The toolbar has **Game review settings** (gear icon), **Stockfish**, and **Maia**. The two engine buttons turn analysis on/off using your saved preferences. Open **Game review settings** to flip the board or configure independent line visibility, line counts (1/3/5), arrows, the evaluation bar, book board annotations, and Maia’s human rating. Technical installation settings stay in the local engine configuration file. Maia shows move probabilities. Click a suggested move to explore a temporary branch, or move a piece legally on the review board; **Return to book position** restores the source position. Pawn promotion offers all four choices.

**Piece mode** hides everything except a free board and two controls. Move either side's pieces without chess legality constraints; **Reset position** restores the entry position, and **Return to review** (or Escape) restores the previous review, including its variation, temporary branch, orientation, scroll, focus, and engine switches. Analysis pauses while Piece mode is open. No study action edits the source PGN or archive.

See [local engine installation](docs/tasks/local-engine-review/SETUP.md), [implementation tasks](docs/tasks/local-engine-review/README.md), and [verification results](docs/tasks/local-engine-review/VERIFICATION.md). Engines default off when opening a review. Display preferences, line count, and human rating are remembered locally.

## Run the desktop app

Prerequisites: **Node.js 22+**, npm, and (if developing on Linux) the system dependencies required by Electron. Native SQLite bindings are rebuilt for Electron automatically during installation.

```sh
npm install
npm run dev
```

For a production build or local installer:

```sh
npm run build      # typecheck and bundle the React renderer
npm start          # run the built desktop app without a development server
npm run dist:dir   # unpacked desktop app
npm run dist       # installer/DMG/AppImage (depends on platform)
npm test           # SQL filter/query unit tests
npm run test:desktop # games and opening-filter desktop smoke tests (requires a graphical session)
```

The app opens the previously selected database if present, and during development also looks for `data/chess-books.sqlite3`. Otherwise, click **Open database** to select an existing SQLite file. **The database is not included in Git or any installer.** The app never writes to the archive and does not create an empty replacement if a file is missing.

## Browse and study

- The front page contains **games only**, with search and filters for **book**, **White/Black players**, **annotator**, **event**, and **year range**. ECO and result are under **More filters**.
- Each game shows its players, event, year, ECO, result, source book, and annotator when available. Enriched archives also show the deepest named opening in the game list and review header.
- The **Opening** section supports name search and family → line → subline selectors, with game counts at every level. Parent selections include descendants and transpositions. A game matches any named mainline position it reaches, so its deepest displayed name can differ from an earlier line used to filter it. **Unclassified** includes missing, stale, unmatched, and invalid classifications. **Source ECO** remains a separate filter for original archive tags.
- Multi-file books appear once in the book filter. Select a **Book section** to narrow further. Games default to **Book order**, with year, player, title, and newest-added sorting also available.
- Click a game to open **full-screen game review** in the same window. **Back to games** or **Esc** returns to the same filters, page, scroll position, and focused game.
- Review shortcuts: **← / →** previous/next move, **Home / End** (or **↑ / ↓**) first/last position, **Shift+← / Shift+→** first/last position, and **F** to flip the board. Text input and editing keys retain their normal behavior.
- The board supports annotated moves, variations, colored arrows, and square highlights. Commentary, all PGN headers, and the unchanged original PGN are available in review.
- Positions, puzzles, training views, book texts, and original source records are hidden from the UI. Their database records and backend APIs remain intact. Source-deleted games are excluded.
- PGNs are decompressed locally and **SHA-256 is verified before display**.

Book mode is retained but disabled by default. For development, explicitly enable it with `VITE_ENABLE_BOOK_MODE=true npm run dev` (or prefix `npm run build` with the same variable). This restores **Read book** for the selected book, including the preserved prose, positions, extraction placeholders, and reading progress. `npm run test:book-reader` builds this opt-in mode and tests it; run `npm run build` afterward to restore the games-only build.

The app uses a narrow, context-isolated Electron preload and parameterized, bounded SQL. The renderer does not receive arbitrary SQL execution, database handles, or access to Node.js. Large and invalid PGNs display an error instead of bypassing integrity checks. Deleted-in-source games are excluded from the browser.

### Schema version

The desktop app supports **schema v3 and v4** and deliberately does not auto-migrate an archive. Named opening enrichment uses **v4**; v3 remains usable with original ECO filters. To create an archive or upgrade an existing one, **make a backup** and run:

```sh
python3 scripts/init-db.py data/chess-books.sqlite3
```

This creates the schema but **does not import chess books or sample games**. It needs Python 3 with SQLite JSON support. The local SQLite file is ignored under `data/`.

See [docs/database.md](docs/database.md) for the schema, stable identifiers, PGN compression and reimport rules.

## Technical layout

| Path | Purpose |
| --- | --- |
| `electron/main.mjs` | Desktop window, local database dialog, restricted IPC |
| `electron/preload.cjs` | Context-isolated renderer API |
| `electron/database.mjs` | Read-only SQLite access, Zstandard decoding, checksum validation |
| `electron/queries.mjs` | Parameterized filtering, sort whitelists, safe paging |
| `src/App.tsx` | Games-only browser, filters, and review navigation |
| `src/BookReader.tsx`, `src/BookText.tsx` | Book navigation, reading progress, and chapter prose |
| `src/PgnBoard.tsx` | Lichess viewer integration |
| `db/migrations/` | Versioned schema migrations |
| `scripts/init-db.py` | Transactional initializer / upgrader |

The source code is licensed under **GPL-3.0-or-later**, in keeping with the Lichess PGN Viewer license. No custom chess engine or full-game position index is included. Named opening matches are derived from the Lichess catalogue; live Explorer statistics are a separate future feature.

## Opening catalogue enrichment

The desktop app remains read-only. Enrichment is an explicit, offline-capable
maintenance step; start with a copy of your archive. Install dependencies with
`npm install`. The commands below use Electron's Node runtime so SQLite uses the
same native ABI as the app; no browser window is opened.

```sh
cp data/chess-books.sqlite3 data/chess-books.openings.sqlite3
python3 scripts/init-db.py data/chess-books.openings.sqlite3
npm run openings -- download --commit a6189a30dc273ccb21fc2536a9a2fefd5592a67a --out data/openings-a6189a3
npm run openings -- enrich --input data/openings-a6189a3 --database data/chess-books.openings.sqlite3 --dry-run
npm run openings -- enrich --input data/openings-a6189a3 --database data/chess-books.openings.sqlite3
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
