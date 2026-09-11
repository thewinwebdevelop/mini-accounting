import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";

import workflowPrefillLogic from "../forms/workflow-prefill.logic.js";

const workflowPrefillLogicPath = new URL("../forms/workflow-prefill.logic.js", import.meta.url);
const workflowLogicPath = new URL("../forms/workflow.logic.js", import.meta.url);

test("expense_request adapter extracts payee, purpose, parties, and lines mapped from expenseLines (D10)", () => {
  const context = workflowPrefillLogic.expenseRequestToWorkflowContext({
    requestTitle: "เบิกค่าส่งของ",
    businessPurpose: "ค่าส่งสินค้า",
    paymentTargetName: "คุณต้า",
    paymentBankName: "SCB",
    paymentAccountNo: "1112223334",
    requesterName: "คุณต้า",
    requesterRole: "ผู้จัดการ",
    expenseLines: [
      { description: "ค่าขนส่ง", amountBeforeVat: "100.00", vatAmount: "0.00", withholdingTax: "0.00" },
    ],
  });

  assert.deepEqual(context.payee, { name: "คุณต้า", bankName: "SCB", accountNo: "1112223334" });
  assert.deepEqual(context.purpose, { title: "เบิกค่าส่งของ", businessPurpose: "ค่าส่งสินค้า" });
  assert.deepEqual(context.parties, { requesterName: "คุณต้า", requesterRole: "ผู้จัดการ" });
  assert.deepEqual(context.lines, [
    { description: "ค่าขนส่ง", quantity: "1", unitCost: "100.00", lineTotal: "100.00", stockSkuId: "" },
  ]);
});

test("substitute_receipt adapter extracts payee name+taxId, purpose, and lines with stockSkuId", () => {
  const context = workflowPrefillLogic.substituteReceiptToWorkflowContext({
    receiptTitle: "",
    businessPurpose: "ซื้อวัสดุ",
    payeeName: "ร้านค้า A",
    payeeTaxId: "1234567890123",
    lines: [{ description: "กระดาษ", quantity: "5", unitCost: "20.00", lineTotal: "100.00", stockSkuId: "SKU-100", vendorSku: "V-9" }],
  });

  assert.deepEqual(context.payee, { name: "ร้านค้า A", taxId: "1234567890123" });
  assert.deepEqual(context.purpose, { businessPurpose: "ซื้อวัสดุ" });
  assert.deepEqual(context.lines, [{ description: "กระดาษ", quantity: "5", unitCost: "20.00", lineTotal: "100.00", stockSkuId: "SKU-100" }]);
  assert.equal(context.parties, undefined);
});

test("the five generic workflow-document adapters extract payee name, purpose, lines, and requesterName from the shared shell payload", () => {
  const payload = {
    title: "คืนเงินกรรมการ",
    businessPurpose: "คืนเงินสำรองจ่าย",
    payeeName: "กรรมการ",
    requesterName: "คุณต้า",
    lines: [{ description: "ค่าส่งเข้าคลัง", quantity: "1", unitCost: "120.00", lineTotal: "120.00", stockSkuId: "" }],
  };
  const adapters = [
    workflowPrefillLogic.purchaseOrderToWorkflowContext,
    workflowPrefillLogic.paymentVoucherToWorkflowContext,
    workflowPrefillLogic.cashSpendDeclarationToWorkflowContext,
    workflowPrefillLogic.payeeAcknowledgementToWorkflowContext,
    workflowPrefillLogic.goodsReceiptToWorkflowContext,
  ];
  for (const toWorkflowContext of adapters) {
    const context = toWorkflowContext(payload);
    assert.deepEqual(context.payee, { name: "กรรมการ" });
    assert.deepEqual(context.purpose, { title: "คืนเงินกรรมการ", businessPurpose: "คืนเงินสำรองจ่าย" });
    assert.deepEqual(context.lines, [{ description: "ค่าส่งเข้าคลัง", quantity: "1", unitCost: "120.00", lineTotal: "120.00", stockSkuId: "" }]);
    assert.deepEqual(context.parties, { requesterName: "คุณต้า" });
  }
});

test("applyWorkflowContextToGoodsReceipt clears quantity while keeping description and stockSkuId", () => {
  const context = {
    lines: [{ description: "กระดาษ A4", quantity: "10", unitCost: "120.00", lineTotal: "1200.00", stockSkuId: "SKU-001" }],
  };
  const patch = workflowPrefillLogic.applyWorkflowContextToGoodsReceipt(context, ["lines"]);

  assert.equal(patch.lines[0].description, "กระดาษ A4");
  assert.equal(patch.lines[0].stockSkuId, "SKU-001");
  assert.equal(patch.lines[0].quantity, "");
});

