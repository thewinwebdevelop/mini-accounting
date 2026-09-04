import assert from "node:assert/strict";
import test from "node:test";

import logic from "../forms/expense-request.logic.js";

const {
  buildRawFileName,
  buildExpensePayload,
  calculateExpenseTotals,
  formatPayloadMarkdown,
  validateExpenseRequest,
} = logic;

test("calculateExpenseTotals sums gross, vat, withholding, and net payment from line items", () => {
  const totals = calculateExpenseTotals([
    { amountBeforeVat: "1000.00", vatAmount: "70.00", withholdingTax: "0" },
    { amountBeforeVat: "500.50", vatAmount: "35.04", withholdingTax: "15.00" },
  ]);

  assert.deepEqual(totals, {
    amountBeforeVat: "1500.50",
    vatAmount: "105.04",
    grossAmount: "1605.54",
    withholdingTax: "15.00",
    netPayment: "1590.54",
  });
});

test("validateExpenseRequest requires the fields needed to create a traceable reimbursement file", () => {
  const errors = validateExpenseRequest({
    requestType: "",
    accountingMonth: "",
    requesterName: "",
    businessPurpose: "",
    paymentTargetName: "",
    expenseLines: [],
  });

  assert.deepEqual(errors, [
    "เลือกประเภทคำขอ",
    "ระบุเดือนบัญชี",
    "ระบุชื่อผู้ขอ",
    "ระบุวัตถุประสงค์ทางธุรกิจ",
    "ระบุชื่อผู้รับเงินหรือผู้ขาย",
    "เพิ่มรายการค่าใช้จ่ายอย่างน้อย 1 รายการ",
  ]);
});

test("validateExpenseRequest rejects an empty placeholder expense line", () => {
  const errors = validateExpenseRequest({
    requestType: "reimbursement",
    accountingMonth: "2026-09",
    requesterName: "คุณผู้ขอ",
    businessPurpose: "ใช้ประกอบการขายสินค้า",
    paymentTargetName: "คุณผู้ขอ",
    expenseLines: [
      {
        date: "",
        category: "",
        description: "",
        vendor: "",
        amountBeforeVat: "",
        vatAmount: "",
        withholdingTax: "",
      },
    ],
  });

  assert.deepEqual(errors, ["กรอกรายละเอียดและยอดเงินของรายการค่าใช้จ่ายอย่างน้อย 1 รายการ"]);
});

test("buildExpensePayload creates standard document IDs and folder paths for a valid request", () => {
  const payload = buildExpensePayload({
    sequence: "7",
    accountingMonth: "2026-09",
    requestTitle: "ค่าแพ็คสินค้า",
    requestType: "reimbursement",
    requesterName: "คุณตัวอย่าง",
    requesterRole: "Operations",
    requesterContact: "Line sample",
    expenseDate: "2026-09-03",
    businessPurpose: "ซื้อวัสดุแพ็คสินค้าใช้จัดส่งออเดอร์",
    paymentTargetName: "คุณตัวอย่าง",
    paymentBankName: "กสิกรไทย",
    paymentAccountNo: "123-4-56789-0",
    expenseLines: [
      {
        date: "2026-09-03",
        category: "วัสดุแพ็คสินค้า",
        description: "ซองไปรษณีย์",
        vendor: "ร้านตัวอย่าง",
        amountBeforeVat: "1000",
        vatAmount: "70",
        withholdingTax: "0",
      },
    ],
    evidenceFiles: {
      fullTaxInvoice: [
        { storedName: "A2_tax-invoice_001.pdf", originalName: "tax.pdf", size: 1024, type: "application/pdf" },
      ],
      vendorPaymentSlip: [
        { storedName: "A3_vendor-payment-slip_001.jpg", originalName: "slip.jpg", size: 1024, type: "image/jpeg" },
      ],
      businessEvidence: [
        { storedName: "A5_business-evidence_001.jpg", originalName: "use.jpg", size: 1024, type: "image/jpeg" },
      ],
    },
  });

  assert.equal(payload.requestNo, "REQ-2026-09-0007");
  assert.equal(payload.folderPath, "documents/2026/09/เบิกจ่าย/REQ-2026-09-0007_ค่าแพ็คสินค้า");
  assert.equal(payload.requestType, "reimbursement");
  assert.equal(payload.requestTitle, "ค่าแพ็คสินค้า");
  assert.equal(payload.requesterRole, "Operations");
  assert.equal(payload.requesterContact, "Line sample");
  assert.equal(payload.expenseDate, "2026-09-03");
  assert.equal(payload.paymentBankName, "กสิกรไทย");
  assert.equal(payload.paymentAccountNo, "123-4-56789-0");
  assert.deepEqual(payload.totals, {
    amountBeforeVat: "1000.00",
    vatAmount: "70.00",
    grossAmount: "1070.00",
    withholdingTax: "0.00",
    netPayment: "1070.00",
  });
  assert.equal(payload.evidence.fullTaxInvoice.status, "มี");
  assert.equal(payload.evidence.reimbursementSlip.status, "รอดำเนินการ");
});

