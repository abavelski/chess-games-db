# Personal Studies — data model, editing contract and Lichess transport

**Status:** v1 storage and codec implemented. The schema below describes the store; executable schema and validators live in `lib/personal-studies/`. See [CONTRACT.md](CONTRACT.md) for concrete limits and [INTEROPERABILITY.md](INTEROPERABILITY.md) for the pending real Lichess check.

## 1. Separate store and ownership

- **File:** `app.getPath('userData')/personal-studies.sqlite3` with a dedicated application ID and `PRAGMA user_version = 1`. Create only when My Studies is explicitly used, not when browsing Games or Openings.
- **API:** privileged main-process `better-sqlite3` connection, `foreign_keys=ON`, bounded queries, transactions and explicit write methods. Use a private, additive migration sequence for this store; do not reuse `db/migrations/007_games.sql`, mutate `ChessArchive`, or touch `opening-user.sqlite3`.
- **Data security:** private local by default; only explicit export/backup crosses the app-owned data directory. No default Lichess network traffic; no credentials in PGN, logs, DB metadata or repository.
- **Authority:** PGN is the persisted chess tree (headers, moves, variations, NAGs, comments and drawing tags). The local study row holds user-facing title, kind, indexed metadata, tags, created/edited timestamps and revision. A controlled update may normalize PGN, but never modify an imported PGN implicitly on mere viewing.

Illustrative schema:

```sql
PRAGMA foreign_keys = ON;
PRAGMA user_version = 1;

CREATE TABLE studies (
  id TEXT PRIMARY KEY,                 -- locally generated UUID; not Lichess ID
  title TEXT NOT NULL,                 -- 1..200 visible characters, trim/validate
  kind TEXT NOT NULL DEFAULT 'other' CHECK(kind IN ('tournament','other')),
  root_fen TEXT NOT NULL,             -- standard initial FEN in v1
  pgn TEXT NOT NULL,                  -- one validated standard-chess game
  white TEXT, black TEXT,
  white_elo INTEGER, black_elo INTEGER,
  event TEXT, site TEXT, date TEXT, round TEXT, result TEXT, eco TEXT, annotator TEXT,
  year INTEGER,                       -- derived from valid Date; nullable
  origin_kind TEXT,                   -- 'blank', 'pgn-file', 'pgn-paste', 'lichess-pgn'
  origin_url TEXT,                    -- optional provenance; not a sync guarantee
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE study_tags (
  study_id TEXT NOT NULL REFERENCES studies(id) ON DELETE CASCADE,
  tag_key TEXT NOT NULL,              -- trimmed/case-folded key for comparisons
  label TEXT NOT NULL,                -- original display spelling
  PRIMARY KEY(study_id, tag_key)
);
CREATE INDEX studies_updated_idx ON studies(updated_at DESC, id);
CREATE INDEX studies_year_idx ON studies(year, id);
CREATE INDEX studies_kind_idx ON studies(kind, id);
CREATE INDEX studies_white_idx ON studies(white, id);
CREATE INDEX studies_black_idx ON studies(black, id);
CREATE INDEX studies_event_idx ON studies(event, id);
CREATE INDEX study_tags_tag_idx ON study_tags(tag_key, study_id);
```

**Decisions to preserve:** no reference into archive `games.id`; no "chapters" table; standard starting FEN is stored explicitly for future versioning; timestamps ISO-8601 UTC; use the `id` as stable identity even when headers, title or moves change. `year` is null for `????.??.??` and malformed/unknown dates, not guessed. Whitespace-only tags are rejected, duplicates by normalized key coalesce, and custom tag values never become SQL identifiers. Title, tags and header lengths, PGN size/variation depth, list page size, and file size are bounded with useful validation messages.

### Update/save contract

