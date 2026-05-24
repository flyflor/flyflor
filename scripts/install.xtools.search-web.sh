#!/usr/bin/env sh
# Install the project-local external tool package registry.
#
# The real payload lives under tools/packages and the registry lives at
# tools/external.tools.jsonc. This wrapper is kept for package.json compatibility.

set -eu

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
TARGET="${FLYFLOR_XTOOLS_TARGET:-./tools}"
RUNNER="${FLYFLOR_RUNNER:-./dist/flyflor}"
CDP_URL="${FLYFLOR_BROWSER_CDP_URL:-http://127.0.0.1:9222}"

FLYFLOR_XTOOLS_TARGET="$TARGET" \
FLYFLOR_RUNNER="$RUNNER" \
FLYFLOR_BROWSER_CDP_URL="$CDP_URL" \
    sh "$ROOT/tools/init.sh" --real
