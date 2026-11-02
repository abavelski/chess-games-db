# OT-08 opening query contract

`OpeningQueryService` owns a ready library through a read-only, query-only
connection. Desktop access is through `OpeningWorkerClient` and the fixed
`opening-study:*` IPC allowlist. The shell connects the picker in OT-09; no
renderer receives SQLite, arbitrary SQL, or a path-opening method.

Operations: catalog, explore, bounded material page (games/articles/comments),
article title catalog, article detail, and source study detail. Requests carry
the library revision. Exploration requests carry mode (`prefix` or `position`),
the unchanged root/anchor FEN, chosen UCI sequence, filters and request revision.
Both standard castling UCI forms normalize to the stored king-to-rook move.

Filters: source roles, stable article keys, metadata substring, and annotation
languages. Different dimensions combine with AND; values inside one dimension
combine with OR. An unknown selected article key yields zero matches, not an
unfiltered query. Comment-language filters select documents with actual text
comments, not merely untagged NAGs/drawings. Reading language affects presentation
only. Source labels and original language IDs remain in material provenance.

Prefix search resolves the whole normalized root and move trie. Position mode
seeds exact `(signed BigInt hash, four-field key)` matches once, then advances
only actual source children for the suffix. It does not reseed by the new board
position. Counts union descendant leaf intervals separately per document;
terminal intervals have their own union. Duplicate branches keep separate leaves,
while repeated occurrences of one anchor cannot count a leaf twice. Article and
game counts use distinct identities. Every response carries library coverage.

The service reads immediate children and indexed nodes; it never parses full
source PGN for a board move. Source detail independently replays the selected
ordinal route and checks its exact position before jumping. Mismatched stored
hash/path/position references open the verified root with a notice. Alternative
matches retain their ordinal paths. Article hints remain unvalidated root
navigation, with ambiguous/unavailable targets kept explicit.

Limits: 32 KiB IPC requests, 2,048 moves, 250,000 source cursors per stage,
50 material cards per page, 20 article examples per page, 8 MiB article and
16 MiB study detail. Limit failures are explicit; source sets are never silently
truncated to fabricate totals. Comment cards have marked previews; full retained
text remains in source detail. Cache scope includes library UUID/revision,
root/anchor, whole sequence and filters. At most eight contexts and 500,000
cached node/child cursors are retained; expired cursors require re-exploration.

Read transactions keep each response consistent. File identity changes reject
further requests until reload. Worker exploration coalescing keeps one running
and one latest pending request; superseded requests are cancelled. Other pending
operations are bounded. Renderer request sequencing is still required at OT-10
to ignore a completed old request. Worker handles terminate on close/switch.

## Verification

```powershell
node scripts/run-archive-tool.mjs --test tests/opening-query.check.mjs
```

Eight native checks pass, including an independent explicit-leaf oracle, full
prefix/terminal/duplicate behavior, transposition discovery, repeated anchors,
custom setup roots, castling differences, irrelevant and pinned en-passant,
simulated hash collisions, filters, pages, language fallback, exact branch
review, cursor expiry, bounded invalid requests and worker cancellation.

The full local ready library was also queried. Uncached root: 81,301 games,
831,305 lines, 1,484 articles; the other 20 accepted documents have setup roots.
Following `e4` gives 50,327 / 388,201 / 766; `e4 c5` gives
10,662 / 132,306 / 274; `e4 c5 Nf3` gives 8,316 / 112,842 / 256.
Counts narrow as required. One-run uncached timings were approximately
1,157 / 681 / 173 / 71 ms respectively; immediate cached requests were below
0.6 ms. These are feasibility observations, not p50/p95 or a responsiveness
release pass. Full timing distributions and UI behavior remain OT-13.
