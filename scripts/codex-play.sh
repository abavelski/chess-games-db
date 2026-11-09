#!/usr/bin/env bash
# Run one Kindle-vs-Maia backlog task with Codex, then verify using host scripts.
# Desktop instance: automated branch/push flow while preserving human gates.
set -euo pipefail

ROOT="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd "$ROOT"
if [[ -f docs/KINDLE_PLAY_IMPROVEMENTS.md ]]; then
    PROJECT=kindle
    PLAN=docs/KINDLE_PLAY_IMPROVEMENTS.md
    PREFIX=FKP
elif [[ -f docs/tasks/kindle-play-server/IMPROVEMENTS_PLAN.md ]]; then
    PROJECT=desktop
    PLAN=docs/tasks/kindle-play-server/IMPROVEMENTS_PLAN.md
    PREFIX=BKP
else
    echo 'Cannot find a Kindle Play improvement plan in this checkout.' >&2
    exit 2
fi

usage() {
    cat <<EOF
Usage: scripts/codex-play.sh COMMAND [TASK] [OPTION]
  auto  [${PREFIX}-01] [--quick|--no-desktop]
                                Resume locally, repair/verify, commit and push
                                task branch, then stop at human checkpoint
  accept ${PREFIX}-01 "verified observations"
                                Explicit human approval: commit, merge/push
                                master, then automatically start next Ready task
  list                          Show planned task statuses (no model call)
  doctor                        Check local tools and repository state (no model call)
  run    ${PREFIX}-01 [--quick|--no-desktop]
                                Create/reuse a task branch; Codex implements,
                                host verifies (default: full checks)
  verify ${PREFIX}-01 [--quick|--no-desktop]
                                Run deterministic tests/builds without Codex
  fix    ${PREFIX}-01 [--quick|--no-desktop]
                                Resume this task's Codex session with only the
                                last failing verification-log excerpt
EOF
    if [[ "$PROJECT" == kindle ]]; then
        echo '  deploy FKP-01 root@DEVICE_IP [SSH_PORT]'
        echo '                                Explicitly deploy verified Play artifacts'
    fi
    cat <<EOF
Environment overrides: CODEX_MODEL=gpt-6.1-sol, CODEX_REASONING=medium,
                       CODEX_BIN=codex (CLI must already be logged in).
Quick runs only focused tests; --no-desktop skips GUI smoke checks on desktop.
Only accept records human verification. auto never accepts it; it pushes
checkpoint changes to a task branch only. Git operations never force-push.
EOF
}

command="${1:-help}"
case "$command" in
    -h|--help|help) usage; exit 0 ;;
    list)
        grep -E '^\|[[:space:]]*[1-4][[:space:]]*\|[[:space:]]*' "$PLAN"
        exit 0 ;;
    doctor)
        echo "Project: $PROJECT | Plan: $PLAN"
        echo "Branch: $(git branch --show-current)"
        git status --short
        for tool in git bash; do command -v "$tool" || true; done
        if [[ "$PROJECT" == kindle ]]; then
            for tool in "${CODEX_BIN:-codex}" cargo python3; do command -v "$tool" || true; done
            echo 'Build requirements: pinned Rust, Zig, FBInk and initialized submodules (see docs/BUILD_DEPLOY.md).'
        else
            for tool in "${CODEX_BIN:-codex}" node npm; do command -v "$tool" || true; done
            echo 'Desktop smoke needs an interactive graphical session; run npm ci when dependencies are absent.'
        fi
        exit 0 ;;
    run|verify|fix|deploy|auto|accept) ;;
    *) usage >&2; exit 2 ;;
esac

if [[ "$command" == run && "$PROJECT" == desktop ]]; then
    command=auto