test("buildExpensePayload does not mark evidence as attached without raw files", () => {
  const payload = buildExpensePayload({
    sequence: "8",
    accountingMonth: "2026-09",
    requestTitle: "ค่าโฆษณา",
    requestType: "reimbursement",
    requesterName: "คุณตัวอย่าง",
    businessPurpose: "ลงโฆษณา TikTok",
    paymentTargetName: "TikTok",
    expenseLines: [
      {
        description: "ค่าโฆษณา",
        amountBeforeVat: "100",
        vatAmount: "0",
        withholdingTax: "0",
      },
    ],
    evidence: {
      receipt: true,
      businessEvidence: true,
      otherEvidence: true,
    },
    evidenceFiles: {
      fullTaxInvoice: [
        { storedName: "A2_tax-invoice_001.pdf", originalName: "tax.pdf", size: 1024, type: "application/pdf" },
      ],
    },
  });

  assert.equal(payload.evidence.receipt.status, "รอดำเนินการ");
  assert.equal(payload.evidence.businessEvidence.status, "รอดำเนินการ");
  assert.equal(payload.evidence.otherEvidence.status, "รอดำเนินการ");
  assert.equal(payload.evidence.fullTaxInvoice.status, "มี");
});

test("buildExpensePayload keeps an existing request number and folder path when editing", () => {
  const payload = buildExpensePayload({
    requestNo: "REQ-2026-09-0001",
    folderPath: "documents/2026/09/เบิกจ่าย/REQ-2026-09-0001_ค่าส่งพัสดุ",
    sequence: "9",
    accountingMonth: "2026-09",
    requestTitle: "ค่าส่งพัสดุแก้ไข",
    requestType: "reimbursement",
    requesterName: "คุณแก้ไข",
    businessPurpose: "ค่าส่งสินค้าเพิ่มเติม",
    paymentTargetName: "คุณแก้ไข",
    expenseLines: [
      {
        description: "ค่าส่งเพิ่ม",
        amountBeforeVat: "200",
        vatAmount: "14",
        withholdingTax: "0",
      },
    ],
    rawFiles: ["A1_receipt_001.jpg"],
  });

  assert.equal(payload.requestNo, "REQ-2026-09-0001");
  assert.equal(payload.folderPath, "documents/2026/09/เบิกจ่าย/REQ-2026-09-0001_ค่าส่งพัสดุ");
  assert.equal(payload.requestTitle, "ค่าส่งพัสดุแก้ไข");
  assert.equal(payload.totals.netPayment, "214.00");
});

test("buildRawFileName creates stable evidence filenames from uploaded originals", () => {
  assert.equal(buildRawFileName("fullTaxInvoice", "IMG 1234.HEIC", 0), "A2_tax-invoice_001.heic");
  assert.equal(buildRawFileName("vendorPaymentSlip", "สลิป โอนเงิน.jpg", 2), "A3_vendor-payment-slip_003.jpg");
  assert.equal(buildRawFileName("otherEvidence", "no-extension", 0), "A6_other-evidence_001");
});

