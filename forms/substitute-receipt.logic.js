const RECEIPT_TYPE_LABELS = {
  stock_purchase: "ซื้อสต๊อกสินค้า",
  general_expense: "รายจ่ายทั่วไป",
};

const EVIDENCE_LABELS = {
  paymentSlip: "สลิป/Statement/หลักฐานชำระเงิน",
  purchaseOrder: "หลักฐานสั่งซื้อ/แชท/ใบเสนอราคา",
  goodsReceived: "ใบรับสินค้าเข้าคลัง/รูปสินค้าที่รับ",
  otherEvidence: "หลักฐานประกอบอื่น",
};

const EVIDENCE_SLUGS = {
  paymentSlip: "payment-slip",
  purchaseOrder: "purchase-order",
  goodsReceived: "goods-received",
  otherEvidence: "other-evidence",
};

const SUBSTITUTE_RECEIPT_STATUSES = ["draft", "pending_approval", "approved", "received", "cancelled", "voided"];
const SUBSTITUTE_RECEIPT_STATUS_LABELS = {
  draft: "แบบร่าง",
  pending_approval: "รอตรวจอนุมัติ",
  approved: "อนุมัติแล้ว",
  received: "รับเข้าคลังแล้ว",
  cancelled: "ยกเลิก",
  voided: "ยกเลิกหลังรับรู้",
};

const SUBSTITUTE_RECEIPT_TRANSITIONS = {
  draft: new Set(["draft", "pending_approval", "cancelled"]),
  pending_approval: new Set(["draft", "pending_approval", "approved", "cancelled"]),
  approved: new Set(["approved", "received", "cancelled"]),
  received: new Set(["received", "voided"]),
  cancelled: new Set(["cancelled"]),
  voided: new Set(["voided"]),
};

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

function getEvidenceRef(evidenceKey) {
  const index = Object.keys(EVIDENCE_LABELS).indexOf(evidenceKey);
  return index >= 0 ? `B${index + 1}` : "BX";
}

function getFileExtension(originalName) {
  const match = cleanText(originalName).match(/\.([a-zA-Z0-9]+)$/);
  return match ? `.${match[1].toLowerCase()}` : "";
}

function buildSubstituteReceiptRawFileName(evidenceKey, originalName, index = 0) {
  const ref = getEvidenceRef(evidenceKey);
  const slug = EVIDENCE_SLUGS[evidenceKey] ?? safeTitle(evidenceKey).toLowerCase();
  const sequence = String(index + 1).padStart(3, "0");
  return `${ref}_${slug}_${sequence}${getFileExtension(originalName)}`;
}