fi
task="${2:-}"
if [[ "$command" == auto && -z "$task" ]]; then
    branch="$(git branch --show-current)"
    if [[ "$branch" =~ ^codex/bkp-0[1-4]$ ]]; then
        task="$(printf '%s' "${branch#codex/}" | tr '[:lower:]' '[:upper:]')"
    else
        for candidate in BKP-01 BKP-02 BKP-03 BKP-04; do
            candidate_row="$(grep -E "^\|[[:space:]]*[1-4][[:space:]]*\|[[:space:]]*${candidate}[[:space:]]" "$PLAN" || true)"
            candidate_status="$(printf '%s\n' "$candidate_row" | awk -F '|' '{s=$5; gsub(/\*/, "", s); sub(/^[[:space:]]+/, "", s); sub(/[[:space:]]+$/, "", s); print s}')"
            if [[ "$candidate_status" == Ready || "$candidate_status" == 'In progress' ]]; then
                task="$candidate"
                break
            fi
        done
        if [[ -z "$task" ]]; then
            echo 'No Ready desktop tasks: all accepted or blocked by human checkpoints.'
            exit 0
        fi
    fi
fi
if [[ ! "$task" =~ ^${PREFIX}-0[1-4]$ ]]; then
    echo "Expected task ${PREFIX}-01 through ${PREFIX}-04." >&2
    exit 2
fi
row="$(grep -E "^\|[[:space:]]*[1-4][[:space:]]*\|[[:space:]]*${task}[[:space:]]" "$PLAN" || true)"
if [[ -z "$row" ]]; then echo "Task $task is missing from $PLAN." >&2; exit 2; fi
status="$(printf '%s\n' "$row" | awk -F '|' '{s=$5; gsub(/\*/, "", s); sub(/^[[:space:]]+/, "", s); sub(/[[:space:]]+$/, "", s); print s}')"

if [[ "$command" == run ]]; then
    case "$status" in
        Ready|'In progress') ;;
        *) echo "Refusing $task: tracker status is '$status'. Human acceptance/dependencies gate the next task." >&2; exit 2 ;;
    esac
    if [[ "$task" == FKP-04 ]]; then
        echo 'FKP-04 is human/device verification only; run verify, then manually accept. No Codex implementation needed.' >&2
        exit 2
    fi
fi

log_base="$(git rev-parse --git-path codex-play-runs)"
mkdir -p "$log_base"
log_base="$(cd "$log_base" && pwd -P)"
new_log() {
    LOG_DIR="$(mktemp -d "$log_base/${task}-$(date +%Y%m%d-%H%M%S)-XXXXXX")"
    printf '%s\n' "$LOG_DIR" > "$log_base/latest-${task}"
    echo "Logs: $LOG_DIR"
}

run_step() {
    local label="$1"
    shift
    printf '\n>>> %s\n' "$label" | tee -a "$LOG_DIR/verify.log"
    printf 'Command:' >> "$LOG_DIR/verify.log"
    printf ' %q' "$@" >> "$LOG_DIR/verify.log"
    printf '\n' >> "$LOG_DIR/verify.log"
    if "$@" >> "$LOG_DIR/verify.log" 2>&1; then
        echo "PASS: $label"
    else
        echo "FAIL: $label" >> "$LOG_DIR/verify.log"
        touch "$LOG_DIR/verify.failed"
        echo "FAIL: $label. Last 60 log lines:" >&2
        tail -n 60 "$LOG_DIR/verify.log" >&2
        return 1
    fi
}

verify_task() {
    local mode="$1"
    local skip_desktop="$2"
    if [[ "$PROJECT" == desktop ]]; then
        local npm_bin=npm
        if command -v npm.cmd >/dev/null 2>&1; then npm_bin=npm.cmd; fi
        run_step 'Focused Kindle HTTP/game/lifecycle/Maia tests' node --test \
            tests/kindle-play-game.test.mjs tests/kindle-play-http.test.mjs \
            tests/kindle-play-lifecycle.test.mjs tests/kindle-play-maia.test.mjs || return 1
        if [[ "$task" == BKP-04 ]]; then
            run_step 'Focused personal studies tests' node --test \
                tests/personal-studies-interop.test.mjs tests/personal-studies-edits.test.mjs \
                tests/personal-studies-pgn.test.mjs || return 1
        fi
        if [[ "$mode" == full ]]; then
            run_step 'Complete Node + archive suite' "$npm_bin" test || return 1
            run_step 'Typecheck and production bundle' "$npm_bin" run build || return 1
            if [[ "$skip_desktop" == 0 ]]; then
                run_step 'Electron desktop smoke suite (graphical session)' "$npm_bin" run test:desktop || return 1
            else
                echo 'SKIPPED: Electron smoke (--no-desktop); not a complete acceptance pass.' | tee -a "$LOG_DIR/verify.log"
            fi
        fi
    else
        if [[ "$task" != FKP-01 ]]; then
            run_step 'Play core state tests' cargo test --locked -p chess-core --test play || return 1
        fi
        run_step 'Play render and touch tests' cargo test --locked -p chess-render --test play || return 1
        run_step 'Play HTTP and runtime tests' cargo test --locked -p kindle-app --test play_http --test play_runtime || return 1
        if [[ "$mode" == full ]]; then
            # Pinned build calls scripts/check.sh itself. Do not run it twice.
            local apps=(play)
            if [[ "$task" == FKP-04 ]]; then apps=(play puzzles review); fi
            local app
            for app in "${apps[@]}"; do
                run_step "Pinned $app build (includes scripts/check.sh)" sh scripts/app.sh build "$app" || return 1
                run_step "Stage $app package" sh scripts/app.sh stage "$app" || return 1
                run_step "Verify $app artifacts" python3 tools/verify_app_artifacts.py --app "$app" || return 1
            done
        fi
    fi
    echo "Verification passed for $task ($mode). Human/device acceptance is still required."
}

