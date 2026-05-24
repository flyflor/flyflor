#!/usr/bin/env sh
# Install the LSP/background/utility external sidecar manifest.

set -eu

FLYFLOR_HOME="${FLYFLOR_HOME:-$HOME/.flyflor}"
TARGET="${FLYFLOR_XTOOLS_TARGET:-$FLYFLOR_HOME/.config/tools}"
SOURCE_ROOT="${FLYFLOR_SOURCE_ROOT:-$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)}"

mkdir -p "$TARGET"

cat > "$TARGET/external.tools.jsonc" <<EOF
{
    "schemaVersion": 1,
    "sidecars": {
        "utility.local": {
            "command": "bun",
            "args": ["$SOURCE_ROOT/scripts/utility.sidecar.ts"],
            "cwd": "project",
            "config": {
                "lspCommand": "",
                "lspArgs": [],
                "taskCommand": "",
                "taskArgs": []
            },
            "timeoutMs": 30000,
            "maxOutputBytes": 262144,
            "tools": [
                "lsp.symbols",
                "lsp.diagnostics",
                "task.background",
                "file.hash",
                "archive.create",
                "archive.extract",
                "data.convert"
            ]
        }
    }
}
EOF

echo "flyflor-xtools: wrote utility external tool manifest to $TARGET"
echo "flyflor-xtools: configure lspCommand/taskCommand delegates before LSP or background task calls"
