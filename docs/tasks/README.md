# Opening enrichment tasks

Implement **option 2 first**. Its four tasks deliver a complete offline app with named openings, line/subline filters, and game-list labels. Option 3 is a separate, optional release for reference-game move statistics. “First option” here means the first implementation below: option 2 from the investigation.

| Release | Tasks in order | Complete when |
| --- | --- | --- |
| Opening catalogue | [01 Storage](option-2-opening-catalogue/01-storage.md), [02 Enrichment script](option-2-opening-catalogue/02-enrichment.md), [03 Read API](option-2-opening-catalogue/03-read-api.md), [04 UI](option-2-opening-catalogue/04-ui.md) | Named filters and labels work offline; legacy and unenriched archives still work. |
| Explorer statistics | [01 Storage](option-3-explorer/01-storage.md), [02 Fetch script](option-3-explorer/02-fetch.md), [03 Derived statistics](option-3-explorer/03-statistics.md), [04 UI](option-3-explorer/04-ui.md) | Optional cached move statistics appear in review without affecting catalogue filtering. |

Each task is a separate implementation/review unit with its own tests. Dependencies specify integration order; fixtures and mocks let agents test each unit without running later tasks or accessing live services. Keep the app usable after every task. No implementation or database modification is part of writing these plans.

Shared rules:

- Keep the default UI games-only and book mode hidden. Enrich only `record_kind = 'game'`; source-deleted games remain excluded from browsing.
- Preserve original PGN bytes, hashes, ECO, headers, source records, and stable identities. Write derived tables through explicit scripts; Electron stays read-only and never auto-migrates an archive.
- Identify derived results by game ID, input PGN checksum, dataset/snapshot, and algorithm version. Queries ignore stale results after reimport; reruns replace them safely.
- Use additive migrations via `scripts/init-db.py`. `electron/database.mjs` currently accepts only schema v3: update the version guard and capability handling with each storage task. New readers support legacy v3 and every intermediate planned schema; unknown future schemas fail clearly.
- Use isolated fixture databases for tests. Never migrate or enrich the user's real database as a side effect of development or tests.
- Each release must pass `npm test`, `npm run build`, and `npm run test:desktop`. Extend fixtures to cover new schema versions; preserve opt-in book-reader coverage. Live network access is never required by tests.

Sources: [Lichess opening catalogue, conventions and CC0 license](https://github.com/lichess-org/chess-openings), [Explorer API](https://lichess-org.github.io/api/#tag/Opening-Explorer), [API usage guidance](https://lichess.org/page/api-tips).
