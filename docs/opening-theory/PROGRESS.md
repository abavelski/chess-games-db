# Opening study implementation progress

Branch: `feature/opening-study-mvp`. All commits stay local; do not push.
Packaging: same repository/build, separate Games / Openings workspaces.

| Task | Status | Evidence |
| --- | --- | --- |
| OT-01 | Done | [Decisions and sketch](DECISIONS.md); packaging accepted by user |
| OT-02 | Done | [Source quality](SOURCE_QUALITY.md); local full inventory reconciles; Python tests pass |
| OT-03 | Next | Strict traversal and measured feasibility gate |
| OT-04–OT-14 | Pending | Execute in task-list order after dependencies pass |

## Resume

Read this file, `MVP_TASKS.md`, and the last task commit on the branch. Check
`git status` before editing. Continue OT-03. Source:
`data/tmp/opening-theory.sqlite`; open read-only, never migrate or repair it.
All source payloads and real-data reports belong under ignored `data/`.
Keep synthetic fixtures redistributable. Mark a task done only when its
acceptance evidence exists, update this file and the task heading, and commit
that task before proceeding. Later tasks are not implicitly done by scaffolding.

OT-03 is a documented feasibility gate before full conversion. OT-07 requires
a full-corpus published artifact; OT-13 requires full-data measurements and
player feedback. Record unresolved gates honestly rather than claiming success.
