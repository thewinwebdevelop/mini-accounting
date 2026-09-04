import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

async function waitForServer(child) {
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("local server did not start"));
    }, 5000);

    child.stdout.on("data", (chunk) => {
      if (chunk.toString("utf8").includes("Expense request local web app")) {
        clearTimeout(timeout);
        resolve();
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

async function requestJson(baseUrl, route, options = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    ...options,
    headers: {
      ...(options.body instanceof FormData ? {} : { "content-type": "application/json" }),
      ...(options.headers || {}),
    },
  });
  const body = await response.json();
  assert.equal(response.ok, true, body.error || `HTTP ${response.status}`);
  return body;
}

async function requestJsonResponse(baseUrl, route, options = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    ...options,
    headers: {
      ...(options.body instanceof FormData ? {} : { "content-type": "application/json" }),
      ...(options.headers || {}),
    },
  });
  return {
    response,
    body: await response.json(),
  };
}

test("substitute receipt APIs return next number and submit stock purchase receipts", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-substitute-api-"));
  const port = 19190;
  const baseUrl = `http://localhost:${port}`;
  const child = spawn(process.execPath, ["local-server.mjs"], {
    cwd: new URL("..", import.meta.url),
    env: {
      ...process.env,
      PORT: String(port),
      SWEET_HOUSE_ROOT_DIR: rootDir,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    await waitForServer(child);

    const next = await requestJson(baseUrl, "/api/substitute-receipts/next?accountingMonth=2026-09");
    assert.deepEqual(next, { sequence: "1", receiptNo: "SR-2026-09-0001" });

    const { product } = await requestJson(baseUrl, "/api/inventory/products", {
      method: "POST",
      body: JSON.stringify({ productCode: "TOP-SR", name: "เสื้อ SR", category: "เสื้อ" }),
    });
    const { stockSku } = await requestJson(baseUrl, "/api/inventory/stock-skus", {
      method: "POST",
      body: JSON.stringify({
        productId: product.id,
        sku: "TOP-SR-WHITE-M",
        color: "ขาว",
        size: "M",
        defaultUnitCost: "100",
      }),
    });

    const formData = new FormData();
    formData.append("payload", JSON.stringify({
      accountingMonth: "2026-09",
      receiptDate: "2026-09-04",
      receiptTitle: "ซื้อสต๊อกไม่มีใบเสร็จ",
      receiptType: "stock_purchase",
      payeeName: "บริษัทขายส่งตัวอย่าง",
      paymentChannel: "โอนผ่านบัญชีบริษัท",
      paymentReference: "BANK-001",
      businessPurpose: "ซื้อสินค้าเพื่อขาย",
      lines: [{
        stockSkuId: String(stockSku.id),
        sku: stockSku.sku,
        description: "เสื้อ SR สีขาว M",
        quantity: "3",
        unitCost: "125",
      }],
    }));
    formData.append("evidence_paymentSlip", new Blob(["payment-slip"], { type: "text/plain" }), "slip.txt");

    const submitted = await requestJson(baseUrl, "/api/substitute-receipts", {
      method: "POST",
      body: formData,
    });
    assert.equal(submitted.receiptNo, "SR-2026-09-0001");
    assert.equal(submitted.status, "pending_approval");
    assert.equal(submitted.rawFiles[0].storedName, "B1_payment-slip_001.txt");
    assert.equal(submitted.pdfFiles.length, 2);
    assert.equal(submitted.stockMovements.length, 0);

    const stockCard = await requestJson(baseUrl, `/api/inventory/stock-card?stockSkuId=${stockSku.id}`);
    assert.equal(stockCard.balance.quantityOnHand, 0);
    assert.deepEqual(stockCard.movements.map((movement) => movement.referenceNo), []);

    const approved = await requestJson(baseUrl, `/api/substitute-receipts/${submitted.receiptNo}/approve`, {
      method: "POST",
      body: JSON.stringify({ approvedBy: "บัญชี" }),
    });
    assert.equal(approved.status, "approved");

    const received = await requestJson(baseUrl, `/api/substitute-receipts/${submitted.receiptNo}/receive-stock`, {
      method: "POST",
      body: JSON.stringify({ receivedDate: "2026-09-05", receivedBy: "คลัง" }),
    });
    assert.equal(received.status, "received");
    assert.equal(received.stockMovements.length, 1);

    const stockCardAfterReceive = await requestJson(baseUrl, `/api/inventory/stock-card?stockSkuId=${stockSku.id}`);
    assert.equal(stockCardAfterReceive.balance.quantityOnHand, 3);
    assert.deepEqual(stockCardAfterReceive.movements.map((movement) => movement.referenceNo), ["SR-2026-09-0001"]);

    const syncAttempt = await requestJsonResponse(baseUrl, `/api/substitute-receipts/${submitted.receiptNo}/sync-drive`, {
      method: "POST",
    });
    assert.equal(syncAttempt.response.status, 400);
    assert.match(syncAttempt.body.error, /Google Drive is not configured/);

    const nextAfterSubmit = await requestJson(baseUrl, "/api/substitute-receipts/next?accountingMonth=2026-09");
    assert.deepEqual(nextAfterSubmit, { sequence: "2", receiptNo: "SR-2026-09-0002" });
  } finally {
    child.kill();
    await new Promise((resolve) => child.once("exit", resolve));
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("expense request API approves submitted requests and reports sheet sync status", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-expense-api-"));
  const port = 19191;
  const baseUrl = `http://localhost:${port}`;
  const child = spawn(process.execPath, ["local-server.mjs"], {
    cwd: new URL("..", import.meta.url),
    env: {
      ...process.env,
      PORT: String(port),
      SWEET_HOUSE_ROOT_DIR: rootDir,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    await waitForServer(child);

    const formData = new FormData();
    formData.append("payload", JSON.stringify({
      accountingMonth: "2026-09",
      requestTitle: "ค่าส่ง API",
      requestType: "reimbursement",
      requesterName: "คุณส่ง",
      businessPurpose: "ค่าส่งสินค้า",
      paymentTargetName: "ขนส่งตัวอย่าง",
      expenseLines: [{
        date: "2026-09-05",
        category: "ค่าส่ง/ขนส่ง",
        description: "ค่าส่งสินค้า",
        vendor: "ขนส่งตัวอย่าง",
        amountBeforeVat: "100",
        vatAmount: "7",
        withholdingTax: "0",
      }],
    }));

    const submitted = await requestJson(baseUrl, "/api/expense-requests", {
      method: "POST",
      body: formData,
    });
    assert.equal(submitted.requestNo, "REQ-2026-09-0001");

    const approved = await requestJson(baseUrl, `/api/expense-requests/${submitted.requestNo}/approve`, {
      method: "POST",
      body: JSON.stringify({ approvedBy: "บัญชี" }),
    });
    assert.equal(approved.status, "approved");
    assert.equal(approved.sheetSync.syncStatus, "sync_failed");
    assert.match(approved.sheetSync.error, /Google Drive is not configured/);

    const list = await requestJson(baseUrl, "/api/expense-requests");
    const approvedRecord = list.requests.find((request) => request.requestNo === submitted.requestNo);
    assert.equal(approvedRecord.status, "approved");
    assert.equal(approvedRecord.sheetSyncStatus, "sync_failed");
  } finally {
    child.kill();
    await new Promise((resolve) => child.once("exit", resolve));
    await rm(rootDir, { recursive: true, force: true });
  }
});
