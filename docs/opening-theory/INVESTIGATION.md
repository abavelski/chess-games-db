# Temporary database investigation

All of this lives in Git-ignored `data/tmp/`. Nothing is committed or added to
the app's extraction build. Keep the scripts here for later experiments.

## Raw SQLite library: games and Theory only

```powershell
python data/tmp/extract-book-sqlite.py
python data/tmp/extract-book-sqlite.py --resume
```

The output is `data/tmp/opening-theory.sqlite`. This separate extractor preserves
unclean native information for main-collection games and Theory games/articles,
including every language, raw record payloads and article/game link evidence.
It does not import AllInOne, Surveys, OpeningTutorials, Autoren, main-book texts
or multimedia. It deliberately does not use the cleaned En Croissant PGN and
runs no independent validation. See [BOOK_SQLITE_DESIGN.md](BOOK_SQLITE_DESIGN.md)
for the schema, relationship semantics, provenance, query examples and app notes.

## One PGN for En Croissant

```powershell
python data/tmp/export-opening-pgn.py
python data/tmp/export-opening-pgn.py --force
python data/tmp/export-opening-pgn.py "data/tmp/ddd/OpeningEncyclopaedia" --output "data/tmp/exports/openings.pgn"
```

The default input is `data/tmp/ddd/OpeningEncyclopaedia` (the existing folder's
actual spelling). Every `.2cbh` directly inside that folder contributes its Game
records to one UTF-8 file, `Opening Encyclopaedia.en-croissant.pgn`, beside the
database. Guiding Text and Analysis records are excluded and counted in the
report. Games are not filtered by date, length, annotation count or deleted flag.
The script also writes `.export.json` with counts, source IDs, per-game move-tree
and comment hashes, language/cleanup statistics, and any source interpretations;
`.export.log` retains reader diagnostics. `--limit N` can produce a smaller test
export to an explicitly chosen `--output` file. Existing final output/report
requires `--force` to replace it.

All legal main lines and sidelines are retained, including NAGs and graphical comments.
For each position, before and after comments are handled separately: use English
if present, otherwise untagged text, otherwise the first available language.
Every annotation in that chosen language is kept. Morphy's simplified converter
writes ordinary comments without `[%pre]`/`[%post_LANG]` wrappers. Literal nested
comment braces and invalid control characters are removed; whitespace is
normalized. Parentheses delimiting variations and legitimate punctuation inside
comments remain. Known engine-evaluation arrays are mapped to per-position PGN
evaluation comments instead of being silently discarded by Morphy.

`sanitize-opening-pgn.mjs` checks every continuation using chessops. As explicitly
requested, unplayable source continuations (including analysis null moves `--`)
are preserved with all their comments as readable PGN comment text. Legal sibling
variations remain playable. The report's `invalidContinuationsAsComments` records
each affected game, its original PGN, the continuation text and the reason. Every
original comment must still occur in the rewritten comments. This avoids silently
dropping source-invalid notation while producing legal games for import.

Before publishing the final file, python-chess independently parses every game,
checks for illegal moves, compares the complete ordered playable variation tree
against the export manifest, and compares all emitted comment text. For affected
games the manifest also retains the original source tree hashes and move counts.
No successful final file is published if any game fails. A candidate
that fails validation is retained as `.unvalidated.pgn`/`.unvalidated.json` for
investigation; decoding failures are recorded in `.failed-export.json`.

Additional source issues handled during the full export:

- Record 11022 contains one unsupported `0x20` annotation whose exact payload
  matches a text record, followed by normal annotations. An in-memory interpretation
  as text-after is allowed only for the inspected whole-annotation SHA-256
  `d4bc322549ef4da18183d4e2c354009e25c8082dfd861e50d22ee62866ad145f`.
  All remaining annotation boundaries must decode correctly; original bytes,
  text and the interpretation are retained in the export report. This is a
  narrowly scoped interpretation, not general support for type `0x20` (which
  Morphy documents as an unknown video format).
- Some setup positions omit a castling right explicitly used by a source sideline.
  The exported FEN adds only rights exercised in the tree, and only when the
  relevant king and rook occupy their original squares in the setup. Every move
  is then checked independently for legality. Original/exported FENs are recorded.

These adjustments affect only the export, never the source database. Some embedded
game-quotation annotations generate warnings from Morphy; they are distinct from
the actual main/variation tree, whose complete move structure is verified.

