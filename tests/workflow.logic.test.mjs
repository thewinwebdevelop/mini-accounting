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

test("template normalization preserves order and sync toggle", () => {
  const normalized = normalizeWorkflowTemplate({
    templateId: "custom_stock",
    name: "ซื้อสต๊อกแบบ custom",
    syncGoogleDrive: true,
    documentSteps: [
      { documentKind: "purchase_order" },
      { documentKind: "payment_voucher" },
    ],
  }, { now: () => "2026-09-06T10:00:00.000Z" });

  assert.equal(normalized.templateId, "custom_stock");
  assert.equal(normalized.syncGoogleDrive, true);
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

test("buildWorkflowTransactionPayload snapshots template and creates TXN folder path", () => {
  const template = DEFAULT_WORKFLOW_TEMPLATES.find((item) => item.templateId === "stock_no_tax_invoice_company_bank");
  const payload = workflowLogic.buildWorkflowTransactionPayload({
    sequence: "7",
    accountingMonth: "2026-09",
    title: "ซื้อสต๊อกล็อตกันยายน",
    template,
  }, { now: () => "2026-09-06T12:00:00.000Z" });

  assert.equal(payload.transactionNo, "TXN-2026-09-0007");
  assert.equal(payload.folderPath, "documents/2026/09/workflow-transactions/TXN-2026-09-0007_ซื้อสต๊อกล็อตกันยายน");
  assert.equal(payload.status, "in_progress");
  assert.equal(payload.templateSnapshot.templateId, "stock_no_tax_invoice_company_bank");
  assert.deepEqual(payload.steps.map((step) => step.workflowStatus), ["not_started", "blocked", "blocked", "blocked"]);
});

test("buildWorkflowTransactionPayload snapshot is a deep copy that cannot corrupt the shared template", () => {
  const template = DEFAULT_WORKFLOW_TEMPLATES.find((item) => item.templateId === "stock_no_tax_invoice_company_bank");
  const payload = workflowLogic.buildWorkflowTransactionPayload({
    sequence: "1",
    accountingMonth: "2026-09",
    title: "ทดสอบ",
    template,
  }, { now: () => "2026-09-06T12:00:00.000Z" });

  payload.templateSnapshot.templateId = "mutated";
  payload.templateSnapshot.documentSteps.push({ stepId: "step-999", documentKind: "purchase_order" });

  assert.equal(template.templateId, "stock_no_tax_invoice_company_bank");
  assert.equal(template.documentSteps.length, 4);
});

test("buildWorkflowTransactionPayload falls back to real time when now is not supplied", () => {
  const template = DEFAULT_WORKFLOW_TEMPLATES.find((item) => item.templateId === "director_expense_transfer");
  const payload = workflowLogic.buildWorkflowTransactionPayload({
    sequence: "2",
    accountingMonth: "2026-09",
    title: "ไม่ระบุเวลา",
    template,
  });

  assert.match(payload.createdAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.equal(payload.updatedAt, payload.createdAt);
});

test("createWorkflowStepStates unlocks only the first step and blocks the rest", () => {
  const template = DEFAULT_WORKFLOW_TEMPLATES.find((item) => item.templateId === "director_expense_cash");
  const steps = workflowLogic.createWorkflowStepStates(template);

  assert.deepEqual(steps.map((step) => step.documentKind), [
    "expense_request",
    "cash_spend_declaration",
    "substitute_receipt",
    "payment_voucher",
  ]);
  assert.deepEqual(steps.map((step) => step.workflowStatus), ["not_started", "blocked", "blocked", "blocked"]);
});

test("normalizeDocumentWorkflowStatus maps completed child documents", () => {
  assert.deepEqual(workflowLogic.normalizeDocumentWorkflowStatus({
    documentKind: "expense_request",
    requestNo: "REQ-2026-09-0001",
    transactionNo: "TXN-2026-09-0001",
    status: "completed",
    statusLabel: "เสร็จสิ้น",
    completedAt: "2026-09-06T13:00:00.000Z",
    completedBy: "บัญชี",
  }), {
    documentKind: "expense_request",
    documentNo: "REQ-2026-09-0001",
    transactionNo: "TXN-2026-09-0001",
    nativeStatus: "completed",
    nativeStatusLabel: "เสร็จสิ้น",
    workflowStatus: "completed",
    completedAt: "2026-09-06T13:00:00.000Z",
    completedBy: "บัญชี",
  });
});

test("normalizeDocumentWorkflowStatus reports substitute_receipt completion by receiptType", () => {
  assert.equal(workflowLogic.normalizeDocumentWorkflowStatus({
    documentKind: "substitute_receipt",
    receiptNo: "SR-2026-09-0001",
    transactionNo: "TXN-2026-09-0001",
    receiptType: "stock_purchase",
    status: "received",
    statusLabel: "รับสินค้าแล้ว",
  }).workflowStatus, "completed");

  assert.equal(workflowLogic.normalizeDocumentWorkflowStatus({
    documentKind: "substitute_receipt",
    receiptNo: "SR-2026-09-0002",
    transactionNo: "TXN-2026-09-0001",
    receiptType: "general_expense",
    status: "approved",
    statusLabel: "อนุมัติแล้ว",
  }).workflowStatus, "completed");

  assert.equal(workflowLogic.normalizeDocumentWorkflowStatus({
    documentKind: "substitute_receipt",
    receiptNo: "SR-2026-09-0003",
    transactionNo: "TXN-2026-09-0001",
    receiptType: "stock_purchase",
    status: "approved",
    statusLabel: "อนุมัติแล้ว",
  }).workflowStatus, "in_progress");

  assert.equal(workflowLogic.normalizeDocumentWorkflowStatus({
    documentKind: "substitute_receipt",
    receiptNo: "SR-2026-09-0004",
    transactionNo: "TXN-2026-09-0001",
    receiptType: "general_expense",
    status: "received",
    statusLabel: "รับสินค้าแล้ว",
  }).workflowStatus, "in_progress");
});

test("normalizeDocumentWorkflowStatus treats missing or unknown native status as in_progress", () => {
  assert.equal(workflowLogic.normalizeDocumentWorkflowStatus({
    documentKind: "purchase_order",
    documentNo: "PO-2026-09-0001",
  }).workflowStatus, "in_progress");

  assert.equal(workflowLogic.normalizeDocumentWorkflowStatus({
    documentKind: "goods_receipt",
    goodsReceiptNo: "GR-2026-09-0001",
    status: "some_unknown_status",
  }).workflowStatus, "in_progress");
});

test("normalizeDocumentWorkflowStatus only reports completed for lightweight document kinds on native completed", () => {
  for (const documentKind of ["purchase_order", "payment_voucher", "goods_receipt", "cash_spend_declaration", "payee_acknowledgement"]) {
    assert.equal(workflowLogic.normalizeDocumentWorkflowStatus({
      documentKind,
      documentNo: "DOC-0001",
      status: "approved",
    }).workflowStatus, "in_progress", `${documentKind} approved should be in_progress`);

    assert.equal(workflowLogic.normalizeDocumentWorkflowStatus({
      documentKind,
      documentNo: "DOC-0001",
      status: "completed",
    }).workflowStatus, "completed", `${documentKind} completed should be completed`);
  }
});

test("normalizeDocumentWorkflowStatus detects document numbers from every supported field", () => {
  assert.equal(workflowLogic.normalizeDocumentWorkflowStatus({ documentNo: "A-1" }).documentNo, "A-1");
  assert.equal(workflowLogic.normalizeDocumentWorkflowStatus({ requestNo: "REQ-1" }).documentNo, "REQ-1");
  assert.equal(workflowLogic.normalizeDocumentWorkflowStatus({ receiptNo: "SR-1" }).documentNo, "SR-1");
  assert.equal(workflowLogic.normalizeDocumentWorkflowStatus({ voucherNo: "PV-1" }).documentNo, "PV-1");
  assert.equal(workflowLogic.normalizeDocumentWorkflowStatus({ purchaseOrderNo: "PO-1" }).documentNo, "PO-1");
  assert.equal(workflowLogic.normalizeDocumentWorkflowStatus({ goodsReceiptNo: "GR-1" }).documentNo, "GR-1");
  assert.equal(workflowLogic.normalizeDocumentWorkflowStatus({}).documentNo, "");
});

test("deriveWorkflowProgress unlocks next document only after current child is completed", () => {
  const template = DEFAULT_WORKFLOW_TEMPLATES.find((item) => item.templateId === "stock_no_tax_invoice_company_bank");
  const transaction = workflowLogic.buildWorkflowTransactionPayload({
    sequence: "1",
    accountingMonth: "2026-09",
    title: "ซื้อสต๊อก",
    template,
  });

  const next = workflowLogic.deriveWorkflowProgress(transaction, [
    {
      documentKind: "purchase_order",
      documentNo: "PO-2026-09-0001",
      workflowStepId: "step-001",
      transactionNo: transaction.transactionNo,
      status: "completed",
      statusLabel: "เสร็จสิ้น",
    },
  ]);

  assert.equal(next.steps[0].workflowStatus, "completed");
  assert.equal(next.steps[1].workflowStatus, "not_started");
  assert.equal(next.steps[2].workflowStatus, "blocked");
  assert.equal(next.currentStepId, "step-002");
});

test("deriveWorkflowProgress matches child documents by documentKind when workflowStepId is missing", () => {
  const template = DEFAULT_WORKFLOW_TEMPLATES.find((item) => item.templateId === "stock_no_tax_invoice_company_bank");
  const transaction = workflowLogic.buildWorkflowTransactionPayload({
    sequence: "2",
    accountingMonth: "2026-09",
    title: "ซื้อสต๊อกอีกครั้ง",
    template,
  });

  const next = workflowLogic.deriveWorkflowProgress(transaction, [
    {
      documentKind: "purchase_order",
      documentNo: "PO-2026-09-0002",
      transactionNo: transaction.transactionNo,
      status: "completed",
    },
  ]);

  assert.equal(next.steps[0].workflowStatus, "completed");
  assert.equal(next.steps[1].workflowStatus, "not_started");
  assert.equal(next.currentStepId, "step-002");
});

test("deriveWorkflowProgress marks the whole transaction completed once every step is completed", () => {
  const template = DEFAULT_WORKFLOW_TEMPLATES.find((item) => item.templateId === "director_expense_transfer");
  const transaction = workflowLogic.buildWorkflowTransactionPayload({
    sequence: "1",
    accountingMonth: "2026-09",
    title: "รายจ่ายเจ้าของ",
    template,
  });

  const childDocuments = transaction.steps.map((step, index) => ({
    documentKind: step.documentKind,
    documentNo: `DOC-000${index + 1}`,
    workflowStepId: step.stepId,
    transactionNo: transaction.transactionNo,
    status: "completed",
    statusLabel: "เสร็จสิ้น",
  }));

  const next = workflowLogic.deriveWorkflowProgress(transaction, childDocuments);

  assert.deepEqual(next.steps.map((step) => step.workflowStatus), ["completed", "completed", "completed"]);
  assert.equal(next.status, "completed");
  assert.equal(next.currentStepId, null);
});

test("deriveWorkflowProgress reports not_started when there are no child documents yet", () => {
  const template = DEFAULT_WORKFLOW_TEMPLATES.find((item) => item.templateId === "director_expense_transfer");
  const transaction = workflowLogic.buildWorkflowTransactionPayload({
    sequence: "3",
    accountingMonth: "2026-09",
    title: "รายจ่ายเจ้าของยังไม่เริ่ม",
    template,
  });

  const next = workflowLogic.deriveWorkflowProgress(transaction, []);

  assert.deepEqual(next.steps.map((step) => step.workflowStatus), ["not_started", "blocked", "blocked"]);
  assert.equal(next.status, "in_progress");
  assert.equal(next.currentStepId, "step-001");
});

test("deriveWorkflowProgress blocks a later step even when its own child document is already completed, if an earlier step is incomplete", () => {
  const template = DEFAULT_WORKFLOW_TEMPLATES.find((item) => item.templateId === "stock_no_tax_invoice_company_bank");
  const transaction = workflowLogic.buildWorkflowTransactionPayload({
    sequence: "4",
    accountingMonth: "2026-09",
    title: "ซื้อสต๊อกข้ามลำดับ",
    template,
  });

  const next = workflowLogic.deriveWorkflowProgress(transaction, [
    {
      documentKind: "substitute_receipt",
      documentNo: "SR-2026-09-0001",
      workflowStepId: "step-002",
      transactionNo: transaction.transactionNo,
      status: "completed",
      statusLabel: "เสร็จสิ้น",
    },
  ]);

  assert.equal(next.steps[0].workflowStatus, "not_started");
  assert.equal(next.steps[1].workflowStatus, "blocked");
  assert.equal(next.currentStepId, "step-001");
});

test("deriveWorkflowProgress reports in_progress when first step has an incomplete child document", () => {
  const template = DEFAULT_WORKFLOW_TEMPLATES.find((item) => item.templateId === "stock_no_tax_invoice_company_bank");
  const transaction = workflowLogic.buildWorkflowTransactionPayload({
    sequence: "5",
    accountingMonth: "2026-09",
    title: "ซื้อสต๊อกอนุมัติแล้ว",
    template,
  });

  const next = workflowLogic.deriveWorkflowProgress(transaction, [
    {
      documentKind: "purchase_order",
      documentNo: "PO-2026-09-0005",
      workflowStepId: "step-001",
      transactionNo: transaction.transactionNo,
      status: "approved",
      statusLabel: "อนุมัติแล้ว",
    },
  ]);

  assert.equal(next.steps[0].workflowStatus, "in_progress");
  assert.equal(next.steps[1].workflowStatus, "blocked");
  assert.equal(next.steps[2].workflowStatus, "blocked");
  assert.equal(next.steps[3].workflowStatus, "blocked");
  assert.equal(next.currentStepId, "step-001");
});

test("formatWorkflowSummaryMarkdown renders template, step, document, and file tables", () => {
  const template = DEFAULT_WORKFLOW_TEMPLATES.find((item) => item.templateId === "stock_no_tax_invoice_company_bank");
  const transaction = workflowLogic.buildWorkflowTransactionPayload({
    sequence: "1",
    accountingMonth: "2026-09",
    title: "ซื้อสต๊อกล็อตกันยายน",
    template,
  }, { now: () => "2026-09-06T12:00:00.000Z" });

  const childDocuments = [
    {
      documentKind: "purchase_order",
      documentNo: "PO-2026-09-0001",
      workflowStepId: "step-001",
      transactionNo: transaction.transactionNo,
      status: "completed",
      statusLabel: "เสร็จสิ้น",
      pdfFiles: [{ name: "PO-2026-09-0001.pdf", url: "/api/purchase-orders/PO-2026-09-0001/files/pdf/PO-2026-09-0001.pdf" }],
      rawFiles: [{ name: "A1_quote_001.jpg", url: "/api/purchase-orders/PO-2026-09-0001/files/raw/A1_quote_001.jpg" }],
    },
  ];

  const markdown = workflowLogic.formatWorkflowSummaryMarkdown(transaction, childDocuments);

  assert.match(markdown, /TXN-2026-09-0001/);
  assert.match(markdown, /ซื้อสต๊อก ไม่มีใบกำกับภาษี ชำระเงินโอนจากบัญชีบริษัท/);
  assert.match(markdown, /ใบสั่งซื้อ/);
  assert.match(markdown, /PO-2026-09-0001/);
  assert.match(markdown, /PO-2026-09-0001\.pdf/);
  assert.match(markdown, /A1_quote_001\.jpg/);
});
