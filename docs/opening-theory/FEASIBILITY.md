# OT-03 traversal and scale review · 2026-10-25

## Reproduce

```powershell
node --test tests/opening-source-tree.test.mjs
python scripts/opening-study-slice.py --source data/tmp/opening-theory.sqlite --output data/opening-study/traversal-slice.json
node scripts/run-archive-tool.mjs scripts/prototype-opening-index.mjs data/opening-study/traversal-slice.json data/opening-study/prototype-indexed.sqlite3
```

Outputs must be new paths. All real payloads, SQLite files and detailed reports
stay under ignored `data/`. The prototype is deliberately **not** an opening
runtime library and has no ready manifest. Never load it in the desktop.

## Results

Source SHA-256:
`9860ea58102bb69f6beea655943358d042f3f1f2221d9814eb5aceaa4e7e04fd`.
The source hash agrees before/after slice export and with OT-02.

The deterministic sample is 942 occurrences: every 173rd archival row, plus
ECO coverage, each distinct root, largest trees, examples of every annotation
type, known decoder errors and representative warnings. This is a deliberately
stratified feasibility slice, not a statistically representative estimate.

| Measurement | Result |
| --- | ---: |
| Completely replayed documents | 935 |
| Quarantined trees | 7 |
| Accepted nodes including synthetic roots | 232,307 |
| Source lines | 18,918 |
| Shared prefixes including roots | 196,432 |
| Exact positions | 193,541 |
| Annotation rows retained with disposition | 46,939 |
| Build + generated PGN replay + final checks | 20.754 seconds |
| Throughput including those checks | 11,193 nodes/second |
| Process peak RSS | 265,297,920 bytes |
| Closed self-contained database | 162,942,976 bytes |
| SQLite integrity / FK violations | ok / zero |

Reference hardware: Windows 10.0.19045, AMD Ryzen 5 5600X (12 logical CPUs),
34,241,204,224 bytes RAM; workspace E: is Samsung SSD 980 1TB NVMe. Electron
Node 22.22.0, packaged better-sqlite3. One run, not latency distributions.
Journal mode WAL, synchronous FULL, one atomic transaction per document,
ANALYZE and WAL checkpoint before close. Memory includes the entire local
sample JSON; the production builder must stream bounded document batches.

Main storage components (bytes): nodes 49,414,144; source-path unique index
28,217,344; annotation payloads 26,361,856; positions 14,290,944 plus their
15,970,304-byte unique index; prefixes 4,079,616 plus child/root indexes
3,747,840. Remaining node indexes total about 19.2 MB. Per-table/index bytes
and per-record elapsed times are in the local report.

The slice shares about 15.4% of source prefixes. Approximately 701 bytes per
source node including payloads/indexes would arithmetically project to 8.39 GB
at the reported 11,959,899 moves. This is **not** a forecast: sample selection,
long textual paths, prefix sharing, article storage, payload encoding and
full-size B-trees change the result. Full-corpus size and latency remain OT-07
and OT-13 gates. There is about 957 GB free on E: at this review.

## Fidelity and exclusions

The parser consumes the complete annotation-free source DTO movetext. Illegal
or unknown tokens in any variation fail the entire document. Root metadata,
move numbering, reported mainline/all-tree counts, branch nesting and depth
limits are checked. It uses the exact source FEN without castling repairs.
Null moves are rejected; no cleaned/derived PGN is used as source.

Synthetic tests independently specify leaf paths and PGN-order annotation
indexes. Nested branch mapping, ordered before/after/root comments, duplicate
siblings, nondefault setup counters and generated legal PGN replay pass. The
Morphy source contract was inspected locally: `GameMovesModel.getAllNodesPgnOrder`
and `GameMovesDtoCodec.toDto` confirm the documented lexical traversal order.

Real exclusions: native main records 652, 1996, 5868 have illegal castling;
32497 and 32871 contain null-move branches; the two known Theory move-decode
failures are also excluded. The annotation-error main record 11022 has a
playable tree, but cannot claim complete annotations. Other documents are not
declared valid merely because extraction succeeded.

TextBefore/TextAfter, Symbols, supported Arrows and Squares retain source
attachment, sequence, language and payload. Two arrows have unsupported colors
and remain unsupported. Eval perspective and evaluation-array offsets are
unverified: preserve as unsupported, never fabricate a score. Quotations and
all other types remain decoded payloads with explicit unsupported disposition.
The prototype's PGN markers verify typed-payload round trips; they are **not**
the finished visible annotation rendering required by OT-05/OT-12.

## Review outcome and design amendments

Retain the proposed source tree + shared prefix trie + exact positions + leaf
interval schema. Index plans now use covering `prefix_children` for child
lookups and `prefix_roots` for roots. An earlier generic nullable `IS ?` query
could not use the partial child index and became progressively slower. Root
and nonroot SQL must remain separate and EXPLAIN plans must be checked.
Interrupted early experiments remain local `prototype-index.sqlite3` and
`prototype-wal.sqlite3`; neither was finalized or reported as a successful run.

**Viewer identity amendment:** 60 accepted sample documents contain 70 repeated
viewer move paths. Distinct ordinal source paths remain intact. Ordinary
move-encoded viewer paths therefore cannot uniquely address duplicate siblings.
OT-12 must use ordinal source navigation with a controlled board projection (or
an equivalently verified adapter). Selecting an alternative occurrence must
select its actual source branch/comments; choosing the first matching viewer
path is prohibited. This amends the reuse plan, not source identity or counts.

The implementation review supports proceeding to OT-04 with these constraints.
No full-corpus performance, visible annotation fidelity or player usability
approval is claimed. The player confirmed Sicilian as the study opening.

Verification: 16 new tree tests and two Python inventory tests pass. Broader
Node run: 108 tests, 107 passed; one existing opening-storage test invokes
unavailable `python3` on this Windows host (working command is `python`). Its
failure precedes archive tests and is an environment/test-launch issue; no
existing Games behavior has been changed in this milestone.
