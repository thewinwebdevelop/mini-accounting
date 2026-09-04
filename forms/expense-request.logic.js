const REQUEST_TYPE_LABELS = {
  reimbursement: "เบิกคืนพนักงาน",
  direct_payment: "บริษัทจ่ายตรงผู้ขาย",
};

const EVIDENCE_LABELS = {
  receipt: "ใบเสร็จรับเงิน",
  fullTaxInvoice: "ใบกำกับภาษีเต็มรูป",
  vendorPaymentSlip: "สลิปจ่ายเงินให้ผู้ขาย",
  reimbursementSlip: "สลิปโอนคืนพนักงาน / หลักฐานบริษัทจ่ายตรง",
  businessEvidence: "รูปสินค้า / หลักฐานการใช้งานจริง",
  otherEvidence: "หลักฐานประกอบอื่น",
};

const EVIDENCE_SLUGS = {
  receipt: "receipt",
  fullTaxInvoice: "tax-invoice",
  vendorPaymentSlip: "vendor-payment-slip",
  reimbursementSlip: "reimbursement-slip",
  businessEvidence: "business-evidence",
  otherEvidence: "other-evidence",
};

function toCents(value) {
  const text = String(value ?? "").replace(/,/g, "").trim();
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
  return String(title ?? "")
    .trim()
    .replace(/[\\/:*?"<>|#%{}^~[\]`]+/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 80) || "ไม่ระบุรายการ";
}

function getEvidenceRef(evidenceKey) {
  const index = Object.keys(EVIDENCE_LABELS).indexOf(evidenceKey);
  return index >= 0 ? `A${index + 1}` : "AX";
}

function getFileExtension(originalName) {
  const text = String(originalName ?? "").trim();
  const match = text.match(/\.([a-zA-Z0-9]+)$/);
  return match ? `.${match[1].toLowerCase()}` : "";
}

function buildRawFileName(evidenceKey, originalName, index = 0) {
  const ref = getEvidenceRef(evidenceKey);
  const slug = EVIDENCE_SLUGS[evidenceKey] ?? safeTitle(evidenceKey).toLowerCase();
  const sequence = String(index + 1).padStart(3, "0");
  return `${ref}_${slug}_${sequence}${getFileExtension(originalName)}`;
}

function calculateExpenseTotals(lines = []) {
  const totals = lines.reduce(
    (sum, line) => {
      const amountBeforeVat = toCents(line.amountBeforeVat);
      const vatAmount = toCents(line.vatAmount);
      const withholdingTax = toCents(line.withholdingTax);
      sum.amountBeforeVat += amountBeforeVat;
      sum.vatAmount += vatAmount;
      sum.grossAmount += amountBeforeVat + vatAmount;
      sum.withholdingTax += withholdingTax;
      sum.netPayment += amountBeforeVat + vatAmount - withholdingTax;
      return sum;
    },
    {
      amountBeforeVat: 0,
      vatAmount: 0,
      grossAmount: 0,
      withholdingTax: 0,
      netPayment: 0,
    },
  );

  return {
    amountBeforeVat: money(totals.amountBeforeVat),
    vatAmount: money(totals.vatAmount),
    grossAmount: money(totals.grossAmount),
    withholdingTax: money(totals.withholdingTax),
    netPayment: money(totals.netPayment),
  };
}

function validateExpenseRequest(data = {}) {
  const errors = [];
  if (!data.requestType) errors.push("เลือกประเภทคำขอ");
  if (!data.accountingMonth) errors.push("ระบุเดือนบัญชี");
  if (!String(data.requesterName ?? "").trim()) errors.push("ระบุชื่อผู้ขอ");
  if (!String(data.businessPurpose ?? "").trim()) errors.push("ระบุวัตถุประสงค์ทางธุรกิจ");
  if (!String(data.paymentTargetName ?? "").trim()) errors.push("ระบุชื่อผู้รับเงินหรือผู้ขาย");
  if (!Array.isArray(data.expenseLines) || data.expenseLines.length === 0) {
    errors.push("เพิ่มรายการค่าใช้จ่ายอย่างน้อย 1 รายการ");
  } else if (!data.expenseLines.some((line) => String(line.description ?? "").trim() && toCents(line.amountBeforeVat) > 0)) {
    errors.push("กรอกรายละเอียดและยอดเงินของรายการค่าใช้จ่ายอย่างน้อย 1 รายการ");
  }
  return errors;
}

function buildExpensePayload(data = {}) {
  const [accountingYear, accountingMonth] = String(data.accountingMonth ?? "").split("-");
  const existingRequestNo = String(data.requestNo ?? "").trim();
  const requestNo = /^REQ-\d{4}-\d{2}-\d{4}$/.test(existingRequestNo)
    ? existingRequestNo
    : `REQ-${accountingYear}-${accountingMonth}-${padSequence(data.sequence)}`;
  const requestNoParts = requestNo.match(/^REQ-(\d{4})-(\d{2})-/);
  const year = requestNoParts?.[1] || accountingYear;
  const month = requestNoParts?.[2] || accountingMonth;
  const folderTitle = safeTitle(data.requestTitle || data.businessPurpose);
  const folderPath = String(data.folderPath ?? "").trim() || `documents/${year}/${month}/เบิกจ่าย/${requestNo}_${folderTitle}`;
  const totals = calculateExpenseTotals(data.expenseLines);

  const evidence = Object.fromEntries(
    Object.entries(EVIDENCE_LABELS).map(([key, label], index) => [
      key,
      {
        label,
        ref: `A${index + 1}`,
        status: data.evidenceFiles?.[key]?.length ? "มี" : "รอดำเนินการ",
        files: (data.evidenceFiles?.[key] ?? []).map((file) => file.storedName || file.name).filter(Boolean),
      },
    ]),
  );
  const uploadedRawFiles = Object.keys(EVIDENCE_LABELS).flatMap((key) => evidence[key].files);

  return {
    requestNo,
    folderPath,
    requestTitle: String(data.requestTitle ?? "").trim(),
    requestType: String(data.requestType ?? "").trim(),
    company: data.company ? {
      legalName: String(data.company.legalName ?? "").trim(),
      taxId: String(data.company.taxId ?? "").trim(),
      branch: String(data.company.branch ?? "").trim(),
      address: String(data.company.address ?? "").trim(),
    } : undefined,
    requestTypeLabel: REQUEST_TYPE_LABELS[data.requestType] ?? data.requestType,
    requesterName: String(data.requesterName ?? "").trim(),
    requesterRole: String(data.requesterRole ?? "").trim(),
    requesterContact: String(data.requesterContact ?? "").trim(),
    expenseDate: String(data.expenseDate ?? "").trim(),
    businessPurpose: String(data.businessPurpose ?? "").trim(),
    paymentTargetName: String(data.paymentTargetName ?? "").trim(),
    paymentBankName: String(data.paymentBankName ?? "").trim(),
    paymentAccountNo: String(data.paymentAccountNo ?? "").trim(),
    expenseLines: data.expenseLines,
    totals,
    evidence,
    evidenceFiles: data.evidenceFiles ?? {},
    rawFiles: uploadedRawFiles.length ? uploadedRawFiles : data.rawFiles ?? [],
    createdAt: data.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function formatPayloadMarkdown(payload) {
  const lines = payload.expenseLines
    .map(
      (line, index) =>
        `| ${index + 1} | ${line.date || ""} | ${line.category || ""} | ${line.description || ""} | ${line.vendor || ""} | ${money(toCents(line.amountBeforeVat))} | ${money(toCents(line.vatAmount))} | ${money(toCents(line.withholdingTax))} | |`,
    )
    .join("\n");

  const evidence = Object.values(payload.evidence)
    .map((item) => `| ${item.ref} | ${item.label} | ${item.status} | ${(item.files ?? []).join(", ")} |`)
    .join("\n");
  const company = payload.company ?? {};

  return `# ข้อมูลสำหรับทำใบเบิกจ่าย

เลขที่เอกสาร: ${payload.requestNo}
ชื่อนิติบุคคล: ${company.legalName || ""}
เลขประจำตัวผู้เสียภาษี: ${company.taxId || ""}
สำนักงานใหญ่/สาขา: ${company.branch || ""}
ที่อยู่บริษัท: ${company.address || ""}
ประเภทคำขอ: ${payload.requestTypeLabel}
ผู้ขอ: ${payload.requesterName}
วัตถุประสงค์ทางธุรกิจ: ${payload.businessPurpose}
โฟลเดอร์: ${payload.folderPath}

## รายการค่าใช้จ่าย

| ลำดับ | วันที่ | หมวด | รายละเอียด | ผู้ขาย | ก่อน VAT | VAT | หัก ณ ที่จ่าย | หมายเหตุ |
|---:|---|---|---|---|---:|---:|---:|---|
${lines}

## สรุปยอด

| รายการ | ยอด |
|---|---:|
| ยอดก่อน VAT | ${payload.totals.amountBeforeVat} |
| VAT | ${payload.totals.vatAmount} |
| ยอดรวม | ${payload.totals.grossAmount} |
| หัก ณ ที่จ่าย | ${payload.totals.withholdingTax} |
| ยอดจ่ายสุทธิ | ${payload.totals.netPayment} |

## หลักฐาน

| รหัส | หลักฐาน | สถานะ | ชื่อไฟล์ raw |
|---|---|---|---|
${evidence}
`;
}

const ExpenseRequestLogic = {
  buildRawFileName,
  buildExpensePayload,
  calculateExpenseTotals,
  formatPayloadMarkdown,
  validateExpenseRequest,
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = ExpenseRequestLogic;
} else {
  window.ExpenseRequestLogic = ExpenseRequestLogic;
}
