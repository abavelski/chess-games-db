# PS-12 — Variation/context search release verification

Status: **completed** (2026-10-21). Depends on: PS-09 through PS-11.

## Deliver

- Add complete fixture-based regression/desktop tests covering mainline and variations, matching paths, collisions, pawn signatures, schema-7 extension, cache invalidation and review-origin navigation.
- Repeat benchmarks and storage measurements with variation-heavy games; record relative growth from mainline-only indexing and query latencies for both search scopes. Exercise interrupted rebuild, partial variation failures and concurrent read/index-build lifecycle as implemented.
- Reverify preservation of original PGNs, annotations, opening catalogue matches, saved personal lines, favourites and all browser filters. User archives are never modified automatically.
- Update `docs/database.md`, README and this phase overview with exact shipped behavior, supported setup instructions, limitations and completed verification results. Explicitly defer **pawn-structure matching UI**, fuzzy similarity, player repertoire tools and online databases.

## Acceptance / tests

- `npm test`, `npm run build`, `npm run test:desktop` and dedicated position-search smoke suites all pass without network or engines.
- Real-archive **copy** is exercised when available; disclose fixture-only benchmark limitations otherwise.
- Mainline versus variation match labels, jump-to-path, return-to-origin, invalid/stale index status and pawn-signature extraction are demonstrated end-to-end.
- Mark all tasks complete only after results and commands are documented.

## Completed release verification — 2026-10-21