1. Renderer sends a versioned, validated **whole-document draft** (title, kind, headers/metadata, tags, serialized PGN) and `expectedRevision`; no raw SQL.
2. Main process strictly parses one PGN, replays **every branch** from the standard initial position, checks legal moves/result, validates expected headers and length/depth/count limits, and updates metadata/indexes and tags in **one transaction**.
3. `UPDATE studies SET ... revision = revision + 1 WHERE id = ? AND revision = ?`; zero rows is a conflict, not an overwrite. Roll back all changes on failure. Return the new revision.
4. Unsaved draft remains intact after failure; Cancel/Discard/Save confirmation on close/switch and before import replacing an open editor. No unannounced autosave.
5. Duplicate copies the current saved study into a new UUID (not a linked record). Delete requires explicit confirmation, immediate transaction and clear undo limitations. Backup first.

### PGN metadata rules

Use common portable headers: `Event`, `Site`, `Date`, `Round`, `White`, `Black`, `Result`, optional `WhiteElo`, `BlackElo`, `ECO`, `Annotator`. Store the study `title`, `kind`, user tag labels and `origin_url` **only in SQLite**; do not silently inject custom unrecognized PGN headers for them. Imported additional PGN headers and unknown annotations should remain in the stored PGN and round-trip to the maximum supported fidelity; if the serializer cannot preserve a construct, **surface that limitation before destructive reserialization**. Header editor updates only the named supported fields and retains unrelated headers.

For the MVP, only standard chess `SetUp` absent or `SetUp=0`, and no nonstandard `FEN`/Variant are accepted. Do not quietly replace a nonstandard root with the starting position. Empty-score `*` is valid; a study need not be a finished game. Moves should be represented by an explicit tree rather than an array of consecutive strings; branch identity is sibling-sensitive. Do not use the viewer's ordinal path as the DB primary key. After reordering/removing a branch, reconcile selection to the surviving node or closest ancestor.

## 2. Board annotations in portable PGN

Persist common Lichess/chessbase-style PGN comment directives on the **position after the move** (or root comments for move 0). For a move:

```pgn
[Event "My tournament"]
[White "Me"]
[Black "Opponent"]
[Result "*"]

1. e4 {Space advantage [%cal Ge2e4,Rd7d5] [%csl Gd4,Be5]} e5
(1... c5 {Sicilian possibility}) 2. Nf3 $1 *
```

- **Arrows:** `[%cal Ge2e4,Rd7d5]` = color letter `G/R/B/Y` followed by origin square and destination square, comma-separated.
- **Square highlights:** `[%csl Gd4,Be5]` = color letter and square.
- **Comments:** user-entered prose, escaped safely for PGN, independent of directive snippets.
- **Glyphs:** numeric PGN NAGs (e.g. `$1`, `$2`, `$3`, `$4`, `$5`, `$6`), and preserve other supported NAGs.
- **Move 0/root annotations:** comments on the game root; test that both exporter and importer maintain them.
- **Editing:** UI supports drawing toggle/remove/clear at the current position, and modifications only to the user's selected position. Preserve comments and non-drawing tags (`[%eval]`, `[%clk]`, unknown directives) when editing arrows/highlights; do not overwrite an entire comment to alter one `[%cal]` tag. Stable deterministic ordering on serialization.
- **Chessground:** existing `GameReview` composes source shapes and engine autoShapes. For personal studies, user drawings belong in persisted `shapes` at that PGN node; engine suggestions remain transient `autoShapes`. Verify no overwrite when switching moves, board flip or promotion.
- **Fidelity guard:** `src/pgn.mjs` has a display-only `commentText` and `prepareDisplayPgn` transformation. **Never serialize the stripped display copy as the authoritative study PGN.** Save/export from the validated study tree containing original comments/directives, not rendered text.

## 3. Lichess transfer, reliable MVP

The MVP uses **one PGN = one local study = one Lichess chapter**. It offers *import into local from Lichess* and *export from local to Lichess*, with no account setup:

