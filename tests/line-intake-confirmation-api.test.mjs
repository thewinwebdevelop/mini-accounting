import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createLocalLineIntakeStore } = require("../forms/line-intake.logic.js");

async function waitForServerPort(child) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("local server did not start")), 5000);
    child.stdout.on("data", chunk => {
      const match = chunk.toString().match(/Expense request local web app: http:\/\/localhost:(\d+)\//);
      if (match) { clearTimeout(timeout); resolve(Number(match[1])); }
    });
    child.once("error", reject);
    child.once("exit", code => reject(new Error(`local server exited with ${code}`)));
  });
}

async function jsonRequest(baseUrl, route, options = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) },
  });
  return { response, body: await response.json() };
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", chunk => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

async function startProfileUpstream({ profileFailure = false } = {}) {
  const { createServer } = await import("node:http");
  const upstream = createServer(async (request, response) => {
    if (request.url === "/oauth2/v2.1/verify") {
      await readBody(request);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ iss: "https://access.line.me", sub: "U-profile", aud: "channel-1", exp: Math.floor(Date.now() / 1000) + 3600, iat: Math.floor(Date.now() / 1000) - 10, name: "LINE display name" }));
      return;
    }
    if (request.url.startsWith("/rest/v1/app_users")) {
      await readBody(request);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify([{ id: "profile-user", line_user_id: "U-profile", display_name: "LINE display name", status: "active", app_user_roles: [{ role_code: "employee" }] }]));
      return;
    }
    if (request.url.startsWith("/rest/v1/app_user_profiles")) {
      await readBody(request);
      if (profileFailure) {
        response.writeHead(500, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "profile unavailable" }));
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify([{ user_id: "profile-user", first_name: "ชื่อโปรไฟล์", last_name: "นามสกุลโปรไฟล์", company_position_id: "position-profile", company_positions: { label: "ผู้จัดการ" }, app_users: { display_name: "LINE display name" } }]));
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

