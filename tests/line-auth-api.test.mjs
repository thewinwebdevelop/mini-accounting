import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import serverLogic from "../forms/local-server.logic.js";

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", chunk => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

async function startUpstream({ role = "employee" } = {}) {
  const upstream = createServer(async (request, response) => {
    if (request.url === "/oauth2/v2.1/verify") {
      await readBody(request);
      const now = Math.floor(Date.now() / 1000);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        iss: "https://access.line.me",
        sub: "U123",
        aud: "channel-1",
        exp: now + 3600,
        iat: now - 10,
        name: "ผู้ใช้จริง",
        picture: "https://example.com/p.png",
      }));
      return;
    }
    if (request.url.startsWith("/rest/v1/app_users")) {
      await readBody(request);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(request.method === "POST"
        ? [{ id: "user-1", line_user_id: "U123", status: "active" }]
        : [{
          id: "user-1",
          line_user_id: "U123",
          display_name: "ผู้ใช้จริง",
          picture_url: "https://example.com/p.png",
          status: "active",
          app_user_roles: [{ role_code: role }],
        }]));
      return;
    }
    response.writeHead(404);
    response.end();
  });
  await new Promise((resolve, reject) => {
    upstream.once("error", reject);
    upstream.listen(0, "127.0.0.1", resolve);
  });
  return { server: upstream, url: `http://127.0.0.1:${upstream.address().port}` };
}