## Batch folder investigation (CBH and 2CBH)

```powershell
python data/tmp/batch-db-reports.py
python data/tmp/batch-db-reports.py --games 5 --texts 3 --seed 123 --force
python data/tmp/batch-db-reports.py "C:/path/to/books" --language ENGLISH
```

The default root is `data/tmp/ddd`. The script recursively discovers `.cbh` and
`.2cbh` header files; each is treated as a separate database even when several
share a folder. It writes files directly beside each database:

- `<database filename>.investigation.json`: counts, flags, source inventory,
  random seed and selected record IDs, sample file paths, and any failures/diagnostics.
- `<database filename>.investigation.txt`: readable report with counts and sample paths.
- `<database filename>.game-ID.pgn` plus `.json` for each sampled game.
- `<database filename>.text-ID.txt` plus `.json` for each sampled text.

Including `.cbh` or `.2cbh` in output names also distinguishes databases that have
the same stem but different formats. By default, it samples up to 3 games and
2 texts per database, using active records only, uniformly without replacement
within each kind. Analyses are counted separately for CB2. If a kind has fewer
records, it samples all available ones; empty databases still get reports.
CB2 classification calls the actual Morphy `Game.isGame()`, `Game.isAnalysis()`
and `Game.isText()` methods and checks that exactly one is true per record.
Only source headers are copied into a temporary in-memory Morphy database for
this scan; this avoids reading incompatible sort indexes. Source files remain
read-only. The console prints Game, Analysis and Guiding Text totals for each
database and aggregate totals, also stored in `batch-investigation.json`.
The default seed is 42, combined with the path relative to the root, so reruns
with the same inputs/options select the same records.

Existing database reports are skipped by default. Use `--force` to regenerate
them and replace files for the newly selected samples. Old samples from other
seeds aren't removed; each database report identifies the current selection.
The root `batch-investigation.json` summarizes the most recent run. Failures in
one database/sample are recorded and processing continues. Exit code 1 indicates
partial/failed investigations; successful exports with nonfatal warnings use
`ok-with-warnings`. Those warnings appear in the reports. Morphy may omit engine
evaluation arrays from PGN; they remain in JSON's structured annotations and raw
bytes. Missing optional CBH accelerator indexes do not prevent direct exports.

The batch script compiles `BatchInspect.java`, `LegacyExport.java` and the shared
`RecordExport.java` once per run. The existing local CBH build and its runtime
classpath are used alongside CB2. CBH recovery is performed only on disposable
copies outside the source folder, and every adjustment is reported. All source
databases are read without modification. The local Logback provider and
`investigation-logback.xml` capture Morphy warnings on stderr so silent annotation
decoding issues can be marked in the report.

If the CBH runtime classpath needs regenerating, use the same Maven command below
with `morphy-cbh/pom.xml` in place of `morphy-cb2/pom.xml`.

From the repository root:

```powershell
python data/tmp/db-stats.py
python data/tmp/db-stats.py --texts 30
python data/tmp/db-stats.py --texts 0 --record 1
python data/tmp/db-stats.py "data/tmp/Another book.2cbh"
python data/tmp/db-stats.py --extract-game 2
python data/tmp/db-stats.py --extract-text 1
python data/tmp/db-stats.py --extract-text 40616 --language ENGLISH --out-dir data/tmp/exports
```

Without an input path, exactly one `.2cbh` must exist beside the script. With
multiple books, pass a file or a directory containing exactly one `.2cbh`.
Explicit paths are relative to the working directory. Run with `--help` for options.

## Exporting individual records

`--extract-game ID` writes `<database>.game-ID.pgn` and an adjacent `.json`.
`--extract-text ID` writes `<database>.text-ID.txt` and an adjacent `.json`.
The default destination is `data/tmp/exports/`; change it with `--out-dir`.
Both extraction options may be used in the same invocation. Extraction skips the
stats scan. Existing outputs are refused unless `--force` is supplied. IDs are the
original 1-based database record IDs (record 1 is a text, record 2 a game here).

