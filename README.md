# Chess Books Explorer

A local, read-only **Electron + React + SQLite** desktop application for browsing chess book archives: complete games, annotated positions, variations, training exercises, text, and original extraction records.

Built on the schema and migration system in this repository, with the **[Lichess PGN Viewer](https://github.com/lichess-org/pgn-viewer)** (which uses Chessground) for the board, move navigation, comments, and variations.

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
npm run test:desktop # desktop smoke test (requires a graphical session)
```

The app opens the previously selected database if present, and during development also looks for `data/chess-books.sqlite3`. Otherwise, click **Open database** to select an existing SQLite file. **The database is not included in Git or any installer.** The app never writes to the archive and does not create an empty replacement if a file is missing.

## Browse and study

- Browse all entries or narrow to **games**, **setup positions**, **lines**, **text**, **training records**, or **original source records**.
- Filter by **book**, player (White/Black), event, annotator, year range, ECO prefix, result, training flag, and source-deletion flag.
- Search titles, source keys, players, events and metadata; inspect paginated results and choose an ordering.
- Examine boards with move controls, comments and variations from the **Lichess PGN Viewer**, including FEN setups; switch to the authoritative **original PGN** or the record's raw headers and metadata.
- Inspect original source-record extraction status, source keys, JSON metadata, and a limited UTF-8 preview of raw move bytes when those bytes are text.
- All compression happens on the local machine with `fzstd`; **SHA-256 is verified before PGNs are displayed**.

The app uses a narrow, context-isolated Electron preload and parameterized, bounded SQL. The renderer does not receive arbitrary SQL execution, database handles, or access to Node.js. Large and invalid PGNs display an error instead of bypassing integrity checks. Deleted-in-source entries are excluded by default, but can be viewed with the filter.

### Schema version

The desktop app requires **schema v3** and deliberately does not auto-migrate a user's archive. To create a new empty archive or upgrade an existing version-1/2 archive, **make a backup** and run:

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
| `src/App.tsx` | React library browser, filters, metadata and source records |
| `src/PgnBoard.tsx` | Lichess viewer integration |
| `db/migrations/` | Versioned schema migrations |
| `scripts/init-db.py` | Transactional initializer / upgrader |

The source code is licensed under **GPL-3.0-or-later**, in keeping with the Lichess PGN Viewer license. No custom chess engine or full-board-position index is included: opening explorer and position searches would require derived indexes beyond the existing SQL schema.
