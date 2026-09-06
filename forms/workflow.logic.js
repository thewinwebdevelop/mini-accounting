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
    syncGoogleSheets: false,
    active: true,
    documentSteps: [
      { stepId: "step-001", documentKind: "purchase_order" },
      { stepId: "step-002", documentKind: "substitute_receipt" },
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
    syncGoogleSheets: false,
    active: true,
    documentSteps: [
      { stepId: "step-001", documentKind: "purchase_order" },
      { stepId: "step-002", documentKind: "substitute_receipt" },
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
    syncGoogleSheets: false,
    active: true,
    documentSteps: [
      { stepId: "step-001", documentKind: "expense_request" },
      { stepId: "step-002", documentKind: "substitute_receipt" },
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
    syncGoogleSheets: false,
    active: true,
    documentSteps: [
      { stepId: "step-001", documentKind: "expense_request" },
      { stepId: "step-002", documentKind: "cash_spend_declaration" },
      { stepId: "step-003", documentKind: "substitute_receipt" },
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
    syncGoogleSheets: false,
    active: true,
    documentSteps: [
      { stepId: "step-001", documentKind: "expense_request" },
      { stepId: "step-002", documentKind: "cash_spend_declaration" },
      { stepId: "step-003", documentKind: "substitute_receipt" },
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
    syncGoogleSheets: false,
    active: true,
    documentSteps: [
      { stepId: "step-001", documentKind: "expense_request" },
      { stepId: "step-002", documentKind: "substitute_receipt" },
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
        errors.push(`พบประเภทเอกสารที่ยังไม่รองรับ: ${step.documentKind}`);
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
    syncGoogleSheets: !!template.syncGoogleSheets,
    active: template.active !== false,
    documentSteps: (template.documentSteps || []).map((step, index) => ({
      stepId: `step-${String(index + 1).padStart(3, "0")}`,
      documentKind: step.documentKind,
    })),
    createdAt: template.createdAt || now,
    updatedAt: now,
  };
}

const WorkflowLogic = {
  DOCUMENT_TYPE_DEFINITIONS,
  DEFAULT_WORKFLOW_TEMPLATES,
  getDocumentTypeDefinition,
  getDefaultWorkflowTemplates,
  validateWorkflowTemplate,
  normalizeWorkflowTemplate,
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = WorkflowLogic;
} else {
  window.WorkflowLogic = WorkflowLogic;
}
