#!/bin/sh

set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
LOG_DIR="$ROOT_DIR/.config/logs"
RUN_DIR="$LOG_DIR/gateway.dev"
CURRENT_LOG="$RUN_DIR/current.log"
SESSION_LOG="$RUN_DIR/session.$(date '+%Y%m%d-%H%M%S').log"

mkdir -p "$RUN_DIR"

# Keep only recent session logs so old failures do not pollute current review.
find "$RUN_DIR" -type f -name 'session.*.log' | sort | head -n -20 | while read -r old; do
    rm -f "$old"
done

rm -f "$CURRENT_LOG"
touch "$CURRENT_LOG"

echo "[gateway.dev.sh] repo: $ROOT_DIR"
echo "[gateway.dev.sh] current log: $CURRENT_LOG"
echo "[gateway.dev.sh] session log: $SESSION_LOG"
echo "[gateway.dev.sh] old session logs pruned; current log reset"

cd "$ROOT_DIR"

bun run gateway:dev 2>&1 | tee "$CURRENT_LOG" | tee "$SESSION_LOG"