async function startAuthenticatedApp(rootDir, upstream) {
  const child = spawn(process.execPath, ["local-server.mjs"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, PORT: "0", SWEET_HOUSE_ROOT_DIR: rootDir, SWEET_HOUSE_AUTH_MODE: "line", LINE_CHANNEL_ID: "channel-1", LINE_VERIFY_URL: `${upstream.url}/oauth2/v2.1/verify`, SUPABASE_URL: upstream.url, SUPABASE_SERVICE_ROLE_KEY: "server-key", SWEET_HOUSE_SESSION_SECRET: "x".repeat(32), LINE_INTAKE_BACKEND: "local", LINE_OCR_PROVIDER: "manual" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const port = await waitForServerPort(child);
  const baseUrl = `http://localhost:${port}`;
  const login = await jsonRequest(baseUrl, "/api/auth/line-session", { method: "POST", body: JSON.stringify({ idToken: "valid-token" }) });
  assert.equal(login.response.status, 200, login.body.error);
  return { child, baseUrl, cookie: login.response.headers.get("set-cookie").split(";")[0] };
}

async function createConfirmableIntake(rootDir, lineUserId = "U-profile") {
  const store = createLocalLineIntakeStore({ rootDir, maxBytes: 1024 * 1024 });
  return store.create({ eventId: `evt-${lineUserId}`, messageId: `msg-${lineUserId}`, lineUserId, mediaKind: "pdf", originalName: "invoice.pdf", contentType: "application/pdf", bytes: Buffer.from("%PDF-original") });
}

const confirmationPayload = {
  accountingMonth: "2026-09", expenseDate: "2026-09-25", businessPurpose: "ค่าใช้จ่ายจาก invoice", paymentTargetName: "ร้านตัวอย่าง", requestType: "reimbursement", requestTitle: "Invoice จาก LINE",
  expenseLines: [{ date: "2026-09-25", description: "ค่าบริการ", amountBeforeVat: "100.00", vatAmount: "7.00", withholdingTax: "0.00", category: "ทั่วไป" }],
};

test("LINE intake review scans and confirmation creates one expense draft with original evidence", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-line-confirm-"));
  const store = createLocalLineIntakeStore({ rootDir, maxBytes: 1024 * 1024 });
  const intake = await store.create({
    eventId: "evt-confirm", messageId: "msg-confirm", lineUserId: "U-confirm", mediaKind: "pdf",
    originalName: "invoice.pdf", contentType: "application/pdf", bytes: Buffer.from("%PDF-original"),
  });
  const child = spawn(process.execPath, ["local-server.mjs"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, PORT: "0", SWEET_HOUSE_ROOT_DIR: rootDir, SWEET_HOUSE_AUTH_MODE: "disabled", LINE_INTAKE_BACKEND: "local", LINE_OCR_PROVIDER: "manual" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    const port = await waitForServerPort(child);
    const baseUrl = `http://localhost:${port}`;
    const reviewed = await jsonRequest(baseUrl, `/api/line-intakes/${intake.item.id}`);
    assert.equal(reviewed.response.status, 200);
    assert.equal(reviewed.body.intake.ocrStatus, "needs_review");
    assert.equal(reviewed.body.intake.ocrProvider, "manual");
    assert.equal(reviewed.body.intake.storagePath, undefined);

    const incomplete = await jsonRequest(baseUrl, `/api/line-intakes/${intake.item.id}/confirm`, { method: "POST", body: JSON.stringify({}) });
    assert.equal(incomplete.response.status, 400);
    assert.match(incomplete.body.error, /เดือนบัญชี|ชื่อผู้ขอ/);

    const payload = {
      accountingMonth: "2026-09", expenseDate: "2026-09-25", requesterName: "ผู้ทดสอบ",
      businessPurpose: "ค่าใช้จ่ายจาก invoice", paymentTargetName: "ร้านตัวอย่าง", requestType: "reimbursement",
      requestTitle: "Invoice จาก LINE", expenseLines: [{ date: "2026-09-25", description: "ค่าบริการ", amountBeforeVat: "100.00", vatAmount: "7.00", withholdingTax: "0.00", category: "ทั่วไป" }],
    };
    const confirmed = await jsonRequest(baseUrl, `/api/line-intakes/${intake.item.id}/confirm`, { method: "POST", body: JSON.stringify(payload) });
    assert.equal(confirmed.response.status, 200, confirmed.body.error);
    assert.equal(confirmed.body.intake.status, "confirmed");
    assert.equal(confirmed.body.document.status, "draft");
    assert.match(confirmed.body.document.requestNo, /^REQ-2026-09-\d{4}$/);
    const rawPath = join(rootDir, confirmed.body.document.folderPath, "raw", "A1_receipt_001.pdf");
    assert.equal(await readFile(rawPath, "utf8"), "%PDF-original");

    const repeated = await jsonRequest(baseUrl, `/api/line-intakes/${intake.item.id}/confirm`, { method: "POST", body: JSON.stringify(payload) });
    assert.equal(repeated.response.status, 200);
    assert.equal(repeated.body.document.requestNo, confirmed.body.document.requestNo);
    assert.equal(repeated.body.idempotent, true);
  } finally {
    child.kill();
    await new Promise(resolve => child.once("exit", resolve));
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("LINE confirmation fills missing requester fields from the authenticated profile", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-line-profile-confirm-"));
  const upstream = await startProfileUpstream();
  const app = await startAuthenticatedApp(rootDir, upstream);
  const intake = await createConfirmableIntake(rootDir);
  try {
    const confirmed = await jsonRequest(app.baseUrl, `/api/line-intakes/${intake.item.id}/confirm`, { method: "POST", headers: { cookie: app.cookie }, body: JSON.stringify(confirmationPayload) });
    assert.equal(confirmed.response.status, 200, confirmed.body.error);
    const saved = JSON.parse(await readFile(join(rootDir, confirmed.body.document.folderPath, "data", "submission.json"), "utf8"));
    assert.equal(saved.requesterName, "ชื่อโปรไฟล์ นามสกุลโปรไฟล์");
    assert.equal(saved.requesterRole, "ผู้จัดการ");
    assert.equal(saved.ownerUserId, "profile-user");
  } finally {
    app.child.kill(); await new Promise(resolve => app.child.once("exit", resolve));
    await new Promise(resolve => upstream.server.close(resolve)); await rm(rootDir, { recursive: true, force: true });
  }
});

test("LINE confirmation keeps explicit requester fields ahead of profile values", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-line-profile-precedence-"));
  const upstream = await startProfileUpstream();
  const app = await startAuthenticatedApp(rootDir, upstream);
  const intake = await createConfirmableIntake(rootDir);
  try {
    const confirmed = await jsonRequest(app.baseUrl, `/api/line-intakes/${intake.item.id}/confirm`, { method: "POST", headers: { cookie: app.cookie }, body: JSON.stringify({ ...confirmationPayload, requesterName: "ชื่อจากใบส่ง", requesterRole: "ผู้ตรวจสอบ" }) });
    assert.equal(confirmed.response.status, 200, confirmed.body.error);
    const saved = JSON.parse(await readFile(join(rootDir, confirmed.body.document.folderPath, "data", "submission.json"), "utf8"));
    assert.equal(saved.requesterName, "ชื่อจากใบส่ง");
    assert.equal(saved.requesterRole, "ผู้ตรวจสอบ");
  } finally {
    app.child.kill(); await new Promise(resolve => app.child.once("exit", resolve));
    await new Promise(resolve => upstream.server.close(resolve)); await rm(rootDir, { recursive: true, force: true });
  }
});

test("LINE confirmation remains available when profile lookup fails", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-line-profile-failure-"));
  const upstream = await startProfileUpstream({ profileFailure: true });
  const app = await startAuthenticatedApp(rootDir, upstream);
  const intake = await createConfirmableIntake(rootDir);
  try {
    const confirmed = await jsonRequest(app.baseUrl, `/api/line-intakes/${intake.item.id}/confirm`, { method: "POST", headers: { cookie: app.cookie }, body: JSON.stringify(confirmationPayload) });
    assert.equal(confirmed.response.status, 200, confirmed.body.error);
    const saved = JSON.parse(await readFile(join(rootDir, confirmed.body.document.folderPath, "data", "submission.json"), "utf8"));
    assert.equal(saved.requesterName, "LINE display name");
    assert.equal(saved.requesterRole, "");
  } finally {
    app.child.kill(); await new Promise(resolve => app.child.once("exit", resolve));
    await new Promise(resolve => upstream.server.close(resolve)); await rm(rootDir, { recursive: true, force: true });
  }
});
