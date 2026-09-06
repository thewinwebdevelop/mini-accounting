const { getDocumentTypeDefinition } = require("./workflow.logic.js");

const LIGHTWEIGHT_DOCUMENT_KINDS = [
  "purchase_order",
  "payment_voucher",
  "cash_spend_declaration",
  "payee_acknowledgement",
  "goods_receipt",
];

const WORKFLOW_DOCUMENT_PREFIXES = {
  purchase_order: "PO",
  payment_voucher: "PV",
  cash_spend_declaration: "CSD",
  payee_acknowledgement: "PAR",
  goods_receipt: "GR",
};

const WORKFLOW_DOCUMENT_STATUS_LABELS = {
  draft: "แบบร่าง",
  pending_approval: "รอตรวจอนุมัติ",
  approved: "อนุมัติแล้ว",
  completed: "เสร็จสิ้น",
  cancelled: "ยกเลิก",
};

const EVIDENCE_LABEL = "หลักฐานประกอบ";

function cleanText(value) {
  return String(value ?? "").trim();
}

function toCents(value) {
  const text = cleanText(value).replace(/,/g, "");
  if (!text) return 0;
  const parsed = Number(text);
  if (!Number.isFinite(parsed)) return 0;
  return Math.round(parsed * 100);
}

function money(cents) {
  return (cents / 100).toFixed(2);
}

function padSequence(sequence) {
  const parsed = Number.parseInt(String(sequence ?? "1"), 10);
  const safe = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
  return String(safe).padStart(4, "0");
}

