// Concurrent-allocation coverage for every document kind's real create path,
// plus the write-through consistency checks named in the task: the
// `documents` index table must agree with disk after a create, an update,
// and a completion. A previous task on this branch shipped a six-entry table
// with one entry asserted and five silently wrong — so every one of the
// seven document kinds and workflow transactions gets its own concurrency
// test here rather than one "representative" case standing in for the rest.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import serverLogic from "../forms/local-server.logic.js";
import workflowDocumentLogic from "../forms/workflow-document.logic.js";
import documentIndex from "../forms/document-index.logic.js";

const {
  saveExpenseSubmission,
  saveSubstituteReceiptSubmission,
  getSubmittedExpenseRequest,
  getSubmittedSubstituteReceipt,
  getWorkflowDocument,
  getNextWorkflowDocumentInfo,
  saveWorkflowDocument,
  completeWorkflowDocument,
  approveExpenseRequest,
  startWorkflowTransaction,
  getWorkflowTransaction,
} = serverLogic;
const { buildWorkflowDocumentPayload } = workflowDocumentLogic;
const { withDocumentIndexDatabase } = documentIndex;

async function withTempRoot(callback) {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-document-numbering-"));
  try {
    await callback(rootDir);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
}

function validExpensePayload(overrides = {}) {
  return {
    accountingMonth: "2026-09",
    requestTitle: "ค่าส่งพัสดุ",
    requestType: "reimbursement",
    requesterName: "คุณต้า",
    businessPurpose: "เบิกค่าใช้จ่าย",
    paymentTargetName: "คุณต้า",
    expenseLines: [
      {
        date: "2026-09-05",
        category: "ค่าส่ง/ขนส่ง",
        description: "ค่าส่งสินค้า",
        vendor: "ขนส่งตัวอย่าง",
        amountBeforeVat: "100",
        vatAmount: "7",
        withholdingTax: "0",
      },
    ],
    ...overrides,
  };
}

function validSubstituteReceiptPayload(overrides = {}) {
  return {
    accountingMonth: "2026-09",
    receiptDate: "2026-09-04",
    receiptTitle: "ค่าใช้จ่ายทั่วไป",
    receiptType: "general_expense",
    payeeName: "บริษัทขายส่งตัวอย่าง",
    paymentChannel: "โอนผ่านบัญชีบริษัท",
    businessPurpose: "ค่าใช้จ่ายทั่วไป",
    lines: [{ description: "ค่าส่งสินค้า", quantity: "1", unitCost: "85" }],
    ...overrides,
  };
}

function validSlipUpload() {
  return [{ evidenceKey: "paymentSlip", originalName: "slip.jpg", type: "image/jpeg", buffer: Buffer.from("slip") }];
}

async function createLightweightDocument(rootDir, documentKind, title) {
  const { documentNo } = await getNextWorkflowDocumentInfo(rootDir, documentKind, "2026-09");
  const payload = buildWorkflowDocumentPayload({
    documentKind,
    documentNo,
    accountingMonth: "2026-09",
    documentDate: "2026-09-06",
    title,
    businessPurpose: "ทดสอบการออกเลขที่พร้อมกัน",
    lines: [{ description: "รายการทดสอบ", quantity: "1", unitCost: "10" }],
  });
  return saveWorkflowDocument({ rootDir, payload });
}

async function readDocumentIndexRows(rootDir, documentKind) {
  return withDocumentIndexDatabase(rootDir, (db) => (
    db.prepare("SELECT * FROM documents WHERE document_kind = ? ORDER BY document_no").all(documentKind).map((row) => ({ ...row }))
  ));
}

test("concurrent expense_request submissions in the same month get distinct request numbers", async () => {
  await withTempRoot(async (rootDir) => {
    const [first, second] = await Promise.all([
      saveExpenseSubmission({ rootDir, payload: validExpensePayload({ requestTitle: "คำขอที่หนึ่ง" }) }),
      saveExpenseSubmission({ rootDir, payload: validExpensePayload({ requestTitle: "คำขอที่สอง" }) }),
    ]);

    assert.notEqual(first.requestNo, second.requestNo);

    const [reloadedFirst, reloadedSecond] = await Promise.all([
      getSubmittedExpenseRequest(rootDir, first.requestNo),
      getSubmittedExpenseRequest(rootDir, second.requestNo),
    ]);
    assert.ok(reloadedFirst, "first request must be independently retrievable");
    assert.ok(reloadedSecond, "second request must be independently retrievable");

    const rows = await readDocumentIndexRows(rootDir, "expense_request");
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map((row) => row.document_no).sort(), [first.requestNo, second.requestNo].sort());
  });
});

