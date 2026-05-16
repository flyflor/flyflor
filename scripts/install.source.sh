#!/usr/bin/env sh
# Flyflor source checkout bootstrap.
#
# This path keeps the repo on the user's machine so they can edit, pull, and
# iterate locally instead of only consuming a frozen binary.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/flyflor/flyflor/master/scripts/install.source.sh | bash
#   curl -fsSL https://raw.githubusercontent.com/flyflor/flyflor/master/scripts/install.source.sh | bash -s -- --target ~/src/flyflor
#   sh scripts/install.source.sh
#
# Behaviour:
#   - clone or update the Flyflor source tree locally;
#   - install Bun dependencies in that checkout;
#   - install canonical prompt/templates into the checkout's ~/.flyflor-style config tree;
#   - leave the source tree editable for future self-iteration.

set -eu

REPO_URL="${FLYFLOR_SOURCE_REPO:-https://github.com/flyflor/flyflor.git}"
TARGET_DIR="${FLYFLOR_SOURCE_DIR:-$HOME/src/flyflor}"
BRANCH="${FLYFLOR_SOURCE_BRANCH:-master}"

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
        -h|--help)
            cat <<EOF
Flyflor source installer

Options:
  --target <dir>   Checkout directory (default: \$HOME/src/flyflor)
  --repo <url>     Git repository URL (default: Flyflor GitHub repo)
  --branch <name>  Branch to clone or update (default: master)

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
    info "cloning $REPO_URL -> $TARGET_DIR"
    git clone --branch "$BRANCH" "$REPO_URL" "$TARGET_DIR"
else
    info "updating existing checkout at $TARGET_DIR"
    git -C "$TARGET_DIR" pull --ff-only
fi

cd "$TARGET_DIR"
info "installing Bun dependencies"
bun install
info "installing templates into the checkout config tree"
bun run install:templates
info "source checkout ready. Run 'bun run chat' inside $TARGET_DIR."