test("applyWorkflowContextToExpenseRequest maps payee/purpose fields and one expenseLines entry per canonical line (D10)", () => {
  const context = {
    payee: { name: "คุณต้า", bankName: "SCB", accountNo: "1112223334" },
    purpose: { title: "เบิกค่าส่ง", businessPurpose: "ค่าส่งสินค้า" },
    lines: [{ description: "ค่าขนส่งเข้าคลัง", quantity: "1", unitCost: "100.00", lineTotal: "100.00", stockSkuId: "" }],
  };
  const patch = workflowPrefillLogic.applyWorkflowContextToExpenseRequest(context, ["payee", "purpose", "lines"]);

  assert.equal(patch.paymentTargetName, "คุณต้า");
  assert.equal(patch.paymentBankName, "SCB");
  assert.equal(patch.paymentAccountNo, "1112223334");
  assert.equal(patch.requestTitle, "เบิกค่าส่ง");
  assert.equal(patch.businessPurpose, "ค่าส่งสินค้า");
  assert.deepEqual(patch.expenseLines, [
    { description: "ค่าขนส่งเข้าคลัง", amountBeforeVat: "100.00", vatAmount: "0.00", withholdingTax: "0.00" },
  ]);
});

test("expense_request lines round-trip: sourcing maps gross (amountBeforeVat + vatAmount) per expenseLines entry, receiving maps back with VAT/withholding zeroed and description preserved (D10 + correction)", () => {
  // Correction to the task brief: the canonical unitCost/lineTotal on the
  // sourcing side use the line's GROSS (amountBeforeVat + vatAmount), not
  // amountBeforeVat alone. Dropping VAT would silently lose money if a user
  // ever puts VAT on an expense line; folding it into the base preserves the
  // total. The first line below has nonzero VAT (17.50) specifically to prove
  // this — a zero-VAT line (the second one, and the normal case for these six
  // no-tax-invoice templates) round-trips identically either way.
  const sourceContext = workflowPrefillLogic.expenseRequestToWorkflowContext({
    expenseLines: [
      { description: "ค่าขนส่งเข้าคลัง", amountBeforeVat: "250.00", vatAmount: "17.50", withholdingTax: "5.00" },
      { description: "ค่าบรรจุภัณฑ์", amountBeforeVat: "80.00", vatAmount: "0.00", withholdingTax: "0.00" },
    ],
  });

  assert.deepEqual(sourceContext.lines, [
    { description: "ค่าขนส่งเข้าคลัง", quantity: "1", unitCost: "267.50", lineTotal: "267.50", stockSkuId: "" },
    { description: "ค่าบรรจุภัณฑ์", quantity: "1", unitCost: "80.00", lineTotal: "80.00", stockSkuId: "" },
  ]);

  const patch = workflowPrefillLogic.applyWorkflowContextToExpenseRequest({ lines: sourceContext.lines }, ["lines"]);

  // Descriptions survive verbatim, and VAT/withholding land at zero even
  // though the original expense lines had nonzero VAT/withholding — these six
  // templates are all no-tax-invoice cases, so VAT is genuinely zero on a
  // prefilled line (D10). amountBeforeVat on the receiving side is the
  // canonical line's (gross) lineTotal, per the receiving-direction mapping,
  // which is unchanged by the sourcing-side correction.
  assert.deepEqual(patch.expenseLines, [
    { description: "ค่าขนส่งเข้าคลัง", amountBeforeVat: "267.50", vatAmount: "0.00", withholdingTax: "0.00" },
    { description: "ค่าบรรจุภัณฑ์", amountBeforeVat: "80.00", vatAmount: "0.00", withholdingTax: "0.00" },
  ]);
});

test("buildWorkflowPrefillContext lets the most recently completed document win per group; earlier ones fill the rest", () => {
  const po = {
    documentKind: "purchase_order",
    documentNo: "PO-2026-09-0001",
    status: "completed",
    completedAt: "2026-09-01T08:00:00.000Z",
    title: "สั่งซื้อวัสดุ",
    businessPurpose: "ซื้อวัสดุสำนักงาน",
    payeeName: "ร้านค้า A",
    lines: [{ description: "กระดาษ", quantity: "10", unitCost: "100.00", lineTotal: "1000.00" }],
  };
  const sr = {
    documentKind: "substitute_receipt",
    documentNo: "SR-2026-09-0001",
    status: "completed",
    receiptType: "general_expense",
    completedAt: "2026-09-02T08:00:00.000Z",
    payeeName: "ร้านค้า B",
    payeeTaxId: "1234567890123",
    businessPurpose: "",
    lines: [{ description: "หมึกพิมพ์", quantity: "2", unitCost: "50.00", lineTotal: "100.00" }],
  };

  const { context, sources } = workflowPrefillLogic.buildWorkflowPrefillContext([po, sr], "payment_voucher");

  // sr completed after po, so sr's payee and lines win.
  assert.equal(context.payee.name, "ร้านค้า B");
  assert.equal(sources.payee, "SR-2026-09-0001");
  assert.deepEqual(context.lines.map((line) => line.description), ["หมึกพิมพ์"]);
  assert.equal(sources.lines, "SR-2026-09-0001");
  // sr supplied an empty businessPurpose, so po's non-empty purpose fills the gap.
  assert.equal(context.purpose.businessPurpose, "ซื้อวัสดุสำนักงาน");
  assert.equal(sources.purpose, "PO-2026-09-0001");
});

