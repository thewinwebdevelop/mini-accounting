import assert from "node:assert/strict";
import test from "node:test";

import substituteReceipt from "../forms/substitute-receipt.logic.js";

const {
  SUBSTITUTE_RECEIPT_STATUSES,
  SUBSTITUTE_RECEIPT_STATUS_LABELS,
  buildSubstituteReceiptPayload,
  buildSubstituteReceiptRawFileName,
  formatSubstituteReceiptMarkdown,
  assertStockLinesUnchanged,
  assertSubstituteReceiptTransition,
  normalizeSubstituteReceiptStatus,
  validateSubstituteReceipt,
} = substituteReceipt;

test("buildSubstituteReceiptPayload creates SR document number, evidence checklist, and stock totals", () => {
  const payload = buildSubstituteReceiptPayload({
    accountingMonth: "2026-09",
    sequence: "7",
    receiptDate: "2026-09-04",
    receiptTitle: "ซื้อสต๊อกเสื้อ",
    receiptType: "stock_purchase",
    payeeName: "บริษัท ตัวอย่าง จำกัด",
    paymentChannel: "โอนผ่านบัญชีบริษัท",
    paymentReference: "KBANK-001",
    businessPurpose: "ซื้อสินค้าเพื่อขาย",
    lines: [
      {
        stockSkuId: "11",
        sku: "TOP-A-WHITE-M",
        description: "เสื้อ A สีขาว M",
        quantity: "3",
        unitCost: "120.50",
      },
      {
        stockSkuId: "12",
        sku: "SKIRT-B-BLACK-F",
        description: "กระโปรง B สีดำ F",
        quantity: "2",
        unitCost: "150",
      },
    ],
    evidenceFiles: {
      paymentSlip: [{ storedName: "B1_payment-slip_001.jpg" }],
      purchaseOrder: [{ storedName: "B2_purchase-order_001.pdf" }],
    },
    createdAt: "2026-09-04T00:00:00.000Z",
  });

  assert.equal(payload.receiptNo, "SR-2026-09-0007");
  assert.match(payload.folderPath, /documents\/2026\/09\/ใบรับรองแทนใบเสร็จ\/SR-2026-09-0007_/);
  assert.equal(payload.receiptTypeLabel, "ซื้อสต๊อกสินค้า");
  assert.equal(payload.lines[0].quantity, 3);
  assert.equal(payload.lines[0].unitCost, "120.50");
  assert.equal(payload.lines[0].lineTotal, "361.50");
  assert.equal(payload.totals.totalAmount, "661.50");
  assert.equal(payload.evidence.paymentSlip.status, "มี");
  assert.equal(payload.evidence.goodsReceived.status, "รอดำเนินการ");
  assert.deepEqual(payload.rawFiles, ["B1_payment-slip_001.jpg", "B2_purchase-order_001.pdf"]);
});

test("validateSubstituteReceipt requires traceable evidence and valid stock purchase lines", () => {
  assert.deepEqual(validateSubstituteReceipt({
    receiptType: "stock_purchase",
    accountingMonth: "2026-09",
    receiptDate: "2026-09-04",
    payeeName: "ร้านขายส่ง",
    businessPurpose: "ซื้อสินค้าเพื่อขาย",
    lines: [{ stockSkuId: "1", quantity: "1", unitCost: "100", description: "เสื้อ" }],
    evidenceFiles: { paymentSlip: [{ storedName: "B1_payment-slip_001.jpg" }] },
  }), []);

  assert.deepEqual(validateSubstituteReceipt({
    receiptType: "stock_purchase",
    accountingMonth: "",
    receiptDate: "",
    payeeName: "",
    businessPurpose: "",
    lines: [{ quantity: "0", unitCost: "0" }],
    evidenceFiles: {},
  }), [
    "ระบุเดือนบัญชี",
    "ระบุวันที่เอกสาร",
    "ระบุผู้ขาย/ผู้รับเงิน",
    "ระบุวัตถุประสงค์ทางธุรกิจ",
    "แนบหลักฐานการชำระเงินหรือหลักฐานการสั่งซื้ออย่างน้อย 1 ไฟล์",
    "เลือกรายการ Stock SKU ให้ครบ",
    "จำนวนสินค้าต้องมากกว่า 0",
    "ต้นทุนต่อหน่วยต้องมากกว่า 0",
  ]);
});

