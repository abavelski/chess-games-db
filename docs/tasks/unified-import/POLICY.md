# Import policy unified-import-1

Inventory is a read-only SQLite transaction, accepts multiple explicit archives,
and reports base version separately from favourites, personal analysis, openings,
and position scope/algorithm/coverage. Versions 3–6 require explicit new-output
migration, with manual review of personal extensions before conversion. Unknown
versions are refused. Unknown schema objects are listed, never removed.

Retain scored games, including genuine FEN starts, unknown players, unfinished
scores, training flags and null moves. Parser failures retain exact source PGN
and receive error feature coverage; they cannot produce encounter fingerprints.
Guiding text and empty standalone exercises are reported separately. Source deletion
is provenance, not a command to hide a game with live references. Import filters
never delete existing rows. Completeness is unknown unless supported by evidence.
The historical converter's games-only classification remains an explicit legacy
policy and is not reused to classify new imports.

UTF-8 PGN blocks retain their original bytes, including BOM, CRLF and separators.
Explicit legacy decoding records the chosen charset; hashes refer to decoded UTF-8.
ChessBase language priority selects the first requested language present anywhere
in a game, without filling comments from lower priorities. The profile includes
policy, converter version, charset and language order; filter limits do not define
an edition. A profile change requires explicit source-update acknowledgement.

A revision hashes all relevant source files, recording individual sizes and hashes.
Paths and titles are locators, not identities. Durable source/local keys and previous
record hashes detect ordinal drift and renumbering. Changed PGN ordering, ambiguous
repeated blocks, replacement editions, or unrecognized existing revisions require
explicit reconciliation; never infer continuity from ordinals alone. Unchanged
prefix extension is safe only where no repeated block creates ambiguity. A renamed
source retains its registry key through an explicit mapping or unique unchanged
revision evidence. Different annotations remain separate editions.

Count limits denote intentional subsets; full scans denote completed enumeration.
Every exclusion/failure has a reason. Producer failure or missing terminal summary
is incomplete even if records were emitted. Changes to any input sidecar during
extraction fail the source. Recovery and CBV unpacking occur only in scratch space.

UI-01 validation: isolated v3–v6 and v7 capability fixtures reconcile without byte
changes. Read-only inventory of the supplied `megabase-games`, `megabase-all-ru-en`
and `megabase-smoke` archives is retained locally in
`.local-import-reports/ui-01-inventory.json`; no supplied archive was modified.

Record reconciliation JSON uses incoming local keys mapped to
`{"key":"existing-local-key","expectedSha256":"existing-pgn-sha256"}`.
Changed records without evidence require this explicit review; checksums prevent
reusing a stale reconciliation. A new source can use an explicit source key,
including a legacy standalone key. Registry proposals are separate from loading;
publication will be coordinated with durable run records in UI-08.
