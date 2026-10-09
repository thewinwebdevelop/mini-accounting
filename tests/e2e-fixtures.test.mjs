import test from "node:test";
import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";

import { createE2EEnvironment } from "../e2e/fixtures/app-server.fixture.mjs";
import { createFixtureData } from "../e2e/fixtures/data-seed.mjs";
import { createTestSession, PERSONAS } from "../e2e/fixtures/auth.fixture.mjs";
import { createMockProviders } from "../e2e/fixtures/mock-providers.mjs";
import { createCloudRuntimeMock } from "../e2e/fixtures/cloud-runtime-mock.mjs";
import { redactE2ELog } from "../e2e/support/redaction.mjs";
const execFileAsync = promisify(execFile);

test("local environments use fresh isolated roots and the health marker", async () => {
  const first = await createE2EEnvironment({ profile: "local", workerIndex: 0 });
  const second = await createE2EEnvironment({ profile: "local", workerIndex: 1 });
  try {
    assert.notEqual(first.runId, second.runId);
    assert.notEqual(first.rootDir, second.rootDir);
    assert.match(first.baseUrl, /^http:\/\/127\.0\.0\.1:\d+\/$/);
    assert.deepEqual((await fetch(new URL("__e2e__/health", first.baseUrl)).then(r => r.json())).runId, first.runId);
    assert.equal(first.mock.requests.every(request => Object.values(first.mock.baseUrls).some(url => request.host === new URL(url).host)), true);
  } finally {
    await Promise.all([first.stop(), second.stop()]);
  }
  await assert.rejects(access(first.rootDir));
  await assert.rejects(access(second.rootDir));
});

test("fixture seed contains every required persona and business fixture", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "sweet-house-seed-test-"));
  try {
    const seed = await createFixtureData({ rootDir, runId: "seed-test" });
    assert.deepEqual(Object.keys(seed.users).sort(), ["accounting", "admin", "employeeA", "employeeB", "inactive", "owner", "pending"]);
    assert.ok(seed.vendors.length > 0);
    assert.ok(seed.inventory.length > 0);
    assert.ok(seed.documents.length > 0);
    assert.ok(seed.templates.length > 0);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("sessions can be created for each persona", () => {
  for (const persona of Object.values(PERSONAS)) {
    const token = createTestSession({ ...persona, secret: "e2e-test-session-secret-012345678901234567890123" });
    assert.match(token, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  }
});

test("provider mock rejects unexpected outbound hosts and supports strict request logs", async () => {
  const mock = await createMockProviders({ profile: "local", runId: "mock-test" });
  try {
    await assert.rejects(fetch("https://example.invalid/not-allowed"));
    const response = await fetch(`${mock.baseUrls.supabase}/rest/v1/fixture_probe`, { method: "GET" });
    assert.equal(response.status, 200);
    assert.equal(mock.requests.at(-1).path, "/rest/v1/fixture_probe");
    const rejected = await fetch(`${mock.baseUrls.supabase}/not-allowlisted`, { method: "DELETE" });
    assert.equal(rejected.status, 404);
    assert.match(await rejected.text(), /unexpected mock endpoint/);
    const wrongHost = await fetch(`${mock.baseUrls.supabase.replace("127.0.0.1", "localhost")}/rest/v1/fixture_probe`);
    assert.equal(wrongHost.status, 400);
    const wrongBody = await fetch(`${mock.baseUrls.line}/v2/bot/message/reply`, { method: "POST", body: "not-json" });
    assert.equal(wrongBody.status, 400);
    const extraField = await fetch(`${mock.baseUrls.line}/v2/bot/message/reply`, { method: "POST", body: JSON.stringify({ replyToken: "fixture", messages: [], extra: true }) });
    assert.equal(extraField.status, 400);
    const nearMiss = await fetch(`${mock.baseUrls.supabase}/rest/v1/fixture_probe/near-miss`);
    assert.equal(nearMiss.status, 404);
    const badQuery = await fetch(`${mock.baseUrls.google}/drive/v3/files?unexpected=true`);
    assert.equal(badQuery.status, 404);
    const badShopeeBody = await fetch(`${mock.baseUrls.shopee}/api/v2/auth/token/get?partner_id=1&timestamp=1&sign=s`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ partner_id: 1, code: "fixture", shop_id: 2, extra: true }) });
    assert.equal(badShopeeBody.status, 400);
    const badRpcBody = await fetch(`${mock.baseUrls.supabase}/rest/v1/rpc/allocate_workflow_transaction_number`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ p_accounting_month: "2026-10", p_request_key: "x", extra: true }) });
    assert.equal(badRpcBody.status, 400);
    const shopeeAuth = await fetch(`${mock.baseUrls.shopee}/api/v2/shop/auth_partner?partner_id=1&timestamp=1&sign=s&redirect=http%3A%2F%2F127.0.0.1%2Fcallback`);
    assert.equal(shopeeAuth.status, 200);
    const shopeeOrders = await fetch(`${mock.baseUrls.shopee}/api/v2/order/get_order_list?partner_id=1&timestamp=1&sign=s&access_token=a&shop_id=2&time_range_field=update_time&time_from=1&time_to=2&page_size=10`);
    assert.equal(shopeeOrders.status, 200);
    const shopeeToken = await fetch(`${mock.baseUrls.shopee}/api/v2/auth/token/get?partner_id=1&timestamp=1&sign=s`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ partner_id: 1, code: "fixture", shop_id: 2 }) });
    assert.equal(shopeeToken.status, 200);
    const googleInit = await fetch(`${mock.baseUrls.google}/upload/drive/v3/files?uploadType=resumable&fields=id,name,webViewLink`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "fixture.pdf", parents: ["root"] }) });
    assert.equal(googleInit.status, 200);
    const uploadSession = googleInit.headers.get("location");
    assert.match(uploadSession, /\/upload-session\//);
    const googleUpload = await fetch(uploadSession, { method: "PUT", headers: { "content-type": "application/pdf" }, body: Buffer.from("fixture-pdf") });
    assert.equal(googleUpload.status, 200);
    const uploadNearMiss = await fetch(`${mock.baseUrls.google}/upload-session/not-real`, { method: "PUT", body: Buffer.from("fixture") });
    assert.equal(uploadNearMiss.status, 404);
    const uploadBadQuery = await fetch(`${mock.baseUrls.google}/upload/drive/v3/files?uploadType=resumable&unexpected=true`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "fixture.pdf" }) });
    assert.equal(uploadBadQuery.status, 404);
  } finally {
    await mock.stop();
  }
});

