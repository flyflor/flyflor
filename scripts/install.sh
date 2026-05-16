#!/usr/bin/env sh
# Flyflor curl-pipe installer.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/flyflor/flyflor/master/scripts/install.sh | bash
#   curl -fsSL https://raw.githubusercontent.com/flyflor/flyflor/master/scripts/install.sh | bash -s -- --version v0.4.0
#   curl -fsSL https://raw.githubusercontent.com/flyflor/flyflor/master/scripts/install.sh | bash -s -- --prefix /usr/local/flyflor
#   curl -fsSL https://raw.githubusercontent.com/flyflor/flyflor/master/scripts/install.sh | bash -s -- --uninstall
#
# Behaviour:
#   - 检测 OS/arch，从 release-base 下载匹配的 flyflor 二进制 + templates tarball；
#   - 安装到 ${PREFIX}/bin/flyflor + ${PREFIX}/{prompts,templates}/；
#   - 默认 prefix = $HOME/.flyflor；
#   - --update 与默认行为一致（覆写 binary，强制刷新 templates）；
#   - --uninstall 删除 bin + templates，保留 config 与用户数据。
#
# 设计约束：
#   - POSIX shell，不依赖 bash-only 特性；
#   - 不写 system 路径除非用户显式 --prefix；
#   - 二进制下载失败立即退出，绝不留半成品。

set -eu

VERSION="${FLYFLOR_VERSION:-latest}"
PREFIX="${FLYFLOR_PREFIX:-$HOME/.flyflor}"
RELEASE_BASE="${FLYFLOR_RELEASE_BASE:-https://github.com/flyflor/flyflor/releases}"
BINARY_NAME="flyflor"
ACTION="install"

die() { echo "flyflor-install: $*" >&2; exit 1; }
info() { echo "flyflor-install: $*"; }

# curl-pipe users often pass options manually. Validate values before reading
# them so install failures stay explicit and do not depend on the user's shell.
need_value() {
    [ $# -ge 2 ] || die "$1 requires a value"
    [ -n "$2" ] || die "$1 requires a value"
}

while [ $# -gt 0 ]; do
    case "$1" in
        --version) need_value "$1" "${2-}"; VERSION="$2"; shift 2 ;;
        --version=*) VERSION="${1#--version=}"; shift ;;
        --prefix) need_value "$1" "${2-}"; PREFIX="$2"; shift 2 ;;
        --prefix=*) PREFIX="${1#--prefix=}"; shift ;;
        --release-base) need_value "$1" "${2-}"; RELEASE_BASE="$2"; shift 2 ;;
        --release-base=*) RELEASE_BASE="${1#--release-base=}"; shift ;;
        --uninstall) ACTION="uninstall"; shift ;;
        --update) ACTION="install"; shift ;;
        -h|--help)
            cat <<EOF
Flyflor installer

Options:
  --version <tag>       Release tag to install (default: latest)
  --prefix <dir>        Install prefix (default: \$HOME/.flyflor)
  --release-base <url>  Base URL for release downloads
  --uninstall           Remove bin + templates (keeps config + data)
  --update              Force re-install latest (default behaviour)

Remote usage:
  curl -fsSL https://raw.githubusercontent.com/flyflor/flyflor/master/scripts/install.sh | bash
EOF
            exit 0
            ;;
        *) die "unknown option: $1" ;;
    esac
done

UNAME="$(uname -s)"
MACHINE="$(uname -m)"

case "$UNAME" in
    Darwin) OS="darwin" ;;
    Linux) OS="linux" ;;
    *) die "unsupported os: $UNAME" ;;
esac

case "$MACHINE" in
    arm64|aarch64) ARCH="arm64" ;;
    x86_64|amd64) ARCH="x64" ;;
    *) die "unsupported arch: $MACHINE" ;;
esac

if [ "$VERSION" = "latest" ] || [ -z "$VERSION" ]; then
    VERSION_SEGMENT="latest/download"
else
    case "$VERSION" in
        v*) TAG="$VERSION" ;;
        *) TAG="v$VERSION" ;;
    esac
    VERSION_SEGMENT="download/$TAG"
fi

ASSET="${BINARY_NAME}-${OS}-${ARCH}"
BINARY_URL="${RELEASE_BASE%/}/${VERSION_SEGMENT}/${ASSET}"
TEMPLATES_URL="${RELEASE_BASE%/}/${VERSION_SEGMENT}/flyflor-templates.tar.gz"

BIN_DIR="$PREFIX/bin"
TPL_DIR="$PREFIX/templates"
PROMPT_DIR="$PREFIX/prompts"
BIN_PATH="$BIN_DIR/$BINARY_NAME"

if [ "$ACTION" = "uninstall" ]; then
    info "removing $BIN_PATH"
    rm -f "$BIN_PATH"
    info "removing $TPL_DIR and $PROMPT_DIR"
    rm -rf "$TPL_DIR" "$PROMPT_DIR"
    info "uninstalled. Config and data under $PREFIX preserved."
    exit 0
fi

if command -v curl >/dev/null 2>&1; then
    DL="curl -fsSL --retry 3"
elif command -v wget >/dev/null 2>&1; then
    DL="wget -q -O -"
else
    die "neither curl nor wget is available"
fi

mkdir -p "$BIN_DIR" "$TPL_DIR" "$PROMPT_DIR"

TMPDIR="$(mktemp -d 2>/dev/null || mktemp -d -t flyflor-install)"
trap 'rm -rf "$TMPDIR"' EXIT INT TERM

info "downloading $BINARY_URL"
if ! $DL "$BINARY_URL" > "$TMPDIR/$BINARY_NAME"; then
    die "binary download failed"
fi
chmod +x "$TMPDIR/$BINARY_NAME"

info "downloading $TEMPLATES_URL"
if ! $DL "$TEMPLATES_URL" > "$TMPDIR/templates.tar.gz"; then
    die "templates download failed"
fi

# 原子替换二进制：先写到临时同盘文件再 mv
mv "$TMPDIR/$BINARY_NAME" "$BIN_PATH.new"
mv "$BIN_PATH.new" "$BIN_PATH"

info "extracting templates to $PREFIX"
tar -xzf "$TMPDIR/templates.tar.gz" -C "$PREFIX"

info "installed $BINARY_NAME -> $BIN_PATH"

case ":$PATH:" in
    *":$BIN_DIR:"*) ;;
    *)
        cat <<EOF

Add this line to your shell rc (~/.bashrc, ~/.zshrc):

    export PATH="\$PATH:$BIN_DIR"

Then restart your shell or run: source ~/.bashrc
EOF
        ;;
esac

info "done. Run '$BINARY_NAME --help' to get started."
