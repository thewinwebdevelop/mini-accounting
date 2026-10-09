import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createE2EEnvironment } from "../e2e/fixtures/app-server.fixture.mjs";
import { createFixtureData } from "../e2e/fixtures/data-seed.mjs";
import { createTestSession, PERSONAS } from "../e2e/fixtures/auth.fixture.mjs";
import { createMockProviders } from "../e2e/fixtures/mock-providers.mjs";
import { createCloudRuntimeMock } from "../e2e/fixtures/cloud-runtime-mock.mjs";
import { redactE2ELog } from "../e2e/support/redaction.mjs";

test("local environments use fresh isolated roots and the health marker", async () => {
  const first = await createE2EEnvironment({ profile: "local", workerIndex: 0 });
  const second = await createE2EEnvironment({ profile: "local", workerIndex: 1 });
  try {
    assert.notEqual(first.runId, second.runId);
    assert.notEqual(first.rootDir, second.rootDir);
    assert.match(first.baseUrl, /^http:\/\/127\.0\.0\.1:\d+\/$/);
    assert.deepEqual((await fetch(new URL("__e2e__/health", first.baseUrl)).then(r => r.json())).runId, first.runId);
    assert.equal(first.mock.requests.some(request => request.host && !request.mock), false);
  } finally {
    await Promise.all([first.stop(), second.stop()]);
  }
  await assert.rejects(access(first.rootDir));
  await assert.rejects(access(second.rootDir));
});

test("fixture seed contains every required persona and business fixture", async () => {
  const rootDir = await os.tmpdir();
  const seed = await createFixtureData({ rootDir: path.join(rootDir, `sweet-house-e2e-${Date.now()}`), runId: "seed-test" });
  assert.deepEqual(Object.keys(seed.users).sort(), ["accounting", "admin", "employeeA", "employeeB", "inactive", "owner", "pending"]);
  assert.ok(seed.vendors.length > 0);
  assert.ok(seed.inventory.length > 0);
  assert.ok(seed.documents.length > 0);
  assert.ok(seed.templates.length > 0);
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
    assert.match(await rejected.text(), /unexpected mock request/);
  } finally {
    await mock.stop();
  }
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
  const previous = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "real-production-secret";
  try {
    await assert.rejects(() => createE2EEnvironment(), /production credentials are forbidden/);
  } finally {
    if (previous === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = previous;
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