test("buildWorkflowPrefillContext: a later step wins over an earlier step even when the later step has an empty completedAt (hybrid substitute_receipt completion never stamps completedAt)", () => {
  // Reproduction: purchase_order -> substitute_receipt -> payment_voucher.
  // The substitute_receipt reaches workflow-completed via the hybrid rule
  // (general_expense + approved) without ever getting a completedAt stamp,
  // so it is "" even though it completed strictly after the purchase order.
  const po = {
    documentKind: "purchase_order",
    documentNo: "PO-2026-09-0010",
    workflowStepId: "step-001",
    status: "completed",
    completedAt: "2026-09-01T08:00:00.000Z",
    businessPurpose: "ซื้อวัสดุสำนักงาน",
    payeeName: "ร้านค้า A",
    lines: [{ description: "กระดาษ", quantity: "10", unitCost: "100.00", lineTotal: "1000.00" }],
  };
  const sr = {
    documentKind: "substitute_receipt",
    documentNo: "SR-2026-09-0010",
    workflowStepId: "step-002",
    status: "approved",
    receiptType: "general_expense",
    completedAt: "",
    payeeName: "ร้านค้า B",
    businessPurpose: "",
    lines: [{ description: "หมึกพิมพ์", quantity: "2", unitCost: "50.00", lineTotal: "100.00" }],
  };

  const { context, sources } = workflowPrefillLogic.buildWorkflowPrefillContext([po, sr], "payment_voucher");

  assert.equal(context.payee.name, "ร้านค้า B");
  assert.equal(sources.payee, "SR-2026-09-0010");
  assert.deepEqual(context.lines.map((line) => line.description), ["หมึกพิมพ์"]);
  assert.equal(sources.lines, "SR-2026-09-0010");
  // sr's businessPurpose was empty, so po's purpose fills the gap.
  assert.equal(context.purpose.businessPurpose, "ซื้อวัสดุสำนักงาน");
  assert.equal(sources.purpose, "PO-2026-09-0010");
});

test("buildWorkflowPrefillContext: a later step wins over an earlier step when both have empty completedAt", () => {
  const po = {
    documentKind: "purchase_order",
    documentNo: "PO-2026-09-0011",
    workflowStepId: "step-001",
    status: "completed",
    completedAt: "",
    payeeName: "ร้านค้า A",
  };
  const sr = {
    documentKind: "substitute_receipt",
    documentNo: "SR-2026-09-0011",
    workflowStepId: "step-002",
    status: "approved",
    receiptType: "general_expense",
    completedAt: "",
    payeeName: "ร้านค้า B",
  };

  const { context, sources } = workflowPrefillLogic.buildWorkflowPrefillContext([po, sr], "payment_voucher");

  assert.equal(context.payee.name, "ร้านค้า B");
  assert.equal(sources.payee, "SR-2026-09-0011");
});

test("buildWorkflowPrefillContext: a later step wins over an earlier step when both have real completedAt timestamps", () => {
  const po = {
    documentKind: "purchase_order",
    documentNo: "PO-2026-09-0012",
    workflowStepId: "step-001",
    status: "completed",
    completedAt: "2026-09-01T08:00:00.000Z",
    payeeName: "ร้านค้า A",
  };
  const sr = {
    documentKind: "substitute_receipt",
    documentNo: "SR-2026-09-0012",
    workflowStepId: "step-002",
    status: "completed",
    completedAt: "2026-09-02T08:00:00.000Z",
    payeeName: "ร้านค้า B",
  };

  const { context, sources } = workflowPrefillLogic.buildWorkflowPrefillContext([po, sr], "payment_voucher");

  assert.equal(context.payee.name, "ร้านค้า B");
  assert.equal(sources.payee, "SR-2026-09-0012");
});

test("buildWorkflowPrefillContext: a later step wins even when its real completedAt is earlier than the earlier step's (step order governs, not the clock)", () => {
  const po = {
    documentKind: "purchase_order",
    documentNo: "PO-2026-09-0013",
    workflowStepId: "step-001",
    status: "completed",
    // Deliberately later than sr's timestamp below, to prove ordering does
    // not fall back to comparing clock values once workflowStepId decides it.
    completedAt: "2026-09-10T08:00:00.000Z",
    payeeName: "ร้านค้า A",
  };
  const sr = {
    documentKind: "substitute_receipt",
    documentNo: "SR-2026-09-0013",
    workflowStepId: "step-002",
    status: "completed",
    completedAt: "2026-09-02T08:00:00.000Z",
    payeeName: "ร้านค้า B",
  };

  const { context, sources } = workflowPrefillLogic.buildWorkflowPrefillContext([po, sr], "payment_voucher");

  assert.equal(context.payee.name, "ร้านค้า B");
  assert.equal(sources.payee, "SR-2026-09-0013");
});

