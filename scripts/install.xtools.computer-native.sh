#!/usr/bin/env sh
# Install the native computer-control external sidecar manifest.
#
# This script only registers a process-json bridge. Mouse and keyboard control
# are delegated to explicit local commands configured in external.tools.jsonc.

set -eu

FLYFLOR_HOME="${FLYFLOR_HOME:-$HOME/.flyflor}"
TARGET="${FLYFLOR_XTOOLS_TARGET:-$FLYFLOR_HOME/.config/tools}"
SOURCE_ROOT="${FLYFLOR_SOURCE_ROOT:-$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)}"

mkdir -p "$TARGET"

cat > "$TARGET/external.tools.jsonc" <<EOF
{
    "schemaVersion": 1,
    "sidecars": {
        "computer.native": {
            "command": "bun",
            "args": ["$SOURCE_ROOT/scripts/computer.native.sidecar.ts"],
            "cwd": "project",
            "config": {
                "mouseCommand": "",
                "mouseArgs": [],
                "keyboardCommand": "",
                "keyboardArgs": []
            },
            "timeoutMs": 10000,
            "maxOutputBytes": 65536,
            "tools": [
                "screen.screenshot",
                "computer.mouse",
                "computer.keyboard",
                "computer.window"
            ]
        }
    }
}
EOF

echo "flyflor-xtools: wrote native computer external tool manifest to $TARGET"
echo "flyflor-xtools: configure sidecars.computer.native.config mouse/keyboard delegates before control calls"
