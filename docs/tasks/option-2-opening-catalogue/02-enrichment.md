# O2-02 — Catalogue download and repeatable game classification

Status: implemented and verified (offline fixtures, resume/invalidation, real 3,865-entry catalogue download, unit/archive suites, build and desktop smoke).

Depends on: O2-01 storage contract. Read [shared rules](../README.md).

Deliver:

- Add explicit CLI commands to download all five Lichess TSVs at a pinned commit and enrich a selected archive. Support local input for offline runs, dry-run, progress/report output, restart, and an explicit rebuild. Document runtime/dependency setup; reuse `chessops`/`fzstd` where practical and account for Electron's SQLite ABI if using Node tooling.
- Validate columns, ECO, names, and legal canonical moves. Derive UCI and position keys: piece placement, side to move, castling rights, and legally relevant en-passant square; exclude move counters. Retain upstream source provenance and CC0 attribution.
- Build display taxonomy from the catalogue's `Family: Variation, Subvariation` convention. Preserve full original names; trim labels, scope child IDs by full parent path, and permit versioned overrides for ambiguous punctuation. This is a browsing taxonomy, not a claim that names encode a complete move tree.
- Verify archived PGN checksums and replay each game's mainline. Record all exact named-position matches, including transpositions; classify by the match at greatest ply. Resolve same-ply ambiguity deterministically (prefer matching canonical move sequence, then deeper taxonomy, then stable entry ID). Preserve alternative matches.
- Process all legal mainline moves without an arbitrary opening-depth cutoff. Illegal/truncated or corrupt games receive diagnostics and no authoritative primary classification. Never classify from commentary variations. Deletion status does not change source records.
- Use bounded batches and resumable staging. Skip unchanged inputs; rebuild on changed PGN/catalogue/algorithm. Publish only when the run completes; partial/failed runs leave the previous revision usable. Report coverage and differences from source ECO without rewriting it.

Acceptance/tests:

- Small pinned TSV/PGN fixtures cover family/line/subline paths, missing names, duplicate positions, transpositions, same-ply ties, illegal PGN, corruption, and unmatched games.
- Test interrupted/resumed runs, dataset updates, changed game hashes, dry-run, and repeat runs without duplicate rows. Verify original archive data is unchanged.
- Produce an enriched fixture and an enrichment report without network access. This task needs no UI or Explorer integration.
