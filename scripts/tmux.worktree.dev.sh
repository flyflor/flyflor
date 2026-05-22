#!/usr/bin/env sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
BASE_DIR=$(dirname "$ROOT_DIR")
SESSION_NAME="flyflor-kernel"
ATTACH="0"
LAUNCH_CODEX="0"
WAVE="kernel"

while [ "$#" -gt 0 ]; do
    case "$1" in
        --attach)
            ATTACH="1"
            ;;
        --launch-codex)
            LAUNCH_CODEX="1"
            ;;
        --wave2)
            WAVE="wave2"
            if [ "$SESSION_NAME" = "flyflor-kernel" ]; then
                SESSION_NAME="flyflor-wave2"
            fi
            ;;
        --wave3)
            WAVE="wave3"
            if [ "$SESSION_NAME" = "flyflor-kernel" ]; then
                SESSION_NAME="flyflor-wave3"
            fi
            ;;
        --session=*)
            SESSION_NAME=${1#--session=}
            ;;
        *)
            echo "Unknown option: $1" >&2
            exit 1
            ;;
    esac
    shift
done

ensure_branch() {
    branch="$1"
    if git -C "$ROOT_DIR" show-ref --verify --quiet "refs/heads/$branch"; then
        return 0
    fi
    if git -C "$ROOT_DIR" show-ref --verify --quiet "refs/remotes/origin/$branch"; then
        git -C "$ROOT_DIR" branch "$branch" "origin/$branch" >/dev/null
        return 0
    fi
    echo "Missing branch: $branch" >&2
    exit 1
}

ensure_worktree() {
    branch="$1"
    path="$2"
    ensure_branch "$branch"
    if [ -e "$path/.git" ]; then
        return 0
    fi
    git -C "$ROOT_DIR" worktree add "$path" "$branch" >/dev/null
}

ensure_shared_node_modules() {
    path="$1"
    if [ -e "$ROOT_DIR/node_modules" ] && [ ! -e "$path/node_modules" ]; then
        ln -s "$ROOT_DIR/node_modules" "$path/node_modules"
    fi
}

launch_codex_window() {
    target="$1"
    path="$2"
    prompt="$3"
    escaped_prompt=$(printf "%s" "$prompt" | tr "\n" " ")
    tmux send-keys -t "$target" "clear" C-m
    tmux send-keys -t "$target" "codex --dangerously-bypass-approvals-and-sandbox --cd '$path' \"$escaped_prompt\"" C-m
}

if [ "$WAVE" = "wave2" ]; then
    CONTEXT_BRANCH="wt/wave2-memory-seal"
    CONTEXT_PATH="$BASE_DIR/flyflor-wt-wave2-memory-seal"
    SCOPE_BRANCH="wt/wave2-scope-crystal"
    SCOPE_PATH="$BASE_DIR/flyflor-wt-wave2-scope-crystal"
    RUNTIME_BRANCH="wt/wave2-runtime-executive"
    RUNTIME_PATH="$BASE_DIR/flyflor-wt-wave2-runtime-executive"
elif [ "$WAVE" = "wave3" ]; then
    CONTEXT_BRANCH="wt/wave3-memory-lifecycle"
    CONTEXT_PATH="$BASE_DIR/flyflor-wt-wave3-memory-lifecycle"
    SCOPE_BRANCH="wt/wave3-scope-constitution"
    SCOPE_PATH="$BASE_DIR/flyflor-wt-wave3-scope-constitution"
    RUNTIME_BRANCH="wt/wave3-runtime-capability"
    RUNTIME_PATH="$BASE_DIR/flyflor-wt-wave3-runtime-capability"
else
    CONTEXT_BRANCH="wt/kernel-context-memory"
    CONTEXT_PATH="$BASE_DIR/flyflor-wt-kernel-context-memory"
    SCOPE_BRANCH="wt/kernel-scope-crystal-ask"
    SCOPE_PATH="$BASE_DIR/flyflor-wt-kernel-scope-crystal-ask"
    RUNTIME_BRANCH="wt/kernel-runtime-executive-ws"
    RUNTIME_PATH="$BASE_DIR/flyflor-wt-kernel-runtime-executive-ws"
fi

