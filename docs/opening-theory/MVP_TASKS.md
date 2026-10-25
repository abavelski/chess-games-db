# Opening study: MVP implementation tasks

2026-10-25 · Implementation tracked in [PROGRESS.md](PROGRESS.md).
Read [high-level design](HIGH_LEVEL_DESIGN.md) and
[database proposal](DATABASE_PROPOSAL.md) first.

The sequence assumes the recommended single build with separate workspaces.
If a separate build is selected at the design gate, change the shell/release
tasks while keeping the opening service and database contracts.

## Milestones and dependency order

| Milestone | Tasks | Reviewable result |
| --- | --- | --- |
| A: prove semantics and feasibility | OT-01–OT-03 | Agreed count examples, fixtures and measured data/index risks |
| B: publish a trustworthy library | OT-04–OT-07 | Independent runtime file and reconciliation report |
| C: complete the study journey | OT-08–OT-12 | Board → continuation → article/example → review → return |
| D: release the MVP | OT-13–OT-14 | Full-data performance and desktop regression evidence |

Critical path: OT-01 → OT-02 → OT-03 → OT-04 → OT-05 → OT-07 → OT-08 →
OT-10 → OT-12 → OT-13 → OT-14. OT-06 supplies articles to OT-07 and OT-11;
OT-09 supplies the workspace shell to OT-10–OT-12.

The estimates should be made after OT-03 establishes parsing and storage
feasibility. Source-format fidelity and real-data query performance are the
largest uncertainties; a UI-only prototype does not resolve them.

## OT-01 — Review product and counting decisions [DONE]

Dependencies: none. Size: small design task.

Confirm the packaging recommendation, the independent library boundary, MVP
filters and the distinction between following a move order and explicitly
starting a same-position search. Review a static workspace sketch using an
actual opening the player studies. Confirm that “Source lines” means available
source paths, not variations learned, and that “Game records” includes copies.

Acceptance:

- Written examples cover branching, a game ending at a prefix, duplicated
  editions, transpositions and repeated positions.
- The review records whether the proposed terminology is understandable and
  whether source-role filters are sufficient for MVP copy handling.
- The chosen shell approach and deferred features are recorded. No engine,
  training or repertoire editor is added to the initial scope by implication.

## OT-02 — Build a source-quality inventory and fixture set [DONE]

Dependencies: OT-01. Size: medium; primarily data work.

Read the archival SQLite without modification. Inventory game/article counts,
source roles, languages, decoder/annotation statuses, roots, moves, known errors
and relationship resolution. Distinguish meaningful article bodies from repeated
navigation and placeholders. Sample body extraction across old and recent
articles rather than assuming one HTML layout.

Create redistributable synthetic fixtures alongside a local-only real-data
manifest. Keep copyrighted source payloads under ignored `data/`; tests in Git
should not require possession of the encyclopedia.

Acceptance:

- Inventory reconciles against the source snapshot; all discrepancies have
  explanations. It includes the three known decoder errors and diagnostic
  records without assuming they are the only invalid chess.
- Fixtures cover mainline plus nested sidelines, duplicate same-move siblings,
  custom FEN/counters, null/illegal moves, damaged notation, root comments,
  before/after comments, NAGs, drawings, evaluation arrays and unknown types.
- Article fixtures cover navigation-only language bodies, meaningful fallback,
  resolved/ambiguous/unavailable links, malformed HTML, active source URLs,
  encoding damage and FEN diagram metadata.
- Historical audit findings are identified as historical; current scope is not
  inferred from the earlier two-Theory-database snapshot.

## OT-03 — Prove source traversal and index scale [DONE]

Dependencies: OT-02. Size: medium, with a stop-and-review gate.

Prototype the source DTO tree reader in an isolated implementation task. Prove
that every move gets the correct original PGN-order index and stable branch
path. Replay a representative real-data slice and measure source-node, prefix,
leaf and annotation sizes. Test viewer generation without treating the raw
`derived_pgn` or separately cleaned En Croissant export as trusted input.

Acceptance:

