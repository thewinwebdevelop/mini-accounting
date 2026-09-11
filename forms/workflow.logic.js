// The only two values a substitute_receipt template step's receiptType may
// declare. Meaningful only when that step's documentKind is
// "substitute_receipt" -- deriveChildWorkflowStatus's hybrid completion rule
// keys on the *document's own* receiptType (stock_purchase completes at
// native "received", general_expense completes at "approved"), so a template
// that declares the wrong one for its use case strands the workflow or, worse,
// reports done while skipping stock receiving entirely.
const SUBSTITUTE_RECEIPT_TEMPLATE_TYPES = ["stock_purchase", "general_expense"];

const DOCUMENT_TYPE_DEFINITIONS = {
  purchase_order: { documentKind: "purchase_order", label: "ใบสั่งซื้อ", route: "/workflow-document?documentKind=purchase_order", standalone: true },
  substitute_receipt: { documentKind: "substitute_receipt", label: "ใบรับรองแทนใบเสร็จรับเงิน", route: "/substitute-receipt", standalone: true },
  payment_voucher: { documentKind: "payment_voucher", label: "ใบสำคัญจ่าย", route: "/workflow-document?documentKind=payment_voucher", standalone: true },
  goods_receipt: { documentKind: "goods_receipt", label: "ใบรับของ/ใบรับสินค้าเข้าคลัง", route: "/workflow-document?documentKind=goods_receipt", standalone: true },
  expense_request: { documentKind: "expense_request", label: "ใบเบิกค่าใช้จ่าย", route: "/expense-request", standalone: true },
  cash_spend_declaration: { documentKind: "cash_spend_declaration", label: "ใบรับรองการจ่ายเงินสดส่วนตัว", route: "/workflow-document?documentKind=cash_spend_declaration", standalone: true },
  payee_acknowledgement: { documentKind: "payee_acknowledgement", label: "ใบสำคัญรับเงิน/ใบรับเงินคืนค่าใช้จ่าย", route: "/workflow-document?documentKind=payee_acknowledgement", standalone: true },
};

