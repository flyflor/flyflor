#!/usr/bin/env sh
# Install the minimal media external sidecar manifest.
#
# This script does not install OCR, Whisper, TTS, provider SDKs, native addons,
# or model assets. It only registers a process-json sidecar that delegates at
# runtime to a configured HTTP JSON provider or local process-json command map.

set -eu

FLYFLOR_HOME="${FLYFLOR_HOME:-$HOME/.flyflor}"
TARGET="${FLYFLOR_XTOOLS_TARGET:-$FLYFLOR_HOME/.config/tools}"
SOURCE_ROOT="${FLYFLOR_SOURCE_ROOT:-$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)}"

mkdir -p "$TARGET"

cat > "$TARGET/external.tools.jsonc" <<EOF
{
    "schemaVersion": 1,
    "sidecars": {
        "media.local": {
            "command": "bun",
            "args": ["$SOURCE_ROOT/scripts/media.sidecar.ts"],
            "cwd": "project",
            "config": {
                "providerUrl": "",
                "providerHeaders": {},
                "localCommands": {}
            },
            "timeoutMs": 30000,
            "maxOutputBytes": 262144,
            "tools": [
                "vision.analyze",
                "vision.ocr",
                "audio.transcribe",
                "audio.speak"
            ]
        }
    }
}
EOF

echo "flyflor-xtools: wrote media external tool manifest to $TARGET"
echo "flyflor-xtools: configure sidecars.media.local.config.providerUrl or config.localCommands before real media calls"
