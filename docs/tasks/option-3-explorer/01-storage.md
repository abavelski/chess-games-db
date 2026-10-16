# O3-01 — Optional Explorer snapshot and move-statistics storage

Depends on: completed option-2 release. Read [shared rules](../README.md).

Deliver:

- Add migration 005; accept v3/v4/v5 archives with capability checks. Missing or empty Explorer tables must not change catalogue labels or filters.
- Store reference profiles: masters or Lichess, rating/speed/date filters, configurable maximum ply (default 60 plies), minimum move count (default 5), and minimum share (default 0; counts remain visible). Record profile and normalization versions.
- Cache responses by normalized position + full profile/query parameters, with timestamp, response schema version, and request completeness. Retain move counts/results and position totals. An omitted move in a truncated result is “unknown,” not “never played.”
- Store snapshot/run status, resumable work items, game input checksum, per-ply observations, and profile-specific summaries. Separate partial snapshots from published results; preserve previous working snapshots on interruption.
- Document schema/contracts for O3-02/03, including fetch freshness, explicit refresh, and stale-result handling. Never store access tokens in an archive.

Acceptance/tests:

- Test v4→v5 migration, idempotence, foreign keys, profile isolation, cache-key collisions, and partial/published snapshot selection.
- Original game data and option-2 classifications remain unchanged. Legacy and v5-empty archives pass the catalogue release tests without network or credentials.
