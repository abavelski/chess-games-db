# O3-03 — Derive reference-move tags and expose read APIs

Depends on: O3-01 contract; seed responses without running O3-02. Read [shared rules](../README.md).

Deliver:

- Implement pure, versioned derivation from cached observations: position total, actual-move count/share, evidence source, and status (`known`, `below threshold`, `unknown`, `not fetched`). Keep catalogue named-position matches separate.
- Compute the contiguous opening prefix satisfying the profile's count/share thresholds; unknown or missing evidence stops the prefix with an explicit reason. Also retain per-move evidence for later re-entry. Do not call the prefix a proven theory boundary or call missing moves novelties.
- Expose optional summary data in list/detail APIs and paginated/bounded per-move statistics for review. Add profile-specific minimum-prefix filtering expressed in plies internally; document UI conversion to full moves.
- Query only published snapshots matching current PGN hashes, profile, and derivation version. Preserve option-2 filters/labels, totals, ordering, and pagination when no Explorer filter is active.
- Units include both source types but never silently combine their counts. Add rebuild-from-cache support when thresholds/derivation change, without unnecessary refetching when query parameters are unchanged.

Acceptance/tests:

- Fixtures cover thresholds, zero totals, rare moves, unknown/truncated results, missing plies, re-entry, stale game hashes, partial runs, profile switching, and full-move/ply boundaries.
- Test combined catalogue/book/year/reference-prefix filtering and unique paginated totals. No API requests occur during reads or derivation tests.
