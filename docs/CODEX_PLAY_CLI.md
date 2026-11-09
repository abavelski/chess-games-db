# Low-token Codex CLI workflow — Kindle Play vs Maia

Both repositories contain the **same** `scripts/codex-play.sh` Bash wrapper. It reads *this checkout's* improvement task tracker, enforces its `Ready` / `In progress` gate, creates a small `codex/<task>` branch, asks Codex to implement only that task, and runs deterministic validation scripts **outside** the model. It never marks human verification as passed, commits application changes, merges, pushes, or deploys without an explicit `deploy` command.

## Prerequisites (Git Bash on Windows or Terminal on macOS)

1. Install Codex CLI, sign in once with `codex login`, and confirm `codex --version`. The default is **`gpt-6.1-sol` / medium**, as selected in the CLI with `-m gpt-6.1-sol -c 'model_reasoning_effort="medium"'`. No API key is stored in these scripts. If a model is unavailable on your account, set `CODEX_MODEL` explicitly.
2. Clone both repositories and pull their latest default branch separately. Desktop `chess-games-db` uses **`master`**; Kindle `kindle-chess-puzzles` uses **`main`**. Work on the task's automatically created branch, not on the default branch.
3. For the desktop checkout: Node.js 22+, `npm ci` (Electron/SQLite native modules), and a graphical desktop for `npm run test:desktop`. Use the existing Maia setup instructions when doing the *manual* real-engine check. Windows Git Bash prefers `npm.cmd` automatically if available (avoids PowerShell execution-policy problems).
4. For the Kindle checkout: the pinned Rust/Zig/FBInk toolchain, initialized Git submodules, Python 3 host tooling, and existing pinned packaging prerequisites in `docs/BUILD_DEPLOY.md`. Run `git submodule update --init --recursive` before the first build. The Play package is independently built; no physical Kindle or Maia model is needed for normal host tests.

Run `bash scripts/codex-play.sh doctor` and `bash scripts/codex-play.sh list` in either repository. The task table itself is the source of truth, including cross-repository gates; the wrapper refuses `Blocked`, `Waiting for human` and `Done` tasks. **After human acceptance, update both the table row and detailed task status, and mark the next task Ready only when all its dependencies (including those in the other repo) are accepted.** Do not bypass those gates to save time.

## One-task workflow

From **desktop** checkout:

```bash
bash scripts/codex-play.sh list
bash scripts/codex-play.sh run BKP-01
# If validation fails, reuse the exact saved Codex thread and feed only a short log excerpt:
bash scripts/codex-play.sh fix BKP-01
# Run validation again WITHOUT spending Codex tokens:
bash scripts/codex-play.sh verify BKP-01
```

From **Kindle** checkout:

```bash
bash scripts/codex-play.sh list
bash scripts/codex-play.sh run FKP-01
bash scripts/codex-play.sh fix FKP-01     # only after a verification failure
bash scripts/codex-play.sh verify FKP-01
# After verified build/stage and explicit decision to deploy for human checking:
bash scripts/codex-play.sh deploy FKP-01 root@DEVICE_IP 2222
```

`run` and `fix` default to **full** verification. For a faster first iteration, add `--quick`: it runs only focused tests. The desktop-only `--no-desktop` runs all Node tests and production build but skips graphical Electron smoke; **neither quick nor no-desktop is a complete acceptance pass**. Before owner acceptance rerun full verification in a graphical environment; for Kindle full verification includes pinned Play build, stage and artifact checks. Final `FKP-04` is **verification-only**: use `verify FKP-04` to validate Play, Puzzles and Review artifacts, then perform and record physical acceptance; do not spend a Codex implementation session on that task.

## Where the token savings come from

- The prompt points to **one task section**, the repo instructions, and existing reusable components instead of pasting entire plans/logs. Codex is told to run *focused* tests only; ordinary full verification, typechecking, packaging and deployment run in plain shell commands.
- `verify`/`deploy` invoke no model at all. On verification failure, `fix` sends at most the last 90 lines / 12 KB of the failed log and **resumes the recorded task thread** when the CLI exposes its session ID. This preserves context without a fresh planning conversation. Nothing uploads entire build logs into the model automatically.
- Detailed JSONL events, last-message summaries, and check logs go under the Git metadata directory (`git rev-parse --git-path codex-play-runs`), **not** into the source tree or a PR. Read the log before invoking `fix` to decide whether the failure is missing local tooling instead of a code issue.
- Avoid spinning up subagents, repeated full-repo scans and remote builds for a small task. Use an explicit model override only if the current model is not adequate: `CODEX_MODEL=gpt-6-luna bash scripts/codex-play.sh run BKP-01 --quick` (if available). The default remains Sol medium.

## Exact automated gates

| Task | Focused verification | Full verification (plain scripts, no Codex) |
| --- | --- | --- |
| BKP-01..03 | Existing `tests/kindle-play-{game,http,lifecycle,maia}.test.mjs` | `npm test`, `npm run build`, `npm run test:desktop` |
| BKP-04 | Above plus personal-studies interop/edit/PGN tests | Same full suite; real DB is never used by test fixtures |
| FKP-01 | Play render/touch, HTTP/runtime tests | `scripts/app.sh build play` (already runs `scripts/check.sh`), `stage play`, artifact verifier |
| FKP-02..03 | Above plus Play core tests | Same pinned Play build/stage/verify |
| FKP-04 | Full Play core/render/HTTP/runtime focused tests | Build/stage/verify **all three apps**: Play, Puzzles, Review |

All commands reuse existing project scripts; they do not implement a second build or deployment pipeline. Git Bash/macOS shell compatibility is maintained using Bash 3-compatible syntax, `python3`, and the existing project tools.

## Human gate and working tree

1. Inspect `git diff` and the check log. If a focused/full check fails because dependencies are missing, install the dependencies and use `verify` again instead of paying Codex to diagnose your computer.
2. Record observed automated evidence and change **both task status locations** to `Waiting for human`. Check the plan's last-step human checklist. For physical Kindle checks, `deploy` only transfers verified artifacts; the owner still has to launch/tap/observe the device, and add actual firmware/build/observations to `docs/device/ks1-barolo.md`.
3. Only after explicit human acceptance, change both statuses to `Done`, commit the implementation/evidence on the task branch, and merge/push through your preferred Git workflow. The runner **never** asserts acceptance or pushes any code by itself. Unaccepted tasks remain blocked.

Failure or cancellation is safe to retry: the wrapper does not reset branches, overwrite user edits, expose live engine credentials, automatically install packages, or connect to a Kindle without the explicit deployment command. The shell command's exit code is nonzero if any required local check fails.