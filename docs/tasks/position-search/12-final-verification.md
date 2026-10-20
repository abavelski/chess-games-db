# PS-12 — Variation/context search release verification

Status: **planned**. Depends on: PS-09 through PS-11.

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
