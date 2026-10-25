# Regression observations during implementation

These failures were observed on the local Windows host while OT-07 conversion
ran. The existing Games implementation and tests involved have not been edited
by OT-01–OT-06. This is not a passing release regression report; resolve or
explicitly investigate these at OT-14 before marking that task done.

- `npm.cmd test`: existing `tests/opening-storage.test.mjs` launches `python3`,
  which is a Microsoft Store execution alias on this host. `python` works.
  The ordinary Node suite stops before archive checks because of this failure.
- `node scripts/run-archive-tool.mjs --test --test-reporter=dot tests/*.check.mjs`:
  migration tests and the import alias test attempt Windows file symlinks and
  receive EPERM. Hard-link alias checks in the new opening tests work without
  elevated permissions.
- Existing import CLI flow tests fail after their game verification completes
  with `EPERM: operation not permitted, fsync`. Inspect the existing import
  publication/directory synchronization path on Windows; do not suppress game
  integrity verification or report failed imports as successful.
- PowerShell's policy blocks `npm.ps1`; use `npm.cmd` without changing system
  execution policy. Direct `node` and Python commands are unaffected.

The new opening-focused checks pass, including complete synthetic publication,
unchanged source hashes, checkpoint rollback/retry, tampered schema/annotation/
source identity rejection, and read-only loading after removing the source.
No full-data publication or desktop regression pass has been claimed yet.
