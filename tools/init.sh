#!/usr/bin/env sh
set -eu

MODE="real"
TARGET="${FLYFLOR_XTOOLS_TARGET:-./tools}"
RUNNER="${FLYFLOR_RUNNER:-}"
CDP_URL="${FLYFLOR_BROWSER_CDP_URL:-http://127.0.0.1:9222}"

while [ "$#" -gt 0 ]; do
    case "$1" in
        --mock)
            MODE="mock"
            shift
            ;;
        --real)
            MODE="real"
            shift
            ;;
        --home)
            TARGET="$2/tools"
            shift 2
            ;;
        --target)
            TARGET="$2"
            shift 2
            ;;
        --runner)
            RUNNER="$2"
            shift 2
            ;;
        --cdp-url)
            CDP_URL="$2"
            shift 2
            ;;
        --help|-h)
            echo "Usage: sh tools/init.sh [--real|--mock] [--target PATH] [--runner PATH] [--cdp-url URL]"
            exit 0
            ;;
        *)
            echo "Unknown argument: $1" >&2
            exit 2
            ;;
    esac
done

if [ -z "$RUNNER" ]; then
    if [ -x "./dist/flyflor" ]; then
        RUNNER="./dist/flyflor"
    elif command -v flyflor >/dev/null 2>&1; then
        RUNNER="flyflor"
    else
        echo "Flyflor binary was not found. Pass --runner PATH." >&2
        exit 1
    fi
fi

PACKAGE_BINARY_NAME="flyflor"
case "$(uname -s 2>/dev/null || printf unknown)" in
    MINGW*|MSYS*|CYGWIN*)
        PACKAGE_BINARY_NAME="flyflor.exe"
        ;;
esac
TARGET_COMMAND_PREFIX="$(printf '%s' "$TARGET" | sed 's#^\./##')"

mkdir -p "$TARGET/packages"
for package in browser-cdp search-web media computer-native computer-use utility mock; do
    PACKAGE_DIR="$TARGET/packages/$package"
    PACKAGE_RUNNER="./$TARGET_COMMAND_PREFIX/packages/$package/bin/$PACKAGE_BINARY_NAME"
    mkdir -p "$PACKAGE_DIR/bin"
    cp "$RUNNER" "$PACKAGE_DIR/bin/$PACKAGE_BINARY_NAME"
    chmod +x "$PACKAGE_DIR/bin/$PACKAGE_BINARY_NAME" 2>/dev/null || true
    cat > "$TARGET/packages/$package/README.md" <<EOF
# $package

This directory is the project-local payload for the external tool package.

Runtime discovery stays in ../../external.tools.jsonc. The command registered there points to ./tools/packages/$package/bin/$PACKAGE_BINARY_NAME.
EOF
    cat > "$TARGET/packages/$package/package.jsonc" <<EOF
{
    "schemaVersion": 1,
    "id": "$package",
    "kind": "external-tool-package",
    "registry": "../../external.tools.jsonc",
    "runtime": "process-json",
    "command": "$PACKAGE_RUNNER"
}
EOF
done

BROWSER_CDP_RUNNER="./$TARGET_COMMAND_PREFIX/packages/browser-cdp/bin/$PACKAGE_BINARY_NAME"
SEARCH_WEB_RUNNER="./$TARGET_COMMAND_PREFIX/packages/search-web/bin/$PACKAGE_BINARY_NAME"
MEDIA_RUNNER="./$TARGET_COMMAND_PREFIX/packages/media/bin/$PACKAGE_BINARY_NAME"
COMPUTER_NATIVE_RUNNER="./$TARGET_COMMAND_PREFIX/packages/computer-native/bin/$PACKAGE_BINARY_NAME"
COMPUTER_USE_RUNNER="./$TARGET_COMMAND_PREFIX/packages/computer-use/bin/$PACKAGE_BINARY_NAME"
UTILITY_RUNNER="./$TARGET_COMMAND_PREFIX/packages/utility/bin/$PACKAGE_BINARY_NAME"
MOCK_RUNNER="./$TARGET_COMMAND_PREFIX/packages/mock/bin/$PACKAGE_BINARY_NAME"