- Mapping of `e4 c5 (c6 d4) Nf3` and nested variants agrees with the source
  annotation contract; before/after and root positions survive round trips.
- Complete token consumption is checked; a parser cannot silently skip illegal
  or unknown continuations and still mark a document complete.
- Slice measurements report actual nodes/prefix sharing, build throughput,
  memory and database/index bytes. Full-scale risks and hardware are recorded.
- Unverified evaluation conventions, unsupported annotations or source repair
  proposals have an explicit disposition before full conversion proceeds.
- Review confirms the proposed schema/query approach, or updates the design
  with evidence before committing to its full-corpus build.

## OT-04 — Introduce the independent runtime schema and staging builder [DONE]

Dependencies: OT-03. Size: medium.

Implement the opening-specific schema, file format identification, manifest,
source/item identities, issue inventory and checkpoint lifecycle. Add the
offline CLI with explicit source, staging and new output paths. Keep all
source-schema and games-v7 migrations unchanged.

Acceptance:

- Wrong file types, incompatible versions, path aliases and existing outputs
  are rejected. Browsing never builds or migrates a library.
- Interrupted conversion resumes only when source inputs and converter versions
  agree. Unfinished files cannot be opened as ready libraries.
- Transactions protect each document; finalization cleans unused derived rows.
- Repeated builds preserve stable external record keys. SQLite integrity and
  FK checks pass on generated fixtures; source fingerprints remain unchanged.

## OT-05 — Convert complete source trees and typed annotations [DONE]

Dependencies: OT-04. Size: large; highest fidelity risk.

Implement strict all-variation legal replay, setup roots, stable source/viewer
paths, exact positions, prefix trie and leaf intervals. Normalize supported
annotations without altering their source attachment or language. Quarantine
invalid trees and classify annotation-only limitations separately.

Acceptance:

- Every accepted source move maps to a legal runtime node and back. Child order,
  SAN/UCI, mainline flags, position identity and leaf intervals agree with an
  independent fixture oracle.
- Source annotation sequence and text are reconciled per type/language. NAGs,
  before/after comments, arrows and squares have semantic round-trip checks.
  Array evaluations are verified or explicitly unsupported; they cannot become
  a misleading single score.
- Unknown types retain decoded payload/provenance and an unsupported status.
  An unmappable annotation is reported; an unmappable move excludes the tree.
- Null-move/illegal branches are not silently removed. No automatic source-FEN
  correction or cleaned-PGN substitution occurs.
- Node/annotation publication and checkpoints are atomic per document.

## OT-06 — Convert articles and relationship evidence safely [DONE]

Dependencies: OT-04; consumes OT-02 article fixtures. Size: large.

Build sanitized reading blocks, language availability/fallback and title catalog.
Remove recognized shared navigation only in the derivative. Map source anchors
to controlled targets. Consolidate repeated evidence without expanding through
unvalidated game identities. Support validated FEN diagram blocks locally.

Acceptance:

- Prose, headings and meaningful links survive representative real articles;
  extraction failures get a safe readable fallback and a diagnostic.
- Source scripts, event handlers, CSS, file/network resource URLs and active
  embeds cannot execute or cause resource requests. Security fixtures include
  malformed markup and obfuscated URL schemes.
- A language counts as available for reading only when it has meaningful
  content. Fallback language is visible and original source language is retained.
- Game/article links resolve by stored evidence. Unvalidated position hints open
  the referenced game root with a notice; ambiguous links expose candidates.
- Missing media and excluded sources remain visible as unavailable; article
  model-game lists distinguish explicit links from same-source membership.
- Standalone articles with no playable model game remain discoverable by title.

## OT-07 — Finalize and reconcile a full runtime library [DONE]

Dependencies: OT-05, OT-06. Size: medium plus full-data execution time.

Complete the offline publication gate and run it against the full local source.
Generate a machine-readable report and concise human summary of accepted,
quarantined, deleted and partially supported material. Publish a new artifact,
never replace the archive or mutate an already loaded runtime file.

Acceptance:

