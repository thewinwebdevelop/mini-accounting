import assert from "node:assert/strict";
import test from "node:test";

import expense from "../forms/expense-request.logic.js";
import substitute from "../forms/substitute-receipt.logic.js";
import workflow from "../forms/workflow-document.logic.js";
import prefill from "../forms/workflow-prefill.logic.js";

const vendor = {
  id: "VENDOR-001",
  name: "ร้านอะไหล่ จำกัด",
  taxId: " 0105559999999 ",
  address: " 99 ถนนสุขุมวิท ",
  contactName: "คุณเอ",
  phone: "0812345678",
  email: "sales@example.test",
  bankName: "ธนาคารตัวอย่าง",
  accountNo: "1234567890",
  paymentChannel: "โอนผ่านบัญชีบริษัท",
  paymentReference: "บัญชี 123",
  defaultBusinessPurpose: "ซื้อวัสดุ",
  note: "internal",
};

const expectedSnapshot = {
  name: "ร้านอะไหล่ จำกัด",
  taxId: "0105559999999",
  address: "99 ถนนสุขุมวิท",
  contactName: "คุณเอ",
  phone: "0812345678",
  email: "sales@example.test",
  bankName: "ธนาคารตัวอย่าง",
  accountNo: "1234567890",
  paymentChannel: "โอนผ่านบัญชีบริษัท",
  paymentReference: "บัญชี 123",
  defaultBusinessPurpose: "ซื้อวัสดุ",
};

test("buildVendorSnapshot projects the canonical snapshot and preserves document-local edits", () => {
  const first = expense.buildVendorSnapshot({
    vendorId: vendor.id,
    paymentTargetName: vendor.name,
    paymentTargetTaxId: vendor.taxId,
    paymentAddress: vendor.address,
    paymentContactName: vendor.contactName,
    paymentPhone: vendor.phone,
    paymentEmail: vendor.email,
    paymentBankName: vendor.bankName,
    paymentAccountNo: vendor.accountNo,
    paymentChannel: vendor.paymentChannel,
    paymentReference: vendor.paymentReference,
    defaultBusinessPurpose: vendor.defaultBusinessPurpose,
  });
  assert.deepEqual(first, expectedSnapshot);

  const edited = expense.buildVendorSnapshot({
    vendorSnapshot: first,
    paymentTargetName: "ร้านอะไหล่ สาขาใหม่",
    paymentBankName: vendor.bankName,
    paymentAccountNo: vendor.accountNo,
  });
  assert.equal(edited.name, "ร้านอะไหล่ สาขาใหม่");
  assert.equal(first.name, vendor.name);
  assert.equal(edited.taxId, first.taxId);
});

test("all seven payload builders add vendor metadata without removing existing fields", () => {
  const expensePayload = expense.buildExpensePayload({
    accountingMonth: "2026-09", sequence: "1", requestType: "direct_payment",
    requesterName: "ผู้ขอ", businessPurpose: "ซื้อวัสดุ", paymentTargetName: vendor.name,
    paymentTargetTaxId: vendor.taxId, paymentBankName: vendor.bankName, paymentAccountNo: vendor.accountNo,
    vendorId: vendor.id, vendorSnapshot: expectedSnapshot,
    expenseLines: [{ description: "ของ", amountBeforeVat: "100" }],
  });
  assert.equal(expensePayload.paymentTargetName, vendor.name);
  assert.equal(expensePayload.vendorId, vendor.id);
  assert.equal(expensePayload.vendorSnapshot.name, vendor.name);
  assert.equal(expensePayload.vendorSnapshot.bankName, vendor.bankName);

  const substitutePayload = substitute.buildSubstituteReceiptPayload({
    accountingMonth: "2026-09", sequence: "1", receiptDate: "2026-09-01",
    receiptType: "general_expense", payeeName: vendor.name, payeeTaxId: vendor.taxId,
    paymentChannel: vendor.paymentChannel, paymentReference: vendor.paymentReference,
    vendorId: vendor.id, vendorSnapshot: expectedSnapshot,
    businessPurpose: "ซื้อวัสดุ", lines: [{ description: "ของ", quantity: "1", unitCost: "100" }],
    evidenceFiles: { paymentSlip: [{ storedName: "slip.pdf" }] },
  });
  assert.equal(substitutePayload.payeeName, vendor.name);
  assert.equal(substitutePayload.vendorId, vendor.id);
  assert.equal(substitutePayload.vendorSnapshot.taxId, vendor.taxId.trim());

  for (const kind of workflow.LIGHTWEIGHT_DOCUMENT_KINDS) {
    const payload = workflow.buildWorkflowDocumentPayload({
      documentKind: kind, accountingMonth: "2026-09", documentDate: "2026-09-01",
      title: kind, businessPurpose: "ซื้อวัสดุ", payeeName: vendor.name,
      vendorId: vendor.id, vendorSnapshot: expectedSnapshot,
      lines: [{ description: "ของ", quantity: "1", unitCost: "100" }],
    });
    assert.equal(payload.payeeName, vendor.name);
    assert.equal(payload.vendorId, vendor.id);
    assert.equal(payload.vendorSnapshot.name, vendor.name);
  }
});

test("old payloads without vendor metadata remain valid and prefill keeps existing payee behavior", () => {
  const old = { payeeName: "ร้านเดิม", businessPurpose: "ค่าใช้จ่าย", lines: [] };
  const context = prefill.substituteReceiptToWorkflowContext(old);
  assert.deepEqual(context.payee, { name: "ร้านเดิม" });
  assert.equal(old.vendorId, undefined);
  assert.equal(old.vendorSnapshot, undefined);

  const source = {
    documentKind: "substitute_receipt", documentNo: "SR-2026-09-0001", workflowStepId: "step-001",
    status: "completed", payeeName: vendor.name, payeeTaxId: vendor.taxId,
    vendorId: vendor.id, vendorSnapshot: expectedSnapshot,
  };
  const enrichedContext = prefill.substituteReceiptToWorkflowContext(source);
  assert.equal(enrichedContext.payee.name, vendor.name);
  assert.equal(enrichedContext.payee.vendorId, vendor.id);
  assert.deepEqual(enrichedContext.payee.vendorSnapshot, expectedSnapshot);
  const patch = prefill.applyWorkflowContextToPurchaseOrder(enrichedContext, ["payee"]);
  assert.equal(patch.payeeName, vendor.name);
  assert.equal(patch.vendorId, vendor.id);
  assert.deepEqual(patch.vendorSnapshot, expectedSnapshot);
});