test("outbound guard blocks a real provider host before network access", async () => {
  const guard = new URL("../e2e/fixtures/outbound-guard.mjs", import.meta.url);
  const script = "fetch('https://api-data.line.me/blocked').then(() => process.exit(1)).catch(error => { if (!error.message.includes('E2E outbound host blocked')) process.exit(2); })";
  const result = await execFileAsync(process.execPath, ["--input-type=module", "-e", script], {
    env: { ...process.env, NODE_OPTIONS: `--import=${guard.pathname}`, E2E_ALLOWED_HOSTS: "127.0.0.1:1" },
  });
  assert.equal(result.stderr, "");
});

test("redaction removes credentials, cookies, OAuth codes and business bytes", () => {
  const raw = "Cookie: sweet_house_session=secret-cookie; Authorization: Bearer service-key-12345678901234567890 code=oauth-secret fileToken=file-token-secret business-file-bytes PDF-CONTENTS";
  const redacted = redactE2ELog(raw);
  assert.doesNotMatch(redacted, /secret-cookie|service-key|oauth-secret|file-token|PDF-CONTENTS/);
  assert.match(redacted, /\[REDACTED\]/);
});

test("failed environment cleanup removes only its owned root", async () => {
  const env = await createE2EEnvironment({ profile: "local", workerIndex: 3 });
  const ownedRoot = env.rootDir;
  await env.stop(new Error("intentional fixture failure"));
  await assert.rejects(access(ownedRoot));
});

