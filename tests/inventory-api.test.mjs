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
      "content-type": "application/json",
      ...(options.headers || {}),
    },
  });
  const body = await response.json();
  assert.equal(response.ok, true, body.error || `HTTP ${response.status}`);
  return body;
}

async function requestBuffer(baseUrl, route) {
  const response = await fetch(`${baseUrl}${route}`);
  const body = Buffer.from(await response.arrayBuffer());
  assert.equal(response.ok, true, `HTTP ${response.status}: ${body.toString("utf8").slice(0, 120)}`);
  return {
    contentType: response.headers.get("content-type"),
    body,
  };
}

test("inventory APIs create product, SKU, purchase-in, balance, and stock card records", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-inventory-api-"));
  const port = 19187;
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

    const initialCategories = await requestJson(baseUrl, "/api/inventory/categories");
    assert.equal(initialCategories.categories.some((category) => category.name === "เสื้อ"), true);

    const createdCategory = await requestJson(baseUrl, "/api/inventory/categories", {
      method: "POST",
      body: JSON.stringify({ name: "เสื้อคลุม", sortOrder: "25" }),
    });
    assert.equal(createdCategory.category.name, "เสื้อคลุม");

    const updatedCategory = await requestJson(baseUrl, `/api/inventory/categories/${createdCategory.category.id}`, {
      method: "PUT",
      body: JSON.stringify({ name: "เสื้อคลุมแฟชั่น", sortOrder: "26", status: "active" }),
    });
    assert.equal(updatedCategory.category.name, "เสื้อคลุมแฟชั่น");

    const { product } = await requestJson(baseUrl, "/api/inventory/products", {
      method: "POST",
      body: JSON.stringify({ productCode: "SHIRT-A", name: "เสื้อ A", category: "เสื้อคลุมแฟชั่น" }),
    });
    const { stockSku } = await requestJson(baseUrl, "/api/inventory/stock-skus", {
      method: "POST",
      body: JSON.stringify({
        productId: product.id,
        sku: "SHIRT-A-BLACK-M",
        color: "ดำ",
        size: "M",
        defaultUnitCost: "120",
      }),
    });

    const updatedSkuResponse = await requestJson(baseUrl, `/api/inventory/stock-skus/${stockSku.id}`, {
      method: "PUT",
      body: JSON.stringify({
        productId: product.id,
        sku: "SHIRT-A-BLACK-M",
        color: "ดำสนิท",
        size: "M",
        defaultUnitCost: "125",
        status: "active",
      }),
    });
    assert.equal(updatedSkuResponse.stockSku.color, "ดำสนิท");

    await requestJson(baseUrl, "/api/inventory/purchase-in", {
      method: "POST",
      body: JSON.stringify({
        stockSkuId: stockSku.id,
        movementDate: "2026-09-04",
        quantity: "5",
        unitCost: "120",
        referenceType: "manual",
        referenceNo: "RCV-API-001",
      }),
    });

    const { balances } = await requestJson(baseUrl, "/api/inventory/balances");
    assert.equal(balances[0].sku, "SHIRT-A-BLACK-M");
    assert.equal(balances[0].quantityOnHand, 5);
    assert.equal(balances[0].averageUnitCost, "120.00");
    assert.equal(balances[0].inventoryValue, "600.00");

    const dashboard = await requestJson(baseUrl, "/api/inventory/dashboard");
    assert.equal(dashboard.summary.stockSkuCount, 1);
    assert.equal(dashboard.summary.totalQuantityOnHand, 5);
    assert.equal(dashboard.summary.totalInventoryValue, "600.00");
    assert.equal(dashboard.latestStockIn.length, 1);
    assert.equal(dashboard.latestStockIn[0].referenceNo, "RCV-API-001");

    const stockInReport = await requestJson(baseUrl, "/api/inventory/stock-in-report?limit=10");
    assert.equal(stockInReport.movements[0].sku, "SHIRT-A-BLACK-M");
    assert.equal(stockInReport.movements[0].totalCost, "600.00");

    const pdf = await requestBuffer(baseUrl, "/api/inventory/current-stock-pdf");
    assert.equal(pdf.contentType, "application/pdf");
    assert.equal(pdf.body.subarray(0, 4).toString("utf8"), "%PDF");

    const stockCard = await requestJson(baseUrl, `/api/inventory/stock-card?stockSkuId=${stockSku.id}`);
    assert.equal(stockCard.sku.color, "ดำสนิท");
    assert.deepEqual(stockCard.movements.map((movement) => movement.referenceNo), ["RCV-API-001"]);

    const { saleSku } = await requestJson(baseUrl, "/api/inventory/sale-skus", {
      method: "POST",
      body: JSON.stringify({
        saleSku: "SHIRT-A-SHOPEE-BLACK-M",
        displayName: "เสื้อ A สีดำ M Shopee",
        platform: "shopee",
        platformProductId: "SP-PRODUCT-1",
        platformVariationId: "SP-BLACK-M",
        components: [{ stockSkuId: stockSku.id, quantity: "1" }],
      }),
    });
    assert.equal(saleSku.saleSku, "SHIRT-A-SHOPEE-BLACK-M");
    assert.equal(saleSku.components[0].sku, "SHIRT-A-BLACK-M");

    const saleSkus = await requestJson(baseUrl, "/api/inventory/sale-skus?search=Shopee");
    assert.equal(saleSkus.saleSkus.length, 1);
    assert.equal(saleSkus.saleSkus[0].platformVariationId, "SP-BLACK-M");
  } finally {
    child.kill();
    await new Promise((resolve) => child.once("exit", resolve));
    await rm(rootDir, { recursive: true, force: true });
  }
});