async function startApp(env) {
  const child = spawn(process.execPath, ["local-server.mjs"], {
    cwd: process.cwd(),
    env: { ...process.env, ...env, PORT: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output = [];
  const wait = new Promise((resolve, reject) => {
    const onData = chunk => {
      const text = chunk.toString();
      output.push(text);
      const match = text.match(/Expense request local web app: http:\/\/localhost:(\d+)\//);
      if (match) resolve(`http://127.0.0.1:${match[1]}`);
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", chunk => output.push(chunk.toString()));
    child.once("error", reject);
    child.once("exit", code => reject(new Error(`server exited ${code}: ${output.join("")}`)));
  });
  const baseUrl = await Promise.race([
    wait,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`server timeout: ${output.join("")}`)), 5000)),
  ]);
  return { child, baseUrl };
}

async function stopApp(child) {
  child.kill("SIGTERM");
  await new Promise(resolve => child.once("exit", resolve));
}

test("LINE session route creates a cookie and /me returns the resolved app user", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-line-auth-"));
  const upstream = await startUpstream();
  const app = await startApp({
    SWEET_HOUSE_ROOT_DIR: rootDir,
    SWEET_HOUSE_AUTH_MODE: "line",
    LINE_CHANNEL_ID: "channel-1",
    LINE_VERIFY_URL: `${upstream.url}/oauth2/v2.1/verify`,
    SUPABASE_URL: upstream.url,
    SUPABASE_SERVICE_ROLE_KEY: "server-key",
    SWEET_HOUSE_SESSION_SECRET: "x".repeat(32),
  });
  try {
    const login = await fetch(`${app.baseUrl}/api/auth/line-session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idToken: "valid-token" }),
    });
    assert.equal(login.status, 200);
    assert.deepEqual((await login.json()).user, {
      id: "user-1",
      lineUserId: "U123",
      displayName: "ผู้ใช้จริง",
      pictureUrl: "https://example.com/p.png",
      status: "active",
      role: "employee",
    });
    const cookie = login.headers.get("set-cookie").split(";")[0];
    assert.match(login.headers.get("set-cookie"), /HttpOnly/);

    const me = await fetch(`${app.baseUrl}/api/auth/me`, { headers: { cookie } });
    assert.equal(me.status, 200);
    assert.deepEqual((await me.json()).user.role, "employee");
  } finally {
    await stopApp(app.child);
    await new Promise(resolve => upstream.server.close(resolve));
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("line auth mode rejects unauthenticated domain APIs and tampered sessions", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-line-auth-guard-"));
  const upstream = await startUpstream();
  const app = await startApp({
    SWEET_HOUSE_ROOT_DIR: rootDir,
    SWEET_HOUSE_AUTH_MODE: "line",
    LINE_CHANNEL_ID: "channel-1",
    LINE_VERIFY_URL: `${upstream.url}/oauth2/v2.1/verify`,
    SUPABASE_URL: upstream.url,
    SUPABASE_SERVICE_ROLE_KEY: "server-key",
    SWEET_HOUSE_SESSION_SECRET: "x".repeat(32),
  });
  try {
    const missing = await fetch(`${app.baseUrl}/api/company-settings`);
    assert.equal(missing.status, 401);
    assert.equal((await missing.json()).code, "AUTH_REQUIRED");

    const tampered = await fetch(`${app.baseUrl}/api/company-settings`, {
      headers: { cookie: "sweet_house_session=not-valid" },
    });
    assert.equal(tampered.status, 401);
    assert.equal((await tampered.json()).code, "AUTH_REQUIRED");
  } finally {
    await stopApp(app.child);
    await new Promise(resolve => upstream.server.close(resolve));
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("line session owns new numbered documents and rejects privileged lifecycle actions for employees", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-line-owner-"));
  const upstream = await startUpstream();
  const app = await startApp({
    SWEET_HOUSE_ROOT_DIR: rootDir,
    SWEET_HOUSE_AUTH_MODE: "line",
    LINE_CHANNEL_ID: "channel-1",
    LINE_VERIFY_URL: `${upstream.url}/oauth2/v2.1/verify`,
    SUPABASE_URL: upstream.url,
    SUPABASE_SERVICE_ROLE_KEY: "server-key",
    SWEET_HOUSE_SESSION_SECRET: "x".repeat(32),
  });
  try {
    const login = await fetch(`${app.baseUrl}/api/auth/line-session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idToken: "valid-token" }),
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie").split(";")[0];
    const payload = {
      accountingMonth: "2026-09",
      requestTitle: "คำขอจาก LINE",
      requestType: "reimbursement",
      requesterName: "ผู้ขอ",
      businessPurpose: "ทดสอบ owner binding",
      paymentTargetName: "ผู้ขอ",
      ownerUserId: "attacker-user",
      expenseLines: [{
        date: "2026-09-05",
        category: "ทดสอบ",
        description: "รายการทดสอบ",
        vendor: "ร้านค้า",
        amountBeforeVat: "100",
        vatAmount: "0",
        withholdingTax: "0",
      }],
    };

    const draftForm = new FormData();
    draftForm.append("payload", JSON.stringify(payload));
    const draftResponse = await fetch(`${app.baseUrl}/api/expense-drafts`, {
      method: "POST",
      headers: { cookie },
      body: draftForm,
    });
    assert.equal(draftResponse.status, 200);
    const draft = await draftResponse.json();
    const draftPath = join(rootDir, draft.folderPath, "data", "submission.json");
    const storedDraft = JSON.parse(await readFile(draftPath, "utf8"));
    assert.equal(storedDraft.ownerUserId, "user-1");

    const submitForm = new FormData();
    submitForm.append("payload", JSON.stringify({ requestNo: draft.requestNo, ownerUserId: "attacker-user" }));
    const submitResponse = await fetch(`${app.baseUrl}/api/expense-requests`, {
      method: "POST",
      headers: { cookie },
      body: submitForm,
    });
    assert.equal(submitResponse.status, 200);

    const approveResponse = await fetch(`${app.baseUrl}/api/expense-requests/${draft.requestNo}/approve`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ approvedBy: "attacker" }),
    });
    assert.equal(approveResponse.status, 403);
    assert.equal((await approveResponse.json()).code, "AUTH_FORBIDDEN");
    const storedAfterDeniedApproval = JSON.parse(await readFile(draftPath, "utf8"));
    assert.equal(storedAfterDeniedApproval.ownerUserId, "user-1");
    assert.equal(storedAfterDeniedApproval.status, "pending_approval");
  } finally {
    await stopApp(app.child);
    await new Promise(resolve => upstream.server.close(resolve));
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("employee cannot read another user's or legacy document files, while owner can", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-line-resource-"));
  const other = await serverLogic.saveExpenseDraft({
    rootDir,
    payload: {
      accountingMonth: "2026-09",
      requestTitle: "เอกสารของคนอื่น",
      requestType: "reimbursement",
      ownerUserId: "user-2",
    },
    uploads: [{ evidenceKey: "receipt", originalName: "other.txt", type: "text/plain", buffer: Buffer.from("other") }],
  });
  const legacy = await serverLogic.saveExpenseDraft({
    rootDir,
    payload: {
      accountingMonth: "2026-09",
      requestTitle: "เอกสาร legacy",
      requestType: "reimbursement",
    },
    uploads: [{ evidenceKey: "receipt", originalName: "legacy.txt", type: "text/plain", buffer: Buffer.from("legacy") }],
  });
  const pending = await serverLogic.saveExpenseSubmission({
    rootDir,
    payload: {
      accountingMonth: "2026-09",
      requestTitle: "รออนุมัติ",
      requestType: "reimbursement",
      requesterName: "ผู้ขอ",
      businessPurpose: "ทดสอบ role gate",
      paymentTargetName: "ผู้ขอ",
      ownerUserId: "user-2",
      expenseLines: [{
        date: "2026-09-05",
        category: "ทดสอบ",
        description: "รายการทดสอบ",
        vendor: "ร้านค้า",
        amountBeforeVat: "100",
        vatAmount: "0",
        withholdingTax: "0",
      }],
    },
  });
  const upstream = await startUpstream();
  const app = await startApp({
    SWEET_HOUSE_ROOT_DIR: rootDir,
    SWEET_HOUSE_AUTH_MODE: "line",
    LINE_CHANNEL_ID: "channel-1",
    LINE_VERIFY_URL: `${upstream.url}/oauth2/v2.1/verify`,
    SUPABASE_URL: upstream.url,
    SUPABASE_SERVICE_ROLE_KEY: "server-key",
    SWEET_HOUSE_SESSION_SECRET: "x".repeat(32),
  });
  try {
    const login = await fetch(`${app.baseUrl}/api/auth/line-session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idToken: "valid-token" }),
    });
    const cookie = login.headers.get("set-cookie").split(";")[0];
    for (const record of [other, legacy]) {
      const response = await fetch(`${app.baseUrl}/api/expense-requests/${record.requestNo}/files/raw/A1_receipt_001.txt`, { headers: { cookie } });
      assert.equal(response.status, 403);
      assert.equal((await response.json()).code, "AUTH_FORBIDDEN");
    }
  } finally {
    await stopApp(app.child);
    await new Promise(resolve => upstream.server.close(resolve));
  }

  const ownerUpstream = await startUpstream({ role: "owner" });
  const ownerApp = await startApp({
    SWEET_HOUSE_ROOT_DIR: rootDir,
    SWEET_HOUSE_AUTH_MODE: "line",
    LINE_CHANNEL_ID: "channel-1",
    LINE_VERIFY_URL: `${ownerUpstream.url}/oauth2/v2.1/verify`,
    SUPABASE_URL: ownerUpstream.url,
    SUPABASE_SERVICE_ROLE_KEY: "server-key",
    SWEET_HOUSE_SESSION_SECRET: "x".repeat(32),
  });
  try {
    const login = await fetch(`${ownerApp.baseUrl}/api/auth/line-session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idToken: "valid-token" }),
    });
    const cookie = login.headers.get("set-cookie").split(";")[0];
    const response = await fetch(`${ownerApp.baseUrl}/api/expense-requests/${other.requestNo}/files/raw/A1_receipt_001.txt`, { headers: { cookie } });
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "other");
    const approve = await fetch(`${ownerApp.baseUrl}/api/expense-requests/${pending.requestNo}/approve`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ approvedBy: "forged" }),
    });
    assert.equal(approve.status, 200);
    const storedApproved = JSON.parse(await readFile(join(rootDir, pending.folderPath, "data", "submission.json"), "utf8"));
    assert.equal(storedApproved.approvedBy, "ผู้ใช้จริง");
    assert.equal(storedApproved.statusHistory.at(-1).actor, "ผู้ใช้จริง");
  } finally {
    await stopApp(ownerApp.child);
    await new Promise(resolve => ownerUpstream.server.close(resolve));
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("production line auth rejects unsafe requests when public origin is missing", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-line-origin-"));
  const upstream = await startUpstream();
  const app = await startApp({
    NODE_ENV: "production",
    SWEET_HOUSE_ROOT_DIR: rootDir,
    SWEET_HOUSE_AUTH_MODE: "line",
    LINE_CHANNEL_ID: "channel-1",
    SUPABASE_URL: upstream.url,
    SUPABASE_SERVICE_ROLE_KEY: "server-key",
    SWEET_HOUSE_SESSION_SECRET: "x".repeat(32),
    APP_PUBLIC_ORIGIN: "",
  });
  try {
    const response = await fetch(`${app.baseUrl}/api/company-settings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ legalName: "ไม่ควรผ่าน" }),
    });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, "AUTH_CONFIG_MISSING");
  } finally {
    await stopApp(app.child);
    await new Promise(resolve => upstream.server.close(resolve));
    await rm(rootDir, { recursive: true, force: true });
  }
});
