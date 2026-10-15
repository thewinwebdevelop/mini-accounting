import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { saveExpenseDraft, getSubmittedExpenseRequest } = require("../forms/local-server.logic.js");
const { formatProfileName } = require("../forms/user-profile.logic.js");
const { updateAppUserProfile } = require("../forms/user-profile.server.logic.js");

test("saved requester snapshots do not change when the profile is updated later", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-profile-snapshot-"));
  const profile = { firstName: "ชื่อเดิม", lastName: "นามสกุลเดิม", companyPositionLabel: "ผู้จัดการ" };
  const request = {
    accountingMonth: "2026-09", expenseDate: "2026-09-25", requesterName: formatProfileName(profile), requesterRole: profile.companyPositionLabel,
    requestType: "reimbursement", requestTitle: "snapshot", businessPurpose: "test", paymentTargetName: "ร้านตัวอย่าง", ownerUserId: "session-user",
    expenseLines: [{ date: "2026-09-25", category: "ทั่วไป", description: "ค่าบริการ", amountBeforeVat: "100", vatAmount: "0", withholdingTax: "0" }],
  };
  const recorder = async (_client, path, options = {}) => {
    if (options.method === "PATCH") return [{ user_id: "session-user" }];
    if (path.includes("company_positions")) return [{ id: "position-1", status: "active", label: "นักบัญชี" }];
    return [{ user_id: "session-user", first_name: "ชื่อใหม่", last_name: "นามสกุลใหม่", company_position_id: "position-1", company_positions: { label: "นักบัญชี" } }];
  };
  try {
    const saved = await saveExpenseDraft({ rootDir, payload: request });
    await updateAppUserProfile({ client: {}, userId: "session-user", input: { firstName: "ชื่อใหม่", lastName: "นามสกุลใหม่", companyPositionId: "position-1" }, request: recorder });
    const reloaded = await getSubmittedExpenseRequest(rootDir, saved.requestNo);
    assert.equal(reloaded.payload.requesterName, "ชื่อเดิม นามสกุลเดิม");
    assert.equal(reloaded.payload.requesterRole, "ผู้จัดการ");
    assert.equal(JSON.parse(await readFile(join(rootDir, saved.folderPath, "data", "submission.json"))).requesterName, "ชื่อเดิม นามสกุลเดิม");
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});
