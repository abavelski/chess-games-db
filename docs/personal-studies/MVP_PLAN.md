# Personal Studies — MVP product and technical plan

**Status:** plan only; no application code or user data changed by this document.

## 1. Problem, outcome and boundary

Games searches and reviews an existing annotated-game archive; Openings navigates a separate curated opening library. Neither is a convenient, fully editable notebook for *my* tournament games and independent studies. Add a third tab, **My Studies**, in the same Electron app. It owns its database, creation/import, search/filter, mutable game tree, save and portable PGN export.

**Terminology:** A **study** is exactly one standard-chess game tree. It may have no moves, an incomplete mainline with `*` result, a complete game, and any number of nested alternative lines. A Lichess **chapter** maps to one study; a Lichess **study** may contain multiple chapters and is *not* mapped 1:1. Local study title and labels are distinct from PGN headers. A personal study is distinct from the current Games archive's `game_personal_analysis`.

### Required MVP user journeys

1. **New:** open My Studies, create "Round 3 vs Smith" with a standard starting board and empty score; enter mainline moves, branch at any prior move, attach prose/NAGs/drawings, Save, leave and reopen with no loss.
2. **Tournament game:** paste or select a *single-game* PGN, populate metadata (players, date/year, event/tournament, round, ratings, result), categorize as tournament game and tag it `endgame` / `time-trouble`; edit and re-export.
3. **Random study:** create an otherwise untitled/unknown-player position study beginning at normal setup, add illustrative variations, title/tags, then find it again by title, player, year, event or tag.
4. **Lichess to local:** export a *chapter PGN* in Lichess and import it as exactly one local study, preserving supported comments, variations and arrows/highlights.
5. **Local to Lichess:** export/copy one study as an annotated PGN and create/import one chapter in a Lichess study via its PGN option. Importing it back retains supported move-tree annotations.
6. **Analysis:** at a selected move, enable existing Stockfish/Maia, inspect candidate lines, explicitly add a suggested continuation if desired; turning engines on/off does not write a study.
7. **Safety:** switching workspaces preserves their independent UI state; leaving a dirty personal study asks Save/Discard/Cancel; a failed save retains edits and displays an error.

## 2. MVP scope (release contract)

**Included**
- Third navigation item `My Studies`, lazily mounted, with isolated list/editor state and preserved Games/Openings behavior.
- Dedicated on-disk `personal-studies.sqlite3` in Electron `app.getPath('userData')` (not in `data/annotated-games.sqlite3`, the opening runtime library or `opening-user.sqlite3`). Auto-create **only this** database on first explicit My Studies use, with its own `application_id`, `user_version` and transactional migrations. Clearly display its storage location and backup/export affordance.
- Create, rename, list, filter/sort, open, edit, duplicate, delete (with confirmation), and explicit Save. Soft deletion is not required if backup/export and deletion confirmation exist.
- One authoritative game tree per study: legal standard chess moves from the initial board, mainline, alternative siblings and nested variations; move promotion; select/navigate variations; add/delete line or subtree; promote a variation to mainline **only if feasible after the editing core is stable** (otherwise a clearly labeled follow-up, not a blocker). Avoid unbounded rendering in deep trees.
- Root-position and per-move comments (plain text); common NAG glyphs (`!`, `?`, `!!`, `??`, `!?`, `?!` plus numeric NAGs already supported by review); drawings persisted per board position: arrows and highlighted squares, standard green/red/blue/yellow, add/remove/clear.
- Headers/metadata: `White`, `Black`, `WhiteElo`, `BlackElo`, `Event`, `Site`, `Date` (year derived), `Round`, `Result`, optional `ECO` and `Annotator`; local `title`, `kind` (tournament / other), and free-form custom tags. Unknown players/dates are valid. Show metadata in list and editor; separate tags from PGN headers.
- Search across title/players/event and tags; filters for kind, year, tags, latest modified, and optionally result; deterministic sorting/pagination for larger lists.
- Single-game PGN import (paste and UTF-8 file) and export (clipboard and `.pgn` file). Include mainline, nested variations, comments, NAGs and Lichess `[%cal]` / `[%csl]` annotations. Multi-game input produces an explicit explanation and is rejected without partial writes in MVP.
- Reuse existing board/score/engine/Piece mode where technically safe, and keep review shortcuts including F, ←/→, Home/End, text-focus exclusions and accessibility.
- Pure offline automated fixtures and desktop smoke/regression coverage; no Lichess account or engine binary needed to pass standard tests.