The PGN includes variations, comments in every language, NAGs and ChessBase's
extended annotation directives through Morphy's round-trip converter. It is
re-parsed before saving: move trees and all comment text/languages/positions must
match (comment whitespace is normalized for the comparison). Undecodable
annotations and invalid annotation positions abort the export instead of silently
omitting them. PGN has limited native annotation types; JSON keeps the structured
annotations and original bytes too. Comments containing literal braces use readable
full-width braces and a `[%cbtext BASE64]` directive preserving their exact text.

The text file contains readable text, removing HTML tags, CSS and scripts.
By default it includes all languages that render to nonempty text, labeled with
language names. `--language ENGLISH` selects one language for the text file.
The JSON always includes all original language bodies as HTML, all plain-text
versions, multilingual titles, original formatting and text-format fields.

Reports also contain every decoded core-header field (including unknown fields),
related player/author/tournament/source/team/title entities, their raw entity
records, raw header/move/annotation bytes as base64, flags, dates/timestamps,
move and annotation counts, structured annotations, export verification results,
source paths/sizes, Morphy revision and the exported file's SHA-256. Raw bytes
retain information Morphy cannot interpret. External media are not copied;
stored references remain in the report. Full database indexes aren't included.

`RecordExport.java` is the editable export implementation. Its `InspectionRecord`
helper adapts the entity/header/text mapping from the pinned experimental Morphy
`Game.java` to direct read-only files, avoiding the incompatible sort index.
The launcher compiles this helper into `.export-classes/` on each export.

Edit `DatabaseStats.java` to change the investigation. The Python launcher uses
Java source-file mode, so every run picks up edits without a separate compile.
`--record` prints the stored header and, for a text, the HTML length and a short
preview per language. Sample titles need the matching `.2lid`; text bodies need
the matching `.2cbg`. Close the database in ChessBase while investigating it.

The script counts physical header records by Morphy's game/text/analysis types,
with active and deleted counts separately. A text/article means a standalone
guiding-text record, not an in-game comment. Game records can include instructional
lines. Annotation figures count active game records with each header flag; they
overlap and aren't counts of individual comments or variations. Moves and
annotations aren't decoded or validated by the stats scan.

Verified on Opening Encyclopaedia 2024: 40,739 records = 40,614 game records +
125 texts/articles, 0 analyses, 0 deleted records. Header year range 1620-2023;
62 game records have no played year. Title samples and text record #1 decoding
also work.

## Local dependency preparation

The pinned Morphy used by `tools/extraction` predates `morphy-cb2`. This experiment
uses Morphy commit `c721bacb53dac9619f268346454d419667497f51` in `.morphy-cb2/`,
a separate worktree of `tools/extraction/.deps/morphy`. Its Maven repository is
`.m2/` here, so the newer snapshot jars don't replace the app's pinned snapshots.
The original checkout remains at the revision in `tools/extraction/pins.json`.

Java and Maven were absent from PATH. Portable Microsoft OpenJDK 21 and Maven
3.9.9 were downloaded into `.runtime/`; no system installation or persistent
environment changes were made. The launcher uses Java on PATH if available,
otherwise the portable copy. Current files are ready to run offline.

To rebuild Morphy and regenerate its classpath on this machine:

```powershell
$taskRoot = (Resolve-Path data/tmp).Path
$env:JAVA_HOME = (Get-ChildItem "$taskRoot/.runtime" -Directory -Filter 'jdk-*' | Select-Object -First 1).FullName
$env:PATH = "$env:JAVA_HOME/bin;$env:PATH"
$mvn = "$taskRoot/.runtime/apache-maven-3.9.9/bin/mvn.cmd"
& $mvn -q -f "$taskRoot/.morphy-cb2/pom.xml" "-Dmaven.repo.local=$taskRoot/.m2" -pl morphy-cb2 -am install '-Dmaven.test.skip=true'
& $mvn -q -f "$taskRoot/.morphy-cb2/morphy-cb2/pom.xml" "-Dmaven.repo.local=$taskRoot/.m2" dependency:build-classpath '-DincludeScope=runtime' '-Dmdep.outputFile=target/investigate-classpath.txt'
```

The full `Database2Cbh.open` fails on this book's `.2lcd` sort index with an
`IndexOutOfBoundsException` in `SortIndexFile`. We use Morphy's `GameHeaderFile`,
`EntityFile`, and `GuidingTextCodec` directly, opening only needed files with
`AccessMode.READ_ONLY`. No database repair, conversion, or source edits occur.
This book has header format version 3; Morphy's current writer uses version 5.
