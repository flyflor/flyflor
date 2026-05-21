#!/bin/sh

set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
LOG_DIR="$ROOT_DIR/.config/logs"
RUN_DIR="$LOG_DIR/gateway.dev"
CURRENT_LOG="$RUN_DIR/current.log"
RUN_LOG="$RUN_DIR/run.$(date '+%Y%m%d-%H%M%S').log"

mkdir -p "$RUN_DIR"

# Keep only recent run logs so old failures do not pollute current review.
find "$RUN_DIR" -type f -name 'run.*.log' | sort | head -n -20 | while read -r old; do
    rm -f "$old"
done

rm -f "$CURRENT_LOG"
touch "$CURRENT_LOG"

echo "[gateway.dev.sh] repo: $ROOT_DIR"
echo "[gateway.dev.sh] current log: $CURRENT_LOG"
echo "[gateway.dev.sh] run log: $RUN_LOG"
echo "[gateway.dev.sh] old run logs pruned; current log reset"

cd "$ROOT_DIR"

bun run gateway:dev 2>&1 | tee "$CURRENT_LOG" | tee "$RUN_LOG"
