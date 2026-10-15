import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const workflowPath = path.resolve(import.meta.dirname, "../.github/workflows/e2e.yml");

test("CI workflow blocks green status until the complete test and E2E matrix passes", async () => {
  const workflow = await readFile(workflowPath, "utf8");

  assert.match(workflow, /^name: CI$/m);
  assert.match(workflow, /^  ci:\s*$/m);
  assert.match(workflow, /- run: \.\/scripts\/test\.sh/);
  assert.match(workflow, /npx node@22 --test tests\/e2e-fixtures\.test\.mjs tests\/e2e-artifacts\.test\.mjs/);
  for (const project of ["chromium", "mobile-chromium", "cloud-runtime-mocked"]) {
    assert.match(workflow, new RegExp(`\\.\\/scripts\\/e2e\\.sh --project ${project}`));
  }
  assert.match(workflow, /python -m pip install pypdf reportlab pdfplumber uharfbuzz/);
  assert.doesNotMatch(workflow, /continue-on-error:\s*true/);
  assert.match(workflow, /name: Write redacted failure artifacts[\s\S]*?if: failure\(\)/);
});

test("production smoke stays a manual read-only gate separate from full CI", async () => {
  const workflow = await readFile(workflowPath, "utf8");

  assert.match(workflow, /^  production-smoke:\s*$/m);
  assert.match(workflow, /github\.event_name == 'workflow_dispatch'/);
  assert.match(workflow, /E2E_BASE_URL: \$\{\{ inputs\.smoke_base_url \}\}/);
  assert.match(workflow, /E2E_BASE_URL=\"\$E2E_BASE_URL\" \.\/scripts\/e2e\.sh --project production-smoke/);
});