test("concurrent substitute_receipt submissions in the same month get distinct receipt numbers", async () => {
  await withTempRoot(async (rootDir) => {
    const [first, second] = await Promise.all([
      saveSubstituteReceiptSubmission({
        rootDir,
        payload: validSubstituteReceiptPayload({ receiptTitle: "ใบที่หนึ่ง" }),
        uploads: validSlipUpload(),
      }),
      saveSubstituteReceiptSubmission({
        rootDir,
        payload: validSubstituteReceiptPayload({ receiptTitle: "ใบที่สอง" }),
        uploads: validSlipUpload(),
      }),
    ]);

    assert.notEqual(first.receiptNo, second.receiptNo);

    const [reloadedFirst, reloadedSecond] = await Promise.all([
      getSubmittedSubstituteReceipt(rootDir, first.receiptNo),
      getSubmittedSubstituteReceipt(rootDir, second.receiptNo),
    ]);
    assert.ok(reloadedFirst, "first receipt must be independently retrievable");
    assert.ok(reloadedSecond, "second receipt must be independently retrievable");

    const rows = await readDocumentIndexRows(rootDir, "substitute_receipt");
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map((row) => row.document_no).sort(), [first.receiptNo, second.receiptNo].sort());
  });
});

test("concurrent workflow_transaction starts in the same month get distinct transaction numbers", async () => {
  await withTempRoot(async (rootDir) => {
    const [first, second] = await Promise.all([
      startWorkflowTransaction({
        rootDir,
        templateId: "stock_no_tax_invoice_company_bank",
        accountingMonth: "2026-09",
        title: "ธุรกรรมที่หนึ่ง",
      }),
      startWorkflowTransaction({
        rootDir,
        templateId: "stock_no_tax_invoice_company_bank",
        accountingMonth: "2026-09",
        title: "ธุรกรรมที่สอง",
      }),
    ]);

    assert.notEqual(first.transactionNo, second.transactionNo);

    const [reloadedFirst, reloadedSecond] = await Promise.all([
      getWorkflowTransaction(rootDir, first.transactionNo),
      getWorkflowTransaction(rootDir, second.transactionNo),
    ]);
    assert.ok(reloadedFirst);
    assert.ok(reloadedSecond);

    const rows = await readDocumentIndexRows(rootDir, "workflow_transaction");
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map((row) => row.document_no).sort(), [first.transactionNo, second.transactionNo].sort());
  });
});

const LIGHTWEIGHT_DOCUMENT_KINDS = [
  "purchase_order",
  "payment_voucher",
  "cash_spend_declaration",
  "payee_acknowledgement",
  "goods_receipt",
];

for (const documentKind of LIGHTWEIGHT_DOCUMENT_KINDS) {
  test(`concurrent ${documentKind} creations in the same month get distinct document numbers`, async () => {
    await withTempRoot(async (rootDir) => {
      const [first, second] = await Promise.all([
        createLightweightDocument(rootDir, documentKind, `${documentKind} หนึ่ง`),
        createLightweightDocument(rootDir, documentKind, `${documentKind} สอง`),
      ]);

      assert.notEqual(first.documentNo, second.documentNo);

      const [reloadedFirst, reloadedSecond] = await Promise.all([
        getWorkflowDocument(rootDir, documentKind, first.documentNo),
        getWorkflowDocument(rootDir, documentKind, second.documentNo),
      ]);
      assert.ok(reloadedFirst, `${documentKind} first document must be independently retrievable`);
      assert.ok(reloadedSecond, `${documentKind} second document must be independently retrievable`);

      const rows = await readDocumentIndexRows(rootDir, documentKind);
      assert.equal(rows.length, 2);
      assert.deepEqual(rows.map((row) => row.document_no).sort(), [first.documentNo, second.documentNo].sort());
    });
  });
}