function safeTitle(title) {
  return cleanText(title)
    .replace(/[\\/:*?"<>|#%{}^~[\]`]+/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 80) || "ไม่ระบุรายการ";
}

function parsePositiveInteger(value) {
  const parsed = Number.parseInt(cleanText(value), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function getFileExtension(originalName) {
  const match = cleanText(originalName).match(/\.([a-zA-Z0-9]+)$/);
  return match ? `.${match[1].toLowerCase()}` : "";
}

function buildWorkflowDocumentRawFileName(evidenceKey, originalName, index = 0) {
  const slug = cleanText(evidenceKey) || "evidence";
  const sequence = String(index + 1).padStart(3, "0");
  return `${slug}_${sequence}${getFileExtension(originalName)}`;
}

function normalizeLine(line = {}) {
  const quantity = parsePositiveInteger(line.quantity);
  const unitCostCents = toCents(line.unitCost);
  const lineTotalCents = quantity * unitCostCents;
  return {
    description: cleanText(line.description),
    quantity,
    unitCost: money(unitCostCents),
    lineTotal: money(lineTotalCents),
  };
}

function normalizeEvidenceFiles(evidenceFiles = {}) {
  const result = {};
  for (const [key, files] of Object.entries(evidenceFiles ?? {})) {
    if (!Array.isArray(files)) continue;
    result[key] = files.map((file) => ({
      evidenceKey: key,
      originalName: cleanText(file.originalName),
      storedName: cleanText(file.storedName || file.name),
      size: Number(file.size || 0),
      type: cleanText(file.type) || "application/octet-stream",
    })).filter((file) => file.storedName);
  }
  return result;
}

function flattenEvidenceFiles(evidenceFiles = {}) {
  return Object.values(evidenceFiles ?? {}).flat().filter(Boolean);
}

function validateWorkflowDocumentPayload(data = {}) {
  const errors = [];

  if (!LIGHTWEIGHT_DOCUMENT_KINDS.includes(cleanText(data.documentKind))) {
    errors.push("เลือกประเภทเอกสาร");
  }
  if (!cleanText(data.accountingMonth)) errors.push("ระบุเดือนบัญชี");
  if (!cleanText(data.documentDate)) errors.push("ระบุวันที่เอกสาร");
  if (!cleanText(data.title)) errors.push("ระบุชื่อเอกสาร");
  if (!cleanText(data.businessPurpose)) errors.push("ระบุวัตถุประสงค์ทางธุรกิจ");

  const lines = Array.isArray(data.lines) ? data.lines : [];
  if (!lines.length) errors.push("เพิ่มรายการอย่างน้อย 1 รายการ");

  return [...new Set(errors)];
}

function buildWorkflowDocumentPayload(data = {}, options = {}) {
  const now = typeof options.now === "function" ? options.now : () => new Date().toISOString();
  const documentKind = cleanText(data.documentKind);
  const prefix = WORKFLOW_DOCUMENT_PREFIXES[documentKind];
  if (!prefix) {
    throw new Error(`Invalid workflow document kind: ${documentKind}`);
  }

  const [accountingYear, accountingMonth] = cleanText(data.accountingMonth).split("-");
  const existingDocumentNo = cleanText(data.documentNo);
  const documentNoPattern = new RegExp(`^${prefix}-\\d{4}-\\d{2}-\\d{4}$`);
  const documentNo = documentNoPattern.test(existingDocumentNo)
    ? existingDocumentNo
    : `${prefix}-${accountingYear}-${accountingMonth}-${padSequence(data.sequence)}`;
  const documentNoParts = documentNo.match(/^[A-Z]+-(\d{4})-(\d{2})-/);
  const year = documentNoParts?.[1] || accountingYear;
  const month = documentNoParts?.[2] || accountingMonth;
  const folderTitle = safeTitle(data.title);
  const folderPath = cleanText(data.folderPath) || `documents/${year}/${month}/${documentKind}/${documentNo}_${folderTitle}`;

  const lines = (Array.isArray(data.lines) ? data.lines : []).map((line) => normalizeLine(line));
  const grossCents = lines.reduce((sum, line) => sum + toCents(line.lineTotal), 0);

  const evidenceFiles = normalizeEvidenceFiles(data.evidenceFiles);
  const uploadedRawFiles = flattenEvidenceFiles(evidenceFiles).map((file) => file.storedName);

  const status = cleanText(data.status) || "draft";
  const documentTypeDefinition = getDocumentTypeDefinition(documentKind);

  return {
    documentKind,
    documentKindLabel: documentTypeDefinition?.label || documentKind,
    documentNo,
    folderPath,
    title: cleanText(data.title),
    status,
    statusLabel: WORKFLOW_DOCUMENT_STATUS_LABELS[status] || status,
    accountingMonth: cleanText(data.accountingMonth),
    documentDate: cleanText(data.documentDate),
    requesterName: cleanText(data.requesterName),
    payeeName: cleanText(data.payeeName),
    businessPurpose: cleanText(data.businessPurpose),
    transactionNo: cleanText(data.transactionNo),
    workflowTemplateId: cleanText(data.workflowTemplateId),
    workflowStepId: cleanText(data.workflowStepId),
    completedAt: cleanText(data.completedAt),
    completedBy: cleanText(data.completedBy),
    company: data.company ? {
      legalName: cleanText(data.company.legalName),
      taxId: cleanText(data.company.taxId),
      branch: cleanText(data.company.branch),
      address: cleanText(data.company.address),
    } : undefined,
    lines,
    totals: {
      grossAmount: money(grossCents),
    },
    evidenceFiles,
    rawFiles: uploadedRawFiles.length ? uploadedRawFiles : (Array.isArray(data.rawFiles) ? data.rawFiles : []),
    statusHistory: Array.isArray(data.statusHistory) ? data.statusHistory : [],
    createdAt: data.createdAt || now(),
    updatedAt: now(),
  };
}

function formatWorkflowDocumentMarkdown(payload = {}) {
  const lineHeader = "| ลำดับ | รายละเอียด | จำนวน | ราคา/หน่วย | ยอดรวม |\n|---:|---|---:|---:|---:|";
  const lines = (payload.lines ?? []).map((line, index) => (
    `| ${index + 1} | ${line.description || ""} | ${line.quantity || 0} | ${line.unitCost || "0.00"} | ${line.lineTotal || "0.00"} |`
  )).join("\n");
  const company = payload.company ?? {};
  const rawFiles = Array.isArray(payload.rawFiles) ? payload.rawFiles : [];

  return `# ${payload.documentKindLabel || payload.documentKind || "เอกสาร"}

เลขที่เอกสาร: ${payload.documentNo || ""}
ชื่อนิติบุคคล: ${company.legalName || ""}
เลขประจำตัวผู้เสียภาษี: ${company.taxId || ""}
สำนักงานใหญ่/สาขา: ${company.branch || ""}
วันที่เอกสาร: ${payload.documentDate || ""}
ชื่อเอกสาร: ${payload.title || ""}
เลขที่ธุรกรรม (Transaction): ${payload.transactionNo || ""}
ผู้ขอ/ผู้จัดทำ: ${payload.requesterName || ""}
ผู้รับเงิน/คู่ค้า: ${payload.payeeName || ""}
วัตถุประสงค์ทางธุรกิจ: ${payload.businessPurpose || ""}
โฟลเดอร์: ${payload.folderPath || ""}

## รายการ

${lineHeader}
${lines}

## สรุปยอด

| รายการ | ยอด |
|---|---:|
| รวมทั้งสิ้น | ${payload.totals?.grossAmount || "0.00"} |

## ไฟล์แนบ raw

${rawFiles.length ? rawFiles.map((name) => `- ${name}`).join("\n") : "- (ไม่มี)"}
`;
}

const WorkflowDocumentLogic = {
  LIGHTWEIGHT_DOCUMENT_KINDS,
  WORKFLOW_DOCUMENT_PREFIXES,
  WORKFLOW_DOCUMENT_STATUS_LABELS,
  EVIDENCE_LABEL,
  buildWorkflowDocumentPayload,
  buildWorkflowDocumentRawFileName,
  formatWorkflowDocumentMarkdown,
  validateWorkflowDocumentPayload,
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = WorkflowDocumentLogic;
} else {
  window.WorkflowDocumentLogic = WorkflowDocumentLogic;
}
