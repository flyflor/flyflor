#!/bin/sh

set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"

# Compatibility wrapper. The active dev log owner is scripts/socket.dev.sh.
exec sh "$ROOT_DIR/scripts/socket.dev.sh"
