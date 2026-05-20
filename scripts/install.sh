#!/usr/bin/env sh
# Flyflor curl-pipe installer.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/flyflor/flyflor/master/scripts/install.sh | bash
#   curl -fsSL https://raw.githubusercontent.com/flyflor/flyflor/master/scripts/install.sh | bash -s -- --version v0.4.0
#   curl -fsSL https://raw.githubusercontent.com/flyflor/flyflor/master/scripts/install.sh | bash -s -- --home ~/.flyflor
#   curl -fsSL https://raw.githubusercontent.com/flyflor/flyflor/master/scripts/install.sh | bash -s -- --binary --prefix /usr/local/flyflor
#   curl -fsSL https://raw.githubusercontent.com/flyflor/flyflor/master/scripts/install.sh | bash -s -- --uninstall
#
# Behaviour:
#   - 默认 source-first：clone / update repo 到 $HOME/.flyflor；
#   - 配置、prompts、templates、workspace 统一放入 ~/.flyflor/.config；
#   - 构建 dist/flyflor 并把 flyflor 链接到 ~/.local/bin；
#   - --binary 才走 release 二进制 + templates tarball 安装；
#   - --uninstall 只删除全局命令链接与 binary，保留源码、配置和数据。
#
# 设计约束：
#   - POSIX shell，不依赖 bash-only 特性；
#   - 不写 system 路径除非用户显式 --global-bin 或 --prefix；
#   - 源码安装失败立即退出，绝不静默降级到半成品。

set -eu

VERSION="${FLYFLOR_VERSION:-latest}"
FLYFLOR_HOME="${FLYFLOR_HOME:-$HOME/.flyflor}"
PREFIX="${FLYFLOR_PREFIX:-$FLYFLOR_HOME}"
FLYFLOR_CONFIG_DIR="${FLYFLOR_CONFIG_DIR:-$FLYFLOR_HOME/.config}"
GLOBAL_BIN_DIR="${FLYFLOR_GLOBAL_BIN_DIR:-$HOME/.local/bin}"
RELEASE_BASE="${FLYFLOR_RELEASE_BASE:-https://github.com/flyflor/flyflor/releases}"
REPO_URL="${FLYFLOR_SOURCE_REPO:-https://github.com/flyflor/flyflor.git}"
BRANCH="${FLYFLOR_SOURCE_BRANCH:-master}"
BINARY_NAME="flyflor"
ACTION="install"
INSTALL_MODE="source"

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
        --home) need_value "$1" "${2-}"; FLYFLOR_HOME="$2"; PREFIX="$2"; shift 2 ;;
        --home=*) FLYFLOR_HOME="${1#--home=}"; PREFIX="$FLYFLOR_HOME"; shift ;;
        --repo) need_value "$1" "${2-}"; REPO_URL="$2"; shift 2 ;;
        --repo=*) REPO_URL="${1#--repo=}"; shift ;;
        --branch) need_value "$1" "${2-}"; BRANCH="$2"; shift 2 ;;
        --branch=*) BRANCH="${1#--branch=}"; shift ;;
        --global-bin) need_value "$1" "${2-}"; GLOBAL_BIN_DIR="$2"; shift 2 ;;
        --global-bin=*) GLOBAL_BIN_DIR="${1#--global-bin=}"; shift ;;
        --prefix) need_value "$1" "${2-}"; PREFIX="$2"; shift 2 ;;
        --prefix=*) PREFIX="${1#--prefix=}"; shift ;;
        --release-base) need_value "$1" "${2-}"; RELEASE_BASE="$2"; shift 2 ;;
        --release-base=*) RELEASE_BASE="${1#--release-base=}"; shift ;;
        --binary) INSTALL_MODE="binary"; shift ;;
        --source) INSTALL_MODE="source"; shift ;;
        --uninstall) ACTION="uninstall"; shift ;;
        --update) ACTION="install"; shift ;;
        -h|--help)
            cat <<EOF
Flyflor installer