test("buildWorkflowPrefillContext: sources with no workflowStepId at all still fall back to array position for a stable, deterministic result", () => {
  const first = {
    documentKind: "purchase_order",
    documentNo: "PO-2026-09-0014",
    status: "completed",
    completedAt: "2026-09-05T08:00:00.000Z",
    payeeName: "ร้านค้า A",
  };
  const second = {
    documentKind: "substitute_receipt",
    documentNo: "SR-2026-09-0014",
    status: "completed",
    completedAt: "2026-09-01T08:00:00.000Z",
    payeeName: "ร้านค้า B",
  };

  const run1 = workflowPrefillLogic.buildWorkflowPrefillContext([first, second], "payment_voucher");
  const run2 = workflowPrefillLogic.buildWorkflowPrefillContext([first, second], "payment_voucher");

  // Later array position wins (callers pass documents in template step
  // order), and repeated calls with the same input give the same result.
  assert.equal(run1.context.payee.name, "ร้านค้า B");
  assert.equal(run1.sources.payee, "SR-2026-09-0014");
  assert.deepEqual(run1, run2);
});

test("buildWorkflowPrefillContext: a later step supplying only payee must not blank out purpose/lines supplied by an earlier step", () => {
  const po = {
    documentKind: "purchase_order",
    documentNo: "PO-2026-09-0015",
    workflowStepId: "step-001",
    status: "completed",
    completedAt: "2026-09-01T08:00:00.000Z",
    businessPurpose: "ซื้อวัสดุสำนักงาน",
    payeeName: "ร้านค้า A",
    lines: [{ description: "กระดาษ", quantity: "10", unitCost: "100.00", lineTotal: "1000.00" }],
  };
  const sr = {
    documentKind: "substitute_receipt",
    documentNo: "SR-2026-09-0015",
    workflowStepId: "step-002",
    status: "approved",
    receiptType: "general_expense",
    completedAt: "",
    payeeName: "ร้านค้า B",
    // No businessPurpose, no lines at all.
  };

  const { context, sources } = workflowPrefillLogic.buildWorkflowPrefillContext([po, sr], "payment_voucher");

  assert.equal(context.payee.name, "ร้านค้า B");
  assert.equal(sources.payee, "SR-2026-09-0015");
  assert.equal(context.purpose.businessPurpose, "ซื้อวัสดุสำนักงาน");
  assert.equal(sources.purpose, "PO-2026-09-0015");
  assert.deepEqual(context.lines.map((line) => line.description), ["กระดาษ"]);
  assert.equal(sources.lines, "PO-2026-09-0015");
});

test("buildWorkflowPrefillContext ignores documents that are not workflow-completed", () => {
  const draftPo = {
    documentKind: "purchase_order",
    documentNo: "PO-2026-09-0002",
    status: "draft",
    payeeName: "ร้านค้า C",
    businessPurpose: "ไม่ควรถูกใช้",
    lines: [{ description: "ไม่ควรถูกใช้", quantity: "1", unitCost: "1.00", lineTotal: "1.00" }],
  };

  const { context, sources } = workflowPrefillLogic.buildWorkflowPrefillContext([draftPo], "payment_voucher");

  assert.deepEqual(context.payee, {});
  assert.deepEqual(context.lines, []);
  assert.deepEqual(sources, {});
});

