# Opening study implementation progress

Branch: `feature/opening-study-mvp`. All commits stay local; do not push.
Packaging: same repository/build, separate Games / Openings workspaces.

| Task | Status | Evidence |
| --- | --- | --- |
| OT-01 | Done | [Decisions and sketch](DECISIONS.md); packaging accepted by user |
| OT-02 | Done | [Source quality](SOURCE_QUALITY.md); local full inventory reconciles; Python tests pass |
| OT-03 | Done | [Feasibility review](FEASIBILITY.md); 942 real records; 16 tree tests pass |
| OT-04 | Done | [Builder](BUILDING.md); 82,888 items staged; three native SQLite checks pass |
| OT-05 | Done | [Tree converter](BUILDING.md); six native checks + 16 reader tests; first 100 real records checkpointed |
| OT-06 | Done | [Safe articles](BUILDING.md); four body/security tests + native relationship check; three real samples |
| OT-07 | Next | Full conversion, reconciliation and publication gate |
| OT-08–OT-14 | Pending | Execute in task-list order after dependencies pass |

## Resume

Read this file, `MVP_TASKS.md`, and the last task commit on the branch. Check
`git status` before editing. Continue OT-07. Source:
`data/tmp/opening-theory.sqlite`; open read-only, never migrate or repair it.
All source payloads and real-data reports belong under ignored `data/`.
Keep synthetic fixtures redistributable. Mark a task done only when its
acceptance evidence exists, update this file and the task heading, and commit
that task before proceeding. Later tasks are not implicitly done by scaffolding.

OT-03 is a documented feasibility gate before full conversion. OT-07 requires
a full-corpus published artifact; OT-13 requires full-data measurements and
player feedback. Record unresolved gates honestly rather than claiming success.
