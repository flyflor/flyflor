#!/usr/bin/env sh

set -eu

FLYFLOR_HOME="${FLYFLOR_HOME:-$HOME/.flyflor}"
TARGET="${FLYFLOR_XTOOLS_TARGET:-$FLYFLOR_HOME/.config/tools}"
SOURCE_ROOT="${FLYFLOR_SOURCE_ROOT:-$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)}"

mkdir -p "$TARGET"

cat > "$TARGET/external.tools.jsonc" <<EOF
{
    "schemaVersion": 1,
    "sidecars": {
        "web.search": {
            "command": "bun",
            "args": ["$SOURCE_ROOT/scripts/web.search.sidecar.ts"],
            "cwd": "project",
            "timeoutMs": 10000,
            "maxOutputBytes": 65536,
            "tools": ["web.search", "web.fetch", "web.extract", "web.download"],
            "config": {
                "cacheTtlMs": 600000,
                "providers": []
            }
        }
    }
}
EOF

echo "flyflor-xtools: wrote search/web external tool manifest to $TARGET"
