# Opening runtime builder

## Staging inventory (OT-04)

```powershell
node scripts/run-archive-tool.mjs scripts/build-opening-library.mjs --source data/tmp/opening-theory.sqlite --staging data/opening-study/library.staging.sqlite3 --output data/opening-study/opening-library.sqlite3 --corpus opening-encyclopaedia-2024
```

Use `--resume` with the same arguments after interruption. The source must be a
closed source-v1 snapshot. Staging and output paths must differ from it and
from each other, and the final output must not exist. Hard links and filesystem
path aliases are rejected. The explicit corpus namespace plus normalized
relative source path/native record ID defines stable external keys; preserve
that namespace across builds. Full source SHA-256 and converter versions bind
checkpoints. Changed inputs require a new generation.

At OT-04 this command inventories only; it does not convert trees/articles or
publish a ready library. The manifest remains `building`, the final path is
absent, and the runtime loader refuses the staging artifact. This distinction
must remain visible until the OT-07 publication gate is implemented.

The 2026-10-25 local execution inventoried all 82,888 source items, hash
`9860ea58102bb69f6beea655943358d042f3f1f2221d9814eb5aceaa4e7e04fd`;
the source hash matched after execution. Local staging:
`data/opening-study/library.staging.sqlite3`. No ready output exists yet.

Schema: `db/opening-library-v1.sql`. Source-v1 DDL and Games migrations are
unchanged. Runtime application ID is 1330924610, format
`opening-study-library`, independent schema v1. Ready manifests require complete
coverage and no unfinished record checkpoints. Browsing never builds or migrates.

Document processing uses `checkpointItem`: one transaction contains derived
publication, disposition, counts and checkpoint. An exception rolls all of
them back; a completed unit is skipped on resume. Cleanup removes unreferenced
derived positions/prefixes before later finalization. WAL/FULL is used only
for offline staging; each command checkpoints and closes its own connection.

Verification:

```powershell
node scripts/run-archive-tool.mjs --test tests/opening-library-staging.check.mjs
```

Tests cover resume mismatch, simulated mid-document failure/rollback/retry,
stable identities across independent builds, unfinished/invalid manifests,
wrong formats, aliases, existing output, cleanup, integrity/FKs and unchanged
source fingerprints. Article and tree publication and checks remain later tasks.