**Outside MVP (future increments, not accidental promises)**
- Arbitrary FEN/root setups, Chess960 or other variants; multiple chapters per local study; realtime Lichess sync/conflict resolution; OAuth setup and automated remote publishing; cloud accounts/collaboration; training/gamebook/conceal mode; engine-generated permanent annotations; opening explorer integration or automated opening matching; full-text search of annotations; undo/redo across sessions; cross-library references/position-index lookups.
- The architecture must *allow* adding these later (persist `root_fen` with standard FEN now and version PGN/contract), but no settings/UI for them yet.

### Early non-negotiable clarification

Use the term "Lichess-compatible PGN", **not full Lichess study backup**: PGN transports the chess tree and common comments/drawings, not the multi-chapter structure, study members, permissions, discussion, interactive lesson settings or all Lichess-specific metadata. Local free-form tags remain local unless a documented explicit PGN mapping is chosen.

## 3. UX sketch

```text
Games | Openings | MY STUDIES

My Studies               [New study] [Import PGN] [Back up/export...]
[Search title/player/event] [Year] [Kind] [Tags] [Sort: recently edited]
  Round 3 vs Smith   My tournament game  2026  time-trouble, endgame
  Isolated IQP plan  Other               —     middlegame
  ...
[Open]

Study: Round 3 vs Smith           [Metadata] [Copy PGN] [Export PGN] [Save]
White/Black, Event, Date, Rating  [Delete/duplicate]
     Chess board       Mainline, indented variations, comments and NAGs
  [arrows/highlights]  [comment] [NAG] [variation controls]
  [move controls]      [Stockfish / Maia] [Piece mode]
```

- Start game at the normal chess initial position even for imported studies; reject nonstandard `SetUp/FEN` or nonstandard `Variant` in MVP with a clear error (do **not** quietly discard FEN).
- Entering a legal move at the end extends the selected line; entering a different legal move from a prior node creates a sibling variation. Re-entering an identical legal move selects the existing child rather than creating an accidental duplicate, unless imported PGNs already contain distinct same-SAN siblings; imported duplicates must not be silently merged.
- Editing text or drawings marks the draft dirty. Save persists **the whole study edit plus metadata and tags atomically**, with optimistic revision checks. Navigation/close prompts for dirty drafts.
- Select a move to view that position's drawings and edit its annotation. Move arrows drawn automatically by engines are visually separate, never saved as user annotations without user action. Expose conventional Chessground drawing gestures with a small discoverable help tooltip and a keyboard/accessible alternative for clearing drawings.
- No external user-data path is required to use studies, but expose **Open data folder / export library backup** safely; never auto-write an arbitrary path.

## 4. Reuse plan grounded in this repository

| Existing code | Reuse / adaptation | Guardrail |
| --- | --- | --- |
| `src/WorkspaceRoot.tsx` | Add lazy My Studies tab and pane; store focus/scroll for all 3; suspend hidden studies' analysis | Games/Openings must keep mounted session and current persistence semantics |
| `src/PgnBoard.tsx`, `@lichess-org/pgn-viewer` and Chessground | Render legal position, navigation, board, arrow drawing | Extend in *opt-in* editable mode; default existing review remains unchanged |
| `src/ReviewMoves.tsx`, `src/review-layout.mjs`, `src/pgn.mjs` | Reuse annotated nested score, comments/NAG display, ordinal paths, parsing/serialization | Do not change source-PGN display sanitation for Games; study editor mutates its **own** game tree |
| `src/GameReview.tsx` | Extract presentational review shell/controls or compose shared primitives into new `PersonalStudyEditor` | Do **not** route study saves via `window.chessArchive.savePersonal`; do not rework archive persistence |
| `src/analysis.mjs`, `src/useEngineAnalysis.ts`, `src/EnginePanel.tsx`, `src/PieceMode.tsx`, `src/useBoardResize.ts` | Legal replay, engines, free board, UI sizing | Hidden panes suspend engine work; engine continuation requires deliberate add-to-study |
| `electron/main.mjs`, `electron/preload.cjs`, `better-sqlite3` | Register separate `personal-studies:*` IPC and narrow `window.personalStudies` | Never expose SQL/file handles or unrestricted filesystem operations to renderer |
| `src/OpeningWorkspace.tsx` and `lib/opening-user-store.mjs` | Model for independent workspace/resume state | Avoid making studies depend on selected opening library or changing its schema |