All acceptance gates passed on disposable, deterministic **schema-7 fixture archives**, without an external engine or online chess database, in [GitHub Actions run 39597173689](https://github.com/abavelski/chess-games-db/actions/runs/39597173689). **No user/private archive was available**, so the numbers below are **fixture-only**, not estimates or targets for real collections.

| Gate | Evidence |
| --- | --- |
| `npm test` | **Passed:** 87 unit tests and 45 archive/integration tests (0 failures), including `tests/position-release.check.mjs` |
| `npm run build` | **Passed:** TypeScript and Vite production build |
| `npm run test:desktop` | **Passed:** original desktop, openings, engine integration, critical positions/Study stops, favourites, personal notes, PS-08/PS-10 position search, PS-11 review-origin search |
| Comparative position benchmark | **Passed** with reproducible `PS12_VARIATION_BENCHMARK_JSON` output; both SQLite index/query plans verified and original archive checksum unchanged |
| Archive preservation | **Passed:** exact original source PGNs/compressed bytes, sources, features, offline Lichess opening matches, saved personal branches/comments, favourites, checksum, schema 7 and FK constraints |
| Index lifecycle | **Passed:** partial bounded build, intentional interruption and resume, existing concurrent read connection observing committed per-game publications, partial malformed sideline downgrade, forced SQL failure rollback, full reindex, changed-PGN invalidation and rebuild |
| Position correctness | **Passed:** source-only/mainline labels and scope, repeated occurrences and separate annotated editions, verified exact PGN reviewer paths including nested branches, pawn hash and exact signature, deliberate 64-bit hash collision with distinct four-field keys, legal personal branch as a search *input* |
| Browser and review | **Passed:** filter preservation, page/keyboard navigation, variation-only row and exact review path, return to unmounted comparison/original review, unsaved Save/Discard/Cancel and Piece mode prohibition, absent/partial-index warnings |

### Reproducible commands

Run from a checkout with installed dependencies / Node.js 22+:

```sh
npm test
npm run build
npm run test:desktop
npm run benchmark:positions -- --games 240 --samples 80
npm run benchmark:position-variations -- --games 120 --samples 40
# Optional: a real schema-7 archive is opened read-only and copied by SQLite backup
npm run benchmark:position-variations -- --database /path/to/your/archive.sqlite3 --samples 40
```

The benchmark's fixture contains six repeatedly cycled legal, nested, author-variation scores (120 total), including branch-only positions, transpositions and repeated visits. The baseline and all-variation indexes are built **separately** on independent SQLite online backups of the same unchanged source. Both runs explicitly install the optional derived schema, force a complete build and measure an incremental no-op pass. The stored benchmark output includes CPU, OS, RAM, Node version, exact SQLite page-byte footprint, index coverage, SQL plans, per-position match counts and sampled p50/p95; an online-backup user archive would be processed by the identical code path. Search latencies measure **synchronous archive search API calls** on warmed, in-process SQLite connections, **not** Electron UI render/network or startup time.

### Measured storage and build work

[CI evidence and raw JSON](https://github.com/abavelski/chess-games-db/actions/runs/39597173689) — Ubuntu Linux x64, AMD EPYC 7763 (4 logical CPUs), 15.61 GiB RAM, Node 22.22.0, 120 games, 40 samples per position/scope with 8 warmups.

| Fixture measure | Mainline-only copy | All-original-variations copy |
| --- | ---: | ---: |
| Fully indexed games | 120 / 120 | 120 / 120 |
| All-variation coverage | 0 / 120 | 120 / 120 |
| Distinct exact positions | 17 | 28 |
| Stored occurrences | 560 | 1,000 |
| SQLite file footprint after build | 499,712 B | 528,384 B |
| Full index build | 183.434 ms | 201.286 ms |
| Incremental rerun | 1.718 ms | 1.666 ms |
| Incremental games skipped | 120 | 120 |
| Invalid/partial variation failures | 0 | 0 |

Original (pre-derived-index) SQLite source size: **376,832 B**. Installing derived tables on either copy before replay occupied **421,888 B**. Compared with the fully built mainline-only copy, all-line indexing added **28,672 B (28 KiB; 5.738%)**, **440 occurrences (+78.571%)** and 11 exact position keys. These growth percentages describe **this fixture** and are sensitive to PGN shape and SQLite page allocations.

### Warming and query timing, p50 / p95 in milliseconds

Each cell has 40 samples on the same CI runner, following 8 warmup queries. The two columns from the all-lines copy isolate scope query differences from index-footprint differences.

| Query position | Mainline query, baseline copy | Mainline query, all-lines copy | Include author variations, all-lines copy | Matches mainline → opt-in |
| --- | ---: | ---: | ---: | ---: |
| Root | 2.189 / 2.472 | 2.112 / 2.277 | 2.321 / 3.521 | 120 → 120 |
| Played opening (1.d4 d5) | 1.795 / 2.024 | 1.855 / 2.732 | 2.020 / 3.073 | 40 → 80 |
| **Author-only** (1.d4 Nf6) | 0.674 / 0.736 | 0.873 / 0.979 | **1.610 / 1.774** | **0 → 20** |
| Repeated branch position (1.d4) | 1.758 / 1.883 | 1.829 / 3.137 | 2.150 / 2.421 | 40 → 80 |
| Transposed position (1.Nf3 Nf6) | 1.767 / 2.282 | 1.792 / 1.917 | 1.989 / 3.084 | 40 → 60 |
| Absent position (1.a4 h5) | 0.646 / 0.684 | 0.666 / 0.708 | 0.700 / 0.752 | 0 → 0 |

All author-variation results above have complete index coverage; the zero for an absent position is therefore authoritative **within this fixture**. The SQL plan uses `position_keys`' covering unique index on `(zobrist_hash, exact_key)` and the `game_position_occurrences_position` index for **both** search scopes, with per-game ranking to deduplicate occurrences. Query times are not stable performance promises or real-archive measurements; benchmark a copy of your own archive for that.

### Recovery, preservation, and limitations

The standalone PS-12 release test uses a second isolated seven-game archive with a deliberately illegal author variation. It confirms the valid mainline stays searchable but `includeSourceVariations` correctly reports `mainlineOnly=1`, leaving the opt-in archive-wide coverage incomplete. The test also verifies a `building`/stale index cannot leak partial results, writer-trigger invalidation after a changed PGN, a write-trigger fault rolling back one per-game rebuild, and simultaneous reader observations of only published snapshots. Separate PS-02/PS-04/PS-09/PS-10 tests cover schema constraints and repeated/failed rebuild states.

**Never index a user's only archive.** Create a consistent SQLite online backup first, run `npm run positions -- init --database COPY`, then `npm run positions -- build --database COPY --include-variations` and `npm run positions -- status --database COPY`. Run `rebuild --dry-run --include-variations` on the copy before a repair, followed by an explicit rebuild if appropriate. No ordinary app navigation installs, repairs or reindexes data; separately saved personal moves are never source-index inputs. Faulty author-variation PGNs require correction/reimporting before complete all-lines coverage can be claimed.

**Explicitly deferred:** a pawn-structure matching interface (though hashes/signatures are indexed now), fuzzy/similar-position search, player repertoire tools, online chess databases, and automatic/background position-index services. The tested release implements **exact, standard-chess positions** with existing filters and optional source-authored branches, not those future tools.