- Every source item and annotation is accounted for by accepted data or a
  documented disposition. No record remains pending/building.
- Source/schema fingerprints, SQLite integrity/FKs, tree/index invariants and
  generated viewer-tree/path checks pass. Known excluded records are reported
  separately from a builder failure.
- The final file is closed, checkpointed and self-contained; only finalized
  files have the ready manifest. Checksum and report identify the artifact.
- Failure/interruption retains a resumable staging artifact without publishing
  an apparently successful output; a previous runtime generation still opens.

## OT-08 — Implement the opening query service and counter contract [DONE]

Dependencies: OT-05; OT-06 for article results, OT-07 for full-data verification.
Size: large.

Implement prefix traversal, position-anchor seeding, actual-source continuation
tracking, document filters, exact counters and bounded material pages in a
worker-owned read-only service. Add an allowlisted IPC surface and request
validation. A synthetic fixture library can support development before OT-07.

Acceptance:

- Move-order queries match the whole selected root/sequence and cannot gain
  lines after a move. Position-anchor searches can add material once; subsequent
  moves only advance retained source cursors.
- Repeated-position anchors use per-document leaf-interval unions. A source
  line is never double-counted because it reaches an anchor twice.
- Game/article counters use distinct identities; language/link evidence cannot
  multiply cards. Child and parent counters use identical filters and snapshots.
- Hash-collision fixtures, castling differences, en-passant conventions, custom
  roots and unknown FENs behave according to the shared fingerprint contract.
- Pages have deterministic matches/order; pagination does not affect totals.
  Missing/incompatible/partial coverage cannot produce an unqualified zero.
- Tests compare counts to an independent explicit-leaf oracle, not only to the
  implementation's own interval calculations.
- Invalid IDs, oversized paths/filters and expired cursors return bounded errors.
  Stale requests can be cancelled or ignored without blocking the desktop UI.

## OT-09 — Add workspace navigation and separate library loading [DONE]

Dependencies: OT-01 and the OT-04 format contract. Size: medium.

Add the Openings entry point, independent library picker and remembered file.
Expose manifest/capabilities/coverage through the new service. Keep game archive
selection, personal data and Games navigation independent.

Acceptance:

- Games remains usable with no opening library. Switching workspaces preserves
  each workspace's file/context and closes worker resources when appropriate.
- A source-v1 file or games-v7 file selected as an opening library gets a clear
  format error; no migration or empty replacement is created.
- Missing files, unsupported versions and invalid manifests have recoverable
  states. Library loading does not write either existing archive.
- The renderer has no database handles, arbitrary SQL or filesystem authority.

## OT-10 — Build the move-driven opening explorer [DONE]

Dependencies: OT-08, OT-09. Size: large UI task.

Build the legal board, SAN path, immediate continuations and contextual material
tabs. Reuse board/filter components behind opening-specific adapters. Query
after each completed move, with bounded asynchronous results and stable focus.

Acceptance:

- Board moves, row clicks and keyboard selection produce the same route and
  counters. Promotion, undo/reset, terminal positions and legal no-hit moves work.
- The default follows move order. “Find other move orders” and FEN input create
  a clearly labeled anchor session; returning restores the previous context.
- Source-role/article/metadata/annotation-language filters are consistent across
  continuations and cards. Changing reading language does not change counters.
- Selected zero-match filters remain visible. Empty library coverage, exhausted
  lines and unsupported moves have distinct, actionable messages.
- Rapid moves, filter edits or library changes cannot display results for an
  earlier board; the board remains interactive during expensive queries.
- Narrow-window and keyboard flows remain usable; controls have accessible names.

## OT-11 — Add article reading and controlled navigation [DONE]

Dependencies: OT-06, OT-08, OT-09. Size: medium.

Render safe reading blocks, language controls, source identity, internal links,
diagrams and model-game lists. Offer title browsing and “Study this article”.

Acceptance:

- Reading works offline with no network requests or source HTML execution.
- Article context and scroll persist while inspecting a linked example.
  Language fallback is explained; unavailable diagrams/links remain readable.
