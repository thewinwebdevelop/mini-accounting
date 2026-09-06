import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

// Binding a fixed port let two runs of this suite collide. Bind port 0 (the OS
// picks a free one) and read the actually-assigned port back out of the
// server's own startup log line instead.
async function waitForServerPort(child) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("local server did not start"));
    }, 5000);

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      const match = text.match(/Expense request local web app: http:\/\/localhost:(\d+)\//);
      if (match) {
        clearTimeout(timeout);
        resolve(Number(match[1]));
      }
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`local server exited early with code ${code}`));
    });
  });
}

function spawnLocalServer(rootDir) {
  return spawn(process.execPath, ["local-server.mjs"], {
    cwd: new URL("..", import.meta.url),
    env: {
      ...process.env,
      PORT: "0",
      SWEET_HOUSE_ROOT_DIR: rootDir,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function stopServer(child) {
  child.kill();
  await new Promise((resolve) => child.once("exit", resolve));
}

async function requestJson(baseUrl, route, options = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    ...options,
    headers: {
      ...(options.body instanceof FormData ? {} : { "content-type": "application/json" }),
      ...(options.headers || {}),
    },
  });
  const body = await response.json();
  return { status: response.status, ok: response.ok, body };
}

async function requestJsonOk(baseUrl, route, options = {}) {
  const { ok, body, status } = await requestJson(baseUrl, route, options);
  assert.equal(ok, true, body.error || `HTTP ${status}`);
  return body;
}

function purchaseOrderFormData(overrides = {}) {
  const formData = new FormData();
  formData.append("payload", JSON.stringify({
    documentKind: "purchase_order",
    accountingMonth: "2026-09",
    documentDate: "2026-09-06",
    title: "สั่งซื้อสินค้า Lot กันยายน",
    requesterName: "คุณต้า",
    payeeName: "ร้านค้าตัวอย่าง",
    businessPurpose: "สั่งซื้อสินค้าเข้าคลัง",
    lines: [{ description: "สินค้า A", quantity: "2", unitCost: "50" }],
    ...overrides,
  }));
  return formData;
}

test("workflow document APIs save, list, complete, and serve files over HTTP", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-workflow-api-"));
  const child = spawnLocalServer(rootDir);

  try {
    const port = await waitForServerPort(child);
    const baseUrl = `http://localhost:${port}`;

    const staticPage = await fetch(`${baseUrl}/workflow-document`);
    assert.equal(staticPage.status, 200);
    const staticHtml = await staticPage.text();
    assert.match(staticHtml, /id="workflowDocumentForm"/);

    const formData = purchaseOrderFormData();
    formData.append("evidence_evidence", new Blob(["quote"], { type: "text/plain" }), "quote.txt");

    const submitted = await requestJsonOk(baseUrl, "/api/workflow-documents", {
      method: "POST",
      body: formData,
    });
    assert.equal(submitted.documentNo, "PO-2026-09-0001");
    assert.equal(submitted.status, "draft");
    assert.equal(submitted.pdfFiles.length, 1);
    assert.equal(submitted.rawFiles[0], "evidence_001.txt");

    const secondSubmitted = await requestJsonOk(baseUrl, "/api/workflow-documents", {
      method: "POST",
      body: purchaseOrderFormData({
        title: "สั่งซื้อสินค้า Lot กันยายน รอบสอง",
        businessPurpose: "สั่งซื้อสินค้าเข้าคลังรอบสอง",
        lines: [{ description: "สินค้า B", quantity: "1", unitCost: "10" }],
        requesterName: "",
        payeeName: "",
      }),
    });
    assert.equal(secondSubmitted.documentNo, "PO-2026-09-0002", "sequence must auto-increment within the same kind/month");

    const fetched = await requestJsonOk(baseUrl, `/api/workflow-documents/purchase_order/${submitted.documentNo}`);
    assert.equal(fetched.payload.title, "สั่งซื้อสินค้า Lot กันยายน");
    assert.equal("absoluteFolderPath" in fetched, false, "GET must not leak the server's absolute filesystem path");

    const list = await requestJsonOk(baseUrl, "/api/workflow-documents?documentKind=purchase_order");
    assert.equal(list.documents.length, 2);
    assert.ok(list.documents.every((doc) => !("absoluteFolderPath" in doc)), "list must not leak the server's absolute filesystem path");

    const completed = await requestJsonOk(baseUrl, `/api/workflow-documents/purchase_order/${submitted.documentNo}/complete`, {
      method: "POST",
      body: JSON.stringify({ completedBy: "คุณต้า" }),
    });
    assert.equal(completed.status, "completed");
    assert.equal(completed.completedBy, "คุณต้า");

    const completedAgain = await requestJsonOk(baseUrl, `/api/workflow-documents/purchase_order/${submitted.documentNo}/complete`, {
      method: "POST",
      body: JSON.stringify({ completedBy: "someone-else" }),
    });
    assert.equal(completedAgain.completedBy, "คุณต้า", "repeat completion over HTTP must not overwrite the original completedBy");
    assert.equal(completedAgain.completedAt, completed.completedAt);

    const pdfFileName = completed.pdfFiles[0].name;
    const pdfResponse = await fetch(`${baseUrl}/workflow-documents/purchase_order/${submitted.documentNo}/pdf/${pdfFileName}`);
    assert.equal(pdfResponse.status, 200);
    const pdfBuffer = Buffer.from(await pdfResponse.arrayBuffer());
    assert.ok(pdfBuffer.length > 0);

    const rawResponse = await fetch(`${baseUrl}/workflow-documents/purchase_order/${submitted.documentNo}/raw/evidence_001.txt`);
    assert.equal(rawResponse.status, 200);
    assert.equal(await rawResponse.text(), "quote");

    const traversalResponse = await fetch(`${baseUrl}/workflow-documents/purchase_order/${submitted.documentNo}/raw/..%2Fdata%2Fworkflow-document.json`);
    assert.equal(traversalResponse.status, 404);

    const missingResponse = await fetch(`${baseUrl}/api/workflow-documents/purchase_order/PO-2026-09-9999`);
    assert.equal(missingResponse.status, 404);
  } finally {
    await stopServer(child);
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("Critical 3 exploit: POST /api/workflow-documents cannot dictate documentNo, folderPath, status, or completedBy/completedAt", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-workflow-api-"));
  const child = spawnLocalServer(rootDir);

  try {
    const port = await waitForServerPort(child);
    const baseUrl = `http://localhost:${port}`;

    // Reproduction from the security review: a client posting raw JSON tries to
    // steal an existing document's number, redirect the write outside rootDir,
    // and forge a completed/audited status in one shot.
    const formData = new FormData();
    formData.append("payload", JSON.stringify({
      documentKind: "purchase_order",
      accountingMonth: "2026-09",
      documentDate: "2026-09-06",
      title: "เอกสารปลอม",
      businessPurpose: "ทดสอบการปลอมแปลง",
      lines: [{ description: "รายการ", quantity: "1", unitCost: "10" }],
      documentNo: "PO-2026-09-0001",
      folderPath: "../../../../tmp/escaped-via-api",
      status: "completed",
      completedBy: "forged",
      completedAt: "2000-01-01T00:00:00.000Z",
      statusHistory: [{ fromStatus: "forged", toStatus: "forged", changedAt: "2000-01-01T00:00:00.000Z" }],
      createdAt: "2000-01-01T00:00:00.000Z",
    }));

    const result = await requestJsonOk(baseUrl, "/api/workflow-documents", {
      method: "POST",
      body: formData,
    });

    // The forged documentNo must not have been honored as a real sequence
    // number (no prior PO exists, so the server must compute PO-2026-09-0001
    // itself here) — the real proof is what actually got persisted below.
    assert.equal(result.documentNo, "PO-2026-09-0001");
    assert.equal(result.status, "draft", "status must be server-assigned draft, not the client's forged completed");
    assert.notEqual(result.folderPath, "../../../../tmp/escaped-via-api");
    assert.ok(result.folderPath.startsWith("documents/2026/09/purchase_order/"), `folderPath must be server-derived, got ${result.folderPath}`);

    assert.equal(existsSync("/tmp/escaped-via-api"), false, "the escaping folder must never be created");

    const stored = await requestJsonOk(baseUrl, `/api/workflow-documents/purchase_order/${result.documentNo}`);
    assert.equal(stored.payload.status, "draft");
    assert.equal(stored.payload.completedBy, "", "forged completedBy must not survive");
    assert.equal(stored.payload.completedAt, "", "forged completedAt must not survive");
    assert.deepEqual(stored.payload.statusHistory, [], "forged statusHistory must not survive");
    assert.notEqual(stored.payload.createdAt, "2000-01-01T00:00:00.000Z", "forged createdAt must not survive");
  } finally {
    await stopServer(child);
    await rm(rootDir, { recursive: true, force: true });
    await rm("/tmp/escaped-via-api", { recursive: true, force: true });
  }
});

test("Critical 3: editing an existing document carries its documentNo/folderPath forward and cannot resurrect a completed one", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-workflow-api-"));
  const child = spawnLocalServer(rootDir);

  try {
    const port = await waitForServerPort(child);
    const baseUrl = `http://localhost:${port}`;

    const created = await requestJsonOk(baseUrl, "/api/workflow-documents", {
      method: "POST",
      body: purchaseOrderFormData(),
    });

    // Editing is supported: posting again with the same documentNo and a
    // changed title must update the same document/folder, not spawn a
    // duplicate folder claiming the same documentNo.
    const edited = await requestJsonOk(baseUrl, "/api/workflow-documents", {
      method: "POST",
      body: purchaseOrderFormData({
        documentNo: created.documentNo,
        title: "สั่งซื้อสินค้า Lot กันยายน (แก้ไข)",
      }),
    });
    assert.equal(edited.documentNo, created.documentNo);
    assert.equal(edited.folderPath, created.folderPath, "editing must reuse the original folder, not compute a new one");

    const afterEdit = await requestJsonOk(baseUrl, `/api/workflow-documents/purchase_order/${created.documentNo}`);
    assert.equal(afterEdit.payload.title, "สั่งซื้อสินค้า Lot กันยายน (แก้ไข)");

    const allDocs = await requestJsonOk(baseUrl, "/api/workflow-documents?documentKind=purchase_order");
    assert.equal(allDocs.documents.length, 1, "editing must not orphan a second folder under the same documentNo");

    await requestJsonOk(baseUrl, `/api/workflow-documents/purchase_order/${created.documentNo}/complete`, {
      method: "POST",
      body: JSON.stringify({ completedBy: "คุณต้า" }),
    });

    const reopenAttempt = await requestJson(baseUrl, "/api/workflow-documents", {
      method: "POST",
      body: purchaseOrderFormData({
        documentNo: created.documentNo,
        title: "พยายามแก้ไขหลังเสร็จสิ้น",
      }),
    });
    assert.equal(reopenAttempt.ok, false, "editing an already-completed document must be refused");

    const stillCompleted = await requestJsonOk(baseUrl, `/api/workflow-documents/purchase_order/${created.documentNo}`);
    assert.equal(stillCompleted.payload.status, "completed");
    assert.equal(stillCompleted.payload.title, "สั่งซื้อสินค้า Lot กันยายน (แก้ไข)", "a refused edit must not have changed the stored title");
  } finally {
    await stopServer(child);
    await rm(rootDir, { recursive: true, force: true });
  }
});