ensure_worktree "$CONTEXT_BRANCH" "$CONTEXT_PATH"
ensure_worktree "$SCOPE_BRANCH" "$SCOPE_PATH"
ensure_worktree "$RUNTIME_BRANCH" "$RUNTIME_PATH"
ensure_shared_node_modules "$CONTEXT_PATH"
ensure_shared_node_modules "$SCOPE_PATH"
ensure_shared_node_modules "$RUNTIME_PATH"

if ! tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
    tmux new-session -d -s "$SESSION_NAME" -n main -c "$ROOT_DIR"
    tmux new-window -d -t "$SESSION_NAME" -n context -c "$CONTEXT_PATH"
    tmux new-window -d -t "$SESSION_NAME" -n scope -c "$SCOPE_PATH"
    tmux new-window -d -t "$SESSION_NAME" -n runtime -c "$RUNTIME_PATH"
    tmux send-keys -t "$SESSION_NAME:main" "printf '%s\n' 'Coordinator branch: main-codex-docs'" C-m
    tmux send-keys -t "$SESSION_NAME:context" "printf '%s\n' 'Owner branch: $CONTEXT_BRANCH'" C-m
    tmux send-keys -t "$SESSION_NAME:scope" "printf '%s\n' 'Owner branch: $SCOPE_BRANCH'" C-m
    tmux send-keys -t "$SESSION_NAME:runtime" "printf '%s\n' 'Owner branch: $RUNTIME_BRANCH'" C-m
fi

