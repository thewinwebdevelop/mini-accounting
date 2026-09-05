#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NODE_BIN="/Users/tar/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
PYTHON_BIN="${SWEET_HOUSE_PYTHON:-/Users/tar/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3}"

if [ ! -x "$NODE_BIN" ]; then
  echo "Bundled Node runtime not found: $NODE_BIN" >&2
  exit 1
fi

if [ -x "$PYTHON_BIN" ]; then
  (cd "$SCRIPT_DIR" && "$PYTHON_BIN" -m unittest test_substitute_receipt_pdf -v)
else
  echo "Bundled Python runtime not found: $PYTHON_BIN — skipping PDF helper tests" >&2
fi

exec "$NODE_BIN" --test tests/*.mjs