const DEFAULT_WORKFLOW_TEMPLATES = [
  {
    templateId: "stock_no_tax_invoice_company_bank",
    name: "ซื้อสต๊อก ไม่มีใบกำกับภาษี ชำระเงินโอนจากบัญชีบริษัท",
    description: "สำหรับการซื้อสินค้าเข้าคลังที่ไม่มีใบกำกับภาษี และชำระเงินโดยการโอนจากบัญชีธนาคารของบริษัท",
    syncGoogleDrive: false,
    active: true,
    documentSteps: [
      { stepId: "step-001", documentKind: "purchase_order" },
      { stepId: "step-002", documentKind: "substitute_receipt", receiptType: "stock_purchase" },
      { stepId: "step-003", documentKind: "payment_voucher" },
      { stepId: "step-004", documentKind: "goods_receipt" },
    ],
    createdAt: "2026-09-06T00:00:00.000Z",
    updatedAt: "2026-09-06T00:00:00.000Z",
  },
  {
    templateId: "stock_no_tax_invoice_director_transfer",
    name: "ซื้อสต๊อก ไม่มีใบกำกับภาษี ชำระเงินโอนบัญชีเจ้าของ",
    description: "สำหรับการซื้อสินค้าเข้าคลังที่ไม่มีใบกำกับภาษี และชำระเงินโดยการโอนจากบัญชีส่วนตัวของเจ้าของ",
    syncGoogleDrive: false,
    active: true,
    documentSteps: [
      { stepId: "step-001", documentKind: "purchase_order" },
      { stepId: "step-002", documentKind: "substitute_receipt", receiptType: "stock_purchase" },
      { stepId: "step-003", documentKind: "expense_request" },
      { stepId: "step-004", documentKind: "payment_voucher" },
      { stepId: "step-005", documentKind: "goods_receipt" },
    ],
    createdAt: "2026-09-06T00:00:00.000Z",
    updatedAt: "2026-09-06T00:00:00.000Z",
  },
  {
    templateId: "director_expense_transfer",
    name: "รายจ่ายเจ้าของ ชำระเงินโอนบัญชี",
    description: "สำหรับบันทึกรายจ่ายของเจ้าของบริษัท ชำระเงินโดยการโอนบัญชี",
    syncGoogleDrive: false,
    active: true,
    documentSteps: [
      { stepId: "step-001", documentKind: "expense_request" },
      { stepId: "step-002", documentKind: "substitute_receipt", receiptType: "general_expense" },
      { stepId: "step-003", documentKind: "payment_voucher" },
    ],
    createdAt: "2026-09-06T00:00:00.000Z",
    updatedAt: "2026-09-06T00:00:00.000Z",
  },
  {
    templateId: "director_expense_cash",
    name: "รายจ่ายเจ้าของ ชำระเงินสด",
    description: "สำหรับบันทึกรายจ่ายของเจ้าของบริษัท ชำระเงินสด",
    syncGoogleDrive: false,
    active: true,
    documentSteps: [
      { stepId: "step-001", documentKind: "expense_request" },
      { stepId: "step-002", documentKind: "cash_spend_declaration" },
      { stepId: "step-003", documentKind: "substitute_receipt", receiptType: "general_expense" },
      { stepId: "step-004", documentKind: "payment_voucher" },
    ],
    createdAt: "2026-09-06T00:00:00.000Z",
    updatedAt: "2026-09-06T00:00:00.000Z",
  },
  {
    templateId: "outsource_expense_cash",
    name: "รายจ่ายบุคคลภายนอก ชำระเงินสด",
    description: "สำหรับบันทึกรายจ่ายจากบุคคลภายนอก ชำระเงินสด",
    syncGoogleDrive: false,
    active: true,
    documentSteps: [
      { stepId: "step-001", documentKind: "expense_request" },
      { stepId: "step-002", documentKind: "cash_spend_declaration" },
      { stepId: "step-003", documentKind: "substitute_receipt", receiptType: "general_expense" },
      { stepId: "step-004", documentKind: "payment_voucher" },
      { stepId: "step-005", documentKind: "payee_acknowledgement" },
    ],
    createdAt: "2026-09-06T00:00:00.000Z",
    updatedAt: "2026-09-06T00:00:00.000Z",
  },
  {
    templateId: "outsource_expense_transfer",
    name: "รายจ่ายบุคคลภายนอก ชำระเงินโอนบัญชี",
    description: "สำหรับบันทึกรายจ่ายจากบุคคลภายนอก ชำระเงินโดยการโอนบัญชี",
    syncGoogleDrive: false,
    active: true,
    documentSteps: [
      { stepId: "step-001", documentKind: "expense_request" },
      { stepId: "step-002", documentKind: "substitute_receipt", receiptType: "general_expense" },
      { stepId: "step-003", documentKind: "payment_voucher" },
      { stepId: "step-004", documentKind: "payee_acknowledgement" },
    ],
    createdAt: "2026-09-06T00:00:00.000Z",
    updatedAt: "2026-09-06T00:00:00.000Z",
  },
];

function getDocumentTypeDefinition(documentKind) {
  return DOCUMENT_TYPE_DEFINITIONS[documentKind];
}

function getDefaultWorkflowTemplates() {
  return DEFAULT_WORKFLOW_TEMPLATES.map((template) => ({
    ...template,
    documentSteps: template.documentSteps.map((step) => ({ ...step })),
  }));
}