if [ "$LAUNCH_CODEX" = "1" ]; then
    if [ "$WAVE" = "wave2" ]; then
        launch_codex_window \
            "$SESSION_NAME:context" \
            "$CONTEXT_PATH" \
            "Read docs/boundaries.md, docs/development.workflow.md, local AGENTS.md, local TODO.md, and local LOGS.md. Own only the wave2 memory seal slice: src/cognitive/hippocampus/memory/**, src/entities/memory/**, src/agent/context/**, related tests and local control files. Close concrete seal gaps around forgetting/decay/vector recall/context assembly with deterministic explicit clocks/resources. Do not change Gateway HTTP surface, DB schema, implicit continuity, or semantic text matching. Keep Bun binary compileability and OOP + composition. Update bilingual local TODO/LOGS, validate focused tests plus check/docs/build as needed, then commit your branch."
        launch_codex_window \
            "$SESSION_NAME:scope" \
            "$SCOPE_PATH" \
            "Read docs/boundaries.md, docs/development.workflow.md, local AGENTS.md, local TODO.md, and local LOGS.md. Own only the wave2 scope-crystal slice: src/cognitive/hippocampus/scope/**, src/cognitive/hippocampus/ask/**, src/cognitive/crystal/**, related tests and local control files. Close ask/codename/scope/gem loop gaps: structured ask closure, codename-to-scope promotion, crystal consolidation evidence, and explicit forgetting without provenance deletion. Respect zero character matching, no fallback scope, and no prompt-container brain.db story. Update bilingual local TODO/LOGS, run focused guards/check as needed, then commit your branch."
        launch_codex_window \
            "$SESSION_NAME:runtime" \
            "$RUNTIME_PATH" \
            "Read docs/boundaries.md, docs/development.workflow.md, local AGENTS.md, local TODO.md, and local LOGS.md. Own only the wave2 runtime executive slice: src/agent/runtime/**, src/agent/gateway/**, src/executive/**, related scripts/tests/docs and local control files. Move from protocol-closed /ws coverage toward end-to-end Executive capability execution under the intended trust/sandbox surface, plus WS loop pause/resume visibility. Keep HTTP Gateway to /ws and /health only. No private client protocol or semantic text matching. Update bilingual local TODO/LOGS, validate focused runtime/gateway/executive tests plus check/docs/build as needed, then commit your branch."
    elif [ "$WAVE" = "wave3" ]; then
        launch_codex_window \
            "$SESSION_NAME:context" \
            "$CONTEXT_PATH" \
            "Read docs/boundaries.md, docs/development.workflow.md, local AGENTS.md, local TODO.md, and local LOGS.md. Own only the wave3 memory lifecycle slice: src/cognitive/hippocampus/memory/**, src/entities/memory/**, src/agent/context/**, scripts/tests that directly validate brain.db ledger/query/replay/audit, decay, hot memory, dream, recall, and archive behavior. Keep brain.db out of prompt assembly semantics; use explicit structure, clocks, resource metrics, and JSON-serializable events. Keep Bun compileability, convention over configuration, OOP + composition, and zero character matching. Update bilingual local TODO/LOGS, validate focused memory tests plus check/docs/build as needed, then commit your branch."
        launch_codex_window \
            "$SESSION_NAME:scope" \
            "$SCOPE_PATH" \
            "Read docs/boundaries.md, docs/development.workflow.md, local AGENTS.md, local TODO.md, and local LOGS.md. Own only the wave3 scope constitution slice: src/cognitive/hippocampus/scope/**, src/cognitive/hippocampus/ask/**, templates/projects/**, scope/codename/crystal-adjacent tests, and local control files. Close the worktree constitution Markdown distribution: scope scaffolds must carry the expected AGENTS/TODO/LOGS/README/project.memory files and bilingual companions without overwriting existing files. Preserve explicit Scope creation, no fallback scope, no codename prompt-container story. Update bilingual local TODO/LOGS, validate focused scope/template/docs tests plus check/docs/build as needed, then commit your branch."
        launch_codex_window \
            "$SESSION_NAME:runtime" \
            "$RUNTIME_PATH" \
            "Read docs/boundaries.md, docs/development.workflow.md, local AGENTS.md, local TODO.md, and local LOGS.md. Own only the wave3 runtime capability slice: src/agent/runtime/**, src/agent/gateway/**, src/executive/**, src/agent/sandbox/**, related scripts/tests/docs and local control files. Move from protocol-closed /ws coverage to end-to-end Executive capability execution under the intended trust/sandbox surface, including observable loop budget and event/history closure. Keep HTTP Gateway to /ws and /health only; do not reintroduce /channels, private client protocol, dynamic require, or semantic text matching. Update bilingual local TODO/LOGS, validate focused runtime/gateway/executive/sandbox tests plus check/docs/build as needed, then commit your branch."
    else
        launch_codex_window \
            "$SESSION_NAME:context" \
            "$CONTEXT_PATH" \
            "Read docs/boundaries.md, docs/development.workflow.md, local AGENTS.md, local TODO.md, and local LOGS.md. Own only the context-memory slice: src/cognitive/hippocampus/memory/**, src/entities/memory/**, src/agent/context/**, related tests and local control files. Close concrete gaps in monthly brain shard handling, forgetting and decay, vector recall, and context assembly. Update local TODO.md and LOGS.md before stopping, then commit your branch."
        launch_codex_window \
            "$SESSION_NAME:scope" \
            "$SCOPE_PATH" \
            "Read docs/boundaries.md, docs/development.workflow.md, local AGENTS.md, local TODO.md, and local LOGS.md. Own only the scope-crystal-ask slice: src/cognitive/hippocampus/scope/**, src/cognitive/hippocampus/ask/**, src/cognitive/crystal/**, related tests and local control files. Close concrete gaps in ask closure, scope promotion, crystal consolidation, forgetting, and recall evidence. Update local TODO.md and LOGS.md before stopping, then commit your branch."
        launch_codex_window \
            "$SESSION_NAME:runtime" \
            "$RUNTIME_PATH" \
            "Read docs/boundaries.md, docs/development.workflow.md, local AGENTS.md, local TODO.md, and local LOGS.md. Own only the runtime-executive-ws slice: src/agent/runtime/**, src/agent/gateway/**, src/executive/**, related scripts/tests/docs and local control files. Close concrete gaps in ws control flow, event and history surfaces, executive loop pause-resume closure, and thin-client protocol coverage. Update local TODO.md and LOGS.md before stopping, then commit your branch."
    fi
fi

echo "tmux session ready: $SESSION_NAME"
echo "main    -> $ROOT_DIR"
echo "context -> $CONTEXT_PATH"
echo "scope   -> $SCOPE_PATH"
echo "runtime -> $RUNTIME_PATH"
echo "attach  -> tmux attach -t $SESSION_NAME"

if [ "$ATTACH" = "1" ]; then
    exec tmux attach -t "$SESSION_NAME"
fi
