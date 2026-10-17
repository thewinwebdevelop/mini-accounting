#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
RUNTIME_ROOT="${SWEET_HOUSE_RUNTIME_ROOT:-$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies}"

if [ -n "${SWEET_HOUSE_NODE_BIN:-}" ]; then
  NODE_BIN="$SWEET_HOUSE_NODE_BIN"
elif [ -x "$RUNTIME_ROOT/node/bin/node" ]; then
  NODE_BIN="$RUNTIME_ROOT/node/bin/node"
else
  NODE_BIN="$(command -v node || true)"
fi
if [ -z "$NODE_BIN" ] || [ ! -x "$NODE_BIN" ]; then
  echo "Required Node runtime not found" >&2
  exit 1
fi
NODE_VERSION="$("$NODE_BIN" --version)"
NODE_MAJOR="${NODE_VERSION#v}"
NODE_MAJOR="${NODE_MAJOR%%.*}"
if ! [[ "$NODE_MAJOR" =~ ^[0-9]+$ ]] || [ "$NODE_MAJOR" -lt 22 ]; then
  echo "Node 22 or newer is required (found $NODE_VERSION)" >&2
  exit 1
fi

if [ -n "${SWEET_HOUSE_PYTHON:-}" ]; then
  PYTHON_BIN="$SWEET_HOUSE_PYTHON"
elif [ -x "$RUNTIME_ROOT/python/bin/python3" ]; then
  PYTHON_BIN="$RUNTIME_ROOT/python/bin/python3"
else
  PYTHON_BIN="$(command -v python3 || true)"
fi
if [ -z "$PYTHON_BIN" ] || [ ! -x "$PYTHON_BIN" ]; then
  echo "Required Python test runtime not found" >&2
  exit 1
fi

(cd "$SCRIPT_DIR" && "$PYTHON_BIN" -m unittest test_substitute_receipt_pdf test_workflow_document_pdf test_workflow_packet_pdf test_workflow_transaction_packet_pdf -v)
"$PYTHON_BIN" "$REPO_DIR/tests/shipping-label-overlay.test.py" -v
cd "$REPO_DIR"
exec "$NODE_BIN" --test tests/*.mjs
