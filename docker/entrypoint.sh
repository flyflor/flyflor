#!/bin/sh
set -eu

SOURCE_BIN="/mounted/flyflor-linux"
LOCAL_BIN="/tmp/flyflor-linux"
LINK_BIN="/usr/local/bin/flyflor"

if [ ! -f "$SOURCE_BIN" ]; then
    echo "Missing Flyflor binary: $SOURCE_BIN" >&2
    exit 1
fi

cp "$SOURCE_BIN" "$LOCAL_BIN"
chmod +x "$LOCAL_BIN"
ln -sf "$LOCAL_BIN" "$LINK_BIN"

exec "$LOCAL_BIN" "$@"
