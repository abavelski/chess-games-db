# Executable policy

`lib/game-policy.mjs` defines policy annotated-editions-1. Retain exactly legacy
`record_kind=game`, including training, deleted, unknown and unannotated games.
Excluded identities and reasons belong in a local report. Suspect excluded setup
scores are reported for later recovery, never silently reclassified. Completeness
requires an explicit `{value,evidence}` object; result and checkmate are not evidence.
Credits remain whole, including commas. Exact names remain separate identities.

Only `book:catalog:…:db-N` identities establish existing collection grouping
(`electron/books.mjs`); titles never establish identity. Preserve section IDs,
original file provenance, sequence and collection key. The extraction producer
is external to this repository. Future importers own format-specific interpretation
and must call the shared writer with stable source and record keys.

Inventory uses a read-only SQLite connection and reports its actual counts, name
cardinalities, derived coverage, malformed scores, corruption and exclusions.
No report containing real game identities belongs in version control.
