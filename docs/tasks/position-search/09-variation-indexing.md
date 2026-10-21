# PS-09 — Index the original PGN's annotated variations

Status: **completed** (2026-10-21). Depends on: PS-03, PS-04. Technical follow-up.

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

## Implementation and verification

- `lib/position-mainline.mjs` adds `extractAllPositions` and `VARIATION_EXTRACTOR_VERSION`; strict mainline replay keeps its PS-03 contract. The new extractor walks every original source-authored branch and nested sibling from its correct parent position, storing the precise viewer path, absolute ply, `is_mainline` flag, and the same Polyglot full-position/pawn fingerprints. PGNs and personal work remain unchanged.
- Strict lexical SAN comparison checks **every** source variation token's order and nesting against the parsed PGN tree. Tolerantly dropped/unrecognized SAN, illegal moves or an unviewable path cannot produce a false all-lines complete result. Invalid sidelines yield `status='partial'`, a bounded diagnostic and only verified mainline occurrences; invalid mainlines return `invalid` with no occurrences. Nested depth above 2048, 100,000 moves, input above 16 MiB or paths exceeding the existing 4096-character storage cap are explicitly rejected; no ordinary chess move-depth cutoff is introduced.
- `lib/position-builder.mjs` and `scripts/positions.mjs` accept `--include-variations` on explicit `build`/`rebuild` (also `--dry-run`). Complete all-line records use the existing schema 009 `scope='all'` and a new `position-builder-v2:position-variations-v1` version. A failed variation publishes **mainline-only** records under the existing supported version and a diagnostic; variation coverage remains incomplete. Other valid all-scope records stay incremental/idempotent, and ordinary mainline builds do not downgrade them.
- `positionBuildStatus` reports `allComplete` and `variationIncomplete` independently of existing mainline coverage. The PS-05 search path recognizes the new all-scope version as a source of **mainline** results, still requiring `is_mainline=1`; old v1 indexes cannot masquerade as all-lines complete. The UI/API selection of variations belongs to **PS-10**. No migration, runtime archive indexing, or personal-analysis indexing is added.
- `tests/position-variations.test.mjs` cross-checks recorded paths/boards/plies with real PGN Viewer nodes for multi-level and sibling author branches, root alternatives, castling/promotion, SetUp/FEN, transposed/repeated positions, pawn structures, malformed variation, and resource limits. `tests/position-variations.check.mjs` exercises opt-in CLI, v1-to-all upgrade, scope fallback, unchanged mainline results, repeat/rebuild/dry-run, source PGN/personal comments/favourites preservation and changed-PGN invalidation.

### Explicit commands — work on an archive **copy**

```sh
npm run positions -- init --database data/games.positions.sqlite3
npm run positions -- build --database data/games.positions.sqlite3 --include-variations
npm run positions -- status --database data/games.positions.sqlite3
npm run positions -- rebuild --database data/games.positions.sqlite3 --include-variations --dry-run
npm run positions -- rebuild --database data/games.positions.sqlite3 --include-variations
```

Invalid author variations remain visible in the original PGN but are not indexed. Saved personal review lines/comments are deliberately excluded. Search mode stays mainline-only until PS-10.

**Automated verification:** [GitHub Actions run 39575472946](https://github.com/abavelski/chess-games-db/actions/runs/39575472946) passed `npm test` (including 84 pure tests and archive regression suite), `npm run build`, the fixture benchmark and the full `npm run test:desktop` Electron smoke suite on 2026-10-21. The two new PS-09 test files ran under `npm test` against the real viewer parser and disposable schema-7 archive fixtures.
