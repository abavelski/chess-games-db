# PS-09 — Index the original PGN's annotated variations

Status: **planned**. Depends on: PS-03, PS-04. Technical follow-up.

## Deliver

- Extend PGN traversal beyond mainline to nested source-authored variations. Replay each branch from its correct parent position; encode the **same viewer path** that `GameReview` and `PgnBoard` resolve; set `is_mainline=0` for sideline nodes.
- Index all valid author branches and the mainline without merging them; no arbitrary depth cutoff, but use bounded work and explicit diagnostics/resource limits for pathological PGN. **Do not index separately saved personal analysis** in this phase (its editable lifecycle differs).
- Evolve per-game status/indexer scope and algorithm version so a prior mainline-only index never masquerades as complete all-variations coverage. Support explicit incremental rebuild. Preserve a usable mainline index when a non-mainline variation is invalid, with clear per-scope completeness (or conservatively declare variation coverage incomplete).
- Keep exact position/pawn keys and collision checks; variant positions only become candidate matches when that search scope is explicitly requested.

## Acceptance / tests

- Multi-level variations, sibling branches, branch at move 1, alternative promotion/castling, same position in mainline and sideline, and custom FEN starts yield correct viewable paths.
- A pawn structure in a sideline gets indexed; the same path opens the exact branch in the viewer.
- Truncated/illegal variation is diagnosed and does not become a false complete variation result; mainline remains searchable.
- Rerun/idempotency and PGN-change invalidation tests; preserve author PGN and separately saved personal work; `npm test`, `npm run build`.
