#!/usr/bin/env sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
BASE_DIR=$(dirname "$ROOT_DIR")
SESSION_NAME="flyflor-kernel"
ATTACH="0"
LAUNCH_CODEX="0"

while [ "$#" -gt 0 ]; do
    case "$1" in
        --attach)
            ATTACH="1"
            ;;
        --launch-codex)
            LAUNCH_CODEX="1"
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

launch_codex_window() {
    target="$1"
    path="$2"
    prompt="$3"
    escaped_prompt=$(printf "%s" "$prompt" | tr "\n" " ")
    tmux send-keys -t "$target" "clear" C-m
    tmux send-keys -t "$target" "codex --dangerously-bypass-approvals-and-sandbox --cd '$path' \"$escaped_prompt\"" C-m
}

CONTEXT_BRANCH="wt/kernel-context-memory"
CONTEXT_PATH="$BASE_DIR/flyflor-wt-kernel-context-memory"
SCOPE_BRANCH="wt/kernel-scope-crystal-ask"
SCOPE_PATH="$BASE_DIR/flyflor-wt-kernel-scope-crystal-ask"
RUNTIME_BRANCH="wt/kernel-runtime-executive-ws"
RUNTIME_PATH="$BASE_DIR/flyflor-wt-kernel-runtime-executive-ws"

ensure_worktree "$CONTEXT_BRANCH" "$CONTEXT_PATH"
ensure_worktree "$SCOPE_BRANCH" "$SCOPE_PATH"
ensure_worktree "$RUNTIME_BRANCH" "$RUNTIME_PATH"

if ! tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
    tmux new-session -d -s "$SESSION_NAME" -n main -c "$ROOT_DIR"
    tmux new-window -d -t "$SESSION_NAME" -n context -c "$CONTEXT_PATH"
    tmux new-window -d -t "$SESSION_NAME" -n scope -c "$SCOPE_PATH"
    tmux new-window -d -t "$SESSION_NAME" -n runtime -c "$RUNTIME_PATH"
    tmux send-keys -t "$SESSION_NAME:main" "printf '%s\n' 'Coordinator branch: main-codex-docs'" C-m
    tmux send-keys -t "$SESSION_NAME:context" "printf '%s\n' 'Owner branch: wt/kernel-context-memory'" C-m
    tmux send-keys -t "$SESSION_NAME:scope" "printf '%s\n' 'Owner branch: wt/kernel-scope-crystal-ask'" C-m
    tmux send-keys -t "$SESSION_NAME:runtime" "printf '%s\n' 'Owner branch: wt/kernel-runtime-executive-ws'" C-m
fi

if [ "$LAUNCH_CODEX" = "1" ]; then
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

echo "tmux session ready: $SESSION_NAME"
echo "main    -> $ROOT_DIR"
echo "context -> $CONTEXT_PATH"
echo "scope   -> $SCOPE_PATH"
echo "runtime -> $RUNTIME_PATH"
echo "attach  -> tmux attach -t $SESSION_NAME"

if [ "$ATTACH" = "1" ]; then
    exec tmux attach -t "$SESSION_NAME"
fi
