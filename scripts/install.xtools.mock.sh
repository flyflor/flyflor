#!/usr/bin/env sh
# Install a descriptor-only mock external tool sidecar manifest.
#
# This script does not install Playwright, OCR, Whisper, TTS, browser runtimes
# or any other heavy dependency. It only writes JSONC discovery files that let
# tests and thin clients exercise the External Kit capability surface.

set -eu

FLYFLOR_HOME="${FLYFLOR_HOME:-$HOME/.flyflor}"
TARGET="${FLYFLOR_XTOOLS_TARGET:-$FLYFLOR_HOME/.config/tools}"
KIT_TARGET="${FLYFLOR_XTOOLS_KIT_TARGET:-$FLYFLOR_HOME/.config/kits}"
SOURCE_ROOT="${FLYFLOR_SOURCE_ROOT:-$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)}"

mkdir -p "$TARGET"
mkdir -p "$KIT_TARGET"

cat > "$TARGET/external.tools.jsonc" <<EOF
{
    "schemaVersion": 1,
    "sidecars": {
        "mock.xtools": {
            "mock": true,
            "command": "bun",
            "args": ["$SOURCE_ROOT/scripts/mock.sidecar.ts"],
            "cwd": "project",
            "timeoutMs": 2000,
            "maxOutputBytes": 65536,
            "tools": [
                "browser.open",
                "browser.snapshot",
                "browser.screenshot",
                "browser.click",
                "browser.type",
                "browser.navigate",
                "browser.evaluate",
                "screen.screenshot",
                "computer.mouse",
                "computer.keyboard",
                "computer.window",
                "vision.analyze",
                "vision.ocr",
                "audio.transcribe",
                "audio.speak",
                "web.fetch",
                "web.search",
                "lsp.symbols",
                "lsp.diagnostics",
                "task.background"
            ]
        }
    }
}
EOF

cat > "$KIT_TARGET/kits.jsonc" <<EOF
{
    "schemaVersion": 1,
    "kits": {
        "mock.xtools": {
            "id": "mock.xtools",
            "kind": "capability",
            "name": "Mock External Tools",
            "description": "Descriptor-only mock sidecar for external browser, computer, media, web, LSP and background-task tools.",
            "permissions": ["control", "capability.catalog"],
            "capabilities": [
                {
                    "source": "user-tool",
                    "names": [
                        "browser.open",
                        "browser.snapshot",
                        "browser.screenshot",
                        "browser.click",
                        "browser.type",
                        "browser.navigate",
                        "browser.evaluate",
                        "screen.screenshot",
                        "computer.mouse",
                        "computer.keyboard",
                        "computer.window",
                        "vision.analyze",
                        "vision.ocr",
                        "audio.transcribe",
                        "audio.speak",
                        "web.fetch",
                        "web.search",
                        "lsp.symbols",
                        "lsp.diagnostics",
                        "task.background"
                    ]
                }
            ]
        }
    }
}
EOF

echo "flyflor-xtools: wrote mock external tool manifest to $TARGET"
echo "flyflor-xtools: wrote mock external kit manifest to $KIT_TARGET"
