# Opening runtime builder

## Staging inventory (OT-04)

```powershell
node scripts/run-archive-tool.mjs scripts/build-opening-library.mjs --source data/tmp/opening-theory.sqlite --staging data/opening-study/library.staging.sqlite3 --output data/opening-study/opening-library.sqlite3 --corpus opening-encyclopaedia-2024
```

Use `--resume` with the same arguments after interruption. The source must be a
closed source-v1 snapshot. Staging and output paths must differ from it and
from each other, and the final output must not exist. Hard links and filesystem
path aliases are rejected. The explicit corpus namespace plus normalized
relative source path/native record ID defines stable external keys; preserve
that namespace across builds. Full source SHA-256 and converter versions bind
checkpoints. Changed inputs require a new generation.

The default phase inventories only. Tree conversion is available with
`--phase trees`; article conversion is `--phase articles` after all games have
final dispositions. Ready publication remains a later task. The manifest remains `building`, the final path is
absent, and the runtime loader refuses the staging artifact. This distinction
must remain visible until the OT-07 publication gate is implemented.

The 2026-10-25 local execution inventoried all 82,888 source items, hash
`9860ea58102bb69f6beea655943358d042f3f1f2221d9814eb5aceaa4e7e04fd`;
the source hash matched after execution. Local staging:
`data/opening-study/library.staging.sqlite3`. No ready output exists yet.

Schema: `db/opening-library-v1.sql`. Source-v1 DDL and Games migrations are
unchanged. Runtime application ID is 1330924610, format
`opening-study-library`, independent schema v1. Ready manifests require complete
coverage and no unfinished record checkpoints. Browsing never builds or migrates.

Document processing uses `checkpointItem`: one transaction contains derived
publication, disposition, counts and checkpoint. An exception rolls all of
them back; a completed unit is skipped on resume. Cleanup removes unreferenced
derived positions/prefixes before later finalization. WAL/FULL is used only
for offline staging; each command checkpoints and closes its own connection.

Verification:

```powershell
node scripts/run-archive-tool.mjs --test tests/opening-library-staging.check.mjs
```

Tests cover resume mismatch, simulated mid-document failure/rollback/retry,
stable identities across independent builds, unfinished/invalid manifests,
wrong formats, aliases, existing output, cleanup, integrity/FKs and unchanged
source fingerprints.

## Complete source trees and typed annotations (OT-05)

Add `--resume --phase trees` to process pending games in source-ID order. Optional
`--limit 100` processes at most 100 additional game records and closes staging
cleanly. A subsequent resume continues pending items, never reinterpreting a
completed source node map. The local staging currently contains the first 100
completed game records; remaining games and all articles are pending. No ready
output has been published.

Each accepted nonempty tree has a legal root, complete ordered source-node map,
prefix memberships, exact positions and descendant leaf intervals. Generated
PGN is independently parsed/replayed by ordinal branch and exact position before
publication. Root, before/after comments, language and source sequence are typed
data; marker PGN verifies payload round trips, while visible presentation remains
OT-12. Move failures exclude entire trees and retain bounded identifying metadata
and annotation disposition in quality issues. Empty/deleted records have explicit
dispositions. Source FEN/castling rights and null branches are never repaired.

Supported annotations: text, NAGs, arrows/squares with verified red/green/yellow/
blue colors. Every unknown type, unsupported color, evaluation array or unverified
scalar score retains its original decoded payload/hash and an unsupported issue.
Unmappable annotation locations retain null node references with an explicit
partial disposition. Source annotation decoder errors always imply partial
annotation coverage, even when the complete move tree is valid.

```powershell
node --test tests/opening-source-tree.test.mjs
node scripts/run-archive-tool.mjs --test tests/opening-tree-converter.check.mjs tests/opening-library-staging.check.mjs
```

Six native checks pass, including a deliberately aborted annotation insert that
rolls back the entire document, shared positions/prefixes and checkpoint. The
explicit leaf oracle covers ordinal provenance for duplicate same-move siblings;
cross-document parents are rejected by composite foreign keys. Sixteen strict
reader tests and the separate Python inventory tests also pass. Full-corpus
annotation reconciliation and publication remain OT-07.

## Safe articles and relationships (OT-06)

The offline converter uses Python's standard-library HTML parser, launched
without a shell or visible window. Set `PYTHON` to an explicit executable if
needed; default is `python` on Windows, `python3` elsewhere. Desktop reading
requires no Python or source archive: only inert JSON blocks are retained.
Recognized navbar/SideBar/navigation is removed in the derivative. Source
attributes, scripts, handlers, styles, frames and resource URLs never become
rendering props. Malformed navigation gets a safe whole-body fallback plus a
quality notice. FEN diagrams are validated with the strict standard-chess
contract; invalid diagrams and missing media become readable unavailable blocks.

Links use original parser line/column locators and stored resolution evidence,
never visible labels or executable CBLink strings. Numeric position hints remain
unvalidated; the controlled target opens the exact referenced document root with
a notice. Ambiguous targets retain candidate stable keys. Repeated explicit
evidence is consolidated separately from same-source membership; unvalidated
header identities never expand article membership. Title catalog entries exist
even without playable examples. Language availability requires explanatory prose,
not merely source navigation; source language IDs remain alongside display codes.

```powershell
node --test tests/opening-reading-blocks.test.mjs
node scripts/run-archive-tool.mjs --test tests/opening-articles.check.mjs
```

Four security/body tests and the native relationship test pass. Real English
samples from source article rows 40615 (2001), 43512 (2000), and 43062 (2023)
retain respectively 2,923 / 1,955 / 4,310 visible characters, 14 / 3 / 13
controlled links and 7 / 1 / 10 validated local diagrams. Each removes both
recognized navigation regions. Missing legacy key bitmaps remain unavailable;
no source media URL is emitted. No malformed/fallback notice was needed for
these samples. Full conversion/reconciliation remains OT-07.
