import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { PERSONAS } from "./auth.fixture.mjs";

const require = createRequire(import.meta.url);
const { saveExpenseDraft, saveExpenseSubmission } = require("../../forms/local-server.logic.js");

export async function createFixtureData({ rootDir, runId }) {
  await mkdir(rootDir, { recursive: true });
  const manifestPath = path.join(rootDir, "e2e-seed.json");
  try { return JSON.parse(await readFile(manifestPath, "utf8")); } catch {}
  const users = Object.fromEntries(Object.entries(PERSONAS).map(([key, user]) => [key, {
    ...user,
    status: key === "pending" ? "pending" : key === "inactive" ? "inactive" : "active",
  }]));
  const manifest = {
    runId,
    users,
    vendors: [{ id: "vendor-1", name: "Fixture Supplies", taxId: "0105559999999", status: "active" }],
    inventory: [{ sku: "FIXTURE-SKU-1", name: "Fixture item", quantity: 25, reorderLevel: 5 }],
    documents: [],
    templates: [{ id: "fixture-template", name: "Fixture workflow", steps: ["request", "approve", "complete"] }],
  };
  for (const [ownerUserId, requestTitle] of [[users.employeeA.userId, "Employee A fixture"], [users.employeeB.userId, "Employee B fixture"]]) {
    const draft = await saveExpenseDraft({ rootDir, payload: {
      requestType: "reimbursement", accountingMonth: "2026-10", requesterName: ownerUserId,
      businessPurpose: requestTitle, paymentTargetName: "Fixture Supplies", requestTitle,
      ownerUserId, expenseLines: [{ description: "Fixture file", amountBeforeVat: "100", vatAmount: "0", withholdingTax: "0" }],
    } });
    const submitted = await saveExpenseSubmission({ rootDir, payload: { requestNo: draft.requestNo } });
    manifest.documents.push({ documentKind: "expense_request", documentNo: submitted.requestNo, ownerUserId, status: "pending_approval", pdfPath: submitted.pdfFiles[0]?.path });
  }
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return manifest;
}
