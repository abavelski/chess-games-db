# O2-01 — Derived opening storage and archive compatibility

Status: implemented and verified (migration tests, unit suite, build, desktop smoke).

Depends on: none. Read [shared rules](../README.md).

Deliver:

- Add migration 004 and document its schema in `docs/database.md`.
- Store catalogue revisions (upstream commit, content checksum, import/algorithm version), entries (ECO, full name, canonical PGN/UCI, normalized position), and taxonomy nodes (stable path ID, label, parent ID).
- Store game classification status (`matched`, `unmatched`, `invalid`), input PGN hash, dataset revision, diagnostics, a primary match, and all named matches with their ply. Multiple catalogue entries may share a position. Add foreign keys and indexes for position lookup and taxonomy/game joins.
- Define a single active published revision; staging a new revision must not replace the working catalogue until its enrichment finishes. Allow unmatched/invalid games in a published revision with explicit status.
- Publish the field/ID contract for O2-02 and O2-03. Derived rows never overwrite source ECO or PGN. Distinguish absent enrichment, unmatched games, and invalid games.
- Update initializer and Electron compatibility: open schema v3 or v4; v3 reports no opening capability, and empty v4 remains fully usable. Keep original game/record APIs working.

Acceptance/tests:

- Migration from a populated v3 fixture preserves every original column/value and PGN byte; initialization is idempotent and transactional on failure.
- Test constraints, repeated-position entries, parent scoping, revision publication, and indexes. Test v3, empty v4, populated v4, and unsupported future-version handling.
- `npm test`, `npm run build`, and desktop smoke pass without an importer or opening UI.