start_codex() {
    local kind="$1"
    local prompt="$2"
    local bin="${CODEX_BIN:-codex}"
    local model="${CODEX_MODEL:-gpt-6.1-sol}"
    local effort="${CODEX_REASONING:-medium}"
    if ! command -v "$bin" >/dev/null 2>&1; then
        echo "Codex CLI '$bin' is missing. Install/login first (codex login)." >&2
        return 1
    fi
    local args=(exec -m "$model" -c "model_reasoning_effort=\"$effort\"" \
        --sandbox workspace-write --json --output-last-message "$LOG_DIR/codex-summary.txt")
    if [[ "$kind" == fix && -s "$log_base/session-${task}" ]]; then
        args+=(resume "$(cat "$log_base/session-${task}")")
        echo 'Resuming saved Codex thread to reuse context.'
    fi
    echo "Codex: $model ($effort), workspace-write; task $task. Events: $LOG_DIR/codex.jsonl"
    if printf '%s\n' "$prompt" | "$bin" "${args[@]}" - > "$LOG_DIR/codex.jsonl" 2> "$LOG_DIR/codex.stderr"; then
        local session
        session="$(sed -n 's/.*"type":"thread.started","thread_id":"\([^"]*\)".*/\1/p' "$LOG_DIR/codex.jsonl" | head -n 1)"
        if [[ -n "$session" ]]; then printf '%s\n' "$session" > "$log_base/session-${task}"; fi
        [[ ! -s "$LOG_DIR/codex-summary.txt" ]] || cat "$LOG_DIR/codex-summary.txt"
    else
        echo 'Codex failed; stderr tail:' >&2
        tail -n 35 "$LOG_DIR/codex.stderr" >&2
        return 1
    fi
}

# Desktop-only unattended handoff. No task is accepted without owner evidence.
desktop_row_status() {
    local line
    line="$(grep -E "^\\|[[:space:]]*[1-4][[:space:]]*\\|[[:space:]]*$1[[:space:]]" "$PLAN" || true)"
    [[ -n "$line" ]] || return 1
    printf '%s\n' "$line" | awk -F '|' '{s=$5; gsub(/\*/, "", s); sub(/^[[:space:]]+/, "", s); sub(/[[:space:]]+$/, "", s); print s}'
}

desktop_switch_task() {
    local branch="codex/$(printf '%s' "$task" | tr '[:upper:]' '[:lower:]')"
    if [[ "$(git branch --show-current)" != "$branch" ]]; then
        if [[ -n "$(git status --porcelain)" ]]; then
            echo "Uncommitted changes on another branch; cannot switch to $branch." >&2
            return 1
        fi
        if git show-ref --verify --quiet "refs/heads/$branch"; then
            git switch "$branch"
        else
            # New tasks always fork from the just-accepted master, never an old task.
            [[ "$(git branch --show-current)" == master ]] || {
                echo "Switch to master before creating $branch." >&2; return 1;
            }
            git switch -c "$branch"
        fi
    fi
}

desktop_latest_dir() {
    [[ -s "$log_base/latest-${task}" ]] || return 1
    local candidate
    candidate="$(cat "$log_base/latest-${task}")"
    [[ -d "$candidate" ]] || return 1
    printf '%s\n' "$candidate"
}

desktop_previous_full_pass() {
    local previous
    previous="$(desktop_latest_dir)" || return 1
    [[ -s "$previous/verify.log" && ! -e "$previous/verify.failed" ]] || return 1
    if [[ -f "$previous/verify.passed" ]]; then
        grep -qx full "$previous/verify.passed" || return 1
    else
        # Compatibility with the original runner's logs (it wrote no success marker).
        for step in 'Complete Node + archive suite' 'Typecheck and production bundle' 'Electron desktop smoke suite (graphical session)'; do
            grep -Fq ">>> $step" "$previous/verify.log" || return 1
        done
        grep -Fq '>>> Focused Kindle HTTP/game/lifecycle/Maia tests' "$previous/verify.log" || return 1
    fi
    # If source changed after that check, rerun the host tests; changing only
    # this runner/plan doesn't invalidate the application build.
    node - "$previous/verify.log" "$PLAN" <<'NODE'
const fs = require('node:fs');
const cp = require('node:child_process');
const path = require('node:path');
const [log, plan] = process.argv.slice(2);
const checkedAt = fs.statSync(log).mtimeMs;
const tracked = cp.execFileSync('git', ['diff', '--name-only', '-z', 'HEAD']);
const untracked = cp.execFileSync('git', ['ls-files', '--others', '--exclude-standard', '-z']);
const names = Buffer.concat([tracked, untracked]).toString().split('\0').filter(Boolean);
for (const name of names) {
  if (name === plan || name === 'scripts/codex-play.sh') continue;
  try {
    if (fs.statSync(path.resolve(name)).mtimeMs > checkedAt + 1000) process.exit(1);
  } catch (e) { if (e.code !== 'ENOENT') throw e; else process.exit(1); }
}
NODE
}

desktop_edit_tracker() {
    # Operates on the two canonical status locations; no regular-expression
    # rewrite of the task's technical checklist is permitted.
    local action="$1" evidence="$2"
    node - "$PLAN" "$task" "$action" "$evidence" <<'NODE'
const fs = require('node:fs');
const [file, task, action, input] = process.argv.slice(2);
const lines = fs.readFileSync(file, 'utf8').split('\n');
const num = Number(task.slice(-2));
const rowIndex = lines.findIndex(x => new RegExp(`^\\|\\s*${num}\\s*\\|\\s*${task}\\s*—`).test(x));
const header = lines.findIndex(x => x.startsWith(`### ${task} —`));
if (rowIndex < 0 || header < 0) throw Error(`Missing tracker task ${task}`);
const detailIndex = lines.findIndex((x,i) => i > header && /^\*\*Status: /.test(x));
if (detailIndex < 0) throw Error('Missing detailed task status');
const current = lines[rowIndex].split('|')[4].replace(/\*/g, '').trim();
function setStatus(index, status) {
  const cells = lines[index].split('|');
  cells[4] = ` **${status}** `;
  lines[index] = cells.join('|');
  const taskName = cells[2].trim().split(' ')[0];
  const h = lines.findIndex(x => x.startsWith(`### ${taskName} —`));
  const d = lines.findIndex((x,i) => i > h && /^\*\*Status: /.test(x));
  if (h < 0 || d < 0) throw Error(`Missing detailed status for ${taskName}`);
  lines[d] = lines[d].replace(/^\*\*Status: .*?\*\*/, `**Status: ${status}.**`);
}
function appendEvidence(body) {
  let end = lines.findIndex((x,i) => i > header && /^### /.test(x));
  if (end < 0) end = lines.findIndex((x,i) => i > header && /^## /.test(x));
  if (end < 0) end = lines.length;
  lines.splice(end, 0, body, '');
}
if (action === 'wait') {
  if (!['Ready','In progress','Waiting for human'].includes(current)) throw Error(`Cannot checkpoint ${current}`);
  if (current !== 'Waiting for human') {
    setStatus(rowIndex, 'Waiting for human');
    appendEvidence(`**Automation evidence (${new Date().toISOString()}):** Complete focused tests, Node/archive suite, production build, and graphical Electron smoke passed. The owner must still perform the BKP human checks; no human acceptance is claimed. Local logs: git metadata/codex-play-runs.`);
  }
} else if (action === 'accept') {
  if (current !== 'Waiting for human') throw Error(`Human checkpoint required; currently ${current}`);
  const evidence = input.replace(/[\r\n]+/g,' ').trim();
  if (evidence.length < 12) throw Error('Provide at least 12 characters of genuine manual observation.');
  setStatus(rowIndex, 'Done');
  appendEvidence(`**Human acceptance (${new Date().toISOString()}):** Owner explicitly approved ${task} after manual checks. Observations: ${evidence}`);
  if (num < 4) {
    const next = `BKP-${String(num+1).padStart(2,'0')}`;
    const idx = lines.findIndex(x => new RegExp(`^\\|\\s*${num+1}\\s*\\|\\s*${next}\\s*—`).test(x));
    if (idx < 0) throw Error(`Missing next task ${next}`);
    const nextStatus = lines[idx].split('|')[4].replace(/\*/g,'').trim();
    if (!nextStatus.startsWith('Blocked')) throw Error(`Expected ${next} blocked, got ${nextStatus}`);
    setStatus(idx, 'Ready');
  }
} else throw Error('Unknown tracker transition');
fs.writeFileSync(file, lines.join('\n'));
NODE
}

desktop_stage_and_push() {
    local message="$1" branch
    branch="$(git branch --show-current)"
    [[ "$branch" == "codex/$(printf '%s' "$task" | tr '[:upper:]' '[:lower:]')" ]] || {
        echo 'Refusing to commit changes from another branch.' >&2; return 1;
    }
    git diff --check
    git add -A
    git diff --cached --check
    # Never let unexpected secrets or local model/database assets enter Git.
    if git diff --cached --name-only | grep -Ei '(^|/)(\.env($|\.)|\.local-engines|\.ssh|auth\.json)|\.(sqlite3?|db|pt|pth|onnx|nnue|pem|key)$'; then
        echo 'Potential local secret or private runtime data staged. Review manually; nothing pushed.' >&2
        git reset -q
        return 1
    fi
    if ! git diff --cached --quiet; then git commit -m "$message"; fi
    git push -u origin "$branch"
}

desktop_stop_at_human() {
    local here
    here="$(desktop_latest_dir 2>/dev/null || true)"
    echo
    echo "STOP: $task is waiting for the owner's manual verification."
    echo "Implementation and tracker checkpoint are committed and pushed to $(git branch --show-current)."
    echo "Human checklist from $PLAN:"
    node - "$PLAN" "$task" <<'NODE'
const fs=require('node:fs');
const [file,task]=process.argv.slice(2);
const text=fs.readFileSync(file,'utf8');
const start=text.indexOf(`### ${task} —`);
const end=start<0?-1:text.indexOf('### ',start+5);
const section=text.slice(start,end<0?undefined:end);
const line=section.split('\n').find(x=>x.includes('**Human verification (last step):**'));
const tag='**Human verification (last step):**';
console.log(line ? line.slice(line.indexOf(tag)+tag.length).trim() : `See section ${task}`);
NODE
    [[ -z "$here" ]] || echo "Check log: $here/verify.log"
    echo 'After completing the checks yourself, report your actual observations:'
    echo "  bash scripts/codex-play.sh accept $task 'I verified ...'"
    echo 'The acceptance command will merge/push master, then start the next Ready task.'
}

desktop_ensure_checkpoint() {
    if ! desktop_previous_full_pass; then
        echo 'No trustworthy full verification evidence for this source state; refusing checkpoint/push.' >&2
        return 1
    fi
    if [[ "$(desktop_row_status "$task")" != 'Waiting for human' ]]; then
        desktop_edit_tracker wait ''
    fi
    desktop_stage_and_push "feat(kindle-play): ${task} implementation (awaiting human verification)"
    desktop_stop_at_human
}

desktop_automate() {
    local mode=full skip_desktop=0
    case "${3:-}" in
        '') ;;
        --quick) mode=quick ;;
        --no-desktop) skip_desktop=1 ;;
        *) echo 'Expected --quick or --no-desktop.' >&2; return 2 ;;
    esac
    [[ "$#" -le 3 ]] || { echo 'Too many arguments.' >&2; return 2; }
    # Do not create branches for tasks blocked in the current tracker.
    local current
    current="$(desktop_row_status "$task")"
    if [[ "$current" == Blocked* ]]; then
        echo "$task remains blocked until the previous task is human-accepted." >&2
        return 2
    fi
    desktop_switch_task
    current="$(desktop_row_status "$task")"
    case "$current" in
        'Waiting for human')
            desktop_ensure_checkpoint; return 0 ;;
        Done)
            echo "$task was already approved. Use accept $task to finish any interrupted merge." >&2
            return 2 ;;
        Ready|'In progress') ;;
        *) echo "$task is $current; cannot bypass required acceptance." >&2; return 2 ;;
    esac
    if [[ "$mode" == full && "$skip_desktop" == 0 ]] && desktop_previous_full_pass; then
        echo "Reusing existing full green log for $task; no Codex or repeat build needed."
        desktop_ensure_checkpoint
        return 0
    fi
    local attempt previous excerpt success=0 needs_fix=0
    if previous="$(desktop_latest_dir 2>/dev/null)" && [[ -f "$previous/verify.failed" ]]; then
        needs_fix=1
    fi
    for attempt in 1 2 3; do
        if [[ "$attempt" == 1 && "$needs_fix" == 0 ]] && \
           { [[ -n "$(git status --porcelain)" ]] || ! git merge-base --is-ancestor "$(git rev-parse HEAD)" master; }; then
            echo 'Existing task changes found; verifying without calling Codex.'
            new_log
        elif [[ "$attempt" == 1 && "$needs_fix" == 0 ]]; then
            new_log
            start_codex run "Task $task only. Follow $PLAN and reuse-first rules. Work test-first, make the smallest complete change, and run focused tests only. The wrapper runs full verification and handles git. Do not commit/push, approve human checks, or start another task."
        else
            previous="$(desktop_latest_dir)" || { echo 'No failure log for repair.' >&2; return 1; }
            excerpt="$(tail -n 90 "$previous/verify.log" | tail -c 12000)"
            new_log
            start_codex fix "Fix only $task, using existing implementation. Address the following failing verification excerpt; run only the focused failing test, not the whole build or suite. Do not commit/push or accept a human checkpoint:\n$excerpt"
        fi
        if verify_task "$mode" "$skip_desktop"; then
            success=1
            if [[ "$mode" == full && "$skip_desktop" == 0 ]]; then
                printf 'full\n' > "$LOG_DIR/verify.passed"
            fi
            break
        fi
        echo "Verification failed; attempting focused repair ($attempt of 3)." >&2
    done
    if [[ "$success" != 1 ]]; then
        echo 'Stopping after three attempts. Inspect the latest local log before spending more model tokens.' >&2
        return 1
    fi
    if [[ "$mode" != full || "$skip_desktop" != 0 ]]; then
        echo 'Quick/no-desktop verification is not sufficient for a human checkpoint. Run auto again for full verification.'
        return 0
    fi
    desktop_ensure_checkpoint
}

