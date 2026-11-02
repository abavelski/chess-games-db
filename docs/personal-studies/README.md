# Personal Studies — MVP

**Status:** proposed design and implementation backlog; **not implemented**.
**Owner's rule:** one personal study = one chess game (including an unfinished game or a line with variations). Unlike a Lichess study, a personal study has no chapters. Standard starting position only for MVP.

## Purpose

Add **My Studies** as a third top-level workspace alongside **Games** and **Openings**. Keep private, editable tournament-game analyses and other self-directed chess work in an **independent local SQLite database**. A study can contain a main line, arbitrarily nested legal variations, position-specific prose, move glyphs and board arrows/highlights. Reuse the existing chess viewer, commentary layout, drawing and Stockfish/Maia capabilities while **preserving all behavior and data in Games and Openings**.

The smallest useful flow is: **My Studies → New study / Import PGN → add legal moves and annotations → Save → find/reopen → export annotated PGN**. A Lichess study *chapter* maps to one local study; Lichess's multi-chapter container maps to multiple local studies, not one.

## Documents

- [MVP plan](MVP_PLAN.md): scope, journeys, delivery slices, architecture, boundaries and release criteria.
- [Data model & Lichess interoperability](DATA_AND_INTEROP.md): dedicated SQLite schema, PGN round trip, drawing encoding, import/export mapping and backup policy.
- [Detailed task backlog](MVP_TASKS.md): ordered PS-01–PS-18 tasks, dependencies, deliverables and acceptance checks.

> **Naming:** this plan uses **PS** for *Personal Studies* only within this folder; the older **PS-01–PS-12** under `docs/tasks/position-search/` refer to *Position Search*. When linking tasks externally, write **Personal Studies PS-xx** to avoid ambiguity.

## Principles

1. **Never write to the game archive or opening runtime library** on behalf of My Studies; never reinterpret existing saved game comments as studies.
2. **Reuse before replacing:** `src/WorkspaceRoot.tsx`, `src/PgnBoard.tsx`, `src/ReviewMoves.tsx`, `src/pgn.mjs`, `src/analysis.mjs`, `src/useBoardResize.ts`, `src/EnginePanel.tsx`, `src/useEngineAnalysis.ts`, `src/PieceMode.tsx`. Adapt shared *presentation* behind additive interfaces rather than turning `GameReview`'s archive-personal overlay into the editor.
3. **PGN as the portable chess source of truth**; SQLite as the authoritative local study collection/metadata store.
4. **Offline first, explicit writes, recoverable.** Never silently discard edits or overwrite another copy.
5. **Engine suggestions are not annotations unless explicitly accepted.** Stockfish, Maia and opening-context connections may be reused without being MVP dependencies.

## Links

- [Existing workspaces](../../src/WorkspaceRoot.tsx), [read-only archive](../../electron/database.mjs), [game review](../../src/GameReview.tsx), [opening study notes](../opening-theory/DECISIONS.md)
- [Lichess Studies API](https://lichess.org/api#tag/Studies), [API tips/rate limits](https://lichess.org/page/api-tips)
