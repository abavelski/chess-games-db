# Product features and study ideas

> Working notes, 2026-10-20. Current-feature snapshot: `master` at `320b76b`. Ideas below are **not implemented** unless explicitly marked. This is a product discussion, not a development commitment.

## Product direction

**A personal, searchable library of thoroughly annotated master games** for a serious young OTB player (currently ~1910 Elo, mainly classical tournaments). Optimize for finding *worthwhile games to study*, understanding their plans, recording one's own analysis, and revisiting useful positions—not for duplicating every ChessBase function. The ability to iterate quickly from one player's feedback is the advantage.

## Already implemented

- **Local desktop library:** Electron/React/SQLite; open/change a schema-v7 database; remember the last file; offline browsing; preserve original source PGNs, game identity, editions, annotator credits, and provenance.
- **Search and browse:** free-text search over game metadata; searchable multi-selects for source, source type, event, year, result, and study markers; year ranges; favourites-only / personal-analysis-only; contextual option counts, sorting, and paginated results (40/page).
- **Opening discovery:** offline Lichess opening catalogue enrichment; family → line → subline name search/filter; matching via reached positions and transpositions; opening/ECO labels and an unclassified-games option.
- **Annotated review:** interactive chessboard; move navigation and nested variations; readable comments, NAGs, evaluations, coloured arrows/squares, source headers and original PGN; keyboard shortcuts, flip and remembered board sizing; return to the same list state.
- **Local analysis:** independently enabled Stockfish and Maia 3 (79M), engine lines/clickable continuations, evaluation bar, candidate arrows, Maia move probabilities and configurable player rating; preferences persist. Engines are optional external local assets.
- **Personal work:** add legal exploratory sidelines and position-specific comments (including variations and the start position); visually distinguish them from book analysis; explicitly save/delete them in the SQLite database while leaving original PGN unchanged; unsaved-change prompt on exit.
- **Guided study:** ChessBase critical-position diamonds and medal labels; counts and next/previous study stops, including variations; progressive *Study stops* reveal; independent free **Piece mode** for moving either side's pieces without legal-move constraints, then restoring the review state.
- **Maintenance/reliability:** transactional game writer, legacy v3–v6 → v7 conversion, resumable offline opening enrichment, feature extraction, checksum-verified compressed PGNs, bounded SQL queries, desktop tests, and cross-platform packaging/Windows setup scripts.

**Implemented below the UI, but not directly exposed as browser controls:** query/filter support for White, Black, all players, annotators, source sections, sites, completeness, annotation presence, individual medal/critical-position flags, and source ECO. CLI conversion/writing/enrichment is **not** an in-app PGN import workflow.

Source of truth: [README](../README.md), [database model](database.md), [review](../src/GameReview.tsx), [browser](../src/App.tsx), [query API](../electron/queries.mjs), and [task notes](tasks/README.md).

## Candidate features (not yet implemented)

| Horizon | Feature | Why it is useful |
| --- | --- | --- |
| **Now** | **Export/backup/restore personal analysis** (and merged annotated PGN export) | Trust: years of personal notes must be portable and safe. |
| **Now** | **Study before reveal**: hide source comments, continuations and engines; record a candidate plan; reveal author then engine at one position | Encourages independent calculation and comparison instead of passive reading. Extend existing Study stops. |
| **Now** | **Study status** (new / studying / studied / revisit), resume last position, recently viewed | Makes a library into an ongoing study routine. |
| **Now** | **Collections, personal tags and position bookmarks** | Organize themes such as isolated queen's pawn, prophylaxis, or technical endings. |
| **Now** | **Full-text search in annotation comments**; expose advanced filters under an optional panel | Find *chess ideas*, not just player names and ECOs. |
| **Now** | **Review editing QoL**: undo/redo, comment shortcuts, draft recovery, collapse variations, copy FEN/variation PGN | Reduces friction when making serious annotations. |
| **Next** | **Exact-position index/search** across games and branches, including transpositions | Jump from a position to other annotated examples. |
| **Next** | **Pawn-structure / material-pattern similarity** | Discover strategically relevant model games across different openings. Start with transparent deterministic signatures. |
| **Next** | **Compare annotated editions of the same game** | Contrast different authors at a move without losing provenance. Link editions; never silently merge them. |
| **Next** | **Import own classical tournament games** and mark learning moments | Connect actual OTB experience with the master-game library. |
| **Next** | **Explainable “what to study next” suggestions** | Rank by relevant opening/position, structure, annotation depth, study markers, and past study. Show *why* each game was recommended. |
| **Later** | **Practice positions extracted from annotated games** and optional spaced revisits | Reuse the library for calculation and recall without building a generic puzzle platform. |
| **Later** | **Opening model-game collections / repertoire coverage** | Learn recurring middlegame plans before building a full opening memorizer. |
| **Later** | **Opponent preparation** by linking an opponent's recent PGNs to relevant model games | Specialized extension of the same game/position retrieval infrastructure. |

## Brainstorming takeaways from existing tools and community discussion

- **ChessBase / HIARCS / SCID:** Deep game, position, pattern and player search is the benchmark; the risk is a crowded, high-complexity interface. Borrow retrieval power, not the full feature surface.
- **En Croissant:** Modern local engines, databases, imports and repertoire workflows demonstrate the appeal of an integrated desktop app. Make note preservation and import/export predictable.
- **Lichess Studies:** Excellent reference for simple navigation, readable variations and reveal-based learning; an indexed *cross-game* annotated library can complement it.
- **ChessTempo:** Spaced repetition and transposition-aware training are useful, but can remain later additions rather than distract from studying master games.
- **Anecdotal Reddit themes:** People value strong search, practical editing, portable annotations and independent analysis before revealing an engine. Treat these as hypotheses to validate with the actual user, not market research statistics.

## Suggested small experiments

1. **Trust + study flow:** make notes exportable, then test a single “my ideas → author's note → engine” interaction.
2. **Library usefulness:** add study status/tags and search inside commentary; test with 20–30 carefully chosen annotated games.
3. **Position discovery:** index exact positions first, then experiment with pawn structures and recommendations using a handful of his own OTB games.

**Success criterion:** he voluntarily returns to the app, finds relevant master games quickly, writes his own ideas before checking answers, and can connect what he learns to OTB tournament play. Keep the core UI quiet and remove features that do not improve those behaviours.

**Scope guard:** no general ChessBase clone, full opening trainer, generic puzzle site or AI coach in the first phase. Retain a strict separation between original author commentary, personal annotations and any future machine-generated output.
