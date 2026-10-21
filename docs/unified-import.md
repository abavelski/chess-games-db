# Unified local game import

Run `npm install` with Node 22+ first. The CLI uses Electron's SQLite ABI via
`npm run import:games`. PGN input needs no Java, Python, Maven, Cargo or network.
CBH/legacy CBV preparation is explicit; see [extraction tools](../tools/extraction/README.md).
No sibling checkout is needed. Imports never fetch dependencies or opening data.

```sh
npm run import:games -- inspect --books-root '/path/to/books' --manifest '/path/to/import-manifest.json'
npm run import:games -- inspect --archive '/path/to/archive.sqlite3'
npm run import:games -- create --input '/path/to/games.pgn' --source-key pgn:my-collection --unenriched --output '/path/to/new.sqlite3'
npm run import:games -- create --books-root '/path/to/books' --book 'Фишер' --manifest '/path/to/import-manifest.json' --unenriched --output '/path/to/fischer.sqlite3'
npm run import:games -- create --books-root '/path/to/books' --manifest '/path/to/import-manifest.json' --unenriched --output '/path/to/books.sqlite3'
npm run import:games -- create --input '/path/to/Mega Database 2026.cbh' --source-key chessbase:mega-database-2026 --count 100000 --min-annotations 20 --min-year 1950 --languages ru,en --unenriched --output '/path/to/mega.sqlite3'
npm run import:games -- update --input '/path/to/games.pgn' --source-key pgn:my-collection --target '/path/to/archive.sqlite3' --unenriched --dry-run
npm run import:games -- update --input '/path/to/games.pgn' --source-key pgn:my-collection --target '/path/to/archive.sqlite3' --unenriched --report '/path/to/new-report.json'
```

Paths resolve from your invocation directory. Quote Unicode paths and spaces.
Windows: the same npm commands work in PowerShell; use `python` for Python tools.
No shell expansion or hard-coded classpath separator is used by the importer.
`--help` lists options and defaults. The default scan is full, with no minimum year
or annotation count. `--count N` means an intentional subset; it never deletes
records outside the subset. `--full-scan` makes the full-scan choice explicit.

Use `--openings /path/to/catalogue` to enrich from checksummed files at revision
`a6189a30dc273ccb21fc2536a9a2fefd5592a67a`. The default checks `data/openings-a6189a3`;
if absent, explicitly pass `--unenriched` or prepare the catalogue separately with
`npm run openings -- download --commit a6189a30dc273ccb21fc2536a9a2fefd5592a67a --out /new/catalogue`.
An incompatible active catalogue requires the separate explicit openings workflow.
Unchanged classifications keep their revision and rows. `--positions mainline` or
`--positions all` installs/builds the optional index; `--positions resume` retains
all-variation scope when installed. Without it, changed games stay invalidated,
coverage is reported, and stale occurrences cannot be returned by search.

UTF-8 PGN blocks preserve BOM, CRLF, Unicode, comments, variations and separators.
Legacy PGN decoding requires `--charset NAME` (WHATWG TextDecoder charset name).
ChessBase defaults to windows-1251, preserves supported full-fidelity annotations,
FEN-start scores, null moves, training and source-deletion provenance. Guiding texts
and empty standalone exercises are excluded with reasons. Failed binary decoding
aborts the source rather than accepting Morphy's partial fallback. PGN parser
failures are retained with error features and cannot become encounter candidates.
Headerless PGN input represents one game; multiple games should use tag sections.
Each decoded PGN is limited to 16 MiB; extraction and planning use disk staging.

`--languages ru,en` selects the first requested language present anywhere in each
ChessBase game, without filling missing comments from another language. `all`
preserves all languages. PGN text is not transformed by language selection.
Profiles include charset/language order/converter/policy versions. Changing one
requires `--accept-source-update`; changed record bytes still need reconciliation.
Use a different source key for a different edition.

The source key identifies an edition; a path/title is a locator. Keep your catalogue
with your backups. Existing v1 catalogue keys and standalone keys are preserved.
Inspection never registers entries. New entries are proposed, recorded with source
commits in `import_runs.registry_json`, then published atomically. Unchanged revision
evidence recognizes a unique rename. Explicit source mappings handle renamed editions
whose content also changed. CBV beside a CBH in the same directory is reported as an
uncertain alternative and skipped to avoid double import; inspect it and import it
individually with its own source key if it is a distinct edition.

