# Unified importer validation — 2026-10-21

All nine implementation units were implemented sequentially in local commits.
The definitive CLI/setup/restore/reconciliation recipes are in
[the operation guide](../../unified-import.md). No production archive was rebuilt
or updated; all writable validation archives were isolated disposable outputs.

The following checks passed:

- `npm test`: the standard unit suite plus SQLite archive integration checks.
- `npm run build`: TypeScript and production frontend build.
- `npm run test:desktop`: all existing desktop stories plus the unified importer
  story. The latter creates an archive, opens/reviews it, stars a game, saves a
  personal line and root/variation comments, closes that archive, updates it, then
  reopens/reviews the same durable game and saved study data.
- `mvn -o -q -f tools/extraction/pom.xml test`: synthetic CBH, legacy header
  parsing, language priority, annotation fidelity, variation/NAG preservation,
  unknown players and FEN starts. Tests use pinned installed dependencies offline.
- `python3 -m unittest discover -s tools/extraction/scripts/tests`: temporary
  metadata recovery, Unicode CBV member copying, traversal/duplicate/bounds checks
  and original-source preservation.
- `python3 tools/extraction/scripts/setup.py --offline`: prepares current Java
  source checksum and runtime classpath using installed pinned artifacts.

The archive tests cover v3–v6 inventory/conversion, refusal of unsafe personal or
unknown legacy extensions, v7 favourites/personal-analysis/position capabilities,
unknown tables/triggers, checksum/cache equivalence, WAL backups, exclusive output
publication, symlink/hardlink refusals, changed roots/branches, stale notes,
transaction rollback, source-worker cancellation, exact/encounter candidates,
source and record reconciliation, collection identities, partial commits and
registry recovery through durable resume. Reconciled record ordering updates
source sequence without changing game keys. No-op imports do not change feature
rows, personal timestamps, game creation times or property-cache revisions.

Read-only inventories of supplied v7 archives were saved in
`.local-import-reports/ui-01-inventory.json`. Actual CBH validation used three games
from Fischer's “My 60 Memorable Games”; legacy CBV validation used three games from
Seirawan's opening book. Both completed with verified PGN checksums, integrity,
foreign keys and cache equivalence. CBV output checksums remained identical after
streaming/scratch-path hardening. Source revisions include every relevant sidecar
and are checked before/after extraction. Disposable outputs and reports remain in
`.local-import-reports/`, which is ignored by Git.

The final real-book reports are `fischer-final-validation.json` and
`seirawan-verified-validation.json`. The subsequent `seirawan-offline-rerun.json`
reports three no-ops, zero applied games, zero target PGNs rechecked and three
individually reported guiding-text exclusions. It used prepared tools without
fetching or rebuilding dependencies. A macOS `/var` versus `/private/var` scratch
path issue found during this validation is fixed and covered by the Unicode CBV
test.

The reproducible benchmark command is:

```sh
node scripts/run-archive-tool.mjs scripts/benchmark-import.mjs 5000
```

On this machine a one-game insertion into a 5,000-game disposable archive took
about 349 ms; its no-op rerun took 325 ms, including online backup, staging,
planning and verification. Parent peak RSS was about 174 MiB (including fixture
construction). Fingerprint lookup used `import_fingerprints_hash`; existing
feature rows/property revisions/timestamps were unchanged. Verification of a
no-op rerun decompressed zero target PGNs. These are local observations, not
portable performance thresholds. The retained measurement is
`.local-import-reports/incremental-benchmark-final.json`.

Intentional limits: local CLI only; no automatic cross-edition merge, no combining
already-studied rows, no implicit in-place legacy conversion, and no hidden online
downloads. Unknown binary decoding fails the source instead of accepting partial
PGN. Unenriched import and position indexing are explicit choices. Old integration
commands remain available; they were not retired without broader parity evidence.
