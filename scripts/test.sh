#!/usr/bin/env bash
set -euo pipefail

NODE_BIN="/Users/tar/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"

if [ ! -x "$NODE_BIN" ]; then
  echo "Bundled Node runtime not found: $NODE_BIN" >&2
  exit 1
fi

exec "$NODE_BIN" --test tests/*.mjs