Reordered PGN blocks, CB record renumbering and changed record bytes are conservative
conflicts. The per-record JSONL report identifies incoming keys, checksums, existing
IDs, conflicts and up to 100 candidates per category. This is a candidate sample,
not an automatic merge. Different annotations/sources remain separate. Malformed
scores never get guessed fingerprints. Duplicate identical occurrences remain
separate rows; after a revision change, repeated blocks require reconciliation.

A reviewed reconciliation file can use this shape:

```json
{
  "sources": {"Renamed Book/games.pgn": {"sourceKey": "old:standalone"}},
  "records": {
    "pgn:my-collection": {
      "ordinal:000002": {"key": "ordinal:000001", "expectedSha256": "OLD_STORED_SHA256"}
    }
  },
  "aliases": {
    "confirmed:same-edition": {
      "ordinal:000001": {"gameKey": "EXISTING_GAME_KEY", "expectedSha256": "OLD_STORED_SHA256"}
    }
  }
}
```

Pass it with `--reconcile /path/to/reconciliation.json`. Checksums prevent stale
mappings. Aliases require identical bytes and a reviewed same-edition decision;
they add a source link while keeping the existing game identity. Combining two
already-existing studied games is unsupported. PGN replacement validates saved UCI
histories, root position and comment anchors. Incompatible notes leave the entire
source unchanged; edit/reconcile the study content explicitly before retrying.
Imported JSON cannot assign target IDs or supply favourites/personal fields.

Close the desktop and all other tools that write the archive before update. Current
desktop builds hold a lease while open; importer maintenance refuses live leases,
and desktop opening is refused during maintenance. SQLite source transactions
recheck planned game/link/personal values and never replace the target file. An
external SQLite client that ignores the lease cannot cause existing notes to be
overwritten by a stale plan: changed records conflict under the write transaction.
Unknown tables/indexes remain intact; unknown/modified triggers or unknown columns
on known tables are refused for review.

Before the first target write, update creates `TARGET.backup-RUNID.sqlite3` using
SQLite online backup, including committed WAL rows. It checks integrity and foreign
keys and records a SHA-256. Source changes apply atomically; a source failure rolls
back that source. Earlier committed sources can remain, so inspect the report's
`completed`, `partial`, `failed` or `conflicts` status. Failures/conflicts exit nonzero.
Create publishes exclusively only after all sources and archive verification succeed.
Existing files, symlinks, hardlink update targets and output sidecars are refused.

To restore: close the app and all database tools. Retain the failed target and its
`-wal`, `-shm`, `-journal` files together in a separate recovery directory. Copy the
verified backup to the target path, with none of the old sidecars beside it. Verify
with `npm run import:games -- inspect --archive /path/to/restored.sqlite3`, then reopen
the app. Preserve or restore the manifest from the same run; durable proposed registry
JSON is also stored inside the backup/target's `import_runs` table when present.
Never copy a backup over an open database or combine it with another file's WAL.

Every run writes a new JSON report and a `.records.jsonl` detail file. Dry-run stages
and simulates changes in scratch but leaves the target and manifest unchanged; its
reports are new files. Apply always plans again; it never executes an old dry-run
plan. Retry the same command, or use `--resume RUNID` to recognize already committed
sources with identical revision/profile. Resume loads the durable registry proposal,
so it also recovers a crash between source commit and catalogue publication. No-op
reruns preserve game timestamps/features/position rows. Candidate fingerprints are
checksummed/versioned and indexed; existing targets need one initial backfill.

Cancellation terminates extraction/apply children; uncommitted SQLite transactions
roll back. Scratch is removed on normal exit and recognized abandoned scratch from
dead local processes is cleaned on the next run. Dead desktop/maintenance leases are
reclaimed. A crash in the short access-gate acquisition window may leave an
`ARCHIVE.access-gate` directory: verify that no importer/desktop process remains
before removing that directory and retrying. Do not remove live leases.

Legacy v3–v6 update is refused. Inventory personal extensions first, then use explicit
`npm run migrate:games -- --input OLD --output NEW`. The existing converter is not a
general personal-data transfer tool; do not assume it preserves custom study tables.
The old integration commands remain available while parity is being validated.