if [ "$MODE" = "mock" ]; then
    cat > "$TARGET/external.tools.jsonc" <<EOF
{
    "schemaVersion": 1,
    "sidecars": {
        "mock.xtools": {
            "mock": true,
            "command": "$MOCK_RUNNER",
            "args": ["xtool-sidecar", "mock.xtools"],
            "cwd": "project",
            "timeoutMs": 2000,
            "maxOutputBytes": 65536,
            "tools": [
                "browser.open", "browser.snapshot", "browser.screenshot", "browser.click", "browser.type", "browser.navigate", "browser.evaluate",
                "screen.screenshot", "computer.use", "computer.mouse", "computer.keyboard", "computer.window",
                "vision.analyze", "vision.ocr", "audio.transcribe", "audio.speak",
                "web.search", "web.fetch", "web.extract", "web.download",
                "lsp.symbols", "lsp.diagnostics", "file.hash", "archive.create", "archive.extract", "data.convert", "task.background"
            ]
        }
    }
}
EOF
else
    cat > "$TARGET/external.tools.jsonc" <<EOF
{
    "schemaVersion": 1,
    "sidecars": {
        "browser.cdp": {
            "command": "$BROWSER_CDP_RUNNER",
            "args": ["xtool-sidecar", "browser.cdp"],
            "cwd": "project",
            "env": { "FLYFLOR_BROWSER_CDP_URL": "$CDP_URL" },
            "timeoutMs": 8000,
            "maxOutputBytes": 65536,
            "tools": ["browser.open", "browser.snapshot", "browser.screenshot", "browser.click", "browser.type", "browser.navigate", "browser.evaluate"]
        },
        "computer.native": {
            "command": "$COMPUTER_NATIVE_RUNNER",
            "args": ["xtool-sidecar", "computer.native"],
            "cwd": "project",
            "config": { "mouseCommand": "", "mouseArgs": [], "keyboardCommand": "", "keyboardArgs": [] },
            "timeoutMs": 10000,
            "maxOutputBytes": 65536,
            "tools": ["screen.screenshot", "computer.mouse", "computer.keyboard", "computer.window"]
        },
        "computer.use": {
            "command": "$COMPUTER_USE_RUNNER",
            "args": ["xtool-sidecar", "computer.use"],
            "cwd": "project",
            "config": { "backend": "delegate", "delegateCommand": "", "delegateArgs": [], "cuaCommand": "cua-driver", "cuaArgs": [] },
            "timeoutMs": 20000,
            "maxOutputBytes": 524288,
            "tools": ["computer.use"]
        },
        "media.local": {
            "command": "$MEDIA_RUNNER",
            "args": ["xtool-sidecar", "media.local"],
            "cwd": "project",
            "config": { "providerUrl": "", "providerHeaders": {}, "localCommands": {} },
            "timeoutMs": 30000,
            "maxOutputBytes": 262144,
            "tools": ["vision.analyze", "vision.ocr", "audio.transcribe", "audio.speak"]
        },
        "web.search": {
            "command": "$SEARCH_WEB_RUNNER",
            "args": ["xtool-sidecar", "web.search"],
            "cwd": "project",
            "config": { "cacheTtlMs": 600000, "providers": [] },
            "timeoutMs": 10000,
            "maxOutputBytes": 65536,
            "tools": ["web.search", "web.fetch", "web.extract", "web.download"]
        },
        "utility.local": {
            "command": "$UTILITY_RUNNER",
            "args": ["xtool-sidecar", "utility.local"],
            "cwd": "project",
            "config": { "lspCommand": "", "lspArgs": [], "taskCommand": "", "taskArgs": [] },
            "timeoutMs": 30000,
            "maxOutputBytes": 262144,
            "tools": ["lsp.symbols", "lsp.diagnostics", "task.background", "file.hash", "archive.create", "archive.extract", "data.convert"]
        }
    }
}
EOF
fi

echo "flyflor xtools initialized"
echo "mode: $MODE"
echo "runner: $RUNNER"
echo "config: $TARGET/external.tools.jsonc"