function validateWorkflowTemplate(template) {
  const errors = [];

  // Check for templateId
  if (!template.templateId) {
    errors.push("ระบุรหัส template");
  }

  // Check for empty or missing documentSteps
  if (!template.documentSteps || template.documentSteps.length === 0) {
    errors.push("ระบุเอกสารอย่างน้อย 1 ฉบับ");
  } else {
    // Check each documentKind is supported
    for (const step of template.documentSteps) {
      if (!DOCUMENT_TYPE_DEFINITIONS[step.documentKind]) {
        // A step with no documentKind at all must not interpolate to the
        // literal "undefined" — a non-Thai token in a Thai-only UI.
        const kindLabel = step.documentKind || "(ไม่ระบุประเภทเอกสาร)";
        errors.push(`พบประเภทเอกสารที่ยังไม่รองรับ: ${kindLabel}`);
        continue;
      }

      // receiptType is only meaningful on a substitute_receipt step (see
      // SUBSTITUTE_RECEIPT_TEMPLATE_TYPES above). Omitting it entirely is
      // allowed -- that is exactly the shape of every template persisted to
      // disk before this feature shipped, and a running install must not
      // break because of it. A *present but wrong* value is rejected outright
      // rather than silently coerced, since silently picking a default here
      // is exactly the kind of guess that stranded workflows or skipped
      // stock receiving in the first place.
      if (
        step.documentKind === "substitute_receipt"
        && step.receiptType
        && !SUBSTITUTE_RECEIPT_TEMPLATE_TYPES.includes(step.receiptType)
      ) {
        errors.push(`ประเภทใบรับรองแทนใบเสร็จไม่ถูกต้อง: ${step.receiptType}`);
      }
    }
  }

  return errors;
}

function normalizeWorkflowTemplate(template, options) {
  const now = options?.now?.() || "2026-09-06T00:00:00.000Z";

  return {
    templateId: typeof template.templateId === "string" ? template.templateId.trim() : template.templateId,
    name: typeof template.name === "string" ? template.name.trim() : template.name,
    description: typeof template.description === "string" ? template.description.trim() : template.description,
    syncGoogleDrive: !!template.syncGoogleDrive,
    active: template.active !== false,
    documentSteps: (template.documentSteps || []).map((step, index) => {
      const normalizedStep = {
        stepId: `step-${String(index + 1).padStart(3, "0")}`,
        documentKind: step.documentKind,
      };
      // receiptType is only meaningful on a substitute_receipt step -- drop
      // it for every other kind rather than carrying a stray value forward.
      // An omitted (falsy) value on a substitute_receipt step is left unset
      // rather than defaulted, so a template persisted before this feature
      // shipped normalizes to exactly the same shape it already has on disk.
      if (step.documentKind === "substitute_receipt") {
        const receiptType = typeof step.receiptType === "string" ? step.receiptType.trim() : step.receiptType;
        if (receiptType) normalizedStep.receiptType = receiptType;
      }
      return normalizedStep;
    }),
    createdAt: template.createdAt || now,
    updatedAt: now,
  };
}

function padWorkflowSequence(sequence) {
  const parsed = Number.parseInt(String(sequence ?? "1"), 10);
  const safe = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
  return String(safe).padStart(4, "0");
}

