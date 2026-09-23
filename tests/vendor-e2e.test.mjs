import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

async function waitForServerPort(child) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("local server did not start")), 5000);
    child.stdout.on("data", (chunk) => {
      const match = chunk.toString("utf8").match(/Expense request local web app: http:\/\/localhost:(\d+)\//);
      if (match) { clearTimeout(timeout); resolve(Number(match[1])); }
    });
    child.once("error", (error) => { clearTimeout(timeout); reject(error); });
    child.once("exit", (code) => { clearTimeout(timeout); reject(new Error(`local server exited early with code ${code}`)); });
  });
}

async function startFixture() {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-vendor-e2e-"));
  const child = spawn(process.execPath, ["local-server.mjs"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, PORT: "0", SWEET_HOUSE_ROOT_DIR: rootDir },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const port = await waitForServerPort(child);
  return { rootDir, child, baseUrl: `http://localhost:${port}` };
}

async function stopFixture(fixture) {
  fixture.child.kill();
  await new Promise((resolve) => fixture.child.once("exit", resolve));
  await rm(fixture.rootDir, { recursive: true, force: true });
}

async function request(baseUrl, route, options = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    ...options,
    headers: {
      ...(options.body instanceof FormData ? {} : { "content-type": "application/json" }),
      ...(options.headers || {}),
    },
  });
  const body = await response.json();
  return { response, body };
}

async function requestOk(baseUrl, route, options = {}) {
  const result = await request(baseUrl, route, options);
  assert.equal(result.response.ok, true, result.body.error || `HTTP ${result.response.status}`);
  return result.body;
}

function expensePayload(vendorId, name = "ผู้ขาย E2E") {
  return {
    accountingMonth: "2026-09",
    requestTitle: "ทดสอบผู้ขาย E2E",
    requestType: "direct_payment",
    requesterName: "ผู้ทดสอบ",
    businessPurpose: "ทดสอบ shared vendor",
    paymentTargetName: name,
    vendorId,
    expenseLines: [{ description: "สินค้า E2E", amountBeforeVat: "100" }],
  };
}

function substitutePayload(vendorId, name = "ผู้ขาย E2E") {
  return {
    accountingMonth: "2026-09",
    receiptDate: "2026-09-20",
    receiptTitle: "ทดสอบผู้ขาย E2E",
    receiptType: "general_expense",
    payeeName: name,
    vendorId,
    businessPurpose: "ทดสอบ shared vendor",
    lines: [{ description: "สินค้า E2E", quantity: "1", unitCost: "100" }],
  };
}

function workflowPayload(documentKind, vendorId, name = "ผู้ขาย E2E") {
  return {
    documentKind,
    accountingMonth: "2026-09",
    documentDate: "2026-09-20",
    title: `ทดสอบ ${documentKind}`,
    requesterName: "ผู้ทดสอบ",
    payeeName: name,
    businessPurpose: "ทดสอบ shared vendor",
    vendorId,
    lines: [{ description: "สินค้า E2E", quantity: "1", unitCost: "100" }],
  };
}

function multipart(payload) {
  const form = new FormData();
  form.append("payload", JSON.stringify(payload));
  form.append("evidence_paymentSlip", new Blob(["payment proof"], { type: "text/plain" }), "payment-proof.txt");
  return form;
}

test("saved vendor picker contract persists one vendor snapshot across all seven document kinds", async () => {
  const fixture = await startFixture();
  try {
    const vendor = await requestOk(fixture.baseUrl, "/api/vendors", {
      method: "POST",
      body: JSON.stringify({ name: "ผู้ขาย E2E", address: "99 ถนนสุขุมวิท", phone: "0812345678" }),
    });
    const vendorId = vendor.vendor.id;

    const expense = await requestOk(fixture.baseUrl, "/api/expense-requests", { method: "POST", body: multipart(expensePayload(vendorId)) });
    const expenseDetail = await requestOk(fixture.baseUrl, `/api/expense-requests/${expense.requestNo}`);
    assert.equal(expenseDetail.payload.vendorId, vendorId);
    assert.equal(expenseDetail.payload.vendorSnapshot.name, "ผู้ขาย E2E");

    const substitute = await requestOk(fixture.baseUrl, "/api/substitute-receipts", { method: "POST", body: multipart(substitutePayload(vendorId)) });
    const substituteDetail = await requestOk(fixture.baseUrl, `/api/substitute-receipts/${substitute.receiptNo}`);
    assert.equal(substituteDetail.payload.vendorId, vendorId);
    assert.equal(substituteDetail.payload.vendorSnapshot.name, "ผู้ขาย E2E");

    const workflowKinds = ["purchase_order", "payment_voucher", "cash_spend_declaration", "payee_acknowledgement", "goods_receipt"];
    for (const documentKind of workflowKinds) {
      const created = await requestOk(fixture.baseUrl, "/api/workflow-documents", { method: "POST", body: multipart(workflowPayload(documentKind, vendorId)) });
      const detail = await requestOk(fixture.baseUrl, `/api/workflow-documents/${documentKind}/${created.documentNo}`);
      assert.equal(detail.payload.vendorId, vendorId, documentKind);
      assert.equal(detail.payload.vendorSnapshot.name, "ผู้ขาย E2E", documentKind);
    }
  } finally {
    await stopFixture(fixture);
  }
});

test("document-only manual vendor remains local when no saved preset is selected", async () => {
  const fixture = await startFixture();
  try {
    const created = await requestOk(fixture.baseUrl, "/api/expense-requests", {
      method: "POST",
      body: multipart(expensePayload("", "ผู้ขายกรอกใหม่")),
    });
    const detail = await requestOk(fixture.baseUrl, `/api/expense-requests/${created.requestNo}`);
    assert.equal(detail.payload.vendorId, "");
    assert.equal(detail.payload.vendorSnapshot.name, "ผู้ขายกรอกใหม่");
    const list = await requestOk(fixture.baseUrl, "/api/vendors");
    assert.deepEqual(list.vendors, []);
  } finally {
    await stopFixture(fixture);
  }
});

test("inactive vendor is rejected for new documents while an old snapshot remains readable", async () => {
  const fixture = await startFixture();
  try {
    const vendor = await requestOk(fixture.baseUrl, "/api/vendors", { method: "POST", body: JSON.stringify({ name: "ผู้ขายเก่าที่ปิดใช้งาน", taxId: "0105550000001" }) });
    const old = await requestOk(fixture.baseUrl, "/api/expense-requests", { method: "POST", body: multipart(expensePayload(vendor.vendor.id, "ผู้ขายเก่าที่ปิดใช้งาน")) });
    const deactivated = await requestOk(fixture.baseUrl, `/api/vendors/${vendor.vendor.id}`, { method: "PATCH", body: JSON.stringify({ status: "inactive" }) });
    assert.equal(deactivated.vendor.status, "inactive");

    const oldDetail = await requestOk(fixture.baseUrl, `/api/expense-requests/${old.requestNo}`);
    assert.equal(oldDetail.payload.vendorSnapshot.name, "ผู้ขายเก่าที่ปิดใช้งาน");

    const attemptedNew = await request(fixture.baseUrl, "/api/expense-requests", { method: "POST", body: multipart(expensePayload(vendor.vendor.id, "เอกสารใหม่")) });
    assert.equal(attemptedNew.response.ok, false);
    assert.match(String(attemptedNew.body.error), /ผู้ขายถูกปิดใช้งาน|ไม่สามารถเลือกผู้ขายที่ปิดใช้งาน|inactive|ไม่พบผู้ขาย/i);
  } finally {
    await stopFixture(fixture);
  }
});