// Critical/Important 3 repro: buildWorkflowPrefillContext seeds
// context = { payee: {}, purpose: {}, lines: [], parties: {} } up front, so
// `parties` is always a truthy *object* even when no completed source ever
// supplied one — every shipped template contains a substitute_receipt, and
// substitute_receipt never emits `parties` at all. Before the fix,
// applyWorkflowPrefillGroups folded that empty `{}` in unconditionally, and
// the appliers' own `if (context.parties)` guard treated `{}` as truthy —
// so applying prefill from a substitute_receipt-only source blanked out
// whatever requesterName/requesterRole the user had already typed, and the
// UI badge printed the literal "นำมาจาก undefined" (sources.parties was never
// set, since no source ever supplied it).
test("buildWorkflowPrefillContext + applyWorkflowPrefillGroups: a substitute_receipt-only source must never blank out requesterName via an empty parties group", () => {
  const completedReceipt = {
    documentKind: "substitute_receipt",
    documentNo: "SR-2026-09-0001",
    status: "approved",
    receiptType: "general_expense",
    payeeName: "ร้านค้า ก",
    businessPurpose: "ค่าใช้จ่ายทดสอบ",
    lines: [{ description: "รายการ", quantity: "1", unitCost: "100.00", lineTotal: "100.00" }],
  };

  const { context, sources } = workflowPrefillLogic.buildWorkflowPrefillContext([completedReceipt], "payment_voucher");

  // substitute_receipt never emits parties, so it must come back empty, not
  // as a false-truthy {} that the appliers below would treat as real data.
  assert.deepEqual(context.parties, {});
  assert.equal(sources.parties, undefined, "no source ever supplied parties, so sources.parties must stay unset");

  const pvPatch = workflowPrefillLogic.applyWorkflowPrefillGroups(context, "payment_voucher", ["payee"]);
  assert.equal(pvPatch.payeeName, "ร้านค้า ก");
  assert.equal("requesterName" in pvPatch, false, "an empty parties group must never add a requesterName key to the patch at all");

  const erPatch = workflowPrefillLogic.applyWorkflowPrefillGroups(context, "expense_request", ["payee"]);
  assert.equal(erPatch.paymentTargetName, "ร้านค้า ก");
  assert.equal("requesterName" in erPatch, false, "expense_request must not have its requesterName/requesterRole blanked by an empty parties group");
  assert.equal("requesterRole" in erPatch, false);
});

test("buildWorkflowPrefillContext groups never carry excluded fields like documentNo, status, or signatures", () => {
  const source = {
    documentKind: "expense_request",
    requestNo: "REQ-2026-09-0001",
    documentDate: "2026-09-01",
    status: "completed",
    statusHistory: [{ status: "completed" }],
    completedAt: "2026-09-05T10:00:00.000Z",
    completedBy: "บัญชี",
    signature: "base64...",
    evidenceFiles: { receipt: [{ name: "a.jpg" }] },
    rawFiles: [{ name: "a.jpg" }],
    workflowStepId: "step-001",
    transactionNo: "TXN-2026-09-0001",
    requestTitle: "เบิกค่าส่ง",
    businessPurpose: "ค่าส่งสินค้า",
    paymentTargetName: "คุณต้า",
    paymentBankName: "SCB",
    paymentAccountNo: "1234567890",
    requesterName: "คุณต้า",
    requesterRole: "ผู้จัดการ",
    expenseLines: [
      { description: "เบิกค่าส่ง", amountBeforeVat: "100.00", vatAmount: "7.00", withholdingTax: "0.00", vendorInvoiceNo: "INV-001" },
    ],
  };

  const { context } = workflowPrefillLogic.buildWorkflowPrefillContext([source], "expense_request");

  assert.deepEqual(Object.keys(context.payee).sort(), ["accountNo", "bankName", "name"]);
  assert.deepEqual(Object.keys(context.purpose).sort(), ["businessPurpose", "title"]);
  assert.equal(context.payee.documentNo, undefined);
  assert.equal(context.purpose.status, undefined);
  // The canonical line shape has no room for vatAmount/withholdingTax or any
  // extra per-line field the source document happened to carry (e.g.
  // vendorInvoiceNo).
  assert.deepEqual(Object.keys(context.lines[0]).sort(), ["description", "lineTotal", "quantity", "stockSkuId", "unitCost"]);
});

test("RECEIVABLE_PREFILL_GROUPS: every kind can receive payee, purpose, and lines; totals is not a group at all (D10)", () => {
  for (const kind of Object.keys(workflowPrefillLogic.RECEIVABLE_PREFILL_GROUPS)) {
    assert.deepEqual(workflowPrefillLogic.RECEIVABLE_PREFILL_GROUPS[kind].slice().sort(), ["lines", "payee", "purpose"]);
  }
  assert.deepEqual(workflowPrefillLogic.PREFILL_GROUPS.slice().sort(), ["lines", "payee", "purpose"]);
});

// ---------------------------------------------------------------------------
// Same class as the "นำมาจาก undefined" bug (an always-truthy empty group
// blanking fields and rendering a badge with no real source): here the
// *group* is genuinely non-empty (expense_request really does supply a
// payee name), but one field within it -- payeeTaxId -- has no source at
// all, because expense_request has no tax-ID field to give. The applier
// must never manufacture "" for a field the source never supplied; it must
// leave that key out of the patch entirely so the shared banner's existing
// `patch[fieldName] === undefined` guard skips both the value write and the
// badge. Otherwise the field renders blank *with* a "นำมาจาก ..." badge
// claiming a value was carried over.
// ---------------------------------------------------------------------------

