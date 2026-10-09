import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PERSONAS } from "./auth.fixture.mjs";

export async function createFixtureData({ rootDir, runId }) {
  await mkdir(rootDir, { recursive: true });
  const users = Object.fromEntries(Object.entries(PERSONAS).map(([key, user]) => [key, {
    ...user,
    status: key === "pending" ? "pending" : key === "inactive" ? "inactive" : "active",
  }]));
  const manifest = {
    runId,
    users,
    vendors: [{ id: "vendor-1", name: "Fixture Supplies", taxId: "0105559999999", status: "active" }],
    inventory: [{ sku: "FIXTURE-SKU-1", name: "Fixture item", quantity: 25, reorderLevel: 5 }],
    documents: [{ documentKind: "expense_request", documentNo: "REQ-2026-10-0001", ownerUserId: users.employeeA.userId, status: "draft" }],
    templates: [{ id: "fixture-template", name: "Fixture workflow", steps: ["request", "approve", "complete"] }],
  };
  await writeFile(path.join(rootDir, "e2e-seed.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return manifest;
}