| Direction | MVP path | Expected fidelity |
| --- | --- | --- |
| Lichess → local | In Lichess choose a chapter's **Share & export → Chapter PGN** (include comments + variations), paste or open the downloaded `.pgn` under My Studies → Import PGN | Standard moves, branches, comments, NAGs, `[%cal]`, `[%csl]`, common headers |
| Local → Lichess | In the local editor **Copy PGN / Export PGN**; on Lichess create/open a study → **Add chapter → PGN** and paste/import | New chapter containing the same supported chess content |
| Round-trip verification | Export local → import as Lichess chapter → re-export chapter → import as another local study; compare normalized tree/annotations | No supported annotations missing; any unmapped Lichess feature documented |

Provide meaningful errors for multiple games, invalid moves, PGNs too large, unsupported start FEN or variant, incomplete/invalid tags, or canceled file choice. Validate before inserting rows. Only use UTF-8 text for file transfer. Offer copy-to-clipboard even when no filesystem export is desired. Never claim local tags, title, Lichess members, privacy or interactive features are transported by PGN.

### Later, optional direct API bridge

The official Lichess Studies API provides:
- `GET /api/study/{studyId}/{chapterId}.pgn` and `GET /api/study/{studyId}.pgn` for retrieval (private/unlisted require suitable authentication).
- `POST /api/study` to create a Lichess study and an initial empty chapter; `POST /api/study/{studyId}/import-pgn` creates chapter(s). These use OAuth2 `study:write`. Lichess study permissions and rate limits apply. Creating an empty initial chapter may require a cleanup/placement decision in a direct-export workflow.
- `GET /api/study/by/{username}` to list studies; authenticated `study:read` access is relevant for private-study imports.

These endpoints are **not** required for the MVP; there is deliberately no "sync" promise. A later implementation should prefer OAuth PKCE and OS credential storage, explicit push/pull with preview and revision/remote-ID mapping, no token in the studies DB, and no automatic overwrite. A multi-chapter remote study should become *multiple separate local studies* by user choice. Respect Lichess's one-request-at-a-time guidance and 429 retry policy. Confirm the live API contract when implementing.

References: [Lichess API: Studies](https://lichess.org/api#tag/Studies), [Study create schema](https://github.com/lichess-org/api/blob/master/doc/specs/tags/studies/api-study.yaml), [Import PGN schema](https://github.com/lichess-org/api/blob/master/doc/specs/tags/studies/api-study-studyId-import-pgn.yaml), [Chapter export schema](https://github.com/lichess-org/api/blob/master/doc/specs/tags/studies/api-study-studyId-chapterId.pgn.yaml), [API rate limit guidance](https://lichess.org/page/api-tips).

## 4. Backup/restore, testing and versioning

- Exporting a PGN saves **one** chess tree, not the entire local metadata/tag library. Provide a separate **Back up personal-studies database** command using SQLite's online backup facility (or a safe, checkpoint-aware equivalent) to a user-chosen destination while the app is running. Reject replacing an existing file without confirmation.
- **Restore:** a documented offline procedure (close app first, copy verified backup to app userData path, reopen) with schema/app-id validation and explicit warning that restoring replaces newer local studies. In-app restore/merge is future scope.
- Keep test databases in temporary directories; never operate against a real archive, opening database or profile. Create migration tests for fresh, reopen, incompatible future schema, corrupt DB and atomic rollback.
- Test corpus: blank and unfinished scores; long tournament mainline; nested variations, early variations, first-move branches, promoted pawns; empty/root comments; multilingual comments and literal braces; extra headers and unknown directives; all drawing colors; imported duplicate SAN branches; invalid moves/FEN/variant; two clients editing the same revision; malformed/oversized PGN.
- Repeated import/export should be **semantically idempotent** for supported chess data; do not demand byte-identical exported PGN after normalization. Preserve unchanged original bytes until the first committed edit where feasible, and never discard unsupported annotations without user-facing notice.

**Optional later:** position indexes, study status/progress, opening lookup, source game copy, Lichess remote identities/sync metadata (in a separate mapping table), FEN roots, alternate variants, full-text comments.