desktop_accept() {
    [[ "$#" -eq 3 ]] || { echo 'Usage: scripts/codex-play.sh accept BKP-01 "manual observations"' >&2; return 2; }
    local evidence="$3" current
    desktop_switch_task
    current="$(desktop_row_status "$task")"
    if [[ "$current" == 'Waiting for human' ]]; then
        desktop_edit_tracker accept "$evidence"
        desktop_stage_and_push "docs(kindle-play): accept ${task} after human verification"
    elif [[ "$current" != Done ]]; then
        echo "Cannot accept ${task}: status is ${current}; full verification and human checkpoint required." >&2
        return 2
    fi
    # From here on this is a resumable release step: the checkpoint already
    # recorded explicit owner approval. Never force-push or overwrite master.
    [[ -z "$(git status --porcelain)" ]] || { echo 'Task branch has uncommitted changes; stopping.' >&2; return 2; }
    git fetch origin master
    git switch master
    git pull --ff-only origin master
    if [[ "$(desktop_row_status "$task")" != Done ]]; then
        git merge --no-ff --no-edit "codex/$(printf '%s' "$task" | tr '[:upper:]' '[:lower:]')"
    fi
    [[ "$(desktop_row_status "$task")" == Done ]] || { echo 'Merge did not mark task Done.' >&2; return 2; }
    # Verify the integrated master as well: another contributor may have changed
    # code since this task was tested. Never push an unverified merge.
    new_log
    if ! verify_task full 0; then
        echo 'Merged master failed verification. No master push was made; inspect and repair locally.' >&2
        return 1
    fi
    printf 'full\n' > "$LOG_DIR/verify.passed"
    git push origin master
    echo "Published accepted $task to master. Continuing with the next Ready task."
    exec bash "$ROOT/scripts/codex-play.sh" auto
}

