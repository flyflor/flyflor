#!/usr/bin/env sh
# Install the minimal Browser CDP external sidecar manifest.
#
# This script does not install Chrome, Chromium, Playwright or browser
# automation packages. It only registers a process-json sidecar that connects
# to an already-running DevTools Protocol endpoint.

set -eu

FLYFLOR_HOME="${FLYFLOR_HOME:-$HOME/.flyflor}"
TARGET="${FLYFLOR_XTOOLS_TARGET:-$FLYFLOR_HOME/.config/tools}"
SOURCE_ROOT="${FLYFLOR_SOURCE_ROOT:-$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)}"
CDP_URL="${FLYFLOR_BROWSER_CDP_URL:-http://127.0.0.1:9222}"

mkdir -p "$TARGET"

cat > "$TARGET/external.tools.jsonc" <<EOF
{
    "schemaVersion": 1,
    "sidecars": {
        "browser.cdp": {
            "command": "bun",
            "args": ["$SOURCE_ROOT/scripts/browser.cdp.sidecar.ts"],
            "cwd": "project",
            "env": {
                "FLYFLOR_BROWSER_CDP_URL": "$CDP_URL"
            },
            "timeoutMs": 8000,
            "maxOutputBytes": 65536,
            "tools": [
                "browser.open",
                "browser.snapshot",
                "browser.screenshot",
                "browser.click",
                "browser.type",
                "browser.navigate",
                "browser.evaluate"
            ]
        }
    }
}
EOF

echo "flyflor-xtools: wrote Browser CDP external tool manifest to $TARGET"
echo "flyflor-xtools: using DevTools endpoint $CDP_URL"
