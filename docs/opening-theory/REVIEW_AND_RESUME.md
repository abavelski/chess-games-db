# Annotated review and resume (OT-12)

Source review starts at the query service's verified ordinal source path and
replays legal UCI moves from the document's own FEN. It follows every original
child in order, including duplicate same-move siblings, through continuation
buttons, the ancestor breadcrumb, Previous/Next, Home and arrow keys. It does
not use the PGN viewer's colliding move-path encoding. Custom setup counters
are preserved. A missing path, mismatched tree hash or wrong expected position
opens the root with an explanation; an unavailable document stays recoverable
with Back to study.

Comments retain sequence, before/after/root placement, source language and
document/annotator attribution. Reading language chooses matching text, then
untagged text, then a labelled source fallback; all languages can be shown.
NAGs include descriptions. Arrows and square highlights come only from the
selected source node and disappear on navigation. Unsupported evaluations,
arrays and unknown annotations have explicit notices; no score perspective
or array offset is invented. Unmapped annotations are separately inspectable.

The explorer remains mounted during review. Back restores its route, filters,
counts, material page, orientation, mounted article history, article scroll and
focused control before paint. Review navigation never changes search scope.
There are no opening calls to Games favourites, saves, notes or engine APIs.

## Independent personal state

`opening-user.sqlite3` in Electron's user-data directory has its own application
ID (1330926931) and schema version 1. A fixed, authorized IPC method accepts
bounded, validated language/workspace/session settings; no SQL/path authority is
exposed. The store contains preferences and one last session, not personal
annotations. Session state contains the library UUID, revision and corpus;
explorer root/moves/mode/filters, material tab/page, orientation, previous prefix
scope, article stable-key history and reading scroll; and the selected review's
stable document key, tree hash, ordinal source path and orientation. Integer
document/node IDs and worker tokens are never persisted.

Settings read failure is visible and does not prevent library exploration.
Legal routes and settings shapes are checked before restoration. An exact
library-identity match restores the session and re-verifies its source selection
through the query service. A rebuilt/different library starts a fresh search
with an explanation while retaining reading preferences. A missing library
retains the old session until its library is explicitly reopened. The existing
`opening-library.json` remembers only the explicitly selected file path.

Writes use full synchronous transactions and DELETE journalling. Copy the
closed `opening-user.sqlite3` and `opening-library.json` independently of the
immutable library; no library/source copy is needed for a settings backup.
Session changes are coalesced for 150 ms, so abrupt termination can lose the
most recent fraction of a second. The last committed session remains atomic.
On a different computer select the external ready library again if its path
changed. No personal-note persistence is claimed.

## Validation

- Build/typecheck pass.
- Ten native query/user-store checks pass, including backup/reopen, invalid
  route/shape rollback, foreign-database refusal and safe match fallback.
- Workspace, explorer, article and review desktop smokes pass. Review smoke
  covers comment order/language, NAGs, drawings appearing/clearing, nested and
  duplicate siblings, custom FEN/counters, reload, orientation, identity mismatch
  and unchanged source/runtime/Games hashes.
- Existing Games desktop smoke passes, including annotations and navigation.

```powershell
node scripts/run-archive-tool.mjs --test tests/opening-user-store.check.mjs tests/opening-query.check.mjs
npm.cmd run build
node scripts/start-electron.mjs tests/opening-review-desktop-smoke.mjs
```
