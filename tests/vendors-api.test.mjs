import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

async function waitForServer(child) {
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("local server did not start")), 5000);
    child.stdout.on("data", (chunk) => {
      if (chunk.toString("utf8").includes("Expense request local web app")) {
        clearTimeout(timeout);
        resolve();
      }
    });
    child.once("error", (error) => { clearTimeout(timeout); reject(error); });
    child.once("exit", (code) => { clearTimeout(timeout); reject(new Error(`local server exited early with code ${code}`)); });
  });
}

async function requestJson(baseUrl, route, options = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) },
  });
  const body = await response.json();
  return { response, body };
}

async function startFixture() {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-vendors-api-"));
  const port = 19292;
  const child = spawn(process.execPath, ["local-server.mjs"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, PORT: String(port), SWEET_HOUSE_ROOT_DIR: rootDir },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await waitForServer(child);
  return { rootDir, child, baseUrl: `http://localhost:${port}` };
}

async function stopFixture({ rootDir, child }) {
  child.kill();
  await new Promise((resolve) => child.once("exit", resolve));
  await rm(rootDir, { recursive: true, force: true });
}

test("shared vendor API lists active records, supports optional tax ID, detail, and matches", async () => {
  const fixture = await startFixture();
  try {
    const createdResult = await requestJson(fixture.baseUrl, "/api/vendors", {
      method: "POST",
      body: JSON.stringify({ name: "ร้านไม่มีเลขภาษี", address: "ที่อยู่" }),
    });
    assert.equal(createdResult.response.status, 200);
    assert.equal(createdResult.body.vendor.taxId, "");
    assert.match(createdResult.body.vendor.id, /^VENDOR-/);

    const list = await requestJson(fixture.baseUrl, "/api/vendors");
    assert.equal(list.response.status, 200);
    assert.deepEqual(list.body.vendors.map((vendor) => vendor.name), ["ร้านไม่มีเลขภาษี"]);

    const detail = await requestJson(fixture.baseUrl, `/api/vendors/${encodeURIComponent(createdResult.body.vendor.id)}`);
    assert.equal(detail.response.status, 200);
    assert.equal(detail.body.vendor.id, createdResult.body.vendor.id);

    const matches = await requestJson(fixture.baseUrl, "/api/vendors/matches?name=%E0%B8%A3%E0%B9%89%E0%B8%B2%E0%B8%99%E0%B9%84%E0%B8%A1%E0%B9%88%E0%B8%A1%E0%B8%B5%E0%B9%80%E0%B8%A5%E0%B8%82%E0%B8%A0%E0%B8%B2%E0%B8%A9%E0%B8%B5");
    assert.equal(matches.response.status, 200);
    assert.equal(matches.body.matches[0].id, createdResult.body.vendor.id);
    assert.deepEqual(matches.body.matches[0].matchedFields, ["name"]);
    assert.match(matches.body.candidateFingerprint, /^[a-f0-9]{64}$/);
    assert.equal(JSON.stringify(matches.body).includes(fixture.rootDir), false);
  } finally {
    await stopFixture(fixture);
  }
});

test("shared vendor API binds duplicate confirmation to candidate and matching IDs", async () => {
  const fixture = await startFixture();
  try {
    const first = await requestJson(fixture.baseUrl, "/api/vendors", {
      method: "POST",
      body: JSON.stringify({ name: "ผู้ขายซ้ำ", taxId: "010-5555" }),
    });
    assert.equal(first.response.status, 200);

    const duplicate = await requestJson(fixture.baseUrl, "/api/vendors", {
      method: "POST",
      body: JSON.stringify({ name: " ผู้ขายซ้ำ ", taxId: "010-5555" }),
    });
    assert.equal(duplicate.response.status, 409);
    assert.equal(duplicate.body.code, "VENDOR_DUPLICATE_CONFIRMATION_REQUIRED");
    assert.equal(duplicate.body.matches[0].id, first.body.vendor.id);
    assert.match(duplicate.body.candidateFingerprint, /^[a-f0-9]{64}$/);

    const stale = await requestJson(fixture.baseUrl, "/api/vendors", {
      method: "POST",
      body: JSON.stringify({
        name: "ผู้ขายซ้ำ", taxId: "010-5555", confirmDuplicate: true,
        expectedMatchIds: [first.body.vendor.id], expectedCandidateFingerprint: "stale",
      }),
    });
    assert.equal(stale.response.status, 409);

    const confirmed = await requestJson(fixture.baseUrl, "/api/vendors", {
      method: "POST",
      body: JSON.stringify({
        name: "ผู้ขายซ้ำ", taxId: "010-5555", confirmDuplicate: true,
        expectedMatchIds: [first.body.vendor.id], expectedCandidateFingerprint: duplicate.body.candidateFingerprint,
      }),
    });
    assert.equal(confirmed.response.status, 200);
    assert.notEqual(confirmed.body.vendor.id, first.body.vendor.id);
  } finally {
    await stopFixture(fixture);
  }
});

test("shared vendor API updates and deactivates records while retaining them for settings", async () => {
  const fixture = await startFixture();
  try {
    const created = await requestJson(fixture.baseUrl, "/api/vendors", {
      method: "POST", body: JSON.stringify({ name: "ผู้ขายปิดใช้งาน" }),
    });
    const updated = await requestJson(fixture.baseUrl, `/api/vendors/${created.body.vendor.id}`, {
      method: "PATCH", body: JSON.stringify({ status: "inactive", phone: "0999999999" }),
    });
    assert.equal(updated.response.status, 200);
    assert.equal(updated.body.vendor.status, "inactive");
    assert.equal(updated.body.vendor.phone, "0999999999");

    const active = await requestJson(fixture.baseUrl, "/api/vendors");
    assert.equal(active.body.vendors.length, 0);
    const all = await requestJson(fixture.baseUrl, "/api/vendors?includeInactive=1");
    assert.equal(all.body.vendors[0].status, "inactive");

    const detail = await requestJson(fixture.baseUrl, `/api/vendors/${created.body.vendor.id}`);
    assert.equal(detail.response.status, 200);
    assert.equal(detail.body.vendor.status, "inactive");
  } finally {
    await stopFixture(fixture);
  }
});

test("shared vendor PATCH requires a fresh duplicate confirmation bound to the candidate", async () => {
  const fixture = await startFixture();
  try {
    const first = await requestJson(fixture.baseUrl, "/api/vendors", {
      method: "POST", body: JSON.stringify({ name: "ชื่อเดิม" }),
    });
    const second = await requestJson(fixture.baseUrl, "/api/vendors", {
      method: "POST", body: JSON.stringify({ name: "ชื่อใหม่" }),
    });
    const duplicate = await requestJson(fixture.baseUrl, `/api/vendors/${second.body.vendor.id}`, {
      method: "PATCH", body: JSON.stringify({ name: "ชื่อเดิม" }),
    });
    assert.equal(duplicate.response.status, 409);
    assert.equal(duplicate.body.code, "VENDOR_DUPLICATE_CONFIRMATION_REQUIRED");

    const matches = await requestJson(fixture.baseUrl, "/api/vendors/matches?name=%E0%B8%8A%E0%B8%B7%E0%B9%88%E0%B8%AD%E0%B9%80%E0%B8%94%E0%B8%B4%E0%B8%A1");
    const stale = await requestJson(fixture.baseUrl, `/api/vendors/${second.body.vendor.id}`, {
      method: "PATCH",
      body: JSON.stringify({ name: "ชื่อเดิม", confirmDuplicate: true, expectedMatchIds: [first.body.vendor.id], expectedCandidateFingerprint: "stale" }),
    });
    assert.equal(stale.response.status, 409);

    const confirmed = await requestJson(fixture.baseUrl, `/api/vendors/${second.body.vendor.id}`, {
      method: "PATCH",
      body: JSON.stringify({ name: "ชื่อเดิม", confirmDuplicate: true, expectedMatchIds: [first.body.vendor.id], expectedCandidateFingerprint: matches.body.candidateFingerprint }),
    });
    assert.equal(confirmed.response.status, 200);
    assert.equal(confirmed.body.vendor.name, "ชื่อเดิม");
  } finally {
    await stopFixture(fixture);
  }
});

test("shared vendor API rejects malformed and unknown IDs without exposing paths", async () => {
  const fixture = await startFixture();
  try {
    const malformed = await requestJson(fixture.baseUrl, "/api/vendors/not-an-id");
    assert.equal(malformed.response.status, 400);
    assert.equal(malformed.body.code, "INVALID_VENDOR_ID");

    const malformedPatch = await requestJson(fixture.baseUrl, "/api/vendors/not-an-id", {
      method: "PATCH", body: JSON.stringify({ name: "แก้ไข" }),
    });
    assert.equal(malformedPatch.response.status, 400);
    assert.equal(malformedPatch.body.code, "INVALID_VENDOR_ID");

    const traversal = await requestJson(fixture.baseUrl, "/api/vendors/VENDOR-%2e%2e%2fsecret");
    assert.equal(traversal.response.status, 400);
    assert.equal(traversal.body.code, "INVALID_VENDOR_ID");

    const unknown = await requestJson(fixture.baseUrl, "/api/vendors/VENDOR-does-not-exist");
    assert.equal(unknown.response.status, 404);
    assert.equal(unknown.body.code, "VENDOR_NOT_FOUND");
    assert.equal(JSON.stringify(unknown.body).includes(fixture.rootDir), false);
  } finally {
    await stopFixture(fixture);
  }
});

test("vendor API redacts storage errors and compatibility create preserves inactive status", async () => {
  const fixture = await startFixture();
  try {
    await mkdir(join(fixture.rootDir, "config"), { recursive: true });
    await writeFile(join(fixture.rootDir, "config", "vendors.json"), "{ malformed", "utf8");
    const broken = await requestJson(fixture.baseUrl, "/api/vendors");
    assert.equal(broken.response.status, 400);
    assert.equal(broken.body.code, undefined);
    assert.equal(JSON.stringify(broken.body).includes(fixture.rootDir), false);
  } finally {
    await stopFixture(fixture);
  }

  const legacyFixture = await startFixture();
  try {
    const created = await requestJson(legacyFixture.baseUrl, "/api/substitute-receipt-vendors", {
      method: "POST", body: JSON.stringify({ name: "ผู้ขายเก่าปิดใช้งาน", status: "inactive" }),
    });
    assert.equal(created.response.status, 200);
    assert.equal(created.body.vendor.status, "inactive");
    const active = await requestJson(legacyFixture.baseUrl, "/api/substitute-receipt-vendors");
    assert.equal(active.body.vendors.length, 0);
    const all = await requestJson(legacyFixture.baseUrl, "/api/substitute-receipt-vendors?includeInactive=1");
    assert.equal(all.body.vendors[0].status, "inactive");
  } finally {
    await stopFixture(legacyFixture);
  }
});
