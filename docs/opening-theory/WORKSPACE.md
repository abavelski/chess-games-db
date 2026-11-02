# OT-09 desktop workspace boundary

Games / Openings navigation shares the desktop build. Games stays mounted with
its existing archive, filters, result page and review state. Opening resources
live in a separate worker and API. The opening file picker does not call the
Games archive opener, favourite or personal-save handlers.

The separate `opening-library.json` user-data preference remembers only a
previous explicit selection. No library is bundled or auto-selected from the
source directory. Missing/corrupt/incompatible remembered files produce a
recoverable opening-workspace error while Games remains available. A new worker
replaces the previous one only after successful format/manifest loading; failed
selection leaves a valid previous library intact. Replaced workers and all
workers at shutdown terminate. Warm workspace switching retains the worker and
its bounded contexts.

The sandboxed preload exposes fixed opening operations, a file picker and
status; it exposes no database handle, SQL execution or arbitrary path opener.
IPC checks the caller is an application window. Runtime files use read-only
handles. A source-v1 or Games-v7 file is rejected without migration/replacement.

Hidden Games reviews are suspended, pause analysis and remove their keyboard
listener. Returning preserves the exact board route. Workspace focus and page
scroll are remembered while both panes stay mounted. The opening pane loads
its JavaScript only when first selected. Persistent detailed opening sessions
remain OT-12.

## Verification

```powershell
npm.cmd run build
node scripts/start-electron.mjs tests/opening-workspace-desktop-smoke.mjs
node scripts/start-electron.mjs tests/desktop-smoke.mjs
```

All pass. The new isolated smoke covers missing remembered files, rejecting
source/Games formats, ready loading, separate remembered paths, unchanged file
hashes, preserved Games results/review and suspended hidden keyboard navigation.
The existing Games smoke covers filters, review/comments/drawings/variations,
resize, keyboard navigation and unchanged archives. Its obsolete direct-child
Back-button selectors were corrected to the existing header-actions container.

React checklist applied: lazy workspace import, preserved component identity,
bounded async lifecycle with stale-load guards, cleanup of listeners/workers,
explicit accessible controls, focus restoration, and no source HTML injection.
Existing Sass conventions are retained. Broader release regression observations
remain in [REGRESSION_NOTES.md](REGRESSION_NOTES.md).
