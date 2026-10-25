# Opening study: proposed application design

Design date: 2026-10-25. Implementation status and continuation instructions:
[PROGRESS.md](PROGRESS.md). Task results: [DECISIONS.md](DECISIONS.md).

Read the proposal in this order:

1. [High-level design](HIGH_LEVEL_DESIGN.md): study workflow, scope, packaging
   options, recommended boundaries and reuse of the existing application.
2. [Database proposal](DATABASE_PROPOSAL.md): independent runtime database,
   move-order and position indexes, counting rules, conversion and validation.
3. [MVP implementation tasks](MVP_TASKS.md): sequenced work with dependencies,
   acceptance criteria and release gates.

The recommendation is **one repository and one desktop build, with separate
Games and Openings workspaces**, an independent opening library and a separate
opening API. The user accepted this packaging decision on 2026-10-25.
The boundaries allow a separate opening build later without redesigning storage.

The central distinction is between **following a move order**, where the set of
source lines narrows with each move, and **finding the same position**, which can
bring in additional material through transpositions. Comments always retain the
source game and branch that give them their meaning.

Existing investigation material remains the source reference:

- [Investigation and temporary tools](INVESTIGATION.md).
- [Source-preserving SQLite design](BOOK_SQLITE_DESIGN.md).
- [Source schema v1](book-library-schema.sql).

The new database proposal is deliberately separate from that source schema.
`data/tmp/opening-theory.sqlite` is the unvalidated archival input, not a file
that the proposed desktop would open or migrate in place. Temporary scripts and
data remain in `data/tmp/`; their paths are not prerequisites for understanding
these documents.