test("validateSubstituteReceipt allows general expenses without Stock SKU", () => {
  assert.deepEqual(validateSubstituteReceipt({
    receiptType: "general_expense",
    accountingMonth: "2026-09",
    receiptDate: "2026-09-04",
    payeeName: "ขนส่งเอกชน",
    businessPurpose: "ค่าส่งสินค้าให้ลูกค้า",
    lines: [{ description: "ค่าส่งสินค้า", quantity: "1", unitCost: "85" }],
    evidenceFiles: { paymentSlip: [{ storedName: "B1_payment-slip_001.jpg" }] },
  }), []);

  assert.deepEqual(validateSubstituteReceipt({
    receiptType: "general_expense",
    accountingMonth: "2026-09",
    receiptDate: "2026-09-04",
    payeeName: "ร้านอุปกรณ์",
    businessPurpose: "ซื้ออุปกรณ์ในออฟฟิศ",
    lines: [{ description: "กระดาษแพ็กสินค้า", quantity: "", unitCost: "" }],
    evidenceFiles: { paymentSlip: [{ storedName: "B1_payment-slip_001.jpg" }] },
  }), [
    "กรอกรายการและยอดเงินอย่างน้อย 1 รายการ",
  ]);
});

test("buildSubstituteReceiptRawFileName creates stable evidence filenames", () => {
  assert.equal(buildSubstituteReceiptRawFileName("paymentSlip", "transfer.JPG", 0), "B1_payment-slip_001.jpg");
  assert.equal(buildSubstituteReceiptRawFileName("purchaseOrder", "order.PDF", 2), "B2_purchase-order_003.pdf");
  assert.equal(buildSubstituteReceiptRawFileName("unknownKey", "note.txt", 0), "BX_unknownkey_001.txt");
});

test("substitute receipt state helpers validate transitions and lock stock lines", () => {
  assert.equal(normalizeSubstituteReceiptStatus(""), "draft");
  assert.equal(SUBSTITUTE_RECEIPT_STATUS_LABELS.approved, "อนุมัติแล้ว");
  assert.doesNotThrow(() => assertSubstituteReceiptTransition("pending_approval", "approved"));
  assert.throws(() => assertSubstituteReceiptTransition("draft", "received"), /Invalid substitute receipt status transition/);

  const original = {
    receiptType: "stock_purchase",
    lines: [{ stockSkuId: "1", quantity: 2, unitCost: "100.00" }],
  };
  assert.doesNotThrow(() => assertStockLinesUnchanged(original, {
    receiptType: "stock_purchase",
    lines: [{ stockSkuId: "1", quantity: "2", unitCost: "100" }],
  }));
  assert.throws(() => assertStockLinesUnchanged(original, {
    receiptType: "stock_purchase",
    lines: [{ stockSkuId: "1", quantity: "3", unitCost: "100" }],
  }), /Stock lines cannot be edited/);
});

test("completed is a valid substitute receipt status reachable only from approved or received", () => {
  assert.deepEqual(SUBSTITUTE_RECEIPT_STATUSES, [
    "draft",
    "pending_approval",
    "approved",
    "received",
    "completed",
    "cancelled",
    "voided",
  ]);
  assert.equal(SUBSTITUTE_RECEIPT_STATUS_LABELS.completed, "เสร็จสิ้น");
  assert.equal(normalizeSubstituteReceiptStatus("completed"), "completed");

  // Reachable from approved (general_expense terminal state) and received (stock_purchase terminal state).
  assert.doesNotThrow(() => assertSubstituteReceiptTransition("approved", "completed"));
  assert.doesNotThrow(() => assertSubstituteReceiptTransition("received", "completed"));
  assert.doesNotThrow(() => assertSubstituteReceiptTransition("completed", "completed"));

  // Every other starting state is rejected.
  assert.throws(() => assertSubstituteReceiptTransition("draft", "completed"), /Invalid substitute receipt status transition/);
  assert.throws(() => assertSubstituteReceiptTransition("pending_approval", "completed"), /Invalid substitute receipt status transition/);
  assert.throws(() => assertSubstituteReceiptTransition("cancelled", "completed"), /Invalid substitute receipt status transition/);
  assert.throws(() => assertSubstituteReceiptTransition("voided", "completed"), /Invalid substitute receipt status transition/);

  // Completed is terminal: it cannot move on to any other status.
  assert.throws(() => assertSubstituteReceiptTransition("completed", "approved"), /Invalid substitute receipt status transition/);
  assert.throws(() => assertSubstituteReceiptTransition("completed", "received"), /Invalid substitute receipt status transition/);
  assert.throws(() => assertSubstituteReceiptTransition("completed", "cancelled"), /Invalid substitute receipt status transition/);
  assert.throws(() => assertSubstituteReceiptTransition("completed", "voided"), /Invalid substitute receipt status transition/);

  // Existing approved/received transitions still work unchanged.
  assert.doesNotThrow(() => assertSubstituteReceiptTransition("approved", "received"));
  assert.doesNotThrow(() => assertSubstituteReceiptTransition("approved", "cancelled"));
  assert.doesNotThrow(() => assertSubstituteReceiptTransition("received", "voided"));
});

