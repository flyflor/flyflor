#!/bin/sh
set -eu

WORKSPACE_BIN="/root/.flyflor/dist/flyflor-linux"
MOUNTED_BIN="/mounted/flyflor-linux"
LOCAL_BIN="/tmp/flyflor-linux"
LINK_BIN="/usr/local/bin/flyflor"

if [ -f "$WORKSPACE_BIN" ]; then
    SOURCE_BIN="$WORKSPACE_BIN"
else
    SOURCE_BIN="$MOUNTED_BIN"
fi

if [ ! -f "$SOURCE_BIN" ]; then
    echo "Missing Flyflor binary: $WORKSPACE_BIN or $MOUNTED_BIN" >&2
    exit 1
fi

cp "$SOURCE_BIN" "$LOCAL_BIN"
chmod +x "$LOCAL_BIN"
ln -sf "$LOCAL_BIN" "$LINK_BIN"

exec "$LOCAL_BIN" "$@"