test("fixture creation rejects inherited production credentials before starting providers", async () => {
  const previous = Object.fromEntries(["SUPABASE_SERVICE_ROLE_KEY", "LINE_CHANNEL_SECRET", "LINE_OCR_API_KEY"].map(key => [key, process.env[key]]));
  process.env.LINE_CHANNEL_SECRET = "real-line-secret";
  try {
    await assert.rejects(() => createE2EEnvironment(), /production credentials are forbidden/);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("cloud runtime keeps provider state across a clean app restart", async () => {
  const runtime = await createCloudRuntimeMock({ workerIndex: 8 });
  try {
    runtime.cloudState.documents.set("TXN-2026-10-0001", { transactionNo: "TXN-2026-10-0001" });
    const restarted = await runtime.restartApp();
    try {
      assert.deepEqual(restarted.cloudState.documents.get("TXN-2026-10-0001"), { transactionNo: "TXN-2026-10-0001" });
      assert.notEqual(restarted.rootDir, runtime.rootDir);
    } finally {
      await restarted.stop();
    }
  } finally {
    // restartApp stops the original runtime; this is intentionally idempotent.
    await runtime.stop();
  }
});

test("cloud provider endpoint persists documents and reservations across restart", async () => {
  const runtime = await createCloudRuntimeMock({ workerIndex: 9 });
  try {
    const document = { documentNo: "TXN-2026-10-0002", title: "durable" };
    const reservation = { requestKey: "request-key-2", transactionNo: document.documentNo };
    assert.equal((await fetch(`${runtime.mock.baseUrls.supabase}/rest/v1/e2e_documents`, { method: "POST", body: JSON.stringify(document) })).status, 201);
    assert.equal((await fetch(`${runtime.mock.baseUrls.supabase}/rest/v1/e2e_reservations`, { method: "POST", body: JSON.stringify(reservation) })).status, 201);
    const restarted = await runtime.restartApp();
    try {
      assert.deepEqual(await fetch(`${restarted.mock.baseUrls.supabase}/rest/v1/e2e_documents`).then(r => r.json()), [document]);
      assert.deepEqual(await fetch(`${restarted.mock.baseUrls.supabase}/rest/v1/e2e_reservations`).then(r => r.json()), [reservation]);
    } finally { await restarted.stop(); }
  } finally { await runtime.stop(); }
});

test("cloud app creates, retries, restarts, and survives a dropped document response", async () => {
  const runtime = await createCloudRuntimeMock({ workerIndex: 10 });
  const session = createTestSession({ ...PERSONAS.owner, secret: "e2e-test-session-secret-012345678901234567890123" });
  const headers = { "content-type": "application/json", origin: "http://127.0.0.1", cookie: `sweet_house_session=${encodeURIComponent(session)}` };
  const create = (baseUrl, idempotencyKey, title) => fetch(`${baseUrl}api/workflow-transactions`, {
    method: "POST", headers,
    body: JSON.stringify({ templateId: "director_expense_transfer", accountingMonth: "2026-10", title, idempotencyKey }),
  });
  try {
    const first = await create(runtime.baseUrl, "cloud-request-1", "Cloud first");
    const firstText = await first.text();
    assert.equal(first.status, 200, `${firstText} requests=${JSON.stringify(runtime.mock.requests)}`);
    const firstBody = JSON.parse(firstText);
    assert.match(firstBody.transactionNo, /^TXN-2026-10-0001$/);
    assert.equal(runtime.mock.state.documents.has("document:workflow_transaction:TXN-2026-10-0001"), true);
    const restarted = await runtime.restartApp();
    try {
      const retryAfterRestart = await fetch(`${restarted.baseUrl}api/workflow-transactions`, { method: "POST", headers, body: JSON.stringify({ templateId: "director_expense_transfer", accountingMonth: "2026-10", title: "Cloud first retry", idempotencyKey: "cloud-request-1" }) });
      const retryText = await retryAfterRestart.text();
      assert.equal(retryAfterRestart.status, 200, `${retryText} requests=${JSON.stringify(restarted.mock.requests)}`);
      assert.equal(JSON.parse(retryText).transactionNo, firstBody.transactionNo);
      assert.equal(restarted.mock.requests.filter(request => request.path === "/rest/v1/documents" && request.method === "POST").length, 0);
      restarted.mock.scriptResponse({ type: "drop-after-persist", endpoint: "/rest/v1/documents" });
      const dropped = await create(restarted.baseUrl, "cloud-request-2", "Dropped response");
      assert.equal(dropped.status, 400);
      const retryDropped = await fetch(`${restarted.baseUrl}api/workflow-transactions`, { method: "POST", headers, body: JSON.stringify({ templateId: "director_expense_transfer", accountingMonth: "2026-10", title: "Dropped response retry", idempotencyKey: "cloud-request-2" }) });
      assert.equal(retryDropped.status, 200);
      assert.match((await retryDropped.json()).transactionNo, /^TXN-2026-10-0002$/);
      assert.equal(restarted.mock.state.documents.size, 2);
      assert.equal(restarted.mock.requests.every(request => request.verified === true && Object.values(restarted.mock.baseUrls).some(url => request.host === new URL(url).host)), true);
      await assert.rejects(access(path.join(restarted.rootDir, "e2e-outbound-blocked.log")));
    } finally { await restarted.stop(); }
  } finally { await runtime.stop(); }
});