test("formatSubstituteReceiptMarkdown includes stock lines and raw evidence names", () => {
  const payload = buildSubstituteReceiptPayload({
    accountingMonth: "2026-09",
    sequence: "1",
    receiptDate: "2026-09-04",
    receiptTitle: "ซื้อสินค้าไม่มีใบเสร็จ",
    receiptType: "stock_purchase",
    payeeName: "ร้านขายส่ง",
    businessPurpose: "ซื้อสินค้าเพื่อขาย",
    lines: [{ stockSkuId: "5", sku: "TOP-A-WHITE-M", description: "เสื้อ A", quantity: "2", unitCost: "100" }],
    evidenceFiles: { paymentSlip: [{ storedName: "B1_payment-slip_001.jpg" }] },
  });

  const markdown = formatSubstituteReceiptMarkdown(payload);
  assert.match(markdown, /# ใบรับรองแทนใบเสร็จรับเงิน/);
  assert.match(markdown, /SR-2026-09-0001/);
  assert.match(markdown, /TOP-A-WHITE-M/);
  assert.match(markdown, /B1_payment-slip_001.jpg/);
  assert.match(markdown, /ยอดรวม \| 200.00/);
});

test("formatSubstituteReceiptMarkdown labels general expense rows without Stock SKU", () => {
  const payload = buildSubstituteReceiptPayload({
    accountingMonth: "2026-09",
    sequence: "2",
    receiptDate: "2026-09-04",
    receiptTitle: "ค่าส่งสินค้า",
    receiptType: "general_expense",
    payeeName: "ขนส่งเอกชน",
    businessPurpose: "ค่าส่งสินค้าให้ลูกค้า",
    lines: [{ description: "ค่าส่งสินค้า Shopee", quantity: "1", unitCost: "85" }],
    evidenceFiles: { paymentSlip: [{ storedName: "B1_payment-slip_001.jpg" }] },
  });

  const markdown = formatSubstituteReceiptMarkdown(payload);
  assert.match(markdown, /ประเภทเอกสาร: รายจ่ายทั่วไป/);
  assert.match(markdown, /\| ลำดับ \| รายละเอียด \| จำนวน \| ราคา\/หน่วย \| ยอดรวม \|/);
  assert.doesNotMatch(markdown, /\| ลำดับ \| Stock SKU \|/);
  assert.match(markdown, /ค่าส่งสินค้า Shopee/);
  assert.match(markdown, /ยอดรวม \| 85.00/);
});

test("buildSubstituteReceiptPayload preserves workflow relation fields and completed status", () => {
  const payload = buildSubstituteReceiptPayload({
    sequence: "1",
    accountingMonth: "2026-09",
    receiptDate: "2026-09-06",
    receiptType: "general_expense",
    payeeName: "ร้านค้า",
    businessPurpose: "ค่าใช้จ่ายบริษัท",
    transactionNo: "TXN-2026-09-0001",
    workflowTemplateId: "director_expense_transfer",
    workflowStepId: "step-002",
    status: "completed",
    completedAt: "2026-09-06T14:00:00.000Z",
    completedBy: "บัญชี",
    lines: [{ description: "ค่าอุปกรณ์", quantity: "1", unitCost: "100" }],
  });

  assert.equal(payload.transactionNo, "TXN-2026-09-0001");
  assert.equal(payload.workflowTemplateId, "director_expense_transfer");
  assert.equal(payload.workflowStepId, "step-002");
  assert.equal(payload.status, "completed");
  assert.equal(payload.completedAt, "2026-09-06T14:00:00.000Z");
  assert.equal(payload.completedBy, "บัญชี");
});

test("buildSubstituteReceiptPayload defaults workflow relation fields to empty strings for standalone receipts", () => {
  const payload = buildSubstituteReceiptPayload({
    sequence: "2",
    accountingMonth: "2026-09",
    receiptDate: "2026-09-06",
    receiptType: "general_expense",
    payeeName: "ร้านค้า",
    businessPurpose: "ค่าใช้จ่ายบริษัท",
    lines: [{ description: "ค่าอุปกรณ์", quantity: "1", unitCost: "100" }],
  });

  assert.equal(payload.transactionNo, "");
  assert.equal(payload.workflowTemplateId, "");
  assert.equal(payload.workflowStepId, "");
  assert.equal(payload.completedAt, "");
  assert.equal(payload.completedBy, "");
  assert.equal(payload.status, "draft");
});