Important current-state notes: `GameReview` overlays personal lines/comments on *immutable book PGN*; it is not a general tree editor. `PgnBoard` uses the PGN Viewer and may reparse it on updates; the editor must retain selected variation/node identity across edits. `src/pgn.mjs` already interprets `[%cal]`/`[%csl]` for the board and uses ordinal paths for distinct siblings. Share pure parsing/path helpers where useful but do not assume viewer paths are stable database IDs.

### Suggested code boundaries (implementation guidance, not files that exist today)

- `lib/personal-studies/storage.mjs`: study DB open/create/migrate, transactions, revision, list/get/write/delete.
- `lib/personal-studies/pgn.mjs`: strict single-game validation, game-tree edits, PGN codec, arrows/highlights, header conversion; pure functions.
- `electron/personal-studies.mjs`: IPC registration, file chooser/export, persistence lifecycle.
- `src/PersonalStudiesWorkspace.tsx`, `src/PersonalStudyEditor.tsx` and focused components/hooks; `src/personal-studies-types.ts`.
- `tests/personal-studies*.test.mjs` and a new desktop smoke suite.

Make any shared refactor *small, additive and default-preserving*, with tests for both Games and Openings before adding study editability.

## 5. Delivery slices and prioritization

| Slice | User-visible milestone | Prerequisites |
| --- | --- | --- |
| A. Foundation | My Studies tab, separate DB, blank study create/list/open, metadata/tags | PS-01–PS-06 |
| B. Real editor | Move/variation editing, comments, NAGs, drawing tools, Save/leave flow | PS-07–PS-12 |
| C. Portability | Import/export single PGN with reliable Lichess round trip | PS-13–PS-15 |
| D. Release gate | Engine reuse and paused-state safety, end-to-end regression, backup/recovery docs | PS-16–PS-18 |

A task is done only after its acceptance checks pass. Slice A should ship behind the new workspace without changing the existing tabs; Slice C is required before declaring the MVP usable.

## 6. Quality / release gates

- **Isolation:** hash and row-count snapshots of the selected Games v7 archive and opening runtime DB remain unchanged while studies are created, edited, imported/exported and deleted. Existing `game_personal_analysis` stays untouched.
- **Round trip:** given a fixture with a 25+ ply mainline, nested variations, root/move comments, 6 NAG types, promotions, and red/blue/green/yellow arrows/squares, export → parse → import has equivalent chess tree and supported annotations. Run a manual test in a *real Lichess chapter* in both directions before release; document any lossy fields. Lichess network tests are manual/opt-in.
- **Durability:** save and reopen, concurrent editing conflict, invalid PGN, disk failure, cancel import, cancel export, cancel deletion, and app restart; no half-written studies or lost unsaved drafts.
- **Regression:** `npm test`, `npm run build`, `npm run test:desktop` (when a GUI session is available); existing Games and Openings navigation, comments/variations, drawings, engines, filters and saved sessions must pass. No live engine or Lichess account required for default suite.
- **Performance/accessibility:** paginated, indexed list; edits responsive with 200+ moves and nested lines; navigation usable by keyboard; controls labeled; alert/confirmation text accurate; engine processes quiet in hidden workspaces.
- **Data location:** DB lives under Electron userData, outside source control. Give users a tested safe backup method (SQLite backup API / checkpoint-aware copy, not blindly copying a live WAL file).

## 7. Future path: richer than Lichess

After MVP, add source-aware but **non-destructive** connections to: (1) Stockfish and Maia existing analysis controls with "accept suggested line" and optional evaluation snapshot provenance; (2) opening library and opening-name detection via position/line matching; (3) Games archive "create personal study from this game" by *copying* a verified PGN, never altering the archive; (4) authenticated Lichess create/import/export APIs with explicit push/pull and conflict detection; (5) position search/pawn structures across collections; (6) nonstandard FEN roots and study-repetition workflows.

Keep PGN import/export as a permanent interoperability escape hatch even after API integration.
