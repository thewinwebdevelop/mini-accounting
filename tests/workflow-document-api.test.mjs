import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import serverLogic from "../forms/local-server.logic.js";
import workflowDocumentLogic from "../forms/workflow-document.logic.js";

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
    assert.equal("absoluteFolderPath" in submitted, false, "POST create response must not leak the server's absolute filesystem path");

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
    assert.equal("absoluteFolderPath" in edited, false, "POST edit response must not leak the server's absolute filesystem path");

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

// Critical 1 repro: collectPayload() on the browser side never sent
// evidenceFiles/rawFiles, and the route's serverOwnedFields block did not
// carry them forward from the stored record on an edit either, so
// saveWorkflowDocument's `existingEvidenceFiles = payload.evidenceFiles ?? {}`
// saw an empty object on every edit — dropping already-stored evidence from
// the record on a no-upload edit, and restarting the per-key file counter at
// 0 on a second upload, silently overwriting the first file on disk. Fixed by
// making the route carry evidenceFiles/rawFiles forward from the stored
// record on an edit, the same way it already does for documentNo/folderPath/
// status/etc — see handleWorkflowDocumentSubmission's serverOwnedFields block.
test("Critical 1: editing a workflow document with existing evidence must not destroy it, and a second upload must append rather than collide", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-workflow-api-"));
  const child = spawnLocalServer(rootDir);

  try {
    const port = await waitForServerPort(child);
    const baseUrl = `http://localhost:${port}`;

    const firstFormData = purchaseOrderFormData();
    firstFormData.append("evidence_evidence", new Blob(["slip-A-content"], { type: "text/plain" }), "slip-A.pdf");
    const created = await requestJsonOk(baseUrl, "/api/workflow-documents", {
      method: "POST",
      body: firstFormData,
    });
    assert.deepEqual(created.rawFiles, ["evidence_001.pdf"]);

    // Edit with no new upload: existing evidence must survive exactly as it was.
    const editedNoUpload = await requestJsonOk(baseUrl, "/api/workflow-documents", {
      method: "POST",
      body: purchaseOrderFormData({ documentNo: created.documentNo, title: "แก้ไขโดยไม่แนบไฟล์ใหม่" }),
    });
    assert.deepEqual(
      editedNoUpload.rawFiles,
      ["evidence_001.pdf"],
      "a save carrying no new uploads must leave existing evidence exactly as it was",
    );

    const originalStillServed = await fetch(`${baseUrl}/workflow-documents/purchase_order/${created.documentNo}/raw/evidence_001.pdf`);
    assert.equal(originalStillServed.status, 200, "the original evidence file must still exist on disk after a no-upload edit");
    assert.equal(await originalStillServed.text(), "slip-A-content");

    const storedAfterNoUploadEdit = await requestJsonOk(baseUrl, `/api/workflow-documents/purchase_order/${created.documentNo}`);
    assert.equal(
      Object.values(storedAfterNoUploadEdit.payload.evidenceFiles || {}).flat().length,
      1,
      "the stored record's evidenceFiles must still list the original file after a no-upload edit",
    );

    // Edit adding a second upload: must append, never collide with the first
    // file's stored name (the per-key counter must not restart at 0).
    const secondFormData = purchaseOrderFormData({ documentNo: created.documentNo, title: "แก้ไขพร้อมแนบไฟล์ใหม่" });
    secondFormData.append("evidence_evidence", new Blob(["slip-B-content"], { type: "text/plain" }), "slip-B.pdf");
    const editedWithUpload = await requestJsonOk(baseUrl, "/api/workflow-documents", {
      method: "POST",
      body: secondFormData,
    });
    assert.deepEqual(
      editedWithUpload.rawFiles.slice().sort(),
      ["evidence_001.pdf", "evidence_002.pdf"],
      "a second upload must append as evidence_002, not collide with evidence_001",
    );

    const firstFileAfterSecondUpload = await fetch(`${baseUrl}/workflow-documents/purchase_order/${created.documentNo}/raw/evidence_001.pdf`);
    assert.equal(firstFileAfterSecondUpload.status, 200);
    assert.equal(await firstFileAfterSecondUpload.text(), "slip-A-content", "the original file's content must not have been overwritten by the second upload");

    const secondFile = await fetch(`${baseUrl}/workflow-documents/purchase_order/${created.documentNo}/raw/evidence_002.pdf`);
    assert.equal(secondFile.status, 200);
    assert.equal(await secondFile.text(), "slip-B-content");

    const storedAfterSecondUpload = await requestJsonOk(baseUrl, `/api/workflow-documents/purchase_order/${created.documentNo}`);
    assert.equal(
      Object.values(storedAfterSecondUpload.payload.evidenceFiles || {}).flat().length,
      2,
      "the stored record must list both evidence files after the second upload",
    );
  } finally {
    await stopServer(child);
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("editing a workflow document cannot forge transactionNo/workflowTemplateId/workflowStepId to move it to a different workflow step", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-workflow-api-"));
  const child = spawnLocalServer(rootDir);

  try {
    const port = await waitForServerPort(child);
    const baseUrl = `http://localhost:${port}`;

    const created = await requestJsonOk(baseUrl, "/api/workflow-documents", {
      method: "POST",
      body: purchaseOrderFormData({
        transactionNo: "TXN-2026-09-0001",
        workflowTemplateId: "stock_no_tax_invoice_company_bank",
        workflowStepId: "step-001",
      }),
    });

    const forged = await requestJsonOk(baseUrl, "/api/workflow-documents", {
      method: "POST",
      body: purchaseOrderFormData({
        documentNo: created.documentNo,
        transactionNo: "TXN-2026-09-9999",
        workflowTemplateId: "some_other_template",
        workflowStepId: "step-999",
      }),
    });
    assert.equal(forged.documentNo, created.documentNo);

    const stored = await requestJsonOk(baseUrl, `/api/workflow-documents/purchase_order/${created.documentNo}`);
    assert.equal(stored.payload.transactionNo, "TXN-2026-09-0001", "transactionNo must stay server-owned on edit, carried forward from the stored record");
    assert.equal(stored.payload.workflowTemplateId, "stock_no_tax_invoice_company_bank", "workflowTemplateId must stay server-owned on edit");
    assert.equal(stored.payload.workflowStepId, "step-001", "workflowStepId must stay server-owned on edit, not movable to another step by a crafted POST");
  } finally {
    await stopServer(child);
    await rm(rootDir, { recursive: true, force: true });
  }
});

// The five lightweight workflow document kinds have their own file route
// (GET /workflow-documents/<documentKind>/<documentNo>/<section>/<fileName>,
// handled by getWorkflowDocumentFile) which is neither the expense-request
// nor the substitute-receipt file route. listPdfFiles/listRawFiles used to
// hardcode the expense-request URL builder for every caller, so a purchase
// order's pdfFiles/rawFiles carried a /api/expense-requests/... url that
// resolved to nothing. Every one of the five kinds is exercised here — an
// earlier regression on this branch shipped a six-entry table with only one
// entry actually asserted, so each kind below gets its own real HTTP fetch,
// not just a shared assertion helper trusted to cover all of them.
const LIGHTWEIGHT_DOCUMENT_KINDS = [
  "purchase_order",
  "payment_voucher",
  "cash_spend_declaration",
  "payee_acknowledgement",
  "goods_receipt",
];

function lightweightDocumentFormData(documentKind, transactionNo, overrides = {}) {
  const formData = new FormData();
  formData.append("payload", JSON.stringify({
    documentKind,
    transactionNo,
    workflowStepId: `step-${documentKind}`,
    accountingMonth: "2026-09",
    documentDate: "2026-09-06",
    title: `เอกสารทดสอบ ${documentKind}`,
    requesterName: "คุณต้า",
    payeeName: "ร้านค้าตัวอย่าง",
    businessPurpose: "ทดสอบ URL ไฟล์ของเอกสาร workflow แบบเบา",
    lines: [{ description: "รายการทดสอบ", quantity: "1", unitCost: "10" }],
    ...overrides,
  }));
  formData.append("evidence_evidence", new Blob([`evidence-for-${documentKind}`], { type: "text/plain" }), "evidence.txt");
  return formData;
}

test("every lightweight workflow document kind serves its PDF and raw files from the workflow-document route, not the expense-request one", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-workflow-lightweight-files-"));
  const child = spawnLocalServer(rootDir);
  const transactionNo = "TXN-2026-09-0001";

  try {
    const port = await waitForServerPort(child);
    const baseUrl = `http://localhost:${port}`;

    for (const documentKind of LIGHTWEIGHT_DOCUMENT_KINDS) {
      const created = await requestJsonOk(baseUrl, "/api/workflow-documents", {
        method: "POST",
        body: lightweightDocumentFormData(documentKind, transactionNo),
      });
      assert.equal(created.documentKind, documentKind);

      // Complete once (first-time path), then again (the idempotent repeat-
      // completion no-op) — the repeat branch is the one that used to hand
      // back the wrong URL (forms/local-server.logic.js, completeWorkflowDocument).
      await requestJsonOk(baseUrl, `/api/workflow-documents/${documentKind}/${created.documentNo}/complete`, {
        method: "POST",
        body: JSON.stringify({ completedBy: "คุณต้า" }),
      });
      const completedAgain = await requestJsonOk(baseUrl, `/api/workflow-documents/${documentKind}/${created.documentNo}/complete`, {
        method: "POST",
        body: JSON.stringify({ completedBy: "someone-else" }),
      });

      assert.equal(completedAgain.pdfFiles.length, 1, `${documentKind}: expected exactly one generated PDF`);
      const pdfFile = completedAgain.pdfFiles[0];
      const expectedPdfUrl = `/workflow-documents/${documentKind}/${created.documentNo}/pdf/${pdfFile.name}`;
      assert.equal(pdfFile.url, expectedPdfUrl, `${documentKind}: pdfFiles[0].url must be the real workflow-document route`);

      const pdfResponse = await fetch(`${baseUrl}${pdfFile.url}`);
      assert.equal(pdfResponse.status, 200, `${documentKind}: fetching pdfFiles[0].url must return the PDF, not 404`);
      const pdfBuffer = Buffer.from(await pdfResponse.arrayBuffer());
      assert.ok(pdfBuffer.length > 0, `${documentKind}: served PDF must not be empty`);

      // The old, buggy URL (borrowed from the expense-request route) must
      // genuinely 404 — proof this document kind never had a real expense
      // request behind it, and the fix did not just paper over the check.
      const wrongUrl = `/api/expense-requests/${created.documentNo}/files/pdf/${pdfFile.name}`;
      const wrongResponse = await fetch(`${baseUrl}${wrongUrl}`);
      assert.equal(wrongResponse.status, 404, `${documentKind}: the old expense-request URL shape must not resolve`);
    }

    // findLightweightWorkflowDocuments (used by refresh/prefill/the workflow
    // summary markdown, and — per the task this fixes — the future packet
    // PDF) is the other affected call site. Exercise it directly for all
    // five kinds and confirm every pdfFiles/rawFiles url it hands back
    // really is servable over HTTP.
    const lightweightDocuments = await serverLogic.findLightweightWorkflowDocuments(rootDir, transactionNo);
    assert.equal(lightweightDocuments.length, LIGHTWEIGHT_DOCUMENT_KINDS.length);

    for (const documentKind of LIGHTWEIGHT_DOCUMENT_KINDS) {
      const record = lightweightDocuments.find((doc) => doc.documentKind === documentKind);
      assert.ok(record, `${documentKind}: findLightweightWorkflowDocuments must return this kind`);

      assert.equal(record.pdfFiles.length, 1, `${documentKind}: expected one PDF from findLightweightWorkflowDocuments`);
      const pdfFile = record.pdfFiles[0];
      const expectedPdfUrl = `/workflow-documents/${documentKind}/${record.documentNo}/pdf/${pdfFile.name}`;
      assert.equal(pdfFile.url, expectedPdfUrl, `${documentKind}: findLightweightWorkflowDocuments pdfFiles[0].url must be the real route`);
      const pdfResponse = await fetch(`${baseUrl}${pdfFile.url}`);
      assert.equal(pdfResponse.status, 200, `${documentKind}: PDF url from findLightweightWorkflowDocuments must actually serve the file`);

      assert.equal(record.rawFiles.length, 1, `${documentKind}: expected one raw evidence file`);
      const rawFile = record.rawFiles[0];
      const expectedRawUrl = `/workflow-documents/${documentKind}/${record.documentNo}/raw/${rawFile.name}`;
      assert.equal(rawFile.url, expectedRawUrl, `${documentKind}: rawFiles[0].url must be the real route`);
      const rawResponse = await fetch(`${baseUrl}${rawFile.url}`);
      assert.equal(rawResponse.status, 200, `${documentKind}: raw url from findLightweightWorkflowDocuments must actually serve the file`);
      assert.equal(await rawResponse.text(), `evidence-for-${documentKind}`, `${documentKind}: served raw file must be the one actually uploaded`);
    }
  } finally {
    await stopServer(child);
    await rm(rootDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// /workflow-documents list page + the list API it reads (step 2).
// ---------------------------------------------------------------------------
const THAI_TEXT = /[฀-๿]/;

test("GET /workflow-documents serves the list page and GET /api/workflow-documents narrows every lightweight kind by month and status, with guarded file links", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-workflow-list-"));
  const child = spawnLocalServer(rootDir);

  try {
    const port = await waitForServerPort(child);
    const baseUrl = `http://localhost:${port}`;

    for (const route of ["/workflow-documents", "/workflow-documents/", "/workflow-documents?documentKind=goods_receipt"]) {
      const page = await fetch(`${baseUrl}${route}`);
      assert.equal(page.status, 200, route);
      assert.match(await page.text(), /id="workflowDocumentRows"/, route);
    }

    const created = {};
    for (const documentKind of LIGHTWEIGHT_DOCUMENT_KINDS) {
      const standalone = await requestJsonOk(baseUrl, "/api/workflow-documents", {
        method: "POST",
        body: lightweightDocumentFormData(documentKind, "", { workflowStepId: "", payeeName: `ผู้รับเงิน ${documentKind}` }),
      });
      const august = await requestJsonOk(baseUrl, "/api/workflow-documents", {
        method: "POST",
        body: lightweightDocumentFormData(documentKind, "", {
          workflowStepId: "",
          accountingMonth: "2026-08",
          documentDate: "2026-08-15",
          title: `เอกสารเดือนสิงหาคม ${documentKind}`,
        }),
      });
      await requestJsonOk(baseUrl, `/api/workflow-documents/${documentKind}/${august.documentNo}/complete`, {
        method: "POST",
        body: JSON.stringify({ completedBy: "คุณต้า" }),
      });
      const linked = await requestJsonOk(baseUrl, "/api/workflow-documents", {
        method: "POST",
        body: lightweightDocumentFormData(documentKind, "TXN-2026-09-0001"),
      });
      created[documentKind] = { standalone, august, linked };
    }

    const everything = await requestJsonOk(baseUrl, "/api/workflow-documents");
    assert.equal(everything.documents.length, LIGHTWEIGHT_DOCUMENT_KINDS.length * 3);

    const numbers = (body) => body.documents.map((doc) => doc.documentNo).sort();
    for (const documentKind of LIGHTWEIGHT_DOCUMENT_KINDS) {
      const { standalone, august, linked } = created[documentKind];
      const route = (query) => `/api/workflow-documents?documentKind=${documentKind}${query}`;

      const all = await requestJsonOk(baseUrl, route(""));
      assert.deepEqual(numbers(all), [standalone, august, linked].map((doc) => doc.documentNo).sort(), documentKind);
      assert.ok(all.documents.every((doc) => doc.documentKind === documentKind), `${documentKind}: list must be scoped to the kind`);

      assert.deepEqual(numbers(await requestJsonOk(baseUrl, route("&accountingMonth=2026-08"))), [august.documentNo], documentKind);
      assert.deepEqual(numbers(await requestJsonOk(baseUrl, route("&accountingMonth=2026-09"))), [standalone.documentNo, linked.documentNo].sort(), documentKind);
      assert.deepEqual(numbers(await requestJsonOk(baseUrl, route("&status=completed"))), [august.documentNo], documentKind);
      assert.deepEqual(numbers(await requestJsonOk(baseUrl, route("&status=draft"))), [standalone.documentNo, linked.documentNo].sort(), documentKind);
      assert.deepEqual(numbers(await requestJsonOk(baseUrl, route("&accountingMonth=2026-09&status=completed"))), [], documentKind);
      assert.deepEqual(numbers(await requestJsonOk(baseUrl, route("&status=all"))), numbers(all), `${documentKind}: status=all means no status filter`);

      const byNo = Object.fromEntries(all.documents.map((doc) => [doc.documentNo, doc]));
      const standaloneItem = byNo[standalone.documentNo];
      assert.equal(standaloneItem.documentDate, "2026-09-06", documentKind);
      assert.equal(standaloneItem.accountingMonth, "2026-09", documentKind);
      assert.equal(standaloneItem.title, `เอกสารทดสอบ ${documentKind}`, documentKind);
      assert.equal(standaloneItem.payeeName, `ผู้รับเงิน ${documentKind}`, documentKind);
      assert.equal(standaloneItem.totalAmount, "10.00", documentKind);
      assert.equal(standaloneItem.status, "draft", documentKind);
      assert.equal(standaloneItem.statusLabel, "แบบร่าง", documentKind);
      assert.equal(standaloneItem.transactionNo, "", documentKind);
      assert.equal(byNo[linked.documentNo].transactionNo, "TXN-2026-09-0001", documentKind);
      assert.equal(byNo[august.documentNo].statusLabel, "เสร็จสิ้น", documentKind);
      assert.equal(byNo[august.documentNo].documentDate, "2026-08-15", documentKind);

      for (const doc of all.documents) {
        assert.equal("absoluteFolderPath" in doc, false, `${doc.documentNo}: must not leak absoluteFolderPath`);
        assert.ok(doc.pdfFiles.length >= 1, `${doc.documentNo}: list entry must carry its PDF`);
        assert.equal(doc.rawFiles.length, 1, `${doc.documentNo}: list entry must carry its raw evidence`);
        for (const file of [...doc.pdfFiles, ...doc.rawFiles]) {
          assert.equal("absolutePath" in file, false, `${doc.documentNo}: file entries must not leak absolutePath`);
          assert.ok(
            file.url.startsWith(`/workflow-documents/${documentKind}/${doc.documentNo}/`),
            `${doc.documentNo}: file url must use the guarded workflow-document route, got ${file.url}`,
          );
          const served = await fetch(`${baseUrl}${file.url}`);
          assert.equal(served.status, 200, `${file.url} must be servable`);
          await served.arrayBuffer();
        }
      }
      assert.equal(JSON.stringify(all).includes(rootDir), false, `${documentKind}: list response must not contain the server's filesystem root`);
    }
  } finally {
    await stopServer(child);
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("GET /api/workflow-documents rejects filter values it does not recognise with a Thai 400 instead of querying with them", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-workflow-list-filters-"));
  const child = spawnLocalServer(rootDir);

  try {
    const port = await waitForServerPort(child);
    const baseUrl = `http://localhost:${port}`;
    await requestJsonOk(baseUrl, "/api/workflow-documents", { method: "POST", body: purchaseOrderFormData() });

    const rejected = [
      "documentKind=expense_request",
      "documentKind=substitute_receipt",
      "documentKind=workflow_transaction",
      `documentKind=${encodeURIComponent("purchase_order' OR '1'='1")}`,
      "accountingMonth=2026-13",
      "accountingMonth=2026-9",
      "accountingMonth=202609",
      `accountingMonth=${encodeURIComponent("2026-09' OR 1=1 --")}`,
      "status=bogus",
      `status=${encodeURIComponent("draft' --")}`,
      `transactionNo=${encodeURIComponent("' OR ''='")}`,
      "transactionNo=TXN-2026-9-1",
      `workflowTemplateId=${"x".repeat(201)}`,
      "workflowStepId=step-001%00",
      "workflowTemplateId=tpl%0A1",
    ];
    for (const query of rejected) {
      const { status, body } = await requestJson(baseUrl, `/api/workflow-documents?${query}`);
      assert.equal(status, 400, query);
      assert.match(String(body.error), THAI_TEXT, `${query}: error must be Thai`);
      assert.equal(body.documents, undefined, `${query}: a rejected filter must not return any documents`);
    }

    const accepted = await requestJsonOk(
      baseUrl,
      "/api/workflow-documents?documentKind=purchase_order&accountingMonth=2026-09&status=draft&transactionNo=&workflowTemplateId=&workflowStepId=",
    );
    assert.deepEqual(accepted.documents.map((doc) => doc.documentNo), ["PO-2026-09-0001"]);
    const noTransaction = await requestJsonOk(baseUrl, "/api/workflow-documents?transactionNo=TXN-2026-09-0001");
    assert.deepEqual(noTransaction.documents, []);
  } finally {
    await stopServer(child);
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("parseWorkflowDocumentListFilters normalises accepted values and throws on anything else", () => {
  const parse = (query) => serverLogic.parseWorkflowDocumentListFilters(new URLSearchParams(query));

  assert.deepEqual(parse(""), {
    documentKind: "",
    accountingMonth: "",
    status: "",
    transactionNo: "",
    workflowTemplateId: "",
    workflowStepId: "",
  });
  assert.deepEqual(parse("documentKind=goods_receipt&accountingMonth=2026-09&status=all&transactionNo=TXN-2026-09-0004&workflowTemplateId=stock_no_tax_invoice_company_bank&workflowStepId=step-004"), {
    documentKind: "goods_receipt",
    accountingMonth: "2026-09",
    status: "",
    transactionNo: "TXN-2026-09-0004",
    workflowTemplateId: "stock_no_tax_invoice_company_bank",
    workflowStepId: "step-004",
  });
  for (const status of ["draft", "pending_approval", "approved", "completed", "cancelled"]) {
    assert.equal(parse(`status=${status}`).status, status);
  }
  for (const query of ["documentKind=expense_request", "accountingMonth=2026-00", "status=received", "transactionNo=REQ-2026-09-0001"]) {
    assert.throws(() => parse(query), THAI_TEXT, query);
  }
});

// ---------------------------------------------------------------------------
// Standalone Google Drive sync for the five lightweight kinds. Expense
// requests and substitute receipts have always had their own
// POST .../sync-drive; these five had no path to Drive at all. Every test
// below is generated for ALL five kinds -- an earlier task on this branch
// shipped a six-entry table with one entry asserted and five silently wrong.
// No test here touches the network: the uploader is injected and stubbed, and
// the HTTP test runs against a rootDir with no Google Drive config, where the
// real uploader fails before it ever calls fetch.
// ---------------------------------------------------------------------------
const DRIVE_SYNC_KINDS = workflowDocumentLogic.LIGHTWEIGHT_DOCUMENT_KINDS;

async function createLightweightDocument(rootDir, documentKind, { complete = true } = {}) {
  const { documentNo } = await serverLogic.getNextWorkflowDocumentInfo(rootDir, documentKind, "2026-09");
  const payload = workflowDocumentLogic.buildWorkflowDocumentPayload({
    documentKind,
    documentNo,
    accountingMonth: "2026-09",
    documentDate: "2026-09-06",
    title: `ทดสอบซิงก์ ${documentKind}`,
    requesterName: "คุณต้า",
    payeeName: "ร้านค้าตัวอย่าง",
    businessPurpose: "ทดสอบซิงก์ Google Drive",
    lines: [{ description: "รายการทดสอบ", quantity: "1", unitCost: "100" }],
  });
  await serverLogic.saveWorkflowDocument({ rootDir, payload });
  if (complete) {
    await serverLogic.completeWorkflowDocument({ rootDir, documentKind, documentNo, completedBy: "บัญชี" });
  }
  return serverLogic.getWorkflowDocument(rootDir, documentKind, documentNo);
}

async function readOwnDriveSyncMetadata(rootDir, folderPath) {
  return JSON.parse(await readFile(join(rootDir, folderPath, "data", "drive-sync.json"), "utf8"));
}

for (const documentKind of DRIVE_SYNC_KINDS) {
  test(`${documentKind}: syncWorkflowDocumentToDrive uploads the document's own folder through the injected uploader and records its own sync metadata`, async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-doc-drive-"));
    try {
      const record = await createLightweightDocument(rootDir, documentKind);
      const uploads = [];
      const result = await serverLogic.syncWorkflowDocumentToDrive({
        rootDir,
        documentKind,
        documentNo: record.documentNo,
        now: () => "2026-09-11T10:00:00.000Z",
        driveUploader: async (options) => {
          uploads.push(options);
          return {
            driveFolderId: `folder-${documentKind}`,
            driveFolderUrl: `https://drive.google.com/drive/folders/folder-${documentKind}`,
            drivePath: `base/2026/09/${documentKind}/${record.documentNo}`,
            uploadedFileCount: 3,
          };
        },
      });

      assert.deepEqual(uploads, [{ rootDir, folderPath: record.folderPath }], "must upload exactly this document's own folder, once");
      assert.equal(result.syncStatus, "synced");
      assert.equal(result.documentKind, documentKind);
      assert.equal(result.documentNo, record.documentNo);
      assert.equal(result.driveFolderId, `folder-${documentKind}`);
      assert.equal(result.driveFolderUrl, `https://drive.google.com/drive/folders/folder-${documentKind}`);
      assert.equal(result.drivePath, `base/2026/09/${documentKind}/${record.documentNo}`);
      assert.equal(result.uploadedFileCount, 3);
      assert.equal(result.syncedAt, "2026-09-11T10:00:00.000Z");
      assert.deepEqual(await readOwnDriveSyncMetadata(rootDir, record.folderPath), result, "the document's own data/drive-sync.json must hold what was returned");
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  test(`${documentKind}: a failed upload is recorded on the document as sync_failed and reported to the caller, never swallowed`, async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-doc-drive-"));
    try {
      const record = await createLightweightDocument(rootDir, documentKind);
      await assert.rejects(
        () => serverLogic.syncWorkflowDocumentToDrive({
          rootDir,
          documentKind,
          documentNo: record.documentNo,
          now: () => "2026-09-11T10:00:00.000Z",
          driveUploader: async () => { throw new Error("Google Drive is not configured"); },
        }),
        /Google Drive is not configured/,
      );

      const stored = await readOwnDriveSyncMetadata(rootDir, record.folderPath);
      assert.equal(stored.syncStatus, "sync_failed");
      assert.equal(stored.error, "Google Drive is not configured");
      assert.equal(stored.documentKind, documentKind);
      assert.equal(stored.documentNo, record.documentNo);
      assert.equal(stored.updatedAt, "2026-09-11T10:00:00.000Z");
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  test(`${documentKind}: a document that is not completed yet refuses to sync, in Thai, without calling the uploader`, async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-doc-drive-"));
    try {
      const record = await createLightweightDocument(rootDir, documentKind, { complete: false });
      let uploaderCalls = 0;
      await assert.rejects(
        () => serverLogic.syncWorkflowDocumentToDrive({
          rootDir,
          documentKind,
          documentNo: record.documentNo,
          driveUploader: async () => { uploaderCalls += 1; return {}; },
        }),
        /เสร็จสิ้น/,
      );
      assert.equal(uploaderCalls, 0);
      assert.equal(existsSync(join(rootDir, record.folderPath, "data", "drive-sync.json")), false, "a refused sync must not write sync metadata");
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });
}

test("syncWorkflowDocumentToDrive refuses a kind that is not one of the five lightweight kinds", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-doc-drive-"));
  try {
    await assert.rejects(
      () => serverLogic.syncWorkflowDocumentToDrive({ rootDir, documentKind: "expense_request", documentNo: "REQ-2026-09-0001", driveUploader: async () => ({}) }),
      /ประเภทเอกสารไม่ถูกต้อง/,
    );
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("describeDriveSyncError turns the uploader's missing-credential errors into Thai, keeping the original text for diagnosis", () => {
  const notConfigured = serverLogic.describeDriveSyncError("Google Drive is not configured");
  assert.match(notConfigured, /ยังไม่ได้ตั้งค่า Google Drive/);
  assert.match(notConfigured, /Google Drive is not configured/);

  const notAuthenticated = serverLogic.describeDriveSyncError("Google Drive is not authenticated. Open /google-drive and login first.");
  assert.match(notAuthenticated, /ยังไม่ได้เข้าสู่ระบบ Google Drive/);

  assert.match(serverLogic.describeDriveSyncError("quota exceeded"), /Google Drive.*quota exceeded/);
  assert.equal(serverLogic.describeDriveSyncError("ไม่พบเอกสาร"), "ไม่พบเอกสาร", "an error that is already Thai is passed through unchanged");
});

test("POST /api/workflow-documents/:kind/:documentNo/sync-drive exists for every lightweight kind; with no Google Drive credentials it fails with a Thai message naming the document", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-doc-drive-http-"));
  const child = spawnLocalServer(rootDir);

  try {
    const port = await waitForServerPort(child);
    const baseUrl = `http://localhost:${port}`;

    for (const documentKind of DRIVE_SYNC_KINDS) {
      const created = await requestJsonOk(baseUrl, "/api/workflow-documents", {
        method: "POST",
        body: purchaseOrderFormData({ documentKind, title: `ทดสอบซิงก์ ${documentKind}` }),
      });
      const syncRoute = `/api/workflow-documents/${documentKind}/${created.documentNo}/sync-drive`;

      const draftAttempt = await requestJson(baseUrl, syncRoute, { method: "POST" });
      assert.equal(draftAttempt.status, 400, `${documentKind}: a draft must be refused`);
      assert.match(draftAttempt.body.error, /เสร็จสิ้น/, `${documentKind}: the refusal must say, in Thai, that the document must be completed first`);

      await requestJsonOk(baseUrl, `/api/workflow-documents/${documentKind}/${created.documentNo}/complete`, {
        method: "POST",
        body: JSON.stringify({ completedBy: "คุณต้า" }),
      });

      const beforeSync = await requestJsonOk(baseUrl, `/api/workflow-documents?documentKind=${documentKind}`);
      assert.equal(beforeSync.documents.find((doc) => doc.documentNo === created.documentNo).syncStatus, "not_synced", documentKind);

      const attempt = await requestJson(baseUrl, syncRoute, { method: "POST" });
      assert.equal(attempt.status, 400, `${documentKind}: a failed upload must not answer 200`);
      assert.ok(attempt.body.error.includes(created.documentNo), `${documentKind}: the error must name the document`);
      assert.match(attempt.body.error, /ยังไม่ได้ตั้งค่า Google Drive/, `${documentKind}: the error must say, in Thai, why`);
      assert.doesNotMatch(JSON.stringify(attempt.body), /absolutePath|absoluteFolderPath/);
      assert.equal(JSON.stringify(attempt.body).includes(rootDir), false, `${documentKind}: must not leak the server's filesystem path`);

      const afterSync = await requestJsonOk(baseUrl, `/api/workflow-documents?documentKind=${documentKind}`);
      const listed = afterSync.documents.find((doc) => doc.documentNo === created.documentNo);
      assert.equal(listed.syncStatus, "sync_failed", `${documentKind}: the failure must be recorded on the document`);
      assert.match(listed.syncError, /ยังไม่ได้ตั้งค่า Google Drive/, `${documentKind}: the list must carry the Thai reason`);
      assert.equal(JSON.stringify(listed).includes(rootDir), false, `${documentKind}: the list must not leak the server's filesystem path`);
    }

    const wrongKind = await requestJson(baseUrl, "/api/workflow-documents/expense_request/REQ-2026-09-0001/sync-drive", { method: "POST" });
    assert.equal(wrongKind.status, 400);
    assert.match(wrongKind.body.error, /ประเภทเอกสารไม่ถูกต้อง/);
  } finally {
    await stopServer(child);
    await rm(rootDir, { recursive: true, force: true });
  }
});
