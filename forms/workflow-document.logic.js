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

// A cancelled lightweight document must never be silently reopened by completing
// it. Every other status may transition to "completed" (repeat completion of an
// already-completed document is handled separately as an idempotent no-op).
const WORKFLOW_DOCUMENT_UNCOMPLETABLE_STATUSES = new Set(["cancelled"]);

const VENDOR_SNAPSHOT_FIELDS = ["name", "taxId", "address", "contactName", "phone", "email", "bankName", "accountNo", "paymentChannel", "paymentReference", "defaultBusinessPurpose"];
const VENDOR_FIELD_ALIASES = {
  name: ["vendorName", "payeeName", "paymentTargetName"],
  taxId: ["vendorTaxId", "payeeTaxId", "paymentTargetTaxId"],
  address: ["vendorAddress", "payeeAddress", "paymentAddress"],
  contactName: ["vendorContactName", "payeeContactName", "paymentContactName"],
  phone: ["vendorPhone", "payeePhone", "paymentPhone"],
  email: ["vendorEmail", "payeeEmail", "paymentEmail"],
  bankName: ["vendorBankName", "bankName", "paymentBankName"],
  accountNo: ["vendorAccountNo", "accountNo", "paymentAccountNo"],
  paymentChannel: ["vendorPaymentChannel", "paymentChannel"],
  paymentReference: ["vendorPaymentReference", "paymentReference"],
  defaultBusinessPurpose: ["vendorDefaultBusinessPurpose", "defaultBusinessPurpose"],
};

function buildVendorSnapshot(payload = {}) {
  const snapshot = Object.fromEntries(VENDOR_SNAPSHOT_FIELDS.map((field) => [field, cleanText(payload.vendorSnapshot?.[field])]));
  for (const field of VENDOR_SNAPSHOT_FIELDS) {
    const source = (VENDOR_FIELD_ALIASES[field] || []).find((key) => Object.prototype.hasOwnProperty.call(payload, key));
    if (source) snapshot[field] = cleanText(payload[source]);
  }
  return snapshot;
}

function assertWorkflowDocumentCompletable(currentStatus) {
  if (WORKFLOW_DOCUMENT_UNCOMPLETABLE_STATUSES.has(cleanText(currentStatus))) {
    throw new Error(`ไม่สามารถทำให้เอกสารสถานะ "${WORKFLOW_DOCUMENT_STATUS_LABELS[currentStatus] || currentStatus}" เสร็จสิ้นได้`);
  }
}

// Cross-module lookups resolve at call time (never at module load) so this file
// stays a plain classic script in the browser: workflow.logic.js is loaded first
// there and exposes window.WorkflowLogic, while Node resolves it via require().
function resolveWorkflowLogic() {
  if (typeof module !== "undefined" && module.exports) {
    return require("./workflow.logic.js");
  }
  return typeof window !== "undefined" ? window.WorkflowLogic : undefined;
}

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

