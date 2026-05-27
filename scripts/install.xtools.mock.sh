#!/usr/bin/env sh
# Install a descriptor-only mock external tool sidecar manifest.
#
# This script does not install Playwright, OCR, Whisper, TTS, browser runtimes
# or any other heavy dependency. It only writes JSONC discovery files that let
# tests and thin clients exercise the External Kit capability surface.

set -eu

TARGET="${FLYFLOR_XTOOLS_TARGET:-./tools}"
KIT_TARGET="${FLYFLOR_XTOOLS_KIT_TARGET:-./tools/packages/kits}"
RUNNER="${FLYFLOR_RUNNER:-./dist/flyflor}"

mkdir -p "$TARGET/packages"
mkdir -p "$KIT_TARGET"

cat > "$TARGET/external.tools.jsonc" <<EOF
{
    "schemaVersion": 1,
    "sidecars": {
        "mock.xtools": {
            "mock": true,
            "command": "$RUNNER",
            "args": ["xtool-sidecar", "mock.xtools"],
            "cwd": "project",
            "timeoutMs": 2000,
            "maxOutputBytes": 65536,
            "tools": [
                "browser.open",
                "browser.snapshot",
                "browser.screenshot",
                "browser.use",
                "browser.click",
                "browser.type",
                "browser.navigate",
                "browser.evaluate",
                "screen.screenshot",
                "computer.use",
                "computer.mouse",
                "computer.keyboard",
                "computer.window",
                "vision.analyze",
                "vision.ocr",
                "audio.transcribe",
                "audio.speak",
                "web.search",
                "web.fetch",
                "web.extract",
                "web.download",
                "lsp.symbols",
                "lsp.diagnostics",
                "file.hash",
                "archive.create",
                "archive.extract",
                "data.convert",
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
                        "browser.use",
                        "browser.click",
                        "browser.type",
                        "browser.navigate",
                        "browser.evaluate",
                        "screen.screenshot",
                        "computer.use",
                        "computer.mouse",
                        "computer.keyboard",
                        "computer.window",
                        "vision.analyze",
                        "vision.ocr",
                        "audio.transcribe",
                        "audio.speak",
                        "web.search",
                        "web.fetch",
                        "web.extract",
                        "web.download",
                        "lsp.symbols",
                        "lsp.diagnostics",
                        "file.hash",
                        "archive.create",
                        "archive.extract",
                        "data.convert",
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
