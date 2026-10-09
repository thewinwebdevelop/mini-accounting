import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
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

test("Playwright config exposes local projects without a fixed service URL", async () => {
  const previous = process.env.E2E_LOCAL_BASE_URL;
  try {
    delete process.env.E2E_LOCAL_BASE_URL;
    const { default: config } = await import("../playwright.config.mjs");
    assert.deepEqual(config.projects.map(project => project.name), ["chromium", "mobile-chromium", "cloud-runtime-mocked", "production-smoke"]);
    assert.equal(config.projects[0].use.baseURL, undefined);
    assert.equal(config.projects[1].use.baseURL, undefined);
    process.env.E2E_LOCAL_BASE_URL = "http://127.0.0.1:54321";
    const { default: configured } = await import("../playwright.config.mjs?runtime-url");
    assert.equal(configured.projects[0].use.baseURL, "http://127.0.0.1:54321");
    assert.equal(configured.projects[1].use.baseURL, "http://127.0.0.1:54321");
  } finally {
    if (previous === undefined) delete process.env.E2E_LOCAL_BASE_URL;
    else process.env.E2E_LOCAL_BASE_URL = previous;
  }
});

test("e2e.sh refuses a local service without a matching fixture run marker", () => inTemp(dir => {
  const log = join(dir, "calls");
  const playwright = fakeCommand(dir, "playwright", `echo called >> "${log}"`);
  const result = run(e2eScript, {
    E2E_PLAYWRIGHT_BIN: playwright,
    E2E_PROJECT: "chromium",
    E2E_LOCAL_BASE_URL: "http://127.0.0.1:54321",
    E2E_RUN_ID: "expected-run",
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /fixture|run marker|E2E_RUN_ID/i);
  assert.throws(() => readFileSync(log));
}));

test("e2e.sh requires fixture URL and run identity for local execution", () => inTemp(dir => {
  const playwright = fakeCommand(dir, "playwright", "exit 0");
  const result = run(e2eScript, { E2E_PLAYWRIGHT_BIN: playwright, E2E_PROJECT: "chromium", E2E_LOCAL_BASE_URL: "", E2E_RUN_ID: "" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /E2E_LOCAL_BASE_URL|E2E_RUN_ID/);
}));

for (const [description, baseUrl] of [
  ["a non-loopback fixture URL", "http://example.com:4321/"],
  ["a fixture URL with embedded credentials", "http://user:password@127.0.0.1:4321/"],
]) {
  test(`e2e.sh rejects ${description} before invoking Playwright`, () => inTemp(dir => {
    const log = join(dir, "calls");
    const playwright = fakeCommand(dir, "playwright", `echo called >> "${log}"`);
    const result = run(e2eScript, {
      E2E_PLAYWRIGHT_BIN: playwright,
      E2E_PROJECT: "chromium",
      E2E_LOCAL_BASE_URL: baseUrl,
      E2E_RUN_ID: "expected-run",
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /plain loopback HTTP origin/);
    assert.throws(() => readFileSync(log));
  }));
}

test("e2e.sh rejects a redirected fixture marker before invoking Playwright", async () => {
  const server = spawn(process.execPath, ["--input-type=module", "-e", `
    import { createServer } from "node:http";
    createServer((req, res) => {
      if (req.url === "/__e2e__/health") {
        res.writeHead(302, { location: "/marker-final" });
        res.end();
        return;
      }
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ runId: "expected-run" }));
    }).listen(0, "127.0.0.1", function () { console.log(this.address().port); });
  `], { stdio: ["ignore", "pipe", "pipe"] });
  try {
    const port = await new Promise((resolve, reject) => {
      server.stdout.once("data", chunk => resolve(Number(chunk.toString().trim())));
      server.once("error", reject);
      server.once("exit", code => reject(new Error(`fixture server exited ${code}`)));
    });
    inTemp(dir => {
      const log = join(dir, "calls");
      const playwright = fakeCommand(dir, "playwright", `echo called >> "${log}"`);
      const result = run(e2eScript, {
        E2E_PLAYWRIGHT_BIN: playwright,
        E2E_PROJECT: "chromium",
        E2E_LOCAL_BASE_URL: `http://127.0.0.1:${port}`,
        E2E_RUN_ID: "expected-run",
      });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /fixture verification failed/i);
      assert.throws(() => readFileSync(log));
    });
  } finally {
    server.kill();
  }
});

test("e2e.sh accepts a matching isolated fixture marker", async () => {
  const server = spawn(process.execPath, ["--input-type=module", "-e", `
    import { createServer } from "node:http";
    createServer((req, res) => {
      if (req.url !== "/__e2e__/health") { res.writeHead(404); res.end(); return; }
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ runId: "expected-run" }));
    }).listen(0, "127.0.0.1", function () { console.log(this.address().port); });
  `], { stdio: ["ignore", "pipe", "pipe"] });
  try {
    const port = await new Promise((resolve, reject) => {
      server.stdout.once("data", chunk => resolve(Number(chunk.toString().trim())));
      server.once("error", reject);
      server.once("exit", code => reject(new Error(`fixture server exited ${code}`)));
    });
    inTemp(dir => {
      const log = join(dir, "calls");
      const playwright = fakeCommand(dir, "playwright", `echo called >> "${log}"`);
      const wrong = run(e2eScript, {
        E2E_PLAYWRIGHT_BIN: playwright,
        E2E_PROJECT: "chromium",
        E2E_LOCAL_BASE_URL: `http://127.0.0.1:${port}`,
        E2E_RUN_ID: "different-run",
      });
      assert.notEqual(wrong.status, 0);
      assert.match(wrong.stderr, /run marker/);
      assert.throws(() => readFileSync(log));
      const result = run(e2eScript, {
        E2E_PLAYWRIGHT_BIN: playwright,
        E2E_PROJECT: "chromium",
        E2E_LOCAL_BASE_URL: `http://127.0.0.1:${port}`,
        E2E_RUN_ID: "expected-run",
      });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(readFileSync(log, "utf8"), "called\n");
    });
  } finally {
    server.kill();
  }
});

test("e2e.sh --list includes the bootstrap spec without a fixture", () => {
  const result = run(e2eScript, { E2E_PROJECT: "chromium", E2E_BASE_URL: "", E2E_LOCAL_BASE_URL: "", E2E_RUN_ID: "" }, ["--list"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /bootstrap\.spec\.mjs/);
});