test("the documents index agrees with disk after a create", async () => {
  await withTempRoot(async (rootDir) => {
    const submitted = await saveExpenseSubmission({ rootDir, payload: validExpensePayload() });
    const rows = await readDocumentIndexRows(rootDir, "expense_request");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].document_no, submitted.requestNo);
    assert.equal(rows[0].status, "submitted");
    assert.equal(rows[0].folder_path, submitted.folderPath);
    assert.equal(rows[0].accounting_month, "2026-09");
  });
});

test("the documents index agrees with disk after an update (edit before approval)", async () => {
  await withTempRoot(async (rootDir) => {
    const submitted = await saveExpenseSubmission({ rootDir, payload: validExpensePayload() });
    await saveExpenseSubmission({
      rootDir,
      payload: { ...validExpensePayload(), requestNo: submitted.requestNo, requestTitle: "ชื่อใหม่หลังแก้ไข" },
    });

    const rows = await readDocumentIndexRows(rootDir, "expense_request");
    assert.equal(rows.length, 1, "editing must update the same row, not create a second one");
    assert.equal(rows[0].document_no, submitted.requestNo);
  });
});

test("the documents index agrees with disk after a completion", async () => {
  await withTempRoot(async (rootDir) => {
    const submitted = await saveExpenseSubmission({ rootDir, payload: validExpensePayload() });
    await approveExpenseRequest({ rootDir, requestNo: submitted.requestNo, approvedBy: "บัญชี" });

    const rows = await readDocumentIndexRows(rootDir, "expense_request");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, "approved");
  });
});

test("the documents index agrees with disk after a lightweight document is completed", async () => {
  await withTempRoot(async (rootDir) => {
    const created = await createLightweightDocument(rootDir, "purchase_order", "สั่งซื้อทดสอบ");
    await completeWorkflowDocument({ rootDir, documentKind: "purchase_order", documentNo: created.documentNo, completedBy: "บัญชี" });

    const rows = await readDocumentIndexRows(rootDir, "purchase_order");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, "completed");
    assert.equal(rows[0].document_no, created.documentNo);
  });
});

test("a save refused by the completed-document guard leaves no trace in the documents index", async () => {
  await withTempRoot(async (rootDir) => {
    const created = await createLightweightDocument(rootDir, "purchase_order", "สั่งซื้อทดสอบ");
    await completeWorkflowDocument({ rootDir, documentKind: "purchase_order", documentNo: created.documentNo, completedBy: "บัญชี" });

    const beforeRows = await readDocumentIndexRows(rootDir, "purchase_order");
    assert.equal(beforeRows.length, 1);
    assert.equal(beforeRows[0].status, "completed");

    // saveWorkflowDocument's assertNotCompletedOnDisk guard refuses this
    // before any file is touched (see forms/local-server.logic.js) — the
    // write-through call in writeWorkflowDocumentFiles is never reached, so
    // the index must come out of this attempt completely unchanged: no new
    // row, no status reverted back to whatever this stale edit carried.
    const record = await getWorkflowDocument(rootDir, "purchase_order", created.documentNo);
    const stalePayload = buildWorkflowDocumentPayload({
      documentKind: "purchase_order",
      documentNo: record.documentNo,
      folderPath: record.folderPath,
      accountingMonth: "2026-09",
      documentDate: "2026-09-06",
      title: "พยายามแก้ไขหลังเสร็จสิ้น",
      businessPurpose: "ทดสอบ",
      lines: [{ description: "รายการแก้ไข", quantity: "9", unitCost: "999" }],
      status: record.status,
      statusHistory: record.payload.statusHistory,
      completedAt: record.payload.completedAt,
      completedBy: record.payload.completedBy,
      createdAt: record.payload.createdAt,
    });

    await assert.rejects(
      () => saveWorkflowDocument({ rootDir, payload: stalePayload }),
      /ไม่สามารถแก้ไขเอกสารที่เสร็จสิ้นแล้วได้/,
    );

    const afterRows = await readDocumentIndexRows(rootDir, "purchase_order");
    assert.deepEqual(afterRows, beforeRows, "a refused write must leave the index exactly as it was");
  });
});
