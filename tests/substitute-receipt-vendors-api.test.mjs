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

test("substitute receipt vendor preset APIs create, list, and update payee presets", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-sr-vendors-api-"));
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

    const created = await requestJson(baseUrl, "/api/substitute-receipt-vendors", {
      method: "POST",
      body: JSON.stringify({
        name: "บริษัทขายส่งตัวอย่าง",
        taxId: "0105566000000",
        paymentChannel: "โอนผ่านบัญชีบริษัท",
        paymentReference: "KBANK 123-4-56789-0",
        defaultBusinessPurpose: "ซื้อสินค้าเพื่อขาย",
        note: "ผู้ขายประจำสำหรับเสื้อผ้า",
      }),
    });

    assert.equal(created.vendor.name, "บริษัทขายส่งตัวอย่าง");
    assert.equal(created.vendor.status, "active");

    const listed = await requestJson(baseUrl, "/api/substitute-receipt-vendors");
    assert.deepEqual(listed.vendors.map((vendor) => vendor.name), ["บริษัทขายส่งตัวอย่าง"]);

    const updated = await requestJson(baseUrl, `/api/substitute-receipt-vendors/${created.vendor.id}`, {
      method: "PUT",
      body: JSON.stringify({
        name: "บริษัทขายส่งตัวอย่าง จำกัด",
        taxId: "0105566000000",
        paymentChannel: "โอนผ่านบัญชีบริษัท",
        paymentReference: "SCB 111-2-33333-4",
        defaultBusinessPurpose: "ซื้อสต๊อกสินค้าเพื่อขาย",
        note: "แก้ไขบัญชีปลายทาง",
        status: "inactive",
      }),
    });

    assert.equal(updated.vendor.name, "บริษัทขายส่งตัวอย่าง จำกัด");
    assert.equal(updated.vendor.paymentReference, "SCB 111-2-33333-4");
    assert.equal(updated.vendor.status, "inactive");

    const activeOnly = await requestJson(baseUrl, "/api/substitute-receipt-vendors");
    assert.equal(activeOnly.vendors.length, 0);

    const withInactive = await requestJson(baseUrl, "/api/substitute-receipt-vendors?includeInactive=1");
    assert.deepEqual(withInactive.vendors.map((vendor) => vendor.status), ["inactive"]);
  } finally {
    child.kill();
    await new Promise((resolve) => child.once("exit", resolve));
    await rm(rootDir, { recursive: true, force: true });
  }
});
