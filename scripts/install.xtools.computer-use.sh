#!/usr/bin/env sh
# Install the high-level computer.use external sidecar manifest.
#
# This script registers only a process-json bridge. Real desktop control is
# provided by a configured delegate or by a macOS cua-driver installation.

set -eu

FLYFLOR_HOME="${FLYFLOR_HOME:-$HOME/.flyflor}"
TARGET="${FLYFLOR_XTOOLS_TARGET:-$FLYFLOR_HOME/.config/tools}"
SOURCE_ROOT="${FLYFLOR_SOURCE_ROOT:-$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)}"

mkdir -p "$TARGET"

cat > "$TARGET/external.tools.jsonc" <<EOF
{
    "schemaVersion": 1,
    "sidecars": {
        "computer.use": {
            "command": "bun",
            "args": ["$SOURCE_ROOT/scripts/computer.use.sidecar.ts"],
            "cwd": "project",
            "config": {
                "backend": "delegate",
                "delegateCommand": "",
                "delegateArgs": [],
                "cuaCommand": "cua-driver",
                "cuaArgs": []
            },
            "timeoutMs": 20000,
            "maxOutputBytes": 524288,
            "tools": [
                "computer.use"
            ]
        }
    }
}
EOF

echo "flyflor-xtools: wrote high-level computer.use external tool manifest to $TARGET"
echo "flyflor-xtools: configure sidecars.computer.use.config.delegateCommand or backend=cua before control calls"