if [[ "$command" == auto || "$command" == accept ]]; then
    if [[ "$PROJECT" != desktop ]]; then echo 'This automation is desktop-only.' >&2; exit 2; fi
    if [[ "$command" == accept ]]; then
        desktop_accept "$@"
        exit $?
    fi
    desktop_automate "$@"
    exit $?
fi

if [[ "$command" == deploy ]]; then
    if [[ "$PROJECT" != kindle || "$#" -gt 4 || -z "${3:-}" ]]; then usage >&2; exit 2; fi
    host="$3"
    port="${4:-2222}"
    if [[ ! "$port" =~ ^[0-9]+$ ]] || ((port < 1 || port > 65535)); then
        echo 'SSH port must be 1..65535' >&2; exit 2
    fi
    new_log
    echo "Explicit owner-triggered deployment to $host:$port. This is not human acceptance."
    run_step 'Check Play artifacts match local source' python3 tools/verify_app_artifacts.py --app play
    run_step 'Deploy Play using existing verified transport' sh scripts/app.sh deploy play --host "$host" --port "$port"
    echo 'Deployment command finished. Human must inspect the actual Scribe and record device evidence.'
    exit 0
fi

mode=full
skip_desktop=0
case "${3:-}" in
    '') ;;
    --quick) mode=quick ;;
    --no-desktop)
        if [[ "$PROJECT" != desktop ]]; then echo '--no-desktop only applies to desktop.' >&2; exit 2; fi
        skip_desktop=1 ;;
    *) usage >&2; exit 2 ;;
