# Personal Studies verification

## PS-01 baseline — 2026-11-02 (Windows)

- `npm test`: 128 pure tests passed; 86 archive checks passed. Five symlink-only subtests explicitly skipped because Windows symlink privileges are unavailable. Sidecar and hardlink checks still execute.
- `npm run build`: passed (existing Sass deprecation warnings).
- `npm run test:desktop`: all eleven suites passed in a disposable profile, including Games review, Openings filters, engines, Piece mode, annotations, imports and position searches.
- Baseline repairs: select installed Python on Windows, close Python SQLite fixture connections, open publication flush handles with write permission on Windows, update obsolete desktop Back selectors.
- Fixture databases only; no real user database used in verification.

Feature acceptance and manual Lichess checks remain pending until their corresponding tasks are implemented.