Options:
  --version <tag>       Release tag to install (default: latest)
  --home <dir>          Flyflor source home (default: \$HOME/.flyflor)
  --repo <url>          Git repository URL (default: Flyflor GitHub repo)
  --branch <name>       Branch to clone or update (default: master)
  --global-bin <dir>    Directory for the global flyflor command (default: \$HOME/.local/bin)
  --binary              Install release binary instead of source-first checkout
  --source              Force source-first checkout mode (default)
  --prefix <dir>        Binary install prefix when --binary is used
  --release-base <url>  Base URL for release downloads
  --uninstall           Remove global command link/binary (keeps source, config + data)
  --update              Force re-install latest (default behaviour)

Remote usage:
  curl -fsSL https://raw.githubusercontent.com/flyflor/flyflor/master/scripts/install.sh | bash
EOF
            exit 0
            ;;
        *) die "unknown option: $1" ;;
    esac
done

link_global_command() {
    source_path="$1"
    mkdir -p "$GLOBAL_BIN_DIR"
    ln -sf "$source_path" "$GLOBAL_BIN_DIR/$BINARY_NAME"
    case ":$PATH:" in
        *":$GLOBAL_BIN_DIR:"*) ;;
        *)
            cat <<EOF

Add this line to your shell rc (~/.bashrc, ~/.zshrc):

    export PATH="\$PATH:$GLOBAL_BIN_DIR"

Then restart your shell or run: source ~/.bashrc
EOF
            ;;
    esac
}

install_source_mode() {
    command -v git >/dev/null 2>&1 || die "git is required"
    command -v bun >/dev/null 2>&1 || die "bun is required"

    if [ ! -d "$FLYFLOR_HOME/.git" ]; then
        mkdir -p "$(dirname "$FLYFLOR_HOME")"
        if [ -e "$FLYFLOR_HOME" ] && [ -n "$(ls -A "$FLYFLOR_HOME" 2>/dev/null)" ]; then
            TMP_SOURCE="$(mktemp -d 2>/dev/null || mktemp -d -t flyflor-source)"
            info "cloning $REPO_URL -> $TMP_SOURCE"
            git clone --branch "$BRANCH" "$REPO_URL" "$TMP_SOURCE"
            info "merging source checkout into existing $FLYFLOR_HOME without deleting config"
            cp -R "$TMP_SOURCE/." "$FLYFLOR_HOME/"
            rm -rf "$TMP_SOURCE"
        else
            info "cloning $REPO_URL -> $FLYFLOR_HOME"
            git clone --branch "$BRANCH" "$REPO_URL" "$FLYFLOR_HOME"
        fi
    else
        info "updating existing checkout at $FLYFLOR_HOME"
        git -C "$FLYFLOR_HOME" pull --ff-only
    fi

    cd "$FLYFLOR_HOME"
    info "installing Bun dependencies"
    bun install
    info "installing templates into $FLYFLOR_CONFIG_DIR"
    bun run install:templates -- --target "$FLYFLOR_CONFIG_DIR" --source-config
    info "building local binary"
    bun run build:binary
    link_global_command "$FLYFLOR_HOME/dist/$BINARY_NAME"
    info "installed $BINARY_NAME -> $GLOBAL_BIN_DIR/$BINARY_NAME"
    info "done. Run '$BINARY_NAME -h' to get started."
}

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
    info "removing $GLOBAL_BIN_DIR/$BINARY_NAME"
    rm -f "$GLOBAL_BIN_DIR/$BINARY_NAME"
    info "removing binary install path $BIN_PATH"
    rm -f "$BIN_PATH"
    info "uninstalled. Source, config and data under $FLYFLOR_HOME preserved."
    exit 0
fi

if [ "$INSTALL_MODE" = "source" ]; then
    install_source_mode
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

link_global_command "$BIN_PATH"
info "installed $BINARY_NAME -> $BIN_PATH"
info "done. Run '$BINARY_NAME -h' to get started."
