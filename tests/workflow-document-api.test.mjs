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

test("workflow document APIs save, list, complete, and serve files over HTTP", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-workflow-api-"));
  const port = 19194;
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

    const staticPage = await fetch(`${baseUrl}/workflow-document`);
    assert.equal(staticPage.status, 200);
    const staticHtml = await staticPage.text();
    assert.match(staticHtml, /id="workflowDocumentForm"/);

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
    }));
    formData.append("evidence_evidence", new Blob(["quote"], { type: "text/plain" }), "quote.txt");

    const submitted = await requestJson(baseUrl, "/api/workflow-documents", {
      method: "POST",
      body: formData,
    });
    assert.equal(submitted.documentNo, "PO-2026-09-0001");
    assert.equal(submitted.status, "draft");
    assert.equal(submitted.pdfFiles.length, 1);
    assert.equal(submitted.rawFiles[0], "evidence_001.txt");

    const secondFormData = new FormData();
    secondFormData.append("payload", JSON.stringify({
      documentKind: "purchase_order",
      accountingMonth: "2026-09",
      documentDate: "2026-09-06",
      title: "สั่งซื้อสินค้า Lot กันยายน รอบสอง",
      businessPurpose: "สั่งซื้อสินค้าเข้าคลังรอบสอง",
      lines: [{ description: "สินค้า B", quantity: "1", unitCost: "10" }],
    }));
    const secondSubmitted = await requestJson(baseUrl, "/api/workflow-documents", {
      method: "POST",
      body: secondFormData,
    });
    assert.equal(secondSubmitted.documentNo, "PO-2026-09-0002", "sequence must auto-increment within the same kind/month");

    const fetched = await requestJson(baseUrl, `/api/workflow-documents/purchase_order/${submitted.documentNo}`);
    assert.equal(fetched.payload.title, "สั่งซื้อสินค้า Lot กันยายน");

    const list = await requestJson(baseUrl, "/api/workflow-documents?documentKind=purchase_order");
    assert.equal(list.documents.length, 2);

    const completed = await requestJson(baseUrl, `/api/workflow-documents/purchase_order/${submitted.documentNo}/complete`, {
      method: "POST",
      body: JSON.stringify({ completedBy: "คุณต้า" }),
    });
    assert.equal(completed.status, "completed");
    assert.equal(completed.completedBy, "คุณต้า");

    const completedAgain = await requestJson(baseUrl, `/api/workflow-documents/purchase_order/${submitted.documentNo}/complete`, {
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
    child.kill();
    await new Promise((resolve) => child.once("exit", resolve));
    await rm(rootDir, { recursive: true, force: true });
  }
});