test("buildExpensePayload marks uploaded evidence files as attached raw evidence", () => {
  const payload = buildExpensePayload({
    sequence: "3",
    accountingMonth: "2026-09",
    requestTitle: "ค่าส่งพัสดุ",
    requestType: "reimbursement",
    requesterName: "คุณตัวอย่าง",
    businessPurpose: "ค่าส่งสินค้าให้ลูกค้า",
    paymentTargetName: "คุณตัวอย่าง",
    expenseLines: [
      {
        amountBeforeVat: "100",
        vatAmount: "7",
        withholdingTax: "0",
      },
    ],
    evidenceFiles: {
      fullTaxInvoice: [
        { storedName: "A2_tax-invoice_001.jpg", originalName: "tax.jpg", size: 1024, type: "image/jpeg" },
      ],
      businessEvidence: [
        { storedName: "A5_business-evidence_001.png", originalName: "use.png", size: 2048, type: "image/png" },
      ],
    },
  });

  assert.equal(payload.evidence.fullTaxInvoice.status, "มี");
  assert.deepEqual(payload.evidence.fullTaxInvoice.files, ["A2_tax-invoice_001.jpg"]);
  assert.equal(payload.evidence.receipt.status, "รอดำเนินการ");
  assert.deepEqual(payload.rawFiles, ["A2_tax-invoice_001.jpg", "A5_business-evidence_001.png"]);
});

test("buildExpensePayload preserves company master data for generated documents", () => {
  const payload = buildExpensePayload({
    sequence: "4",
    accountingMonth: "2026-09",
    requestTitle: "ค่าโฆษณา",
    requestType: "reimbursement",
    requesterName: "คุณผู้ขอ",
    businessPurpose: "ลงโฆษณา TikTok",
    paymentTargetName: "TikTok",
    company: {
      legalName: "หจก.สวีทเฮาส์ เดซี่",
      taxId: "0103569007277",
      branch: "สำนักงานใหญ่",
      address: "500 หมู่ 10 แขวงหนองแขม เขตหนองแขม กรุงเทพฯ 10160",
    },
    expenseLines: [
      {
        description: "ค่าโฆษณา",
        amountBeforeVat: "100",
        vatAmount: "0",
        withholdingTax: "0",
      },
    ],
  });

  assert.deepEqual(payload.company, {
    legalName: "หจก.สวีทเฮาส์ เดซี่",
    taxId: "0103569007277",
    branch: "สำนักงานใหญ่",
    address: "500 หมู่ 10 แขวงหนองแขม เขตหนองแขม กรุงเทพฯ 10160",
  });
});

test("formatPayloadMarkdown lists stored raw filenames for uploaded evidence", () => {
  const markdown = formatPayloadMarkdown({
    requestNo: "REQ-2026-09-0003",
    company: {
      legalName: "หจก.สวีทเฮาส์ เดซี่",
      taxId: "0103569007277",
      branch: "สำนักงานใหญ่",
      address: "500 หมู่ 10 แขวงหนองแขม เขตหนองแขม กรุงเทพฯ 10160",
    },
    requestTypeLabel: "เบิกคืนพนักงาน",
    requesterName: "คุณตัวอย่าง",
    businessPurpose: "ค่าส่งสินค้าให้ลูกค้า",
    folderPath: "documents/2026/09/เบิกจ่าย/REQ-2026-09-0003_ค่าส่งพัสดุ",
    expenseLines: [],
    totals: {
      amountBeforeVat: "0.00",
      vatAmount: "0.00",
      grossAmount: "0.00",
      withholdingTax: "0.00",
      netPayment: "0.00",
    },
    evidence: {
      fullTaxInvoice: {
        ref: "A2",
        label: "ใบกำกับภาษีเต็มรูป",
        status: "มี",
        files: ["A2_tax-invoice_001.jpg", "A2_tax-invoice_002.pdf"],
      },
    },
  });

  assert.match(markdown, /หจก\.สวีทเฮาส์ เดซี่/);
  assert.match(markdown, /0103569007277/);
  assert.match(markdown, /A2_tax-invoice_001\.jpg, A2_tax-invoice_002\.pdf/);
});
