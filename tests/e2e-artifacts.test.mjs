import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:http";
import { once } from "node:events";
import { fileURLToPath } from "node:url";

import { runProductionSmoke, writeRedactedArtifacts } from "../e2e/specs/production-smoke.spec.mjs";
import { redactE2ELog } from "../e2e/support/redaction.mjs";

function response(status, body = "ok", headers = {}) {
  return { status, headers: new Headers(headers), text: async () => body };
}

test("production smoke performs only exact anonymous GET allowlisted checks", async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), ...options });
    const parsed = new URL(url);
    if (parsed.pathname === "/") return response(200, "<html>fixture root</html>", { "content-type": "text/html" });
    if (parsed.pathname === "/healthz") return response(200, JSON.stringify({ ok: true }), { "content-type": "application/json" });
    if (parsed.pathname === "/api/healthz") return response(200, JSON.stringify({ ok: true }), { "content-type": "application/json" });
    if (parsed.pathname === "/line-auth") return response(200, "login", { "content-type": "text/html" });
    if (parsed.pathname === "/mobile-menu.css") return response(200, "body{}", { "content-type": "text/css" });
    if (parsed.pathname === "/line-auth.browser.js") return response(200, "window.auth = true", { "content-type": "text/javascript" });
    if (parsed.pathname === "/api/workflow-documents") return response(401, JSON.stringify({ error: "auth required" }), { "content-type": "application/json" });
    throw new Error(`unexpected request: ${parsed.pathname}`);
  };

  const report = await runProductionSmoke({ baseUrl: "https://example.test/", fetchImpl });
  assert.equal(report.ok, true);
  assert.ok(calls.length > 0);
  assert.ok(calls.every(call => call.method === "GET"));
  assert.ok(calls.every(call => call.redirect === "error"));
  assert.ok(calls.every(call => !call.headers || !Object.keys(call.headers).some(key => key.toLowerCase() === "cookie")));
  assert.deepEqual([...new Set(calls.map(call => new URL(call.url).pathname))].sort(), ["/", "/api/healthz", "/api/workflow-documents", "/healthz", "/line-auth", "/line-auth.browser.js", "/mobile-menu.css"]);
});

test("production smoke rejects callback, mutation, redirect and non-allowlisted responses", async () => {
  await assert.rejects(() => runProductionSmoke({
    baseUrl: "https://example.test",
    fetchImpl: async () => response(302, "", { location: "/oauth/callback" }),
  }), /redirect|unexpected status/i);

  await assert.rejects(() => runProductionSmoke({
    baseUrl: "https://example.test",
    fetchImpl: async (_url, options) => response(options.method === "GET" ? 200 : 204),
  }), /mutation|allowlist|unexpected/i);
});

test("artifact writer redacts credentials, cookies, file tokens and business bytes", async () => {
  const reportDir = await mkdtemp(path.join(os.tmpdir(), "sweet-house-artifacts-"));
  try {
    await writeRedactedArtifacts({
      reportDir,
      events: [{
        cookie: "sweet_house_session=secret-cookie",
        authorization: "Bearer service-key-12345678901234567890",
        oauthCode: "oauth-secret",
        fileToken: "file-token-secret",
        document: "REAL FIXTURE DOCUMENT TEXT",
        body: "business-file-bytes PDF-CONTENTS",
      }],
    });
    const files = await readdir(reportDir);
    assert.deepEqual(files.sort(), ["e2e-report.json", "e2e-report.log"]);
    const output = `${await readFile(path.join(reportDir, "e2e-report.json"), "utf8")}\n${await readFile(path.join(reportDir, "e2e-report.log"), "utf8")}`;
    for (const secret of ["secret-cookie", "service-key-", "oauth-secret", "file-token-secret", "REAL FIXTURE DOCUMENT TEXT", "PDF-CONTENTS"]) {
      assert.doesNotMatch(output, new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
    assert.match(output, /\[REDACTED\]/);
  } finally {
    await rm(reportDir, { recursive: true, force: true });
  }
});

test("recursive redaction removes nested secrets, storage state, traces and structured bytes", () => {
  const redacted = redactE2ELog({
    nested: [{ cookie: "nested-cookie", document: "REAL BUSINESS TEXT" }],
    storageState: { cookies: [{ value: "session-value" }], origins: [{ localStorage: [{ value: "oauth-secret" }] }] },
    trace: { request: { body: "PDF-CONTENTS" } },
    metadata: { fileToken: "file-token-secret", authorization: "Bearer service-key-12345678901234567890" },
  });
  for (const secret of ["nested-cookie", "REAL BUSINESS TEXT", "session-value", "oauth-secret", "PDF-CONTENTS", "file-token-secret", "service-key-"]) {
    assert.doesNotMatch(redacted, new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(redacted, /\[REDACTED\]/);
});

test("production smoke has no Playwright import or launch path", async () => {
  const smokeSource = await readFile(new URL("../e2e/specs/production-smoke.spec.mjs", import.meta.url), "utf8");
  const runnerSource = await readFile(new URL("../scripts/e2e.sh", import.meta.url), "utf8");
  assert.doesNotMatch(smokeSource, /@playwright|APIRequestContext|request\.fetch/);
  assert.match(runnerSource, /production-smoke: direct Node HTTP smoke/);
  assert.match(runnerSource, /exec "\$NODE_BIN" "\$REPO_DIR\/e2e\/specs\/production-smoke\.spec\.mjs"/);
});

test("production smoke accepts the real isolated application's public routes and protected API", async () => {
  const { createE2EEnvironment } = await import("../e2e/fixtures/app-server.fixture.mjs");
  const app = await createE2EEnvironment();
  try {
    assert.equal((await fetch(new URL("/workflow-documents", app.baseUrl))).status, 200);
    const report = await runProductionSmoke({ baseUrl: app.baseUrl });
    assert.equal(report.ok, true);
    assert.equal(report.checks.find(check => check.path === "/api/workflow-documents").status, 401);
    const { stdout } = await promisify(execFile)("/bin/bash", [fileURLToPath(new URL("../scripts/e2e.sh", import.meta.url)), "--project", "production-smoke"], {
      env: { ...process.env, E2E_BASE_URL: app.baseUrl, E2E_NODE_BIN: process.execPath, E2E_PLAYWRIGHT_BIN: "/not-installed" },
    });
    assert.deepEqual(JSON.parse(stdout).checks, report.checks);
  } finally { await app.stop(); }
});

test("production smoke never follows an HTTP redirect to a callback", async () => {
  const paths = [];
  const server = createServer((req, res) => {
    paths.push(req.url);
    res.writeHead(302, { location: "/api/google-drive/oauth2callback?code=forbidden" });
    res.end();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    await assert.rejects(runProductionSmoke({ baseUrl: `http://127.0.0.1:${server.address().port}` }));
    assert.deepEqual(paths, ["/"]);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
