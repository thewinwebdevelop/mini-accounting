import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const testScript = join(root, "scripts/test.sh");
const e2eScript = join(root, "scripts/e2e.sh");

function inTemp(run) {
  const dir = mkdtempSync(join(tmpdir(), "sweet-house-tooling-"));
  try { return run(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

function fakeCommand(dir, name, body) {
  const path = join(dir, name);
  writeFileSync(path, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  return path;
}

function run(script, env, args = []) {
  return spawnSync("/bin/bash", [script, ...args], {
    cwd: root,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
}

test("test.sh discovers compatible Node and Python from PATH and runs all existing suites", () => inTemp(dir => {
  const bin = join(dir, "bin");
  mkdirSync(bin);
  const log = join(dir, "calls");
  fakeCommand(bin, "node", `if [ "$1" = "--version" ]; then echo v24.0.0; exit 0; fi\nprintf 'node %s\\n' "$*" >> "${log}"`);
  fakeCommand(bin, "python3", `printf 'python %s\\n' "$*" >> "${log}"`);
  const result = run(testScript, {
    PATH: `${bin}:${process.env.PATH}`,
    SWEET_HOUSE_RUNTIME_ROOT: join(dir, "missing-bundle"),
    SWEET_HOUSE_NODE_BIN: "",
    SWEET_HOUSE_PYTHON: "",
  });
  assert.equal(result.status, 0, result.stderr);
  const calls = readFileSync(log, "utf8");
  for (const suite of ["test_substitute_receipt_pdf", "test_workflow_document_pdf", "test_workflow_packet_pdf", "test_workflow_transaction_packet_pdf", "shipping-label-overlay.test.py"]) {
    assert.match(calls, new RegExp(suite.replaceAll(".", "\\.")));
  }
  assert.match(calls, /node --test tests\/.*\.mjs/);
}));

test("test.sh honors explicit runtime paths", () => inTemp(dir => {
  const log = join(dir, "calls");
  const node = fakeCommand(dir, "chosen-node", `if [ "$1" = "--version" ]; then echo v24.0.0; exit 0; fi\nprintf 'node %s\\n' "$*" >> "${log}"`);
  const python = fakeCommand(dir, "chosen-python", `printf 'python %s\\n' "$*" >> "${log}"`);
  const result = run(testScript, { SWEET_HOUSE_NODE_BIN: node, SWEET_HOUSE_PYTHON: python });
  assert.equal(result.status, 0, result.stderr);
  assert.match(readFileSync(log, "utf8"), /python -m unittest/);
  assert.match(readFileSync(log, "utf8"), /node --test/);
}));

test("test.sh fails when the required Python test runtime is unavailable", () => inTemp(dir => {
  const node = fakeCommand(dir, "chosen-node", 'if [ "$1" = "--version" ]; then echo v24.0.0; fi');
  const result = run(testScript, { SWEET_HOUSE_NODE_BIN: node, SWEET_HOUSE_PYTHON: join(dir, "absent") });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Python.*not found|Python.*unavailable/i);
}));

test("test.sh fails when the configured Node runtime is unavailable", () => inTemp(dir => {
  const result = run(testScript, { SWEET_HOUSE_NODE_BIN: join(dir, "absent") });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Node.*not found/);
}));

test("e2e.sh rejects a production URL for a full project before invoking Playwright", () => inTemp(dir => {
  const log = join(dir, "calls");
  const playwright = fakeCommand(dir, "playwright", `echo called >> "${log}"`);
  const result = run(e2eScript, { E2E_PLAYWRIGHT_BIN: playwright, E2E_PROJECT: "chromium", E2E_BASE_URL: "https://example.com" }, ["--list"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /E2E_BASE_URL|production URL/);
  assert.throws(() => readFileSync(log));
}));

test("e2e.sh selects the requested project and forwards runner options", () => inTemp(dir => {
  const log = join(dir, "calls");
  const playwright = fakeCommand(dir, "playwright", `printf '%s\\n' "$@" > "${log}"`);
  const result = run(e2eScript, {
    E2E_PLAYWRIGHT_BIN: playwright,
    E2E_PROJECT: "mobile-chromium",
    E2E_WORKERS: "2",
    E2E_TRACE: "on",
    E2E_GREP: "mobile",
  }, ["--list"]);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(readFileSync(log, "utf8").trim().split("\n"), ["test", "--project", "mobile-chromium", "--workers", "2", "--trace", "on", "--grep", "mobile", "--list"]);
}));

test("e2e.sh honors --project and rejects a production URL for that full project", () => inTemp(dir => {
  const playwright = fakeCommand(dir, "playwright", "exit 0");
  const result = run(e2eScript, { E2E_PLAYWRIGHT_BIN: playwright, E2E_PROJECT: "production-smoke", E2E_BASE_URL: "https://example.com" }, ["--project", "chromium", "--list"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /E2E_BASE_URL/);
}));

test("e2e.sh requires E2E_BASE_URL for production smoke", () => inTemp(dir => {
  const playwright = fakeCommand(dir, "playwright", "exit 0");
  const result = run(e2eScript, { E2E_PLAYWRIGHT_BIN: playwright, E2E_PROJECT: "production-smoke", E2E_BASE_URL: "" }, ["--list"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /E2E_BASE_URL/);
}));

test("e2e.sh fails when Playwright is not installed", () => inTemp(dir => {
  const result = run(e2eScript, { E2E_PLAYWRIGHT_BIN: join(dir, "absent") }, ["--list"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Playwright.*not found|Playwright.*unavailable/i);
}));

test("e2e.sh uses an explicitly configured Node runtime for installed Playwright", () => inTemp(dir => {
  const log = join(dir, "calls");
  const node = fakeCommand(dir, "chosen-node", `if [ "$1" = "--version" ]; then echo v24.0.0; exit 0; fi\nprintf '%s\\n' "$@" > "${log}"`);
  const result = run(e2eScript, { E2E_NODE_BIN: node, E2E_PLAYWRIGHT_BIN: "", E2E_PROJECT: "chromium" }, ["--list"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(readFileSync(log, "utf8"), /@playwright\/test\/cli\.js\ntest\n--project\nchromium\n--list/);
}));

test("Playwright config exposes local and production smoke projects", async () => {
  const { default: config } = await import("../playwright.config.mjs");
  assert.deepEqual(config.projects.map(project => project.name), ["chromium", "mobile-chromium", "production-smoke"]);
  assert.match(config.projects[0].use.baseURL, /^http:\/\/127\.0\.0\.1:/);
  assert.match(config.projects[1].use.baseURL, /^http:\/\/127\.0\.0\.1:/);
});
