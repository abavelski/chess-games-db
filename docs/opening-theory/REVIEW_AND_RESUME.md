# Annotated review and resume (OT-12)

Annotated examples now open the same `GameReview` used by Games. The
opening-specific preview, board layout, move buttons and annotation cards were
removed. `OpeningGameReview` supplies only the validated runtime tree, language
selection, source attribution and study navigation to the shared screen.

The shared board, resizer, score/variation transcript, NAG descriptions,
keyboard navigation, review settings, engine controls and Piece mode are reused.
Comments retain before/after/root placement and source sequence. Reading language
chooses matching text, then untagged text, then a labelled source fallback;
all languages can be shown. Source prose is encoded as literal text so braces
and PGN-like directives cannot introduce moves, evaluations or drawings.
Arrows and squares use the shared board overlays and clear on navigation.
Unsupported/unmapped annotations remain explicit; no evaluation perspective or
array offset is inferred.

Opening review uses ordinal child identities throughout the shared viewer and
transcript, preserving duplicate same-move siblings. Native verified source paths
map to these identities; custom FEN counters survive replay. Temporary board or
engine exploration extends the selected branch in memory. Opening examples do
not use Games favourites, personal-comment persistence or cross-archive search;
the source library stays read-only. Engine analysis is opt-in and uses the same
local engine configuration as Games.

The explorer remains mounted during review. Back to study restores its route,
filters, counts, material page, orientation, mounted article history, article
scroll and focused control. Review navigation does not change search scope.
Session persistence stores the last source ancestor when exploring a temporary
variation. Missing paths/hash/position mismatches still fall back through the
query service with an explanation.

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

## Shared review feedback validation (OT-13)

Build/typecheck and 30 focused review/notation/personal unit tests pass. The
opening review desktop smoke now exercises the shared transcript, drawings,
nested and duplicate branches, exact path/orientation after restart, custom FEN
counters, a temporary board variation and unchanged source/runtime/Games hashes.
Article and explorer desktop smokes, existing Games review and personal-review
smokes also pass. The personal-test return-focus selector was updated for the current header
action container.

The full-library desktop smoke passes and confirms the runtime checksum is
unchanged. Its new local report is `data/opening-study/performance-ui-shared-review.json`;
the run overlapped other desktop checks, so its timing distributions are not a
replacement for the dedicated performance baseline.

The broad unit run passes 119/120; the existing opening-storage migration test
cannot start `python3` on this Windows environment. The optional engine desktop
smoke also remains unverified here: its toolbar-count assertion is stale (six
buttons versus the existing seven), and a diagnostic run past that assertion
times out waiting for the fake engine output on Windows.
No engine implementation changed in this feedback fix.
