#!/usr/bin/env sh
# Flyflor source checkout bootstrap.
#
# This path keeps the repo on the user's machine so they can edit, pull, and
# iterate locally instead of only consuming a frozen binary.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/flyflor/flyflor/master/scripts/install.source.sh | bash
#   curl -fsSL https://raw.githubusercontent.com/flyflor/flyflor/master/scripts/install.source.sh | bash -s -- --target ~/.flyflor
#   sh scripts/install.source.sh
#
# Behaviour:
#   - clone or update the Flyflor source tree under ~/.flyflor by default;
#   - install Bun dependencies in that checkout;
#   - install canonical prompt/templates into ~/.flyflor/.config;
#   - build the Bun-compiled binary and link it as the global flyflor command;
#   - leave the source tree editable for future self-iteration.

set -eu

REPO_URL="${FLYFLOR_SOURCE_REPO:-https://github.com/flyflor/flyflor.git}"
TARGET_DIR="${FLYFLOR_SOURCE_DIR:-$HOME/.flyflor}"
BRANCH="${FLYFLOR_SOURCE_BRANCH:-master}"
GLOBAL_BIN_DIR="${FLYFLOR_GLOBAL_BIN_DIR:-$HOME/.local/bin}"

die() { echo "flyflor-source-install: $*" >&2; exit 1; }
info() { echo "flyflor-source-install: $*"; }

# Option values are validated before assignment so curl-pipe installs fail with
# a stable diagnostic instead of a shell-specific "parameter not set" message.
need_value() {
    [ $# -ge 2 ] || die "$1 requires a value"
    [ -n "$2" ] || die "$1 requires a value"
}

while [ $# -gt 0 ]; do
    case "$1" in
        --target) need_value "$1" "${2-}"; TARGET_DIR="$2"; shift 2 ;;
        --target=*) TARGET_DIR="${1#--target=}"; shift ;;
        --repo) need_value "$1" "${2-}"; REPO_URL="$2"; shift 2 ;;
        --repo=*) REPO_URL="${1#--repo=}"; shift ;;
        --branch) need_value "$1" "${2-}"; BRANCH="$2"; shift 2 ;;
        --branch=*) BRANCH="${1#--branch=}"; shift ;;
        --global-bin) need_value "$1" "${2-}"; GLOBAL_BIN_DIR="$2"; shift 2 ;;
        --global-bin=*) GLOBAL_BIN_DIR="${1#--global-bin=}"; shift ;;
        -h|--help)
            cat <<EOF
Flyflor source installer

Options:
  --target <dir>   Source home (default: \$HOME/.flyflor)
  --repo <url>     Git repository URL (default: Flyflor GitHub repo)
  --branch <name>  Branch to clone or update (default: master)
  --global-bin <dir>  Directory for the global flyflor command (default: \$HOME/.local/bin)

Remote usage:
  curl -fsSL https://raw.githubusercontent.com/flyflor/flyflor/master/scripts/install.source.sh | bash
EOF
            exit 0
            ;;
        *) die "unknown option: $1" ;;
    esac
done

command -v git >/dev/null 2>&1 || die "git is required"
command -v bun >/dev/null 2>&1 || die "bun is required"

if [ ! -d "$TARGET_DIR/.git" ]; then
    mkdir -p "$(dirname "$TARGET_DIR")"
    if [ -e "$TARGET_DIR" ] && [ -n "$(ls -A "$TARGET_DIR" 2>/dev/null)" ]; then
        TMP_SOURCE="$(mktemp -d 2>/dev/null || mktemp -d -t flyflor-source)"
        info "cloning $REPO_URL -> $TMP_SOURCE"
        git clone --branch "$BRANCH" "$REPO_URL" "$TMP_SOURCE"
        info "merging source checkout into existing $TARGET_DIR without deleting config"
        cp -R "$TMP_SOURCE/." "$TARGET_DIR/"
        rm -rf "$TMP_SOURCE"
    else
        info "cloning $REPO_URL -> $TARGET_DIR"
        git clone --branch "$BRANCH" "$REPO_URL" "$TARGET_DIR"
    fi
else
    info "updating existing checkout at $TARGET_DIR"
    git -C "$TARGET_DIR" pull --ff-only
fi

cd "$TARGET_DIR"
info "installing Bun dependencies"
bun install
CONFIG_DIR="${FLYFLOR_CONFIG_DIR:-$TARGET_DIR/.config}"
info "installing templates into $CONFIG_DIR"
bun run install:templates -- --target "$CONFIG_DIR" --source-config
info "building Bun-compiled binary"
bun run build:binary
mkdir -p "$GLOBAL_BIN_DIR"
ln -sf "$TARGET_DIR/dist/flyflor" "$GLOBAL_BIN_DIR/flyflor"
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
info "source checkout ready. Run 'flyflor -h' globally or 'bun run chat' inside $TARGET_DIR."
