# O3-02 — Authenticated, resumable Explorer enrichment script

Depends on: O3-01 contract. Read [shared rules](../README.md).

Deliver:

- Add an explicit CLI using the current official Explorer API, with masters and optional rating/time-control-filtered Lichess profiles. Read a user-supplied token from an environment variable; redact credentials from logs and diagnostics.
- Collect unique mainline positions/moves from selected games up to the profile's maximum ply; reuse option-2 position normalization. Query only missing/explicitly refreshed cache entries. Keep observed move counts for both reference sources separate.
- Request enough candidate moves to cover each game's actual move where the API supports it. Validate current response/limit behavior; mark absence as unknown unless the response can establish it. Record query parameters and completeness explicitly.
- One request at a time; on 429 wait at least one minute before retrying. Handle authentication failures, timeouts, cancellation, malformed responses, and server errors with bounded retries and resumable checkpoints. Never cache errors as zero statistics.
- Support dry-run (request estimates), local response fixtures, selected-game/profile runs, refresh, and progress/coverage reports. Publication is explicit after a completed run; partial data remains inspectable but not represented as complete.

Acceptance/tests:

- Use a fake HTTP server/clock: authentication, 429 delay, retries, cancellation/resume, malformed data, duplicate positions, cache reuse, freshness, incomplete move lists, and profile separation.
- Assert secrets never enter database/log output and failures preserve prior published data.
- No live API token or network is required by automated tests; this task does not change the UI.