function parsePositiveInteger(value) {
  const parsed = Number.parseInt(cleanText(value), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function normalizeSubstituteReceiptStatus(status) {
  const normalized = cleanText(status) || "draft";
  if (!SUBSTITUTE_RECEIPT_STATUSES.includes(normalized)) {
    throw new Error(`Invalid substitute receipt status: ${normalized}`);
  }
  return normalized;
}

function assertSubstituteReceiptTransition(fromStatus, toStatus) {
  const from = normalizeSubstituteReceiptStatus(fromStatus);
  const to = normalizeSubstituteReceiptStatus(toStatus);
  if (!SUBSTITUTE_RECEIPT_TRANSITIONS[from]?.has(to)) {
    throw new Error(`Invalid substitute receipt status transition: ${from} -> ${to}`);
  }
}

function normalizeLockedStockLine(line = {}) {
  return {
    stockSkuId: cleanText(line.stockSkuId),
    quantity: parsePositiveInteger(line.quantity),
    unitCost: money(toCents(line.unitCost)),
  };
}

function assertStockLinesUnchanged(originalPayload = {}, nextPayload = {}) {
  const originalReceiptType = cleanText(originalPayload.receiptType) || "stock_purchase";
  const nextReceiptType = cleanText(nextPayload.receiptType) || "stock_purchase";
  const originalLines = Array.isArray(originalPayload.lines) ? originalPayload.lines : [];
  const nextLines = Array.isArray(nextPayload.lines) ? nextPayload.lines : [];

  if (originalReceiptType !== nextReceiptType || originalLines.length !== nextLines.length) {
    throw new Error("Stock lines cannot be edited after approval or receiving");
  }

  originalLines.forEach((line, index) => {
    const original = normalizeLockedStockLine(line);
    const next = normalizeLockedStockLine(nextLines[index]);
    if (
      original.stockSkuId !== next.stockSkuId
      || original.quantity !== next.quantity
      || original.unitCost !== next.unitCost
    ) {
      throw new Error("Stock lines cannot be edited after approval or receiving");
    }
  });
}

function normalizeLine(line = {}, receiptType = "stock_purchase") {
  const quantity = parsePositiveInteger(line.quantity);
  const unitCostCents = toCents(line.unitCost);
  const lineTotalCents = quantity * unitCostCents;
  return {
    stockSkuId: cleanText(line.stockSkuId),
    sku: cleanText(line.sku),
    description: cleanText(line.description),
    quantity,
    unitCost: money(unitCostCents),
    lineTotal: money(lineTotalCents),
    vendorSku: cleanText(line.vendorSku),
    receiptType,
  };
}

function normalizeEvidenceFiles(evidenceFiles = {}) {
  return Object.fromEntries(
    Object.keys(EVIDENCE_LABELS).map((key) => [
      key,
      (evidenceFiles[key] ?? []).map((file) => ({
        evidenceKey: key,
        originalName: cleanText(file.originalName),
        storedName: cleanText(file.storedName || file.name),
        size: Number(file.size || 0),
        type: cleanText(file.type) || "application/octet-stream",
      })).filter((file) => file.storedName),
    ]),
  );
}

function evidenceFileCount(evidenceFiles = {}) {
  return Object.values(evidenceFiles).reduce((total, files) => total + (Array.isArray(files) ? files.length : 0), 0);
}

function validateSubstituteReceipt(data = {}) {
  const errors = [];
  const receiptType = cleanText(data.receiptType) || "stock_purchase";
  const evidenceFiles = data.evidenceFiles ?? {};
  const lines = Array.isArray(data.lines) ? data.lines : [];

  if (!cleanText(data.accountingMonth)) errors.push("ระบุเดือนบัญชี");
  if (!cleanText(data.receiptDate)) errors.push("ระบุวันที่เอกสาร");
  if (!cleanText(data.payeeName)) errors.push("ระบุผู้ขาย/ผู้รับเงิน");
  if (!cleanText(data.businessPurpose)) errors.push("ระบุวัตถุประสงค์ทางธุรกิจ");
  if (evidenceFileCount(evidenceFiles) === 0) {
    errors.push("แนบหลักฐานการชำระเงินหรือหลักฐานการสั่งซื้ออย่างน้อย 1 ไฟล์");
  }

  if (!lines.length) {
    errors.push("เพิ่มรายการอย่างน้อย 1 รายการ");
    return errors;
  }

  if (receiptType === "stock_purchase") {
    if (lines.some((line) => !cleanText(line.stockSkuId))) errors.push("เลือกรายการ Stock SKU ให้ครบ");
    if (lines.some((line) => parsePositiveInteger(line.quantity) <= 0)) errors.push("จำนวนสินค้าต้องมากกว่า 0");
    if (lines.some((line) => toCents(line.unitCost) <= 0)) errors.push("ต้นทุนต่อหน่วยต้องมากกว่า 0");
  } else {
    const validAmountLine = lines.some((line) => parsePositiveInteger(line.quantity) > 0 && toCents(line.unitCost) > 0);
    if (!validAmountLine) errors.push("กรอกรายการและยอดเงินอย่างน้อย 1 รายการ");
  }

  return [...new Set(errors)];
}

function buildSubstituteReceiptPayload(data = {}) {
  const [accountingYear, accountingMonth] = cleanText(data.accountingMonth).split("-");
  const existingReceiptNo = cleanText(data.receiptNo);
  const receiptNo = /^SR-\d{4}-\d{2}-\d{4}$/.test(existingReceiptNo)
    ? existingReceiptNo
    : `SR-${accountingYear}-${accountingMonth}-${padSequence(data.sequence)}`;
  const receiptNoParts = receiptNo.match(/^SR-(\d{4})-(\d{2})-/);
  const year = receiptNoParts?.[1] || accountingYear;
  const month = receiptNoParts?.[2] || accountingMonth;
  const receiptType = cleanText(data.receiptType) || "stock_purchase";
  const folderTitle = safeTitle(data.receiptTitle || data.businessPurpose);
  const folderPath = cleanText(data.folderPath) || `documents/${year}/${month}/ใบรับรองแทนใบเสร็จ/${receiptNo}_${folderTitle}`;
  const lines = (Array.isArray(data.lines) ? data.lines : []).map((line) => normalizeLine(line, receiptType));
  const totalCents = lines.reduce((sum, line) => sum + toCents(line.lineTotal), 0);
  const evidenceFiles = normalizeEvidenceFiles(data.evidenceFiles);
  const evidence = Object.fromEntries(
    Object.entries(EVIDENCE_LABELS).map(([key, label], index) => [
      key,
      {
        label,
        ref: `B${index + 1}`,
        status: evidenceFiles[key]?.length ? "มี" : "รอดำเนินการ",
        files: (evidenceFiles[key] ?? []).map((file) => file.storedName),
      },
    ]),
  );
  const uploadedRawFiles = Object.keys(EVIDENCE_LABELS).flatMap((key) => evidence[key].files);

  return {
    documentKind: "substitute_receipt",
    receiptNo,
    folderPath,
    receiptTitle: cleanText(data.receiptTitle),
    receiptType,
    receiptTypeLabel: RECEIPT_TYPE_LABELS[receiptType] ?? receiptType,
    company: data.company ? {
      legalName: cleanText(data.company.legalName),
      taxId: cleanText(data.company.taxId),
      branch: cleanText(data.company.branch),
      address: cleanText(data.company.address),
    } : undefined,
    accountingMonth: cleanText(data.accountingMonth),
    receiptDate: cleanText(data.receiptDate),
    payeeName: cleanText(data.payeeName),
    payeeTaxId: cleanText(data.payeeTaxId),
    paymentChannel: cleanText(data.paymentChannel),
    paymentReference: cleanText(data.paymentReference),
    businessPurpose: cleanText(data.businessPurpose),
    lines,
    totals: {
      totalAmount: money(totalCents),
    },
    evidence,
    evidenceFiles,
    rawFiles: uploadedRawFiles.length ? uploadedRawFiles : data.rawFiles ?? [],
    createdAt: data.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function formatSubstituteReceiptMarkdown(payload = {}) {
  const isStockPurchase = (payload.receiptType || "stock_purchase") === "stock_purchase";
  const lineHeader = isStockPurchase
    ? "| ลำดับ | Stock SKU | รายละเอียด | จำนวน | ต้นทุนต่อหน่วย | ยอดรวม |\n|---:|---|---|---:|---:|---:|"
    : "| ลำดับ | รายละเอียด | จำนวน | ราคา/หน่วย | ยอดรวม |\n|---:|---|---:|---:|---:|";
  const lines = (payload.lines ?? []).map((line, index) => (
    isStockPurchase
      ? `| ${index + 1} | ${line.sku || ""} | ${line.description || ""} | ${line.quantity || 0} | ${line.unitCost || "0.00"} | ${line.lineTotal || "0.00"} |`
      : `| ${index + 1} | ${line.description || ""} | ${line.quantity || 0} | ${line.unitCost || "0.00"} | ${line.lineTotal || "0.00"} |`
  )).join("\n");
  const evidence = Object.values(payload.evidence ?? {}).map((item) => (
    `| ${item.ref} | ${item.label} | ${item.status} | ${(item.files ?? []).join(", ")} |`
  )).join("\n");
  const company = payload.company ?? {};

  return `# ใบรับรองแทนใบเสร็จรับเงิน

เลขที่เอกสาร: ${payload.receiptNo}
ชื่อนิติบุคคล: ${company.legalName || ""}
เลขประจำตัวผู้เสียภาษี: ${company.taxId || ""}
สำนักงานใหญ่/สาขา: ${company.branch || ""}
วันที่เอกสาร: ${payload.receiptDate || ""}
ประเภทเอกสาร: ${payload.receiptTypeLabel || ""}
ผู้ขาย/ผู้รับเงิน: ${payload.payeeName || ""}
ช่องทางชำระเงิน: ${payload.paymentChannel || ""}
เลขอ้างอิงชำระเงิน: ${payload.paymentReference || ""}
วัตถุประสงค์ทางธุรกิจ: ${payload.businessPurpose || ""}
โฟลเดอร์: ${payload.folderPath || ""}

## รายการ

${lineHeader}
${lines}

## สรุปยอด

| รายการ | ยอด |
|---|---:|
| ยอดรวม | ${payload.totals?.totalAmount || "0.00"} |

## หลักฐาน

| รหัส | หลักฐาน | สถานะ | ชื่อไฟล์ raw |
|---|---|---|---|
${evidence}
`;
}

const SubstituteReceiptLogic = {
  SUBSTITUTE_RECEIPT_STATUSES,
  SUBSTITUTE_RECEIPT_STATUS_LABELS,
  assertStockLinesUnchanged,
  assertSubstituteReceiptTransition,
  buildSubstituteReceiptPayload,
  buildSubstituteReceiptRawFileName,
  formatSubstituteReceiptMarkdown,
  normalizeSubstituteReceiptStatus,
  validateSubstituteReceipt,
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = SubstituteReceiptLogic;
} else {
  window.SubstituteReceiptLogic = SubstituteReceiptLogic;
}
