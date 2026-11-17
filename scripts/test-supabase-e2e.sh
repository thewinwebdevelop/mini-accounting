#!/usr/bin/env bash
set -euo pipefail
# Use an isolated local Supabase project; the fixture rejects remote URLs and
# inherited production credentials. Export CLI status JSON without logging keys.
: "${E2E_SUPABASE_CONFIG:?Set E2E_SUPABASE_CONFIG to the local supabase status JSON file}"
node_major="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$node_major" -lt 22 ]; then
  echo 'Node 22 or newer is required; run with Node 22 on PATH.' >&2
  exit 1
fi
node --test e2e/supabase/*.test.mjs
node node_modules/@playwright/test/cli.js test --config playwright.supabase.config.mjs