- Directly linked examples and same-chapter examples have distinct labels;
  unresolved links never navigate to a guessed target.
- Selecting an article applies its direct model-game scope and updates the
  explorer consistently. An article without indexed examples still opens.

## OT-12 — Integrate annotated example review and session return

Dependencies: OT-05, OT-08, OT-10, OT-11. Size: large UI/integration task.

Adapt the existing review components to opening documents. Verify the exact
source node before jumping. Preserve source comments/drawings on their branches,
and keep opening sessions independent from game-v7 personal persistence.
Add the separate minimal user store for preferences and resume state.

Acceptance:

- Opening a result lands at the matching verified node, including author
  sidelines and custom setup roots. A mismatched stored/viewer path falls back
  safely with an explanation.
- Ordered comments, NAGs, evaluations and drawings render correctly. Multiple
  aggregate comments remain attributed; selecting a source controls its overlay.
- Full review navigation does not silently change the explorer's search scope.
  Back restores board path, filters, counts/page, article scroll, orientation and
  focus. Active exploratory/review state is not overwritten by stale responses.
- No opening record is sent to v7 favourite/personal-save APIs. Existing Games
  editing and engines retain their behavior.
- Restart restores valid state. Missing/rebuilt libraries do not misattach a
  stored integer ID to a different document; revision/hash checks protect resume.
- User settings/session backup can be copied independently of immutable library
  data. No claim of personal note persistence is made in this MVP.

## OT-13 — Verify full-data performance, failure handling and usability

Dependencies: OT-07, OT-10–OT-12. Size: medium plus measurement time.

Measure the full published local library on a documented SSD reference machine.
Check the target budgets in the high-level design and investigate failures
before adding caches/materialized counts. Exercise the real study journey with
the player on at least two openings and one transposition example.

Acceptance:

- Report cold/warm root, common/deep prefix, no-hit, filtered and repeated-anchor
  query distributions, including p50/p95, UI responsiveness, memory and disk.
  Proposed targets are warm explore p95 ≤200 ms, typical cached display ≤300 ms,
  first readable article/game ≤1 s; any revised budget has measured justification.
- Full-corpus results accompany fixture results. Explain plans show intended
  indexes; parsing/decompression does not enter the per-move query hot path.
- Interruption, malformed/corrupt files, missing source/library, worker failure,
  stale cursors and invalid resume references recover without source writes.
- The player can explain the three counters and complete board → article →
  example → back without losing context. Record friction and address MVP blockers.
- Source files and game archives remain unchanged by opening exploration.

## OT-14 — Package, document and release the MVP

Dependencies: OT-13. Size: medium.

Document offline conversion/load, reports, supported content, coverage limits,
backup/resume and rollback. Keep copyrighted data out of source control and
installers by default. Ensure the packaged build includes all new service and
schema assets. Follow existing cross-platform release conventions.

Acceptance:

- Unit, archive and desktop regression suites pass, including the existing Games
  browser, personal saves, favourites, engines and position-search flows.
- An isolated opening desktop test completes exploration, transposition anchor,
  article link, matching-branch review and return using synthetic fixtures.
- A packaged build opens an external ready library without development paths,
  temporary scripts or the archival SQLite file. Windows smoke verification
  follows the repository's current release workflow.
- Installers contain code/assets only. The runtime library and its coverage/
  checksum report are separate artifacts with documented local setup.
- The final release note states the actual validated scope and remaining
  annotation/media limitations; it does not call the source complete or current.

## MVP completion checklist

- A validated, separately versioned opening library exists; archival input is intact.
- Legal moves narrow a real source tree, with exact and understandable counters.
- Transpositions are an explicit discovery action with correct repeated-position counts.
- Relevant prose and annotated branches are readable together with source context.
- Article/example navigation and returning/resuming preserve the study session.
- Full-data responsiveness, failure recovery and Games regressions are verified.

Everything outside this checklist, especially training progress, repertoire
authoring, engines in Openings and a second product build, remains follow-up work.