// evidenceKey is the multipart field name minus the "evidence_" prefix, which
// means it is fully attacker-controlled. Strip path separators AND dots (not
// just separators, like safeTitle does) so a value such as "../../../ESCAPED"
// can never reassemble into a traversal segment once "_NNN.ext" is appended.
function sanitizeEvidenceKey(evidenceKey) {
  const cleaned = cleanText(evidenceKey)
    .replace(/[\\/:*?"<>|#%{}^~[\]`.]+/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 80)
    .toLowerCase();
  return cleaned || "evidence";
}

function buildWorkflowDocumentRawFileName(evidenceKey, originalName, index = 0) {
  const slug = sanitizeEvidenceKey(evidenceKey);
  const sequence = String(index + 1).padStart(3, "0");
  return `${slug}_${sequence}${getFileExtension(originalName)}`;
}

const WORKFLOW_VAT_MODES = Object.freeze({
  unspecified: "ยังไม่ระบุ VAT",
  exclusive: "ราคาไม่รวม VAT",
  inclusive: "ราคารวม VAT",
  none: "ไม่มี VAT",
  manual: "ระบุยอด VAT ตามเอกสาร",
});

// Money is stored in integer satang. Tax ratios use integer arithmetic so a
// half-satang rounds consistently in the browser and on the server.
const MAX_WORKFLOW_CENTS = 9999999999999;
function workflowInputCents(value) {
  const cents = toCents(value);
  return Number.isSafeInteger(cents) && cents >= 0 && cents <= MAX_WORKFLOW_CENTS ? cents : 0;
}
function workflowRoundRatio(cents, numerator, denominator) {
  const product = BigInt(cents) * BigInt(numerator);
  const divisor = BigInt(denominator);
  return Number((product * 2n + divisor) / (divisor * 2n));
}
function normalizeLine(line = {}) {
  const parsedQuantity = Number(cleanText(line.quantity));
  const quantity = Number.isSafeInteger(parsedQuantity) && parsedQuantity > 0 ? parsedQuantity : 0;
  const unitCostCents = workflowInputCents(line.unitCost);
  const inputCents = Number.isSafeInteger(quantity * unitCostCents) ? quantity * unitCostCents : 0;
  const vatMode = Object.hasOwn(WORKFLOW_VAT_MODES, cleanText(line.vatMode)) ? cleanText(line.vatMode) : "unspecified";
  const usesRate = ["exclusive", "inclusive"].includes(vatMode);
  const rateUnits = usesRate ? Math.min(10000, workflowInputCents(cleanText(line.vatRate) || "7")) : 0;
  let base = inputCents;
  let vat = 0;
  if (vatMode === "exclusive") vat = workflowRoundRatio(inputCents, rateUnits, 10000);
  if (vatMode === "inclusive") {
    base = workflowRoundRatio(inputCents, 10000, 10000 + rateUnits);
    vat = inputCents - base;
  }
  if (vatMode === "manual") vat = workflowInputCents(line.vatAmount);
  const gross = base + vat;
  const withholding = workflowInputCents(line.withholdingTax);
  return {
    description: cleanText(line.description), quantity,
    unitCost: money(unitCostCents), lineTotal: money(gross),
    stockSkuId: cleanText(line.stockSkuId),
    vatMode, vatRate: usesRate ? money(rateUnits) : null,
    amountBeforeVat: vatMode === "unspecified" ? null : money(base),
    vatAmount: vatMode === "unspecified" ? null : money(vat),
    withholdingTax: money(withholding), netPayment: money(gross - withholding),
  };
}

function calculateWorkflowAmounts(rawLines = []) {
  const lines = (Array.isArray(rawLines) ? rawLines : []).map(normalizeLine);
  const specified = lines.filter((line) => line.vatMode !== "unspecified").length;
  const vatStatus = specified === 0 ? "unspecified" : specified === lines.length ? "specified" : "partial";
  const sum = (field) => lines.reduce((value, line) => value + toCents(line[field]), 0);
  const gross = sum("lineTotal");
  const withholding = sum("withholdingTax");
  return { lines, totals: {
    amountBeforeVat: vatStatus === "specified" ? money(sum("amountBeforeVat")) : null,
    vatAmount: vatStatus === "specified" ? money(sum("vatAmount")) : null,
    grossAmount: money(gross), withholdingTax: money(withholding),
    netPayment: money(gross - withholding), vatStatus,
  } };
}

function validateWorkflowAmounts(rawLines = []) {
  const errors = [];
  const validMoney = (value) => {
    const raw = cleanText(value).replace(/,/g, "");
    return /^\d+(?:\.\d{1,2})?$/.test(raw) && Number.isSafeInteger(toCents(raw)) && toCents(raw) <= MAX_WORKFLOW_CENTS;
  };
  for (const [index, line] of rawLines.entries()) {
    const prefix = `รายการ ${index + 1}: `;
    const mode = cleanText(line.vatMode) || "unspecified";
    if (!Object.hasOwn(WORKFLOW_VAT_MODES, mode)) errors.push(prefix + "รูปแบบ VAT ไม่ถูกต้อง");
    if (!/^\d+$/.test(cleanText(line.quantity)) || !Number.isSafeInteger(Number(line.quantity)) || Number(line.quantity) <= 0) errors.push(prefix + "ระบุจำนวนเป็นจำนวนเต็มมากกว่า 0");
    if (!validMoney(line.unitCost)) errors.push(prefix + "ราคา/หน่วยต้องเป็นจำนวนเงินตั้งแต่ 0 และไม่เกิน 2 ตำแหน่งทศนิยม");
    if (["inclusive", "exclusive"].includes(mode)) {
      const rate = cleanText(line.vatRate) || "7";
      if (!validMoney(rate) || Number(rate.replace(/,/g, "")) > 100) errors.push(prefix + "อัตรา VAT ต้องอยู่ระหว่าง 0 ถึง 100");
    }
    if (mode === "manual" && !validMoney(line.vatAmount)) errors.push(prefix + "ระบุยอด VAT ตามเอกสารเป็นจำนวนเงินตั้งแต่ 0");
    if (cleanText(line.withholdingTax) && !validMoney(line.withholdingTax)) errors.push(prefix + "ยอดหัก ณ ที่จ่ายไม่ถูกต้อง");
    const normalized = normalizeLine(line);
    if (toCents(normalized.withholdingTax) > toCents(normalized.lineTotal)) errors.push(prefix + "ยอดหัก ณ ที่จ่ายต้องไม่เกินยอดรวมรายการ");
    if (!Number.isSafeInteger(Number(line.quantity) * toCents(line.unitCost)) || Number(line.quantity) * toCents(line.unitCost) > MAX_WORKFLOW_CENTS || toCents(normalized.lineTotal) > MAX_WORKFLOW_CENTS) errors.push(prefix + "ยอดเงินเกินขอบเขตที่รองรับ");
  }
  const totals = calculateWorkflowAmounts(rawLines).totals;
  if (toCents(totals.grossAmount) > MAX_WORKFLOW_CENTS) errors.push("ยอดรวมเอกสารเกินขอบเขตที่รองรับ");
  return errors;
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
  errors.push(...validateWorkflowAmounts(lines));

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

  const rawLines = Array.isArray(data.lines) ? data.lines : [];
  const amountErrors = validateWorkflowAmounts(rawLines);
  if (amountErrors.length) throw new Error(amountErrors.join("\n"));
  const { lines, totals } = calculateWorkflowAmounts(rawLines);

  const evidenceFiles = normalizeEvidenceFiles(data.evidenceFiles);
  const uploadedRawFiles = flattenEvidenceFiles(evidenceFiles).map((file) => file.storedName);

  const status = cleanText(data.status) || "draft";
  const documentTypeDefinition = resolveWorkflowLogic()?.getDocumentTypeDefinition?.(documentKind);

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
    vendorId: cleanText(data.vendorId),
    vendorSnapshot: buildVendorSnapshot(data),
    businessPurpose: cleanText(data.businessPurpose),
    transactionNo: cleanText(data.transactionNo),
    workflowTemplateId: cleanText(data.workflowTemplateId),
    workflowStepId: cleanText(data.workflowStepId),
    submittedAt: cleanText(data.submittedAt),
    submittedBy: cleanText(data.submittedBy),
    approvedAt: cleanText(data.approvedAt),
    approvedBy: cleanText(data.approvedBy),
    completedAt: cleanText(data.completedAt),
    completedBy: cleanText(data.completedBy),
    company: data.company ? {
      legalName: cleanText(data.company.legalName),
      taxId: cleanText(data.company.taxId),
      branch: cleanText(data.company.branch),
      address: cleanText(data.company.address),
    } : undefined,
    lines,
    totals,
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
    `| ${index + 1} | ${line.description || ""} (${WORKFLOW_VAT_MODES[line.vatMode] || WORKFLOW_VAT_MODES.unspecified}${["inclusive", "exclusive"].includes(line.vatMode) ? ` ${line.vatRate}%` : ""}) | ${line.quantity || 0} | ${line.unitCost || "0.00"} | ${line.lineTotal || "0.00"} |`
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
| ยอดก่อน VAT | ${payload.totals?.amountBeforeVat ?? "ยังไม่ระบุ VAT"} |
| VAT | ${payload.totals?.vatAmount ?? "ยังไม่ระบุ VAT"} |
| รวมทั้งสิ้น | ${payload.totals?.grossAmount || "0.00"} |
| หัก ณ ที่จ่าย | ${payload.totals?.withholdingTax || "0.00"} |
| ยอดจ่ายสุทธิ | ${payload.totals?.netPayment || payload.totals?.grossAmount || "0.00"} |

## ไฟล์แนบ raw

${rawFiles.length ? rawFiles.map((name) => `- ${name}`).join("\n") : "- (ไม่มี)"}
`;
}

const WorkflowDocumentLogic = {
  LIGHTWEIGHT_DOCUMENT_KINDS,
  WORKFLOW_VAT_MODES,
  calculateWorkflowAmounts,
  validateWorkflowAmounts,
  WORKFLOW_DOCUMENT_PREFIXES,
  WORKFLOW_DOCUMENT_STATUS_LABELS,
  assertWorkflowDocumentCompletable,
  buildWorkflowDocumentPayload,
  buildVendorSnapshot,
  buildWorkflowDocumentRawFileName,
  formatWorkflowDocumentMarkdown,
  sanitizeEvidenceKey,
  validateWorkflowDocumentPayload,
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = WorkflowDocumentLogic;
} else {
  window.WorkflowDocumentLogic = WorkflowDocumentLogic;
}