test("applyWorkflowContextToSubstituteReceipt must not manufacture an empty payeeTaxId when the source (expense_request) never supplied one", () => {
  // expense_request's payee context only ever has `name` -- see
  // expenseRequestToWorkflowContext, which reads paymentTargetName into
  // `name` and has no taxId source field at all.
  const context = { payee: { name: "คุณต้า" } };
  const patch = workflowPrefillLogic.applyWorkflowContextToSubstituteReceipt(context, ["payee"]);

  assert.equal(patch.payeeName, "คุณต้า");
  assert.equal("payeeTaxId" in patch, false, "payeeTaxId must be absent from the patch, not an empty string, when the source never supplied it");
});

test("applyWorkflowContextToSubstituteReceipt still applies payeeTaxId when the source genuinely supplies it", () => {
  const context = { payee: { name: "ร้านค้า A", taxId: "1234567890123" } };
  const patch = workflowPrefillLogic.applyWorkflowContextToSubstituteReceipt(context, ["payee"]);

  assert.equal(patch.payeeName, "ร้านค้า A");
  assert.equal(patch.payeeTaxId, "1234567890123");
});

test("applyWorkflowContextToSubstituteReceipt must not manufacture an empty receiptTitle/businessPurpose when the source only supplied one of the two", () => {
  const titleOnly = workflowPrefillLogic.applyWorkflowContextToSubstituteReceipt({ purpose: { title: "หัวข้อ" } }, ["purpose"]);
  assert.equal(titleOnly.receiptTitle, "หัวข้อ");
  assert.equal("businessPurpose" in titleOnly, false);

  const purposeOnly = workflowPrefillLogic.applyWorkflowContextToSubstituteReceipt({ purpose: { businessPurpose: "วัตถุประสงค์" } }, ["purpose"]);
  assert.equal("receiptTitle" in purposeOnly, false);
  assert.equal(purposeOnly.businessPurpose, "วัตถุประสงค์");
});

test("applyWorkflowContextToExpenseRequest must not manufacture empty paymentBankName/paymentAccountNo when the source (substitute_receipt) never supplies them", () => {
  // substitute_receipt's payee context only ever has `name`/`taxId` -- see
  // substituteReceiptToWorkflowContext -- so bankName/accountNo are never
  // present when the source is a substitute_receipt.
  const context = { payee: { name: "ร้านค้า A", taxId: "1234567890123" } };
  const patch = workflowPrefillLogic.applyWorkflowContextToExpenseRequest(context, ["payee"]);

  assert.equal(patch.paymentTargetName, "ร้านค้า A");
  assert.equal("paymentBankName" in patch, false);
  assert.equal("paymentAccountNo" in patch, false);
});

test("applyWorkflowContextToExpenseRequest must not manufacture an empty requestTitle/businessPurpose when the source only supplied one of the two", () => {
  const titleOnly = workflowPrefillLogic.applyWorkflowContextToExpenseRequest({ purpose: { title: "หัวข้อ" } }, ["purpose"]);
  assert.equal(titleOnly.requestTitle, "หัวข้อ");
  assert.equal("businessPurpose" in titleOnly, false);
});

test("applyWorkflowContextToExpenseRequest must not manufacture an empty requesterRole when the source parties group only supplied requesterName", () => {
  const patch = workflowPrefillLogic.applyWorkflowContextToExpenseRequest({ parties: { requesterName: "คุณต้า" } }, []);
  assert.equal(patch.requesterName, "คุณต้า");
  assert.equal("requesterRole" in patch, false);
});

test("the shared workflow-document shell applier (exercised here via applyWorkflowContextToPurchaseOrder, one of its five aliases) must not manufacture an empty title/businessPurpose when the source only supplied one of the two", () => {
  const businessPurposeOnly = workflowPrefillLogic.applyWorkflowContextToPurchaseOrder({ purpose: { businessPurpose: "วัตถุประสงค์" } }, ["purpose"]);
  assert.equal("title" in businessPurposeOnly, false);
  assert.equal(businessPurposeOnly.businessPurpose, "วัตถุประสงค์");

  const titleOnly = workflowPrefillLogic.applyWorkflowContextToPurchaseOrder({ purpose: { title: "ชื่อเอกสาร" } }, ["purpose"]);
  assert.equal(titleOnly.title, "ชื่อเอกสาร");
  assert.equal("businessPurpose" in titleOnly, false);
});

// ---------------------------------------------------------------------------
// Exhaustive per-kind x per-direction x per-group matrix. Task 6's own review
// notes call out a prior six-entry seed table where five of six entries were
// silently wrong because only one was asserted — this exercises every one of
// the seven kinds x two directions x three groups combinations that exists,
// rather than trusting the shared-shell tests above to stand in for all five
// generic kinds identically forever.
// ---------------------------------------------------------------------------

const ALL_KINDS = [
  "expense_request",
  "substitute_receipt",
  "purchase_order",
  "payment_voucher",
  "cash_spend_declaration",
  "payee_acknowledgement",
  "goods_receipt",
];