function safeWorkflowTitle(title) {
  return String(title ?? "")
    .trim()
    .replace(/[\\/:*?"<>|#%{}^~[\]`]+/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 80) || "ไม่ระบุรายการ";
}

function getWorkflowMonthParts(accountingMonth = "") {
  const [year, month] = String(accountingMonth).split("-");
  if (!/^\d{4}$/.test(year) || !/^\d{2}$/.test(month)) {
    throw new Error("Invalid accounting month");
  }
  return { year, month };
}

function cloneWorkflowTemplate(template = {}) {
  return {
    ...template,
    documentSteps: (template.documentSteps || []).map((step) => ({ ...step })),
  };
}

function createWorkflowStepStates(template) {
  const documentSteps = (template && template.documentSteps) || [];
  return documentSteps.map((step, index) => ({
    stepId: step.stepId,
    documentKind: step.documentKind,
    workflowStatus: index === 0 ? "not_started" : "blocked",
  }));
}

function buildWorkflowTransactionPayload(data = {}, options = {}) {
  const now = typeof options.now === "function" ? options.now() : new Date().toISOString();
  const { year, month } = getWorkflowMonthParts(data.accountingMonth);
  const transactionNo = `TXN-${year}-${month}-${padWorkflowSequence(data.sequence)}`;
  const title = String(data.title ?? "").trim();
  const folderPath = `documents/${year}/${month}/workflow-transactions/${transactionNo}_${safeWorkflowTitle(title)}`;
  const templateSnapshot = cloneWorkflowTemplate(data.template);
  const steps = createWorkflowStepStates(templateSnapshot);

  return {
    transactionNo,
    accountingMonth: `${year}-${month}`,
    title,
    workflowTemplateId: templateSnapshot.templateId,
    templateSnapshot,
    folderPath,
    status: "in_progress",
    syncGoogleDrive: !!templateSnapshot.syncGoogleDrive,
    steps,
    currentStepId: steps.length ? steps[0].stepId : null,
    createdAt: now,
    updatedAt: now,
  };
}

function deriveChildWorkflowStatus(documentRecord = {}) {
  if (documentRecord.status === "completed") {
    return "completed";
  }

  if (documentRecord.documentKind === "substitute_receipt") {
    if (documentRecord.receiptType === "stock_purchase" && documentRecord.status === "received") {
      return "completed";
    }
    if (documentRecord.receiptType === "general_expense" && documentRecord.status === "approved") {
      return "completed";
    }
  }

  return "in_progress";
}

function normalizeDocumentWorkflowStatus(documentRecord = {}) {
  const documentNo = documentRecord.documentNo
    || documentRecord.requestNo
    || documentRecord.receiptNo
    || documentRecord.voucherNo
    || documentRecord.purchaseOrderNo
    || documentRecord.goodsReceiptNo
    || "";

  return {
    documentKind: documentRecord.documentKind,
    documentNo,
    transactionNo: documentRecord.transactionNo,
    nativeStatus: documentRecord.status,
    nativeStatusLabel: documentRecord.statusLabel,
    workflowStatus: deriveChildWorkflowStatus(documentRecord),
    completedAt: documentRecord.completedAt,
    completedBy: documentRecord.completedBy,
  };
}

function deriveWorkflowProgress(transaction, childDocuments = []) {
  const normalizedDocs = childDocuments.map((doc) => ({
    ...normalizeDocumentWorkflowStatus(doc),
    workflowStepId: doc.workflowStepId,
  }));

  // Documents must be produced in strict template order: once a step is not yet
  // complete, every later step is blocked regardless of that step's own status.
  let blocked = false;
  const steps = (transaction.steps || []).map((step) => {
    const match = normalizedDocs.find((doc) => doc.workflowStepId === step.stepId)
      || normalizedDocs.find((doc) => !doc.workflowStepId && doc.documentKind === step.documentKind);

    let workflowStatus;
    if (blocked) {
      workflowStatus = "blocked";
    } else if (match && match.workflowStatus === "completed") {
      workflowStatus = "completed";
    } else {
      workflowStatus = match ? match.workflowStatus : "not_started";
      blocked = true;
    }

    return { ...step, workflowStatus };
  });

  const allCompleted = steps.length > 0 && steps.every((step) => step.workflowStatus === "completed");
  const currentStep = steps.find((step) => step.workflowStatus !== "completed");

  return {
    ...transaction,
    steps,
    status: allCompleted ? "completed" : "in_progress",
    currentStepId: currentStep ? currentStep.stepId : null,
  };
}

function formatWorkflowSummaryMarkdown(transaction = {}, childDocuments = []) {
  const templateSnapshot = transaction.templateSnapshot || {};

  const stepRows = (transaction.steps || []).map((step, index) => {
    const label = getDocumentTypeDefinition(step.documentKind)?.label || step.documentKind;
    return `| ${index + 1} | ${label} | ${step.workflowStatus} |`;
  }).join("\n");

  const childRows = childDocuments.map((doc) => {
    const normalized = normalizeDocumentWorkflowStatus(doc);
    const label = getDocumentTypeDefinition(normalized.documentKind)?.label || normalized.documentKind;
    return `| ${label} | ${normalized.documentNo || ""} | ${normalized.nativeStatusLabel || normalized.nativeStatus || ""} |`;
  }).join("\n");

  const pdfRows = childDocuments
    .flatMap((doc) => doc.pdfFiles || [])
    .map((file) => `| ${file.name || ""} | ${file.url || ""} |`)
    .join("\n");

  const rawRows = childDocuments
    .flatMap((doc) => doc.rawFiles || [])
    .map((file) => `| ${file.name || ""} | ${file.url || ""} |`)
    .join("\n");

  // Once the transaction has synced, each child document's own Google Drive
  // folder (see syncWorkflowTransactionToDrive in forms/local-server.logic.js).
  // This file is uploaded as part of the transaction folder, so the
  // transaction's folder in Drive is the index to its paperwork.
  const driveDocuments = Array.isArray(transaction.driveSync?.documents) ? transaction.driveSync.documents : [];
  const markdownCell = (value) => String(value ?? "").replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ");
  const driveSection = driveDocuments.length
    ? `\n## เอกสารใน Google Drive\n\n| ประเภทเอกสาร | เลขที่เอกสาร | สถานะ | ลิงก์ |\n|---|---|---|---|\n${driveDocuments.map((doc) => {
      const label = getDocumentTypeDefinition(doc.documentKind)?.label || doc.documentKind;
      const status = doc.syncStatus === "synced"
        ? "ขึ้น Google Drive แล้ว"
        : `ยังไม่ขึ้น Google Drive: ${doc.message || doc.error || ""}`;
      return `| ${markdownCell(label)} | ${markdownCell(doc.documentNo)} | ${markdownCell(status)} | ${markdownCell(doc.driveFolderUrl)} |`;
    }).join("\n")}\n`
    : "";

  return `# สรุปธุรกรรม Workflow

เลขที่ธุรกรรม: ${transaction.transactionNo || ""}
ชื่อธุรกรรม: ${transaction.title || ""}
เดือนบัญชี: ${transaction.accountingMonth || ""}
สถานะ: ${transaction.status || ""}
Template: ${templateSnapshot.name || ""}
โฟลเดอร์: ${transaction.folderPath || ""}

## ขั้นตอนเอกสาร

| ลำดับ | ประเภทเอกสาร | สถานะ |
|---:|---|---|
${stepRows}

## เอกสารย่อย

| ประเภทเอกสาร | เลขที่เอกสาร | สถานะ |
|---|---|---|
${childRows}

## ไฟล์ PDF

| ชื่อไฟล์ | ลิงก์ |
|---|---|
${pdfRows}

## ไฟล์ต้นฉบับ

| ชื่อไฟล์ | ลิงก์ |
|---|---|
${rawRows}
${driveSection}`;
}

const WorkflowLogic = {
  DOCUMENT_TYPE_DEFINITIONS,
  DEFAULT_WORKFLOW_TEMPLATES,
  SUBSTITUTE_RECEIPT_TEMPLATE_TYPES,
  getDocumentTypeDefinition,
  getDefaultWorkflowTemplates,
  validateWorkflowTemplate,
  normalizeWorkflowTemplate,
  createWorkflowStepStates,
  buildWorkflowTransactionPayload,
  normalizeDocumentWorkflowStatus,
  deriveWorkflowProgress,
  formatWorkflowSummaryMarkdown,
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = WorkflowLogic;
} else {
  window.WorkflowLogic = WorkflowLogic;
}
