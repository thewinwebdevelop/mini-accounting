import assert from "node:assert/strict";
import { mkdtemp, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import serverLogic from "../forms/local-server.logic.js";
import documentIndex from "../forms/document-index.logic.js";
import workflowDocumentLogic from "../forms/workflow-document.logic.js";

const {
  saveExpenseSubmission,
  approveExpenseRequest,
  completeExpenseRequest,
  saveSubstituteReceiptSubmission,
  approveSubstituteReceipt,
  completeSubstituteReceipt,
  startWorkflowTransaction,
  saveWorkflowDocument,
  completeWorkflowDocument,
  refreshWorkflowTransaction,
  completeWorkflowTransaction,
  getSubmittedExpenseRequest,
  getSubmittedSubstituteReceipt,
  getWorkflowDocument,
  getWorkflowTransaction,
} = serverLogic;

const {
  withDocumentIndexDatabase,
  queryDocumentIndexRows,
  rebuildDocumentIndex,
} = documentIndex;

const { buildWorkflowDocumentPayload } = workflowDocumentLogic;

async function withTempRoot(callback) {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-index-consistency-"));
  try {
    await callback(rootDir);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
}

// Read the full `documents` table exactly as queryDocumentIndexRows shapes
// it, normalized into a stable, comparable form (sorted by kind+number, with
// no id/sequence columns -- sequence is redundant with document_no and adds
// nothing a real drift bug would show up in).
function snapshotDocumentsTable(db) {
  return queryDocumentIndexRows(db, {})
    .map(({ documentKind, documentNo, accountingMonth, status, folderPath, transactionNo, workflowTemplateId, workflowStepId, createdAt, updatedAt }) => ({
      documentKind, documentNo, accountingMonth, status, folderPath, transactionNo, workflowTemplateId, workflowStepId, createdAt, updatedAt,
    }))
    .sort((a, b) => `${a.documentKind}:${a.documentNo}`.localeCompare(`${b.documentKind}:${b.documentNo}`));
}

// This is the proof the task asks for: now that every read path (list pages,
// point lookups, the workflow-transaction detail/refresh/complete/prefill
// routes) trusts the documents index instead of walking disk on every call,
// the suite no longer gets that guarantee "for free" the way it used to
// (reads walking disk while writes updated the index, so any divergence
// between the two would have shown up as a failing assertion on real data
// somewhere in the suite). This test restores that guarantee directly: run a
// representative set of real operations across every document kind and every
// write path (submit/approve/complete for expense_request and
// substitute_receipt, save/complete for a lightweight workflow document,
// start/refresh/complete for a workflow transaction), then assert the
// write-through `documents` table already holds exactly what a full,
// independent rebuild from disk (rebuildDocumentIndex) would produce.
test("the write-through documents index matches a full from-disk rebuild after a representative set of operations", async () => {
  await withTempRoot(async (rootDir) => {
    const txn = await startWorkflowTransaction({
      rootDir,
      templateId: "director_expense_transfer",
      accountingMonth: "2026-09",
      title: "ทดสอบความสอดคล้องของดัชนี",
    });

    const expense = await saveExpenseSubmission({
      rootDir,
      payload: {
        accountingMonth: "2026-09",
        requestTitle: "เบิกค่าส่งเจ้าของ",
        requestType: "reimbursement",
        requesterName: "เจ้าของ",
        businessPurpose: "เบิกค่าส่ง",
        paymentTargetName: "เจ้าของ",
        transactionNo: txn.transactionNo,
        workflowTemplateId: txn.workflowTemplateId,
        workflowStepId: txn.steps[0].stepId,
        expenseLines: [{
          date: "2026-09-05",
          category: "ค่าส่ง/ขนส่ง",
          description: "ค่าส่งสินค้า",
          vendor: "ขนส่งตัวอย่าง",
          amountBeforeVat: "100",
          vatAmount: "7",
          withholdingTax: "0",
        }],
      },
    });
    await approveExpenseRequest({ rootDir, requestNo: expense.requestNo, approvedBy: "เจ้าของ" });
    await completeExpenseRequest({ rootDir, requestNo: expense.requestNo, completedBy: "บัญชี" });

    const receipt = await saveSubstituteReceiptSubmission({
      rootDir,
      payload: {
        accountingMonth: "2026-09",
        receiptDate: "2026-09-05",
        receiptTitle: "ใบรับรองแทนใบเสร็จค่าส่ง",
        receiptType: "general_expense",
        payeeName: "ขนส่งตัวอย่าง",
        businessPurpose: "ค่าส่ง",
        transactionNo: txn.transactionNo,
        workflowTemplateId: txn.workflowTemplateId,
        workflowStepId: txn.steps[1].stepId,
        lines: [{ description: "ค่าส่งสินค้า", quantity: "1", unitCost: "107" }],
      },
      uploads: [{
        evidenceKey: "paymentSlip",
        originalName: "slip.txt",
        type: "text/plain",
        buffer: Buffer.from("slip"),
      }],
    });
    await approveSubstituteReceipt({ rootDir, receiptNo: receipt.receiptNo, approvedBy: "บัญชี" });
    await completeSubstituteReceipt({ rootDir, receiptNo: receipt.receiptNo, completedBy: "บัญชี" });

    const voucher = await saveWorkflowDocument({
      rootDir,
      payload: buildWorkflowDocumentPayload({
        documentKind: "payment_voucher",
        sequence: "1",
        accountingMonth: "2026-09",
        documentDate: "2026-09-06",
        title: "จ่ายค่าส่ง",
        businessPurpose: "จ่ายเงิน",
        lines: [{ description: "ค่าส่ง", quantity: "1", unitCost: "107" }],
        transactionNo: txn.transactionNo,
        workflowTemplateId: txn.workflowTemplateId,
        workflowStepId: txn.steps[2].stepId,
      }),
      uploads: [],
    });
    await completeWorkflowDocument({ rootDir, documentKind: "payment_voucher", documentNo: voucher.documentNo, completedBy: "บัญชี" });

    await refreshWorkflowTransaction({ rootDir, transactionNo: txn.transactionNo, regeneratePacket: false });
    await completeWorkflowTransaction({ rootDir, transactionNo: txn.transactionNo, completedBy: "บัญชี" });

    // A second, independent standalone expense request outside any
    // transaction -- the index must cover both workflow and non-workflow
    // documents alike.
    const standaloneExpense = await saveExpenseSubmission({
      rootDir,
      payload: {
        accountingMonth: "2026-10",
        requestTitle: "ค่าน้ำเดือนตุลาคม",
        requestType: "reimbursement",
        requesterName: "คุณทดสอบ",
        expenseLines: [],
      },
    });

    // Sanity: everything above really did land on disk and in the index
    // through the ordinary read paths, before comparing table snapshots.
    assert.ok(await getSubmittedExpenseRequest(rootDir, expense.requestNo));
    assert.ok(await getSubmittedExpenseRequest(rootDir, standaloneExpense.requestNo));
    assert.ok(await getSubmittedSubstituteReceipt(rootDir, receipt.receiptNo));
    assert.ok(await getWorkflowDocument(rootDir, "payment_voucher", voucher.documentNo));
    assert.ok(await getWorkflowTransaction(rootDir, txn.transactionNo));

    const beforeRebuild = withDocumentIndexDatabase(rootDir, (db) => snapshotDocumentsTable(db));
    assert.equal(beforeRebuild.length, 5, "expense request x2, substitute receipt, payment voucher, workflow transaction");

    await rebuildDocumentIndex(rootDir);
    const afterRebuild = withDocumentIndexDatabase(rootDir, (db) => snapshotDocumentsTable(db));

    assert.deepEqual(
      beforeRebuild,
      afterRebuild,
      "the index every write path already maintains must describe exactly the same documents, in the same state, as an independent rebuild from disk",
    );
  });
});

// The other half of "disk stays the source of truth": if the two ever DO
// disagree (a manual disk edit, a partial migration, a bug), the rebuild
// script must be able to reconcile them -- proven here by deliberately
// corrupting the live index (delete a document's row, and separately, change
// another document's indexed status without touching its file) and checking
// that rebuildDocumentIndex repairs both.
test("rebuildDocumentIndex repairs a deliberately corrupted index back to matching disk", async () => {
  await withTempRoot(async (rootDir) => {
    const first = await saveExpenseSubmission({
      rootDir,
      payload: {
        accountingMonth: "2026-09",
        requestTitle: "ทดสอบซ่อมดัชนี 1",
        requestType: "reimbursement",
        requesterName: "คุณทดสอบ",
        expenseLines: [],
      },
    });
    const second = await saveExpenseSubmission({
      rootDir,
      payload: {
        accountingMonth: "2026-09",
        requestTitle: "ทดสอบซ่อมดัชนี 2",
        requestType: "reimbursement",
        requesterName: "คุณทดสอบ",
        expenseLines: [],
      },
    });

    withDocumentIndexDatabase(rootDir, (db) => {
      // Corruption 1: drop the row for `first` entirely (as if the write-
      // through insert had silently failed, or the row was manually deleted).
      db.prepare("DELETE FROM documents WHERE document_no = ?").run(first.requestNo);
      // Corruption 2: give `second`'s indexed status a value that disagrees
      // with what its real submission.json says (still "submitted").
      db.prepare("UPDATE documents SET status = 'approved' WHERE document_no = ?").run(second.requestNo);
    });

    const { total } = await rebuildDocumentIndex(rootDir);
    assert.equal(total, 2);

    const rows = withDocumentIndexDatabase(rootDir, (db) => snapshotDocumentsTable(db));
    const firstRow = rows.find((row) => row.documentNo === first.requestNo);
    const secondRow = rows.find((row) => row.documentNo === second.requestNo);
    assert.ok(firstRow, "the deleted row must be restored by the rebuild");
    assert.equal(secondRow.status, "submitted", "the corrupted status must be overwritten back to what the file on disk actually says");
  });
});

// Drift direction 1: the index names a document whose folder is gone from
// disk (deleted out from under the app, or the index simply fell behind).
// The rule: disk wins, always -- a silently wrong answer (serving stale
// cached fields from the index row, or worse, claiming the document exists
// with made-up content) is the one outcome that must never happen. The
// point-lookup functions degrade to "not found" (the same error a genuinely
// nonexistent document would raise), exactly like a plain disk walk would
// have reported once the file was gone -- never a crash, and never success
// with fabricated data.
test("a document deleted from disk after being indexed is reported as not found, never served from stale index data", async () => {
  await withTempRoot(async (rootDir) => {
    const request = await saveExpenseSubmission({
      rootDir,
      payload: {
        accountingMonth: "2026-09",
        requestTitle: "จะถูกลบออกจากดิสก์",
        requestType: "reimbursement",
        requesterName: "คุณทดสอบ",
        expenseLines: [],
      },
    });

    // The index still has a row pointing at this folder (write-through set
    // it moments ago) -- now the folder itself disappears, exactly as if
    // someone deleted it outside the app.
    await rm(join(rootDir, request.folderPath), { recursive: true, force: true });

    await assert.rejects(
      () => getSubmittedExpenseRequest(rootDir, request.requestNo),
      /Expense request not found/,
      "a deleted document must be reported as not found, not silently served from the (now stale) index row",
    );
  });
});

// Drift direction 2: a folder exists on disk that the index does not know
// about (a write-through insert that never happened, a row deleted by
// accident, or simply not yet reconciled). The rule: a caller asking for
// that exact document by number must still find it -- an index miss must
// never be indistinguishable from "this document does not exist", because
// that is precisely the failure mode that would make an owner's real
// documents "vanish". Point lookups fall back to a full disk search on a
// miss to guarantee this.
test("a document whose index row is missing but whose file is still on disk is still found by a point lookup", async () => {
  await withTempRoot(async (rootDir) => {
    const request = await saveExpenseSubmission({
      rootDir,
      payload: {
        accountingMonth: "2026-09",
        requestTitle: "ดัชนีหายไปแต่ไฟล์ยังอยู่",
        requestType: "reimbursement",
        requesterName: "คุณทดสอบ",
        expenseLines: [],
      },
    });

    // Simulate the index having no idea this document exists, while the
    // file (the source of truth) is completely untouched.
    withDocumentIndexDatabase(rootDir, (db) => {
      db.prepare("DELETE FROM documents WHERE document_no = ?").run(request.requestNo);
    });
    assert.equal(
      withDocumentIndexDatabase(rootDir, (db) => queryDocumentIndexRows(db, { documentKind: "expense_request" })).length,
      0,
      "sanity: the index really has no row for this expense request now",
    );

    const found = await getSubmittedExpenseRequest(rootDir, request.requestNo);
    assert.equal(found.requestNo, request.requestNo, "the point lookup must fall back to a disk search and still find the real document");

    // Listing (which does not fall back per-row -- see findSubmittedExpenseRequests)
    // still will not show it until the index is repaired; prove that repair
    // path too, since a listing page is exactly where an owner would notice
    // a "missing" document.
    await rebuildDocumentIndex(rootDir);
    const { listExpenseRequests } = serverLogic;
    const listed = await listExpenseRequests(rootDir);
    assert.equal(listed.some((record) => record.requestNo === request.requestNo), true, "after repairing the index, the document must show up in listings again");
  });
});