test("WORKFLOW_CONTEXT_ADAPTERS registers a distinct toWorkflowContext/applyWorkflowContext pair for every one of the seven kinds", () => {
  assert.deepEqual(Object.keys(workflowPrefillLogic.WORKFLOW_CONTEXT_ADAPTERS).sort(), [...ALL_KINDS].sort());
  for (const kind of ALL_KINDS) {
    const adapter = workflowPrefillLogic.WORKFLOW_CONTEXT_ADAPTERS[kind];
    assert.equal(typeof adapter.toWorkflowContext, "function", `${kind} must have a toWorkflowContext`);
    assert.equal(typeof adapter.applyWorkflowContext, "function", `${kind} must have an applyWorkflowContext`);
  }
});

function samplePayloadFor(kind) {
  switch (kind) {
    case "expense_request":
      return {
        requestTitle: "เบิกค่าส่ง",
        businessPurpose: "ค่าส่งสินค้า",
        paymentTargetName: "คุณต้า",
        paymentBankName: "SCB",
        paymentAccountNo: "1112223334",
        requesterName: "คุณต้า",
        requesterRole: "ผู้จัดการ",
        expenseLines: [{ description: "ค่าขนส่ง", amountBeforeVat: "100.00", vatAmount: "0.00", withholdingTax: "0.00" }],
      };
    case "substitute_receipt":
      return {
        receiptTitle: "ใบรับรองแทนใบเสร็จ",
        businessPurpose: "ซื้อวัสดุ",
        payeeName: "ร้านค้า A",
        payeeTaxId: "1234567890123",
        lines: [{ description: "กระดาษ", quantity: "5", unitCost: "20.00", lineTotal: "100.00", stockSkuId: "SKU-100" }],
      };
    default:
      return {
        title: "เอกสารตัวอย่าง",
        businessPurpose: "วัตถุประสงค์ตัวอย่าง",
        payeeName: "ผู้รับเงินตัวอย่าง",
        requesterName: "คุณต้า",
        lines: [{ description: "รายการตัวอย่าง", quantity: "2", unitCost: "50.00", lineTotal: "100.00", stockSkuId: "SKU-9" }],
      };
  }
}

for (const kind of ALL_KINDS) {
  test(`${kind}: toWorkflowContext sources exactly the payee/purpose/lines groups the field table promises, and nothing else`, () => {
    const context = workflowPrefillLogic.WORKFLOW_CONTEXT_ADAPTERS[kind].toWorkflowContext(samplePayloadFor(kind));

    // Every one of the seven kinds can source all three groups from a
    // sufficiently populated payload (D10 removed every prior exclusion).
    assert.ok(context.payee, `${kind} must be able to source payee`);
    assert.ok(context.purpose, `${kind} must be able to source purpose`);
    assert.ok(Array.isArray(context.lines) && context.lines.length > 0, `${kind} must be able to source lines`);
    for (const line of context.lines) {
      assert.deepEqual(Object.keys(line).sort(), ["description", "lineTotal", "quantity", "stockSkuId", "unitCost"]);
    }

    if (kind === "expense_request" || kind === "purchase_order" || kind === "payment_voucher"
      || kind === "cash_spend_declaration" || kind === "payee_acknowledgement" || kind === "goods_receipt") {
      assert.ok(context.parties, `${kind} must be able to source parties (has a requesterName field)`);
    } else {
      // substitute_receipt has no requester field on the document at all.
      assert.equal(context.parties, undefined, `${kind} must never source parties (no requester field)`);
    }
  });

  test(`${kind}: applyWorkflowContext receives exactly payee/purpose/lines when all three are ticked`, () => {
    const sourceContext = workflowPrefillLogic.WORKFLOW_CONTEXT_ADAPTERS[kind].toWorkflowContext(samplePayloadFor(kind));
    const patch = workflowPrefillLogic.applyWorkflowPrefillGroups(sourceContext, kind, ["payee", "purpose", "lines"]);

    if (kind === "expense_request") {
      assert.equal(patch.paymentTargetName, "คุณต้า");
      assert.equal(patch.requestTitle, "เบิกค่าส่ง");
      assert.ok(Array.isArray(patch.expenseLines) && patch.expenseLines.length === 1);
      assert.deepEqual(Object.keys(patch.expenseLines[0]).sort(), ["amountBeforeVat", "description", "vatAmount", "withholdingTax"]);
    } else if (kind === "substitute_receipt") {
      assert.equal(patch.payeeName, "ร้านค้า A");
      assert.equal(patch.payeeTaxId, "1234567890123");
      assert.equal(patch.receiptTitle, "ใบรับรองแทนใบเสร็จ");
      assert.ok(Array.isArray(patch.lines) && patch.lines.length === 1);
      assert.equal(patch.lines[0].quantity, "5", `${kind} must not clear quantity — only goods_receipt does`);
      assert.equal(patch.requesterName, undefined, `${kind} has no requester field to apply parties onto`);
    } else {
      assert.equal(patch.payeeName, "ผู้รับเงินตัวอย่าง");
      assert.equal(patch.title, "เอกสารตัวอย่าง");
      assert.equal(patch.requesterName, "คุณต้า");
      assert.ok(Array.isArray(patch.lines) && patch.lines.length === 1);
      if (kind === "goods_receipt") {
        assert.equal(patch.lines[0].quantity, "", "goods_receipt must always clear quantity");
        assert.equal(patch.lines[0].description, "รายการตัวอย่าง");
        assert.equal(patch.lines[0].stockSkuId, "SKU-9");
      } else {
        assert.equal(patch.lines[0].quantity, "2", `${kind} must not clear quantity — only goods_receipt does`);
      }
    }
  });

  test(`${kind}: applyWorkflowContext applies nothing from an unticked group`, () => {
    const sourceContext = workflowPrefillLogic.WORKFLOW_CONTEXT_ADAPTERS[kind].toWorkflowContext(samplePayloadFor(kind));
    const patch = workflowPrefillLogic.applyWorkflowPrefillGroups(sourceContext, kind, []);

    if (kind === "expense_request") {
      assert.equal(patch.paymentTargetName, undefined);
      assert.equal(patch.requestTitle, undefined);
      assert.equal(patch.expenseLines, undefined);
    } else if (kind === "substitute_receipt") {
      assert.equal(patch.payeeName, undefined);
      assert.equal(patch.receiptTitle, undefined);
      assert.equal(patch.lines, undefined);
    } else {
      assert.equal(patch.payeeName, undefined);
      assert.equal(patch.title, undefined);
      assert.equal(patch.lines, undefined);
    }
    // parties is never user-tickable and always rides along, even with no
    // groups ticked, for every kind that has a requester field to apply it to.
    if (kind === "substitute_receipt") {
      assert.equal(patch.requesterName, undefined);
    } else {
      assert.equal(patch.requesterName, "คุณต้า");
    }
  });

  test(`${kind}: RECEIVABLE_PREFILL_GROUPS declares payee, purpose, and lines all receivable`, () => {
    assert.deepEqual(workflowPrefillLogic.RECEIVABLE_PREFILL_GROUPS[kind].slice().sort(), ["lines", "payee", "purpose"]);
  });
}

