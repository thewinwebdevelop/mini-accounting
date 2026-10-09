#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PROJECT="${E2E_PROJECT:-chromium}"
forwarded=()
while [ "$#" -gt 0 ]; do
  case "$1" in
    --project)
      if [ "$#" -lt 2 ]; then echo "--project requires a value" >&2; exit 1; fi
      PROJECT="$2"
      shift 2
      ;;
    --project=*) PROJECT="${1#--project=}"; shift ;;
    *) forwarded+=("$1"); shift ;;
  esac
done

case "$PROJECT" in
  chromium|mobile-chromium)
    if [ -n "${E2E_BASE_URL:-}" ]; then
      echo "E2E_BASE_URL is forbidden for full E2E projects" >&2
      exit 1
    fi
    ;;
  production-smoke)
    if [ -z "${E2E_BASE_URL:-}" ]; then
      echo "E2E_BASE_URL is required for production-smoke" >&2
      exit 1
    fi
    ;;
  *)
    echo "Unknown E2E_PROJECT: $PROJECT" >&2
    exit 1
    ;;
esac

PLAYWRIGHT_BIN="${E2E_PLAYWRIGHT_BIN:-$REPO_DIR/node_modules/.bin/playwright}"
if [ ! -x "$PLAYWRIGHT_BIN" ]; then
  echo "Playwright executable not found; run npm ci" >&2
  exit 1
fi

if [ -z "${E2E_PLAYWRIGHT_BIN:-}" ]; then
  RUNTIME_ROOT="${SWEET_HOUSE_RUNTIME_ROOT:-$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies}"
  if [ -n "${E2E_NODE_BIN:-}" ]; then
    NODE_BIN="$E2E_NODE_BIN"
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
fi

args=(test --project "$PROJECT")
if [ -n "${E2E_WORKERS:-}" ]; then args+=(--workers "$E2E_WORKERS"); fi
if [ -n "${E2E_TRACE:-}" ]; then args+=(--trace "$E2E_TRACE"); fi
if [ -n "${E2E_GREP:-}" ]; then args+=(--grep "$E2E_GREP"); fi
args+=("${forwarded[@]}")
cd "$REPO_DIR"
if [ -n "${E2E_PLAYWRIGHT_BIN:-}" ]; then
  exec "$PLAYWRIGHT_BIN" "${args[@]}"
fi
exec "$NODE_BIN" "$REPO_DIR/node_modules/@playwright/test/cli.js" "${args[@]}"
