#!/usr/bin/env sh
# Flyflor Docker one-click bootstrap.
#
# This path keeps the source checkout on the user's machine and then starts the
# existing docker compose dev stack against that checkout.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/flyflor/flyflor/master/scripts/install.docker.sh | bash
#   curl -fsSL https://raw.githubusercontent.com/flyflor/flyflor/master/scripts/install.docker.sh | bash -s -- --target ~/src/flyflor
#   sh scripts/install.docker.sh

set -eu

REPO_URL="${FLYFLOR_DOCKER_REPO:-https://github.com/flyflor/flyflor.git}"
TARGET_DIR="${FLYFLOR_DOCKER_DIR:-$HOME/src/flyflor}"
BRANCH="${FLYFLOR_DOCKER_BRANCH:-master}"

die() { echo "flyflor-docker-install: $*" >&2; exit 1; }
info() { echo "flyflor-docker-install: $*"; }

# Docker install intentionally keeps a source checkout locally. Validate values
# here because the script is also meant to be executed directly from curl.
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
Flyflor Docker bootstrap

Options:
  --target <dir>   Checkout directory (default: \$HOME/src/flyflor)
  --repo <url>     Git repository URL (default: Flyflor GitHub repo)
  --branch <name>  Branch to clone or update (default: master)

Remote usage:
  curl -fsSL https://raw.githubusercontent.com/flyflor/flyflor/master/scripts/install.docker.sh | bash
EOF
            exit 0
            ;;
        *) die "unknown option: $1" ;;
    esac
done

command -v git >/dev/null 2>&1 || die "git is required"
command -v bun >/dev/null 2>&1 || die "bun is required"
command -v docker >/dev/null 2>&1 || die "docker is required"
docker compose version >/dev/null 2>&1 || die "docker compose is required"

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
info "installing templates into docker config"
bun run docker:templates
info "building linux binary and starting docker dev stack"
bun run docker:up
info "docker dev stack is up. Run 'bun run docker:logs' inside $TARGET_DIR for logs."