// ---------------------------------------------------------------------------
// Browser-load smoke test. Task 6's own review notes flagged a sibling module
// with a top-level `require()` that only broke in a real (or vm-sandboxed)
// browser tab — every existing test there string-matched source text and
// stayed green. This actually executes forms/workflow-prefill.logic.js as a
// classic script with a `window` global and no `require`/`module`.
// ---------------------------------------------------------------------------

function runAsClassicScriptInBrowserSandbox(source, extraGlobals = {}) {
  const context = vm.createContext({ window: {}, ...extraGlobals });
  vm.runInContext(source, context);
  return context.window;
}

test("workflow-prefill.logic.js runs as a classic script in a require-less browser sandbox and populates window.WorkflowPrefillLogic", async () => {
  const source = await readFile(workflowPrefillLogicPath, "utf8");
  const window = runAsClassicScriptInBrowserSandbox(source);

  const exported = window.WorkflowPrefillLogic;
  assert.ok(exported, "window.WorkflowPrefillLogic must be populated");
  assert.deepEqual([...exported.PREFILL_GROUPS].sort(), ["lines", "payee", "purpose"]);
  assert.equal(typeof exported.buildWorkflowPrefillContext, "function");
  assert.equal(typeof exported.applyWorkflowPrefillGroups, "function");
  assert.equal(typeof exported.expenseRequestToWorkflowContext, "function");
  assert.equal(typeof exported.applyWorkflowContextToGoodsReceipt, "function");
});

test("workflow-prefill.logic.js resolves normalizeDocumentWorkflowStatus through window.WorkflowLogic when loaded in real page order", async () => {
  const context = vm.createContext({ window: {} });
  vm.runInContext(await readFile(workflowLogicPath, "utf8"), context);
  vm.runInContext(await readFile(workflowPrefillLogicPath, "utf8"), context);

  const po = {
    documentKind: "purchase_order",
    documentNo: "PO-2026-09-0001",
    status: "completed",
    completedAt: "2026-09-01T08:00:00.000Z",
    payeeName: "ร้านค้า A",
    title: "สั่งซื้อวัสดุ",
    businessPurpose: "ซื้อวัสดุสำนักงาน",
    lines: [{ description: "กระดาษ", quantity: "10", unitCost: "100.00", lineTotal: "1000.00" }],
  };

  const { context: prefillContext, sources } = context.window.WorkflowPrefillLogic.buildWorkflowPrefillContext([po], "payment_voucher");

  assert.equal(prefillContext.payee.name, "ร้านค้า A");
  assert.equal(sources.payee, "PO-2026-09-0001");
});