esac
if [[ "$#" -gt 3 ]]; then usage >&2; exit 2; fi

if [[ "$command" == run ]]; then
    target_branch="codex/$(printf '%s' "$task" | tr '[:upper:]' '[:lower:]')"
    current_branch="$(git branch --show-current)"
    if [[ "$current_branch" != "$target_branch" ]]; then
        if [[ -n "$(git status --porcelain)" ]]; then
            echo "Worktree is not clean; commit/stash before switching to $target_branch." >&2
            exit 2
        fi
        if git show-ref --verify --quiet "refs/heads/$target_branch"; then
            git switch "$target_branch"
        else
            git switch -c "$target_branch"
        fi
    fi
fi

if [[ "$command" == fix ]]; then
    expected_branch="codex/$(printf '%s' "$task" | tr '[:upper:]' '[:lower:]')"
    if [[ "$(git branch --show-current)" != "$expected_branch" ]]; then
        echo "Switch to $expected_branch before repairing $task." >&2; exit 2
    fi
    if [[ ! -f "$log_base/latest-${task}" ]]; then
        echo "No previous verification log for $task. Run verify first." >&2; exit 2
    fi
    previous="$(cat "$log_base/latest-${task}")/verify.log"
    if [[ ! -s "$previous" || ! -f "${previous%.log}.failed" ]]; then
        echo "No failing verification log for $task. Run verify first." >&2; exit 2
    fi
    excerpt="$(tail -n 90 "$previous" | tail -c 12000)"
fi
new_log
case "$command" in
    run)
        start_codex run "Task $task only. Follow $PLAN (reuse-first rule and this task's section) and project AGENTS.md if present. Inspect only relevant implementation files/tests. Work test-first; implement the smallest safe change, run only focused tests. Do NOT run full suites, pinned builds, desktop smoke or deployment: this wrapper performs those without model tokens. Update the task tracker to In progress; do not claim automated or human verification before this wrapper has run. Do not commit, merge or push. Briefly report changed files and focused test results."
        verify_task "$mode" "$skip_desktop" ;;
    fix)
        start_codex fix "Fix ONLY $task's verification failure on the current branch. Follow $PLAN; make the smallest change, run only the failing focused test, do not rerun full suites/build/deploy, commit or push. Verification log tail (up to 12 KB):
$excerpt"
        verify_task "$mode" "$skip_desktop" ;;
    verify)
        verify_task "$mode" "$skip_desktop" ;;
esac
cat <<EOF

Next: inspect 'git diff' and the verification log; record checks/status in $PLAN.
Then perform the plan's **human verification as the final step**. Never mark Done
until the owner explicitly accepts. No commits/merges/pushes were performed.
EOF