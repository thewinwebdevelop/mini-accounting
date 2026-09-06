import assert from "node:assert/strict";
import test from "node:test";

import workflowLogic from "../forms/workflow.logic.js";

const {
  DOCUMENT_TYPE_DEFINITIONS,
  DEFAULT_WORKFLOW_TEMPLATES,
  validateWorkflowTemplate,
  normalizeWorkflowTemplate,
  getDefaultWorkflowTemplates,
} = workflowLogic;

test("document type registry exposes MVP standalone document kinds", () => {
  assert.deepEqual(Object.keys(DOCUMENT_TYPE_DEFINITIONS), [
    "purchase_order",
    "substitute_receipt",
    "payment_voucher",
    "goods_receipt",
    "expense_request",
    "cash_spend_declaration",
    "payee_acknowledgement",
  ]);
});

test("default workflow templates contain the six requested use cases", () => {
  assert.deepEqual(DEFAULT_WORKFLOW_TEMPLATES.map((item) => item.templateId), [
    "stock_no_tax_invoice_company_bank",
    "stock_no_tax_invoice_director_transfer",
    "director_expense_transfer",
    "director_expense_cash",
    "outsource_expense_cash",
    "outsource_expense_transfer",
  ]);
});

test("stock company bank template contains the requested document order", () => {
  const template = DEFAULT_WORKFLOW_TEMPLATES.find((item) => item.templateId === "stock_no_tax_invoice_company_bank");
  assert.deepEqual(template.documentSteps.map((step) => step.documentKind), [
    "purchase_order",
    "substitute_receipt",
    "payment_voucher",
    "goods_receipt",
  ]);
});

test("template normalization preserves order and sync toggles", () => {
  const normalized = normalizeWorkflowTemplate({
    templateId: "custom_stock",
    name: "ซื้อสต๊อกแบบ custom",
    syncGoogleDrive: true,
    syncGoogleSheets: false,
    documentSteps: [
      { documentKind: "purchase_order" },
      { documentKind: "payment_voucher" },
    ],
  }, { now: () => "2026-09-06T10:00:00.000Z" });

  assert.equal(normalized.templateId, "custom_stock");
  assert.equal(normalized.syncGoogleDrive, true);
  assert.equal(normalized.syncGoogleSheets, false);
  assert.deepEqual(normalized.documentSteps.map((step) => step.stepId), ["step-001", "step-002"]);
});

test("template validation rejects unsupported document kinds", () => {
  assert.deepEqual(validateWorkflowTemplate({
    name: "bad",
    documentSteps: [{ documentKind: "unknown_doc" }],
  }), ["ระบุรหัส template", "พบประเภทเอกสารที่ยังไม่รองรับ: unknown_doc"]);
});

test("every default workflow template has the document steps specified by the design spec", () => {
  const expectedDocumentKindsByTemplateId = {
    stock_no_tax_invoice_company_bank: [
      "purchase_order",
      "substitute_receipt",
      "payment_voucher",
      "goods_receipt",
    ],
    stock_no_tax_invoice_director_transfer: [
      "purchase_order",
      "substitute_receipt",
      "expense_request",
      "payment_voucher",
      "goods_receipt",
    ],
    director_expense_transfer: [
      "expense_request",
      "substitute_receipt",
      "payment_voucher",
    ],
    director_expense_cash: [
      "expense_request",
      "cash_spend_declaration",
      "substitute_receipt",
      "payment_voucher",
    ],
    outsource_expense_cash: [
      "expense_request",
      "cash_spend_declaration",
      "substitute_receipt",
      "payment_voucher",
      "payee_acknowledgement",
    ],
    outsource_expense_transfer: [
      "expense_request",
      "substitute_receipt",
      "payment_voucher",
      "payee_acknowledgement",
    ],
  };

  const actualDocumentKindsByTemplateId = Object.fromEntries(
    DEFAULT_WORKFLOW_TEMPLATES.map((template) => [
      template.templateId,
      template.documentSteps.map((step) => step.documentKind),
    ]),
  );

  assert.deepEqual(actualDocumentKindsByTemplateId, expectedDocumentKindsByTemplateId);
});

test("every default workflow template has contiguous sequential step IDs", () => {
  for (const template of DEFAULT_WORKFLOW_TEMPLATES) {
    const expectedStepIds = template.documentSteps.map((_, index) => `step-${String(index + 1).padStart(3, "0")}`);
    assert.deepEqual(template.documentSteps.map((step) => step.stepId), expectedStepIds, `template ${template.templateId} has non-contiguous step IDs`);
  }
});

test("template normalization trims whitespace-only text fields to empty strings", () => {
  const normalized = normalizeWorkflowTemplate({
    templateId: "   ",
    name: "   ",
    description: "   ",
    documentSteps: [{ documentKind: "purchase_order" }],
  }, { now: () => "2026-09-06T10:00:00.000Z" });

  assert.equal(normalized.templateId, "");
  assert.equal(normalized.name, "");
  assert.equal(normalized.description, "");
});

test("getDefaultWorkflowTemplates returns a deep copy that cannot corrupt the shared seed", () => {
  const first = getDefaultWorkflowTemplates();
  first.push({ templateId: "injected" });
  first[0].templateId = "mutated";
  first[0].documentSteps.push({ stepId: "step-999", documentKind: "purchase_order" });

  const second = getDefaultWorkflowTemplates();
  assert.deepEqual(second.map((item) => item.templateId), [
    "stock_no_tax_invoice_company_bank",
    "stock_no_tax_invoice_director_transfer",
    "director_expense_transfer",
    "director_expense_cash",
    "outsource_expense_cash",
    "outsource_expense_transfer",
  ]);
  assert.deepEqual(second[0].documentSteps.map((step) => step.documentKind), [
    "purchase_order",
    "substitute_receipt",
    "payment_voucher",
    "goods_receipt",
  ]);
});
