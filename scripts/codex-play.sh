#!/usr/bin/env bash
# Run one Kindle-vs-Maia backlog task with Codex, then verify using host scripts.
# Same entry point is intentionally installed in both repositories.
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
No command accepts human verification, merges or pushes changes.
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
    run|verify|fix|deploy) ;;
    *) usage >&2; exit 2 ;;
esac

task="${2:-}"
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
            tests/kindle-play-lifecycle.test.mjs tests/kindle-play-maia.test.mjs
        if [[ "$task" == BKP-04 ]]; then
            run_step 'Focused personal studies tests' node --test \
                tests/personal-studies-interop.test.mjs tests/personal-studies-edits.test.mjs \
                tests/personal-studies-pgn.test.mjs
        fi
        if [[ "$mode" == full ]]; then
            run_step 'Complete Node + archive suite' "$npm_bin" test
            run_step 'Typecheck and production bundle' "$npm_bin" run build
            if [[ "$skip_desktop" == 0 ]]; then
                run_step 'Electron desktop smoke suite (graphical session)' "$npm_bin" run test:desktop
            else
                echo 'SKIPPED: Electron smoke (--no-desktop); not a complete acceptance pass.' | tee -a "$LOG_DIR/verify.log"
            fi
        fi
    else
        if [[ "$task" != FKP-01 ]]; then
            run_step 'Play core state tests' cargo test --locked -p chess-core --test play
        fi
        run_step 'Play render and touch tests' cargo test --locked -p chess-render --test play
        run_step 'Play HTTP and runtime tests' cargo test --locked -p kindle-app --test play_http --test play_runtime
        if [[ "$mode" == full ]]; then
            # Pinned build calls scripts/check.sh itself. Do not run it twice.
            local apps=(play)
            if [[ "$task" == FKP-04 ]]; then apps=(play puzzles review); fi
            local app
            for app in "${apps[@]}"; do
                run_step "Pinned $app build (includes scripts/check.sh)" sh scripts/app.sh build "$app"
                run_step "Stage $app package" sh scripts/app.sh stage "$app"
                run_step "Verify $app artifacts" python3 tools/verify_app_artifacts.py --app "$app"
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