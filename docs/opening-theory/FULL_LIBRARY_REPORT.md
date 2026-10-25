# OT-07 full-library publication · 2026-10-25

The complete local archival snapshot passed conversion and publication checks.
No archival bytes, source-v1 schema, Games archive or Games migration was changed.
The runtime file, reports and all source payloads remain ignored under `data/`;
none is committed or bundled in an installer.

Local ready artifact: `data/opening-study/opening-library.sqlite3`.
Companions: `opening-library.sqlite3.report.json` and
`opening-library.sqlite3.sha256` in the same directory.

| Result | Count |
| --- | ---: |
| Source items processed/accounted | 82,888 / 82,888 |
| Searchable game occurrences | 81,321 |
| Quarantined game trees | 81 |
| Source-deleted games excluded | 2 |
| Accepted legal moves | 11,924,612 |
| Indexed nodes including synthetic roots | 12,005,933 |
| Source lines | 831,393 |
| Distinct shared prefixes including roots | 4,973,558 |
| Exact positions | 4,609,986 |
| Source decoded annotations accounted | 1,860,129 |
| Annotation rows in accepted documents | 1,852,905 |
| Retained annotations marked unsupported | 20,926 |
| Documents with partial annotation coverage | 11,549 |
| Articles / meaningful language versions | 1,484 / 2,958 |
| Distinct explicit article/document relations | 6,006 |
| Distinct same-source article/document relations | 42,623 |

The 12,500 source explicit relation rows contain repeated multilingual evidence;
display membership is consolidated while evidence rows are retained. Excluded
games do not become playable examples. There is no expansion through provisional
header identities or deduplication of game editions.

Of 81 quarantined trees, 74 contain null moves, five contain illegal moves
(including three castling cases), and two failed source move decoding. They are
whole-document exclusions, not pruned playable trees. The main annotation-error
record retains its validated moves with partial annotation coverage. Unsupported
evaluations, quotations, clocks, medals and other payloads remain explicitly
unsupported. Unsupported drawing colors also retain their decoded payloads.
Missing source media stays unavailable. This is a validated searchable subset
of the extracted source, not complete/current opening theory.

SQLite integrity is `ok`; FK violations are zero. The publication gate re-read
source item identities, reconciled source and retained annotation counts, replayed
every accepted source tree and generated viewer tree, compared stored ordered
nodes/exact positions/annotations, checked prefix/leaf invariants and article
body hashes/safe controlled blocks, ran ANALYZE and closed/checkpointed WAL.
There were no unfinished record checkpoints. A new final name was created
without replacing an existing artifact. Synthetic tests also verify recovery,
tamper rejection and that an interrupted later build leaves a prior generation
usable independently of the source.

Closed artifact size: **7,404,560,384 bytes**. Final validation took 409.878
seconds on the Windows/Ryzen 5600X/32 GB/Samsung SSD 980 machine documented in
[FEASIBILITY.md](FEASIBILITY.md). This is build validation time, not query/UI
latency evidence; those remain OT-13.

Source SHA-256 (unchanged before/after):
`9860ea58102bb69f6beea655943358d042f3f1f2221d9814eb5aceaa4e7e04fd`.
Artifact SHA-256:
`ed27366391bca685a47fdf12187b0b97962c4ffee0f86b44e48cbb74dd87fbbc`.
Runtime schema fingerprint:
`737dcd059de5d80db2646000f6b1192a76f12314117077f58fbfdadee5b2b65c`.
Source schema fingerprint:
`1f5876b2d4ce1040976e0ae22f8d86861ac182c49e16bde6f5bbd5f435d30ace`.

Builder/parser/annotation versions are v2, sanitizer is `opening-blocks-v1`,
and position identity remains `polyglot-standard-v1`. Earlier staging was
preserved rather than reused after language normalization/root-hash changes.
The published library UUID is `3e447545-f184-4066-a688-d418ba3492c4`, revision
`41ead7eb4579750679f4e46cf409f6fc588cab62bbab524a0645f18b3ef86b02`.

Verification: 21 opening-focused Node tests, 10 native SQLite checks and two
Python inventory tests pass. Broader existing Windows regression failures are
recorded in [REGRESSION_NOTES.md](REGRESSION_NOTES.md); this is not a desktop or
packaged release verification claim.
