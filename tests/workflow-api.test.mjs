import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import serverLogic from "../forms/local-server.logic.js";
import workflowLogic from "../forms/workflow.logic.js";
import workflowDocumentLogic from "../forms/workflow-document.logic.js";

test("workflow templates seed defaults and can be updated with sync toggles", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-workflow-"));
  try {
    const templates = await serverLogic.listWorkflowTemplates(rootDir);
    assert.equal(templates.length, 6);
    const saved = await serverLogic.saveWorkflowTemplate({
      rootDir,
      template: {
        ...templates[0],
        syncGoogleDrive: true,
        documentSteps: [
          { documentKind: "purchase_order" },
          { documentKind: "payment_voucher" },
        ],
      },
    });
    assert.equal(saved.syncGoogleDrive, true);
    assert.deepEqual(saved.documentSteps.map((step) => step.documentKind), ["purchase_order", "payment_voucher"]);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("starting a workflow transaction creates a TXN record from a template", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-workflow-"));
  try {
    const result = await serverLogic.startWorkflowTransaction({
      rootDir,
      templateId: "stock_no_tax_invoice_company_bank",
      accountingMonth: "2026-09",
      title: "ซื้อสต๊อกล็อตกันยายน",
    });
    assert.equal(result.transactionNo, "TXN-2026-09-0001");
    assert.equal(result.steps[0].workflowStatus, "not_started");
    assert.equal(result.steps[1].workflowStatus, "blocked");

    const loaded = await serverLogic.getWorkflowTransaction(rootDir, result.transactionNo);
    assert.equal(loaded.transactionNo, result.transactionNo);
    assert.equal(loaded.templateSnapshot.templateId, "stock_no_tax_invoice_company_bank");
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("getNextWorkflowTransactionInfo scans workflow transaction folders", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-workflow-"));
  try {
    await mkdir(join(rootDir, "documents", "2026", "09", "workflow-transactions", "TXN-2026-09-0003_old"), { recursive: true });
    assert.deepEqual(await serverLogic.getNextWorkflowTransactionInfo(rootDir, "2026-09"), {
      sequence: "4",
      transactionNo: "TXN-2026-09-0004",
    });
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("getNextWorkflowTransactionInfo ignores unrelated directory names in the month folder", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-workflow-"));
  try {
    const monthDir = join(rootDir, "documents", "2026", "09", "workflow-transactions");
    await mkdir(join(monthDir, "TXN-2026-09-0002_something"), { recursive: true });
    await mkdir(join(monthDir, ".DS_Store-ish-folder"), { recursive: true });
    await mkdir(join(monthDir, "REQ-2026-09-0001_unrelated-prefix"), { recursive: true });
    assert.deepEqual(await serverLogic.getNextWorkflowTransactionInfo(rootDir, "2026-09"), {
      sequence: "3",
      transactionNo: "TXN-2026-09-0003",
    });
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("startWorkflowTransaction allocates sequential numbers one after another within the same month", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-workflow-"));
  try {
    const first = await serverLogic.startWorkflowTransaction({
      rootDir,
      templateId: "stock_no_tax_invoice_company_bank",
      accountingMonth: "2026-09",
      title: "ธุรกรรมที่หนึ่ง",
    });
    const second = await serverLogic.startWorkflowTransaction({
      rootDir,
      templateId: "stock_no_tax_invoice_company_bank",
      accountingMonth: "2026-09",
      title: "ธุรกรรมที่สอง",
    });
    const third = await serverLogic.startWorkflowTransaction({
      rootDir,
      templateId: "stock_no_tax_invoice_company_bank",
      accountingMonth: "2026-09",
      title: "ธุรกรรมที่สาม",
    });

    assert.deepEqual(
      [first.transactionNo, second.transactionNo, third.transactionNo],
      ["TXN-2026-09-0001", "TXN-2026-09-0002", "TXN-2026-09-0003"],
    );
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("startWorkflowTransaction allocates distinct numbers when two calls race for the same month (concurrent, no folder yet)", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-workflow-"));
  try {
    const [first, second] = await Promise.all([
      serverLogic.startWorkflowTransaction({
        rootDir,
        templateId: "stock_no_tax_invoice_company_bank",
        accountingMonth: "2026-09",
        title: "ธุรกรรมพร้อมกัน",
      }),
      serverLogic.startWorkflowTransaction({
        rootDir,
        templateId: "stock_no_tax_invoice_company_bank",
        accountingMonth: "2026-09",
        title: "ธุรกรรมพร้อมกัน",
      }),
    ]);

    // The core defect: without a reservation, both concurrent calls resolve
    // the same "next" sequence number and both persist under it.
    assert.notEqual(first.transactionNo, second.transactionNo);

    const [reloadedFirst, reloadedSecond] = await Promise.all([
      serverLogic.getWorkflowTransaction(rootDir, first.transactionNo),
      serverLogic.getWorkflowTransaction(rootDir, second.transactionNo),
    ]);
    assert.ok(reloadedFirst, "first transaction must be independently retrievable by its own number");
    assert.ok(reloadedSecond, "second transaction must be independently retrievable by its own number");
    assert.equal(reloadedFirst.transactionNo, first.transactionNo);
    assert.equal(reloadedSecond.transactionNo, second.transactionNo);

    const monthDir = join(rootDir, "documents", "2026", "09", "workflow-transactions");
    const folders = await readdir(monthDir);
    assert.equal(folders.length, 2, "two distinct transaction folders must exist on disk");
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("startWorkflowTransaction allocates distinct numbers when two calls race for the same month with DIFFERENT titles, and children are never cross-attributed", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-workflow-"));
  try {
    const [first, second] = await Promise.all([
      serverLogic.startWorkflowTransaction({
        rootDir,
        templateId: "stock_no_tax_invoice_company_bank",
        accountingMonth: "2026-09",
        title: "ซื้อสต๊อกล็อตเอ",
      }),
      serverLogic.startWorkflowTransaction({
        rootDir,
        templateId: "stock_no_tax_invoice_company_bank",
        accountingMonth: "2026-09",
        title: "ซื้อสต๊อกล็อตบี",
      }),
    ]);

    // The defect: reserving the full (title-suffixed) folder path lets two
    // different-titled starts both land on the same "next" transaction
    // number, because each reserves a different folder path and neither
    // sees the other's mkdir. The reservation must be keyed on the
    // transaction number alone, independent of title.
    assert.notEqual(first.transactionNo, second.transactionNo);

    const [reloadedFirst, reloadedSecond] = await Promise.all([
      serverLogic.getWorkflowTransaction(rootDir, first.transactionNo),
      serverLogic.getWorkflowTransaction(rootDir, second.transactionNo),
    ]);
    assert.ok(reloadedFirst, "first transaction must be independently retrievable by its own number");
    assert.ok(reloadedSecond, "second transaction must be independently retrievable by its own number");
    assert.equal(reloadedFirst.title, "ซื้อสต๊อกล็อตเอ");
    assert.equal(reloadedSecond.title, "ซื้อสต๊อกล็อตบี");

    // A child document created under the first transaction must never be
    // attributed to the second, even though both share a month and template.
    const purchaseOrderStepId = first.steps[0].stepId;
    const { documentNo } = await serverLogic.getNextWorkflowDocumentInfo(rootDir, "purchase_order", "2026-09");
    const payload = workflowDocumentLogic.buildWorkflowDocumentPayload({
      documentKind: "purchase_order",
      documentNo,
      accountingMonth: "2026-09",
      documentDate: "2026-09-06",
      title: "สั่งซื้อสต๊อกเอ",
      businessPurpose: "ซื้อสินค้าเข้าคลัง",
      transactionNo: first.transactionNo,
      workflowTemplateId: first.workflowTemplateId,
      workflowStepId: purchaseOrderStepId,
      lines: [{ description: "สินค้า A", quantity: "1", unitCost: "100" }],
    });
    await serverLogic.saveWorkflowDocument({ rootDir, payload });

    const firstChildren = await serverLogic.findWorkflowChildDocuments(rootDir, first.transactionNo);
    const secondChildren = await serverLogic.findWorkflowChildDocuments(rootDir, second.transactionNo);
    assert.equal(firstChildren.length, 1, "the child document belongs to the first transaction");
    assert.equal(firstChildren[0].documentNo, documentNo);
    assert.equal(secondChildren.length, 0, "the second transaction must not inherit the first transaction's child document");

    const monthDir = join(rootDir, "documents", "2026", "09", "workflow-transactions");
    const folders = await readdir(monthDir);
    // Only the two real, title-suffixed transaction folders should remain —
    // no leftover bare reservation directories.
    assert.equal(folders.length, 2, "two distinct transaction folders must exist on disk, with no leftover reservation markers");
    for (const folder of folders) {
      assert.match(folder, /^TXN-2026-09-\d{4}_.+/, "each folder must keep the required TXN-YYYY-MM-NNNN_<title> shape");
    }
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("persistWorkflowTransaction rejects an empty or missing folderPath instead of writing into rootDir", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-workflow-"));
  try {
    await assert.rejects(
      () => serverLogic.persistWorkflowTransaction(rootDir, { transactionNo: "TXN-2026-09-0001", folderPath: "" }, []),
      /ที่อยู่โฟลเดอร์ธุรกรรมไม่ถูกต้อง/,
    );
    await assert.rejects(
      () => serverLogic.persistWorkflowTransaction(rootDir, { transactionNo: "TXN-2026-09-0001" }, []),
      /ที่อยู่โฟลเดอร์ธุรกรรมไม่ถูกต้อง/,
    );

    // Neither rejected attempt may have created anything directly under rootDir.
    const rootEntries = await readdir(rootDir).catch(() => []);
    assert.deepEqual(rootEntries, []);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("getWorkflowTransactionFile raises Thai error messages", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-workflow-"));
  try {
    const txn = await serverLogic.startWorkflowTransaction({
      rootDir,
      templateId: "director_expense_transfer",
      accountingMonth: "2026-09",
      title: "เบิกค่าส่ง",
    });

    await assert.rejects(
      () => serverLogic.getWorkflowTransactionFile({ rootDir, transactionNo: "", section: "pdf", fileName: "a.pdf" }),
      /ไม่มีเลขที่ธุรกรรม/,
    );
    await assert.rejects(
      () => serverLogic.getWorkflowTransactionFile({ rootDir, transactionNo: txn.transactionNo, section: "data", fileName: "a.pdf" }),
      /ส่วนไฟล์ไม่ถูกต้อง/,
    );
    await assert.rejects(
      () => serverLogic.getWorkflowTransactionFile({ rootDir, transactionNo: txn.transactionNo, section: "pdf", fileName: "../a.pdf" }),
      /ชื่อไฟล์ไม่ถูกต้อง/,
    );
    await assert.rejects(
      () => serverLogic.getWorkflowTransactionFile({ rootDir, transactionNo: "TXN-2026-09-9999", section: "pdf", fileName: "a.pdf" }),
      /ไม่พบธุรกรรม/,
    );
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("getWorkflowTransactionFile rejects path traversal and resolves legitimate pdf files", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-workflow-"));
  try {
    const txn = await serverLogic.startWorkflowTransaction({
      rootDir,
      templateId: "director_expense_transfer",
      accountingMonth: "2026-09",
      title: "เบิกค่าส่ง",
    });
    const loaded = await serverLogic.getWorkflowTransaction(rootDir, txn.transactionNo);
    const pdfDir = join(rootDir, loaded.folderPath, "pdf");
    await mkdir(pdfDir, { recursive: true });
    await writeFile(join(pdfDir, "99_ชุดรวมเอกสาร_workflow-transaction.pdf"), "stub-pdf");

    const legit = await serverLogic.getWorkflowTransactionFile({
      rootDir,
      transactionNo: txn.transactionNo,
      section: "pdf",
      fileName: "99_ชุดรวมเอกสาร_workflow-transaction.pdf",
    });
    assert.ok(legit.absolutePath.startsWith(pdfDir));

    await assert.rejects(() => serverLogic.getWorkflowTransactionFile({
      rootDir,
      transactionNo: txn.transactionNo,
      section: "pdf",
      fileName: "../data/workflow-transaction.json",
    }));

    await assert.rejects(() => serverLogic.getWorkflowTransactionFile({
      rootDir,
      transactionNo: txn.transactionNo,
      section: "data",
      fileName: "workflow-transaction.json",
    }));
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("listWorkflowDocumentTypes exposes all seven registered document kinds", () => {
  const types = serverLogic.listWorkflowDocumentTypes();
  assert.equal(types.length, Object.keys(workflowLogic.DOCUMENT_TYPE_DEFINITIONS).length);
  for (const type of types) {
    assert.ok(type.documentKind, "each document type must carry documentKind");
    assert.ok(type.label, "each document type must carry a Thai label");
  }
});

test("listWorkflowTransactions lists every started transaction across months", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-workflow-"));
  try {
    const first = await serverLogic.startWorkflowTransaction({
      rootDir,
      templateId: "director_expense_cash",
      accountingMonth: "2026-09",
      title: "รายจ่ายเจ้าของเงินสด",
    });
    const second = await serverLogic.startWorkflowTransaction({
      rootDir,
      templateId: "outsource_expense_cash",
      accountingMonth: "2026-10",
      title: "รายจ่ายภายนอกเงินสด",
    });

    const all = await serverLogic.listWorkflowTransactions(rootDir);
    assert.deepEqual(
      all.map((transaction) => transaction.transactionNo).sort(),
      [first.transactionNo, second.transactionNo].sort(),
    );
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("every default workflow template can start a transaction with the right first/blocked steps", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-workflow-"));
  try {
    const templates = workflowLogic.getDefaultWorkflowTemplates();
    assert.equal(templates.length, 6);

    for (const template of templates) {
      const result = await serverLogic.startWorkflowTransaction({
        rootDir,
        templateId: template.templateId,
        accountingMonth: "2026-09",
        title: `ทดสอบ-${template.templateId}`,
      });
      assert.equal(result.steps.length, template.documentSteps.length, `${template.templateId} should carry all its steps`);
      assert.equal(result.steps[0].workflowStatus, "not_started", `${template.templateId} first step should be not_started`);
      for (let i = 1; i < result.steps.length; i += 1) {
        assert.equal(result.steps[i].workflowStatus, "blocked", `${template.templateId} step ${i} should start blocked`);
      }
    }
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("refreshWorkflowTransaction really scans lightweight documents and unblocks the next step in order", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-workflow-"));
  try {
    const txn = await serverLogic.startWorkflowTransaction({
      rootDir,
      templateId: "stock_no_tax_invoice_company_bank",
      accountingMonth: "2026-09",
      title: "ซื้อสต๊อกล็อตกันยายน",
    });
    // Steps: purchase_order, substitute_receipt, payment_voucher, goods_receipt
    const purchaseOrderStepId = txn.steps[0].stepId;
    const { documentNo } = await serverLogic.getNextWorkflowDocumentInfo(rootDir, "purchase_order", "2026-09");
    const payload = workflowDocumentLogic.buildWorkflowDocumentPayload({
      documentKind: "purchase_order",
      documentNo,
      accountingMonth: "2026-09",
      documentDate: "2026-09-06",
      title: "สั่งซื้อสต๊อก",
      businessPurpose: "ซื้อสินค้าเข้าคลัง",
      transactionNo: txn.transactionNo,
      workflowTemplateId: txn.workflowTemplateId,
      workflowStepId: purchaseOrderStepId,
      lines: [{ description: "สินค้า A", quantity: "1", unitCost: "100" }],
    });
    await serverLogic.saveWorkflowDocument({ rootDir, payload });
    await serverLogic.completeWorkflowDocument({
      rootDir,
      documentKind: "purchase_order",
      documentNo,
      completedBy: "คุณต้า",
    });

    const refreshed = await serverLogic.refreshWorkflowTransaction({ rootDir, transactionNo: txn.transactionNo });
    assert.equal(refreshed.steps[0].workflowStatus, "completed", "completed purchase order should mark step 0 completed");
    assert.equal(refreshed.steps[1].workflowStatus, "not_started", "step 1 should be unblocked once step 0 is done");
    assert.equal(refreshed.steps[2].workflowStatus, "blocked", "step 2 should stay blocked (strict order)");
    assert.equal(refreshed.steps[3].workflowStatus, "blocked", "step 3 should stay blocked (strict order)");

    const reloaded = await serverLogic.getWorkflowTransaction(rootDir, txn.transactionNo);
    assert.equal(reloaded.steps[0].workflowStatus, "completed", "refresh must persist derived progress to disk");

    // Refreshing again (retry / double click) must be a stable no-op, not a re-derivation error.
    const refreshedAgain = await serverLogic.refreshWorkflowTransaction({ rootDir, transactionNo: txn.transactionNo });
    assert.equal(refreshedAgain.steps[0].workflowStatus, "completed");
    assert.equal(refreshedAgain.steps[1].workflowStatus, "not_started");
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("refreshWorkflowTransaction writes workflow summary packet", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-workflow-"));
  try {
    const txn = await serverLogic.startWorkflowTransaction({
      rootDir,
      templateId: "director_expense_transfer",
      accountingMonth: "2026-09",
      title: "เบิกค่าส่ง",
    });
    const refreshed = await serverLogic.refreshWorkflowTransaction({ rootDir, transactionNo: txn.transactionNo });
    assert.ok(refreshed.pdfFiles.some((file) => file.name === "99_ชุดรวมเอกสาร_workflow-transaction.pdf"));
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

// Critical/Important 4 repro: a packet-generation failure (missing Python
// runtime, a ReportLab import error, a locked output file, ...) used to
// reject refreshWorkflowTransaction outright — and since both initTransactionPage
// and handleWorkflowTransactionStartDocument call it unconditionally, one bad
// packet attempt took down the entire transaction page and every
// "เปิดเอกสาร" button, even though the packet is only ever a convenience
// download link. Injects a failing packetGenerator (the same DI seam already
// used for expenseRecorder/driveUploader) instead of actually breaking the
// Python subprocess, so this stays fast and hermetic.
test("refreshWorkflowTransaction survives a failing packet generator: progress still persists and no exception escapes", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-workflow-"));
  try {
    const txn = await serverLogic.startWorkflowTransaction({
      rootDir,
      templateId: "director_expense_transfer",
      accountingMonth: "2026-09",
      title: "เบิกค่าส่ง",
    });

    const failingPacketGenerator = async () => {
      throw new Error("ไม่พบ ReportLab (จำลองความล้มเหลว)");
    };

    const refreshed = await serverLogic.refreshWorkflowTransaction({
      rootDir,
      transactionNo: txn.transactionNo,
      packetGenerator: failingPacketGenerator,
    });

    // Refresh itself must not throw, must still report real progress, and
    // must surface the failure honestly rather than swallowing it.
    assert.equal(refreshed.transactionNo, txn.transactionNo);
    assert.equal(refreshed.steps[0].workflowStatus, "not_started");
    assert.ok(refreshed.packetError, "a failed packet generation must be surfaced, not silently swallowed");
    assert.equal(
      refreshed.pdfFiles.some((file) => file.name === "99_ชุดรวมเอกสาร_workflow-transaction.pdf"),
      false,
      "no packet file must be listed when generation failed",
    );

    // A later, successful refresh (packetGenerator not overridden) must still
    // work normally — the earlier failure must not have wedged anything.
    const recovered = await serverLogic.refreshWorkflowTransaction({ rootDir, transactionNo: txn.transactionNo });
    assert.equal("packetError" in recovered, false);
    assert.ok(recovered.pdfFiles.some((file) => file.name === "99_ชุดรวมเอกสาร_workflow-transaction.pdf"));
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("completeWorkflowTransaction survives a failing packet generator and still completes", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-workflow-"));
  try {
    const txn = await completeSingleStepTransaction(rootDir);

    const failingPacketGenerator = async () => {
      throw new Error("ไฟล์ผลลัพธ์ถูกล็อกอยู่ (จำลองความล้มเหลว)");
    };

    const completed = await serverLogic.completeWorkflowTransaction({
      rootDir,
      transactionNo: txn.transactionNo,
      completedBy: "บัญชี",
      packetGenerator: failingPacketGenerator,
    });

    assert.equal(completed.status, "completed");
    assert.ok(completed.packetError, "a failed packet generation must be surfaced, not silently swallowed");
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("refreshWorkflowTransaction injects documentKind so expense_request and the substitute_receipt hybrid rule dispatch correctly", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-workflow-"));
  try {
    const txn = await serverLogic.startWorkflowTransaction({
      rootDir,
      templateId: "director_expense_transfer",
      accountingMonth: "2026-09",
      title: "เบิกค่าส่งเจ้าของ",
    });
    // Steps: expense_request, substitute_receipt, payment_voucher
    const expenseStepId = txn.steps[0].stepId;
    const receiptStepId = txn.steps[1].stepId;

    const savedExpense = await serverLogic.saveExpenseSubmission({
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
        workflowStepId: expenseStepId,
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
      },
    });
    await serverLogic.approveExpenseRequest({
      rootDir,
      requestNo: savedExpense.requestNo,
      approvedBy: "เจ้าของ",
      expenseRecorder: async () => ({ syncStatus: "not_required" }),
    });
    await serverLogic.completeExpenseRequest({
      rootDir,
      requestNo: savedExpense.requestNo,
      completedBy: "บัญชี",
    });

    const afterExpense = await serverLogic.refreshWorkflowTransaction({ rootDir, transactionNo: txn.transactionNo });
    assert.equal(afterExpense.steps[0].workflowStatus, "completed", "completed expense_request must inject documentKind so it maps to completed");
    assert.equal(afterExpense.steps[1].workflowStatus, "not_started", "substitute_receipt step should now be unblocked");

    const savedReceipt = await serverLogic.saveSubstituteReceiptSubmission({
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
        workflowStepId: receiptStepId,
        lines: [
          { description: "ค่าส่งสินค้า", quantity: "1", unitCost: "107" },
        ],
      },
      uploads: [{ evidenceKey: "paymentSlip", originalName: "slip.jpg", type: "image/jpeg", buffer: Buffer.from("slip") }],
    });
    await serverLogic.approveSubstituteReceipt({
      rootDir,
      receiptNo: savedReceipt.receiptNo,
      approvedBy: "เจ้าของ",
      expenseRecorder: async () => ({ syncStatus: "not_required" }),
    });

    const afterReceipt = await serverLogic.refreshWorkflowTransaction({ rootDir, transactionNo: txn.transactionNo });
    assert.equal(
      afterReceipt.steps[1].workflowStatus,
      "completed",
      "an approved general_expense substitute_receipt must dispatch through the hybrid rule, which needs documentKind injected",
    );
    assert.equal(afterReceipt.steps[2].workflowStatus, "not_started", "payment_voucher step should now be unblocked");
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("getWorkflowTransactionPrefill builds context from completed sibling documents and reports availableGroups", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-workflow-"));
  try {
    const txn = await serverLogic.startWorkflowTransaction({
      rootDir,
      templateId: "stock_no_tax_invoice_company_bank",
      accountingMonth: "2026-09",
      title: "ทดสอบ prefill",
    });
    // saveWorkflowDocument (Task 4/5) expects an already-built payload — it
    // does not call buildWorkflowDocumentPayload itself, matching every other
    // saveWorkflowDocument call in this suite (see the purchase_order save
    // above in "refreshWorkflowTransaction really scans lightweight
    // documents..."). documentNo/folderPath must be computed here, not passed
    // as raw sequence/date fields.
    const poPayload = workflowDocumentLogic.buildWorkflowDocumentPayload({
      documentKind: "purchase_order",
      sequence: "1",
      accountingMonth: "2026-09",
      documentDate: "2026-09-06",
      title: "สั่งซื้อวัสดุ",
      requesterName: "คุณต้า",
      payeeName: "ร้านค้า A",
      businessPurpose: "ซื้อวัสดุสำนักงาน",
      lines: [{ description: "กระดาษ A4", quantity: "10", unitCost: "100.00" }],
      transactionNo: txn.transactionNo,
      workflowTemplateId: txn.templateSnapshot.templateId,
      workflowStepId: txn.steps[0].stepId,
    });
    const po = await serverLogic.saveWorkflowDocument({ rootDir, payload: poPayload });
    await serverLogic.completeWorkflowDocument({ rootDir, documentKind: "purchase_order", documentNo: po.documentNo, completedBy: "บัญชี" });

    const prefill = await serverLogic.getWorkflowTransactionPrefill({
      rootDir,
      transactionNo: txn.transactionNo,
      documentKind: "substitute_receipt",
      stepId: txn.steps[1].stepId,
    });

    assert.equal(prefill.context.payee.name, "ร้านค้า A");
    assert.equal(prefill.sources.payee, po.documentNo);
    assert.deepEqual(prefill.availableGroups.slice().sort(), ["lines", "payee", "purpose"]);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("getWorkflowTransactionPrefill rejects a documentKind that does not match the step's template document kind", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-workflow-"));
  try {
    const txn = await serverLogic.startWorkflowTransaction({
      rootDir,
      templateId: "stock_no_tax_invoice_company_bank",
      accountingMonth: "2026-09",
      title: "ทดสอบ prefill ผิดประเภท",
    });
    await assert.rejects(() => serverLogic.getWorkflowTransactionPrefill({
      rootDir,
      transactionNo: txn.transactionNo,
      documentKind: "payment_voucher",
      stepId: txn.steps[0].stepId,
    }));
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("getWorkflowTransactionPrefill sources payee, purpose, and lines from a completed expense_request", async () => {
  // findSubmittedExpenseRequests (the listing-page scan) only returns a
  // curated summary with no businessPurpose/paymentTargetName/paymentBankName/
  // paymentAccountNo/requesterRole/expenseLines at all — findWorkflowChildDocuments
  // must re-read the full submission via getSubmittedExpenseRequest so an
  // expense_request source document is not silently reduced to almost nothing.
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-workflow-"));
  try {
    const txn = await serverLogic.startWorkflowTransaction({
      rootDir,
      templateId: "director_expense_transfer",
      accountingMonth: "2026-09",
      title: "ทดสอบ prefill จากใบเบิกค่าใช้จ่าย",
    });
    const savedExpense = await serverLogic.saveExpenseSubmission({
      rootDir,
      payload: {
        requestType: "reimbursement",
        accountingMonth: "2026-09",
        requesterName: "คุณต้า",
        requesterRole: "ผู้จัดการ",
        businessPurpose: "ค่าส่งสินค้า",
        paymentTargetName: "ขนส่งตัวอย่าง",
        paymentBankName: "SCB",
        paymentAccountNo: "1112223334",
        transactionNo: txn.transactionNo,
        workflowTemplateId: txn.workflowTemplateId,
        workflowStepId: txn.steps[0].stepId,
        expenseLines: [
          { description: "ค่าขนส่ง", vendor: "ขนส่งตัวอย่าง", amountBeforeVat: "100.00", vatAmount: "0.00", withholdingTax: "0.00" },
        ],
      },
    });
    await serverLogic.approveExpenseRequest({
      rootDir,
      requestNo: savedExpense.requestNo,
      approvedBy: "เจ้าของ",
      expenseRecorder: async () => ({ syncStatus: "not_required" }),
    });
    await serverLogic.completeExpenseRequest({ rootDir, requestNo: savedExpense.requestNo, completedBy: "บัญชี" });

    const prefill = await serverLogic.getWorkflowTransactionPrefill({
      rootDir,
      transactionNo: txn.transactionNo,
      documentKind: txn.steps[1].documentKind,
      stepId: txn.steps[1].stepId,
    });

    assert.equal(prefill.context.payee.name, "ขนส่งตัวอย่าง");
    assert.equal(prefill.context.payee.bankName, "SCB");
    assert.equal(prefill.context.payee.accountNo, "1112223334");
    assert.equal(prefill.context.purpose.businessPurpose, "ค่าส่งสินค้า");
    assert.deepEqual(prefill.context.lines, [
      { description: "ค่าขนส่ง", quantity: "1", unitCost: "100.00", lineTotal: "100.00", stockSkuId: "" },
    ]);
    assert.equal(prefill.context.parties.requesterName, "คุณต้า");
    assert.equal(prefill.context.parties.requesterRole, "ผู้จัดการ");
    assert.equal(prefill.sources.payee, savedExpense.requestNo);
    assert.deepEqual(prefill.availableGroups.slice().sort(), ["lines", "payee", "purpose"]);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Workflow transaction completion and Drive sync (Task 11).
//
// There is no workflow-level Sheets sync anywhere in this file (decision D6):
// child documents (expense request, substitute receipt) already write their
// own Sheets rows carrying the real amounts, and one transaction bundles
// several documents covering the *same* money, so a workflow-level row would
// double- or triple-count it in the monthly sheet.
// ---------------------------------------------------------------------------

test("completeWorkflowTransaction refuses completion while a step is incomplete", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-workflow-"));
  try {
    const txn = await serverLogic.startWorkflowTransaction({
      rootDir,
      templateId: "director_expense_transfer",
      accountingMonth: "2026-09",
      title: "เบิกค่าส่ง",
    });
    await assert.rejects(
      () => serverLogic.completeWorkflowTransaction({ rootDir, transactionNo: txn.transactionNo, completedBy: "บัญชี" }),
    );
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

async function completeSingleStepTransaction(rootDir, templateOverrides) {
  const template = await serverLogic.saveWorkflowTemplate({
    rootDir,
    template: {
      templateId: `single_step_${Date.now()}`,
      name: "ทดสอบ single step",
      syncGoogleDrive: false,
      documentSteps: [{ documentKind: "payment_voucher" }],
      ...templateOverrides,
    },
  });
  const txn = await serverLogic.startWorkflowTransaction({
    rootDir,
    templateId: template.templateId,
    accountingMonth: "2026-09",
    title: "ทดสอบ complete",
  });
  const { documentNo } = await serverLogic.getNextWorkflowDocumentInfo(rootDir, "payment_voucher", "2026-09");
  const payload = workflowDocumentLogic.buildWorkflowDocumentPayload({
    documentKind: "payment_voucher",
    documentNo,
    accountingMonth: "2026-09",
    documentDate: "2026-09-06",
    title: "จ่ายเงิน",
    requesterName: "คุณต้า",
    payeeName: "ร้านค้า",
    businessPurpose: "ทดสอบ",
    lines: [{ description: "ค่าใช้จ่าย", quantity: "1", unitCost: "100" }],
    transactionNo: txn.transactionNo,
    workflowTemplateId: template.templateId,
    workflowStepId: txn.steps[0].stepId,
  });
  await serverLogic.saveWorkflowDocument({ rootDir, payload });
  await serverLogic.completeWorkflowDocument({
    rootDir,
    documentKind: "payment_voucher",
    documentNo,
    completedBy: "บัญชี",
  });
  await serverLogic.refreshWorkflowTransaction({ rootDir, transactionNo: txn.transactionNo });
  return txn;
}

test("completeWorkflowTransaction succeeds and auto-syncs Drive when the template toggle is on", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-workflow-"));
  try {
    const txn = await completeSingleStepTransaction(rootDir, { syncGoogleDrive: true });
    let driveCalls = 0;
    const completed = await serverLogic.completeWorkflowTransaction({
      rootDir,
      transactionNo: txn.transactionNo,
      completedBy: "บัญชี",
      driveUploader: async () => { driveCalls += 1; return { driveFolderId: "f1", driveFolderUrl: "https://drive/f1", drivePath: "p", uploadedFileCount: 1 }; },
    });

    assert.equal(completed.status, "completed");
    assert.equal(completed.completedBy, "บัญชี");
    assert.equal(driveCalls, 1);
    assert.equal(completed.driveSync.syncStatus, "synced");
    assert.equal(completed.sheetSync, undefined);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("completeWorkflowTransaction does not auto-sync Drive when the toggle is off, and manual sync works afterward", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-workflow-"));
  try {
    const txn = await completeSingleStepTransaction(rootDir, { syncGoogleDrive: false });
    let driveCalls = 0;
    const stubDrive = async () => { driveCalls += 1; return { driveFolderId: "f1", driveFolderUrl: "https://drive/f1", drivePath: "p", uploadedFileCount: 1 }; };

    const completed = await serverLogic.completeWorkflowTransaction({
      rootDir,
      transactionNo: txn.transactionNo,
      completedBy: "บัญชี",
      driveUploader: stubDrive,
    });
    assert.equal(completed.status, "completed");
    assert.equal(driveCalls, 0);
    assert.equal(completed.driveSync.syncStatus, "not_required");

    const manualDrive = await serverLogic.syncWorkflowTransactionToDrive({ rootDir, transactionNo: txn.transactionNo, driveUploader: stubDrive });
    assert.equal(driveCalls, 1);
    assert.equal(manualDrive.syncStatus, "synced");
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("completeWorkflowTransaction repeated call is a true no-op: preserves the audit stamp, appends no history, never re-syncs", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-workflow-"));
  try {
    const txn = await completeSingleStepTransaction(rootDir, { syncGoogleDrive: true });
    let driveCalls = 0;
    const stubDrive = async () => { driveCalls += 1; return { driveFolderId: "f1", driveFolderUrl: "https://drive/f1", drivePath: "p", uploadedFileCount: 1 }; };

    const first = await serverLogic.completeWorkflowTransaction({
      rootDir,
      transactionNo: txn.transactionNo,
      completedBy: "บัญชี",
      driveUploader: stubDrive,
    });
    assert.equal(driveCalls, 1);

    const second = await serverLogic.completeWorkflowTransaction({
      rootDir,
      transactionNo: txn.transactionNo,
      completedBy: "someone-else-entirely",
      driveUploader: stubDrive,
    });

    assert.equal(driveCalls, 1, "a repeat completion call must not re-trigger Drive sync");
    assert.equal(second.completedAt, first.completedAt, "the original completedAt must survive a repeat call");
    assert.equal(second.completedBy, "บัญชี", "the original completedBy must not be overwritten by a repeat call's argument");
    assert.equal(second.statusHistory.length, first.statusHistory.length, "no duplicate history entry may be appended");
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("syncWorkflowTransactionToDrive refuses to sync a transaction that is not completed yet", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-workflow-"));
  try {
    const txn = await serverLogic.startWorkflowTransaction({
      rootDir,
      templateId: "director_expense_transfer",
      accountingMonth: "2026-09",
      title: "ยังไม่เสร็จ",
    });
    await assert.rejects(
      () => serverLogic.syncWorkflowTransactionToDrive({ rootDir, transactionNo: txn.transactionNo }),
    );
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("syncWorkflowTransactionToDrive returns a sync_failed status without throwing when the uploader rejects", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-workflow-"));
  try {
    const txn = await completeSingleStepTransaction(rootDir, { syncGoogleDrive: false });
    await serverLogic.completeWorkflowTransaction({ rootDir, transactionNo: txn.transactionNo, completedBy: "บัญชี" });

    const failingUploader = async () => { throw new Error("Google Drive is not configured"); };
    const result = await serverLogic.syncWorkflowTransactionToDrive({
      rootDir,
      transactionNo: txn.transactionNo,
      driveUploader: failingUploader,
    });

    assert.equal(result.syncStatus, "sync_failed");
    assert.equal(result.error, "Google Drive is not configured");

    const reloaded = await serverLogic.getWorkflowTransaction(rootDir, txn.transactionNo);
    assert.equal(reloaded.driveSync.syncStatus, "sync_failed");
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("local server exposes workflow transaction completion and sync routes", async () => {
  const source = await readFile(new URL("../local-server.mjs", import.meta.url), "utf8");
  assert.match(source, /completeWorkflowTransaction/);
  assert.match(source, /syncWorkflowTransactionToDrive/);
  assert.match(source, /\/complete/);
  assert.match(source, /\/sync-drive/);
  assert.doesNotMatch(source, /syncWorkflowTransactionToSheets/);
  assert.doesNotMatch(source, /\/sync-sheets/);
});

// ---------------------------------------------------------------------------
// HTTP routing tests below. These spawn the real local-server.mjs process and
// exercise the workflow-template/workflow-transaction routes over HTTP, the
// same pattern tests/workflow-document-api.test.mjs uses for the sibling
// workflow-document routes. Bind port 0 (the OS picks a free port) and read
// the actually-assigned port back out of the server's own startup log line.
// ---------------------------------------------------------------------------

async function waitForServerPort(child) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("local server did not start"));
    }, 5000);

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      const match = text.match(/Expense request local web app: http:\/\/localhost:(\d+)\//);
      if (match) {
        clearTimeout(timeout);
        resolve(Number(match[1]));
      }
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`local server exited early with code ${code}`));
    });
  });
}

function spawnLocalServer(rootDir) {
  return spawn(process.execPath, ["local-server.mjs"], {
    cwd: new URL("..", import.meta.url),
    env: {
      ...process.env,
      PORT: "0",
      SWEET_HOUSE_ROOT_DIR: rootDir,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function stopServer(child) {
  child.kill();
  await new Promise((resolve) => child.once("exit", resolve));
}

async function requestJson(baseUrl, route, options = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    ...options,
    headers: {
      ...(options.body instanceof FormData ? {} : { "content-type": "application/json" }),
      ...(options.headers || {}),
    },
  });
  const body = await response.json();
  return { status: response.status, ok: response.ok, body };
}

async function requestJsonOk(baseUrl, route, options = {}) {
  const { ok, body, status } = await requestJson(baseUrl, route, options);
  assert.equal(ok, true, body.error || `HTTP ${status}`);
  return body;
}

function workflowDocumentFormData(overrides = {}) {
  const formData = new FormData();
  formData.append("payload", JSON.stringify({
    documentKind: "purchase_order",
    accountingMonth: "2026-09",
    documentDate: "2026-09-06",
    title: "สั่งซื้อสินค้าใน Workflow",
    requesterName: "คุณต้า",
    payeeName: "ร้านค้าตัวอย่าง",
    businessPurpose: "ซื้อสินค้าเข้าคลัง",
    lines: [{ description: "สินค้า A", quantity: "1", unitCost: "100" }],
    ...overrides,
  }));
  return formData;
}

async function startTransactionOverHttp(baseUrl, overrides = {}) {
  return requestJsonOk(baseUrl, "/api/workflow-transactions", {
    method: "POST",
    body: JSON.stringify({
      templateId: "stock_no_tax_invoice_company_bank",
      accountingMonth: "2026-09",
      title: "ซื้อสต๊อกทดสอบผ่าน HTTP",
      ...overrides,
    }),
  });
}

async function submitAndCompletePurchaseOrder(baseUrl, txn) {
  const submitted = await requestJsonOk(baseUrl, "/api/workflow-documents", {
    method: "POST",
    body: workflowDocumentFormData({
      transactionNo: txn.transactionNo,
      workflowTemplateId: txn.workflowTemplateId,
      workflowStepId: txn.steps[0].stepId,
    }),
  });
  await requestJsonOk(baseUrl, `/api/workflow-documents/purchase_order/${submitted.documentNo}/complete`, {
    method: "POST",
    body: JSON.stringify({ completedBy: "คุณต้า" }),
  });
  return submitted;
}

test("GET /api/workflow-document-types exposes registered document kinds over HTTP", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-workflow-http-"));
  const child = spawnLocalServer(rootDir);
  try {
    const port = await waitForServerPort(child);
    const baseUrl = `http://localhost:${port}`;
    const result = await requestJsonOk(baseUrl, "/api/workflow-document-types");
    assert.equal(result.documentTypes.length, Object.keys(workflowLogic.DOCUMENT_TYPE_DEFINITIONS).length);
    for (const type of result.documentTypes) {
      assert.ok(type.documentKind);
      assert.ok(type.label);
    }
  } finally {
    await stopServer(child);
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("GET/POST /api/workflow-templates lists defaults and lets a client edit sync toggle and steps, but not server-owned fields", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-workflow-http-"));
  const child = spawnLocalServer(rootDir);
  try {
    const port = await waitForServerPort(child);
    const baseUrl = `http://localhost:${port}`;

    const list = await requestJsonOk(baseUrl, "/api/workflow-templates");
    assert.equal(list.templates.length, 6);
    const target = list.templates.find((t) => t.templateId === "stock_no_tax_invoice_company_bank");
    assert.ok(target);
    const originalCreatedAt = target.createdAt;

    const saved = await requestJsonOk(baseUrl, "/api/workflow-templates", {
      method: "POST",
      body: JSON.stringify({
        templateId: target.templateId,
        name: "ชื่อใหม่ที่แก้ไขผ่าน HTTP",
        syncGoogleDrive: true,
        documentSteps: [
          { documentKind: "purchase_order" },
          { documentKind: "payment_voucher" },
        ],
        // Attempted forgery: none of these fields may be set by the client.
        active: false,
        createdAt: "2000-01-01T00:00:00.000Z",
        syncGoogleSheets: true,
      }),
    });

    assert.equal(saved.name, "ชื่อใหม่ที่แก้ไขผ่าน HTTP", "name is client-settable");
    assert.equal(saved.syncGoogleDrive, true, "syncGoogleDrive toggle is client-settable");
    assert.deepEqual(saved.documentSteps.map((step) => step.documentKind), ["purchase_order", "payment_voucher"], "documentSteps is client-settable");
    assert.equal(saved.active, true, "active must stay server-owned, not forced to false by the client");
    assert.notEqual(saved.createdAt, "2000-01-01T00:00:00.000Z", "createdAt must stay server-owned, not forgeable");
    assert.equal(saved.createdAt, originalCreatedAt, "createdAt must be inherited from the existing record");
    assert.equal("syncGoogleSheets" in saved, false, "the workflow layer never gets a syncGoogleSheets toggle");

    const reloaded = await requestJsonOk(baseUrl, "/api/workflow-templates");
    const reloadedTarget = reloaded.templates.find((t) => t.templateId === target.templateId);
    assert.equal(reloadedTarget.active, true);
  } finally {
    await stopServer(child);
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("POST /api/workflow-templates rejects a missing templateId with a Thai error", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-workflow-http-"));
  const child = spawnLocalServer(rootDir);
  try {
    const port = await waitForServerPort(child);
    const baseUrl = `http://localhost:${port}`;
    const result = await requestJson(baseUrl, "/api/workflow-templates", {
      method: "POST",
      body: JSON.stringify({ name: "ไม่มีรหัส" }),
    });
    assert.equal(result.ok, false);
    assert.match(result.body.error, /รหัส/);
  } finally {
    await stopServer(child);
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("GET /api/workflow-transactions/next is not swallowed by the /:transactionNo route", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-workflow-http-"));
  const child = spawnLocalServer(rootDir);
  try {
    const port = await waitForServerPort(child);
    const baseUrl = `http://localhost:${port}`;

    // If "/next" were swallowed by the generic /:transactionNo GET handler,
    // this would 404 with "transaction not found" instead of returning the
    // next sequence number.
    const result = await requestJsonOk(baseUrl, "/api/workflow-transactions/next?accountingMonth=2026-09");
    assert.deepEqual(result, { sequence: "1", transactionNo: "TXN-2026-09-0001" });
  } finally {
    await stopServer(child);
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("GET /api/workflow-transactions/next rejects a malformed accountingMonth with a Thai error", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-workflow-http-"));
  const child = spawnLocalServer(rootDir);
  try {
    const port = await waitForServerPort(child);
    const baseUrl = `http://localhost:${port}`;
    const result = await requestJson(baseUrl, "/api/workflow-transactions/next?accountingMonth=2026/09");
    assert.equal(result.ok, false);
    assert.match(result.body.error, /เดือนบัญชี/);
  } finally {
    await stopServer(child);
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("POST /api/workflow-transactions starts a transaction from only templateId/accountingMonth/title, and GET lists/fetches it", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-workflow-http-"));
  const child = spawnLocalServer(rootDir);
  try {
    const port = await waitForServerPort(child);
    const baseUrl = `http://localhost:${port}`;

    const txn = await startTransactionOverHttp(baseUrl, {
      // Attempted forgery: the client only supplies templateId/accountingMonth/title;
      // none of these other fields may steer the server's own identifiers.
      transactionNo: "TXN-2026-09-9999",
      sequence: "9999",
      folderPath: "../../../../tmp/escaped-via-workflow-transaction",
      status: "completed",
    });

    assert.equal(txn.transactionNo, "TXN-2026-09-0001", "server must compute the real transaction number, ignoring the client's forged one");
    assert.equal(txn.status, "in_progress", "status must be server-derived, not the client's forged completed");
    assert.ok(txn.folderPath.startsWith("documents/2026/09/workflow-transactions/"), `folderPath must be server-derived, got ${txn.folderPath}`);
    assert.equal(txn.steps[0].workflowStatus, "not_started");
    assert.equal(txn.steps[1].workflowStatus, "blocked");

    const fetched = await requestJsonOk(baseUrl, `/api/workflow-transactions/${txn.transactionNo}`);
    assert.equal(fetched.transactionNo, txn.transactionNo);

    const list = await requestJsonOk(baseUrl, "/api/workflow-transactions");
    assert.deepEqual(list.transactions.map((t) => t.transactionNo), [txn.transactionNo]);

    const missing = await requestJson(baseUrl, "/api/workflow-transactions/TXN-2026-09-9999");
    assert.equal(missing.status, 404);
  } finally {
    await stopServer(child);
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("POST /api/workflow-transactions rejects a malformed accountingMonth with a Thai error", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-workflow-http-"));
  const child = spawnLocalServer(rootDir);
  try {
    const port = await waitForServerPort(child);
    const baseUrl = `http://localhost:${port}`;
    const result = await requestJson(baseUrl, "/api/workflow-transactions", {
      method: "POST",
      body: JSON.stringify({ templateId: "stock_no_tax_invoice_company_bank", accountingMonth: "September", title: "x" }),
    });
    assert.equal(result.ok, false);
    assert.match(result.body.error, /เดือนบัญชี/);
  } finally {
    await stopServer(child);
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("POST refresh and start-document enforce strict template order, and self-refresh before checking", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-workflow-http-"));
  const child = spawnLocalServer(rootDir);
  try {
    const port = await waitForServerPort(child);
    const baseUrl = `http://localhost:${port}`;

    const txn = await startTransactionOverHttp(baseUrl);
    // Steps: purchase_order (query-string route already), substitute_receipt
    // (bare route), payment_voucher (query-string route), goods_receipt.
    const [poStep, receiptStep, voucherStep] = txn.steps;

    // The current (first) step must be startable, and its URL must stay
    // well-formed even though /workflow-document?documentKind=... already
    // carries a query string.
    const poOpen = await requestJsonOk(baseUrl, `/api/workflow-transactions/${txn.transactionNo}/start-document/${poStep.stepId}`, {
      method: "POST",
    });
    assert.equal((poOpen.url.match(/\?/g) || []).length, 1, `url must not contain two "?": ${poOpen.url}`);
    const poParsed = new URL(poOpen.url, baseUrl);
    assert.equal(poParsed.pathname, "/workflow-document");
    assert.equal(poParsed.searchParams.get("documentKind"), "purchase_order");
    assert.equal(poParsed.searchParams.get("transactionNo"), txn.transactionNo);
    assert.equal(poParsed.searchParams.get("workflowTemplateId"), txn.workflowTemplateId);
    assert.equal(poParsed.searchParams.get("workflowStepId"), poStep.stepId);
    assert.equal(poParsed.searchParams.get("returnTo"), `/workflow-transaction?transactionNo=${txn.transactionNo}`);

    // A locked step (payment_voucher, step index 2) must be refused even
    // though it is a real step in the template.
    const lockedAttempt = await requestJson(baseUrl, `/api/workflow-transactions/${txn.transactionNo}/start-document/${voucherStep.stepId}`, {
      method: "POST",
    });
    assert.equal(lockedAttempt.ok, false, "a locked step must be refused server-side");
    assert.match(lockedAttempt.body.error, /[ก-๙]/, "refusal must be a Thai error message");

    // A crafted, entirely unknown stepId must also be refused.
    const unknownAttempt = await requestJson(baseUrl, `/api/workflow-transactions/${txn.transactionNo}/start-document/not-a-real-step`, {
      method: "POST",
    });
    assert.equal(unknownAttempt.ok, false);

    // Complete the purchase order directly (without ever calling /refresh)
    // then immediately try to start substitute_receipt: start-document must
    // refresh first so the newly-completed step unlocks the next one right away.
    await submitAndCompletePurchaseOrder(baseUrl, txn);

    const receiptOpen = await requestJsonOk(baseUrl, `/api/workflow-transactions/${txn.transactionNo}/start-document/${receiptStep.stepId}`, {
      method: "POST",
    });
    assert.equal((receiptOpen.url.match(/\?/g) || []).length, 1, `url for a route with no built-in query string must still be well-formed: ${receiptOpen.url}`);
    const receiptParsed = new URL(receiptOpen.url, baseUrl);
    assert.equal(receiptParsed.pathname, "/substitute-receipt");
    assert.equal(receiptParsed.searchParams.get("transactionNo"), txn.transactionNo);
    assert.equal(receiptParsed.searchParams.get("workflowStepId"), receiptStep.stepId);
    assert.equal(receiptParsed.searchParams.get("returnTo"), `/workflow-transaction?transactionNo=${txn.transactionNo}`);
    assert.equal(
      receiptParsed.searchParams.get("receiptType"),
      "stock_purchase",
      "start-document must carry the template's declared receiptType so the form can lock the field",
    );

    // Explicit /refresh must also reflect the same, now-persisted, progress.
    const refreshed = await requestJsonOk(baseUrl, `/api/workflow-transactions/${txn.transactionNo}/refresh`, {
      method: "POST",
    });
    assert.equal(refreshed.steps[0].workflowStatus, "completed");
    assert.equal(refreshed.steps[1].workflowStatus, "not_started");
    assert.equal(refreshed.steps[2].workflowStatus, "blocked");
  } finally {
    await stopServer(child);
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("start-document carries the general_expense receiptType declared by an expense template's substitute_receipt step", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-workflow-http-"));
  const child = spawnLocalServer(rootDir);
  try {
    const port = await waitForServerPort(child);
    const baseUrl = `http://localhost:${port}`;

    const txn = await startTransactionOverHttp(baseUrl, { templateId: "director_expense_transfer", title: "เบิกค่าใช้จ่ายทดสอบ receiptType" });
    const receiptStep = txn.steps[1];
    assert.equal(receiptStep.documentKind, "substitute_receipt");

    // Step 0 (expense_request) is the current step, so it must be started
    // and completed first before substitute_receipt (step 1) unlocks.
    const expenseFormData = new FormData();
    expenseFormData.append("payload", JSON.stringify({
      accountingMonth: "2026-09",
      requestTitle: "เบิกค่าใช้จ่ายทดสอบ",
      requestType: "reimbursement",
      requesterName: "เจ้าของ",
      businessPurpose: "ทดสอบ receiptType",
      paymentTargetName: "เจ้าของ",
      transactionNo: txn.transactionNo,
      workflowTemplateId: txn.workflowTemplateId,
      workflowStepId: txn.steps[0].stepId,
      expenseLines: [{
        date: "2026-09-05",
        category: "ค่าส่ง/ขนส่ง",
        description: "ค่าใช้จ่ายทดสอบ",
        vendor: "ผู้ขายทดสอบ",
        amountBeforeVat: "100",
        vatAmount: "7",
        withholdingTax: "0",
      }],
    }));
    expenseFormData.append("evidence_businessEvidence", new Blob(["evidence"], { type: "text/plain" }), "evidence.txt");
    const expenseSubmitted = await requestJsonOk(baseUrl, "/api/expense-requests", { method: "POST", body: expenseFormData });
    await requestJsonOk(baseUrl, `/api/expense-requests/${expenseSubmitted.requestNo}/approve`, {
      method: "POST",
      body: JSON.stringify({ approvedBy: "เจ้าของ" }),
    });
    await requestJsonOk(baseUrl, `/api/expense-requests/${expenseSubmitted.requestNo}/complete`, {
      method: "POST",
      body: JSON.stringify({ completedBy: "บัญชี" }),
    });

    const receiptOpen = await requestJsonOk(baseUrl, `/api/workflow-transactions/${txn.transactionNo}/start-document/${receiptStep.stepId}`, {
      method: "POST",
    });
    const receiptParsed = new URL(receiptOpen.url, baseUrl);
    assert.equal(
      receiptParsed.searchParams.get("receiptType"),
      "general_expense",
      "director_expense_transfer's substitute_receipt step declares general_expense",
    );
  } finally {
    await stopServer(child);
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("start-document does not carry a receiptType param for a substitute_receipt step whose template never declared one, and a later template edit never touches a running transaction's snapshot", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-workflow-http-"));
  const child = spawnLocalServer(rootDir);
  try {
    const port = await waitForServerPort(child);
    const baseUrl = `http://localhost:${port}`;

    // A custom template whose substitute_receipt step never declares a
    // receiptType -- exactly the shape a template persisted to disk before
    // this feature shipped will have.
    await requestJsonOk(baseUrl, "/api/workflow-templates", {
      method: "POST",
      body: JSON.stringify({
        templateId: "custom_no_receipt_type",
        name: "Custom no receiptType",
        documentSteps: [
          { documentKind: "purchase_order" },
          { documentKind: "substitute_receipt" },
        ],
      }),
    });

    const txn = await startTransactionOverHttp(baseUrl, { templateId: "custom_no_receipt_type", title: "ทดสอบ template ไม่มี receiptType" });

    // Editing the live template *after* the transaction started must never
    // change what a running transaction's start-document URL carries -- the
    // snapshot on the transaction record is authoritative, not the live
    // template.
    await requestJsonOk(baseUrl, "/api/workflow-templates", {
      method: "POST",
      body: JSON.stringify({
        templateId: "custom_no_receipt_type",
        name: "Custom no receiptType",
        documentSteps: [
          { documentKind: "purchase_order" },
          { documentKind: "substitute_receipt", receiptType: "general_expense" },
        ],
      }),
    });

    await submitAndCompletePurchaseOrder(baseUrl, txn);
    const receiptStep = txn.steps[1];
    const receiptOpen = await requestJsonOk(baseUrl, `/api/workflow-transactions/${txn.transactionNo}/start-document/${receiptStep.stepId}`, {
      method: "POST",
    });
    const receiptParsed = new URL(receiptOpen.url, baseUrl);
    assert.equal(
      receiptParsed.searchParams.has("receiptType"),
      false,
      "no receiptType param must be sent when the snapshotted template step never declared one, even though the live template was edited afterward to declare one",
    );
  } finally {
    await stopServer(child);
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("saveSubstituteReceiptSubmission rejects a receiptType that disagrees with the workflow step's snapshotted template", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-workflow-"));
  try {
    // stock_no_tax_invoice_company_bank's substitute_receipt step (step-002)
    // declares "stock_purchase". Submitting "general_expense" against that
    // step must be refused server-side -- locking the UI select is not
    // enforcement, a crafted request can still submit any value.
    const txn = await serverLogic.startWorkflowTransaction({
      rootDir,
      templateId: "stock_no_tax_invoice_company_bank",
      accountingMonth: "2026-09",
      title: "ทดสอบปฏิเสธ receiptType ที่ไม่ตรงกับ workflow",
    });
    const receiptStepId = txn.steps[1].stepId;

    await assert.rejects(
      serverLogic.saveSubstituteReceiptSubmission({
        rootDir,
        payload: {
          accountingMonth: "2026-09",
          receiptDate: "2026-09-05",
          receiptTitle: "ทดสอบ receiptType ผิด",
          receiptType: "general_expense",
          payeeName: "ผู้ขายทดสอบ",
          businessPurpose: "ทดสอบ",
          transactionNo: txn.transactionNo,
          workflowTemplateId: txn.workflowTemplateId,
          workflowStepId: receiptStepId,
          lines: [{ description: "รายการทดสอบ", quantity: "1", unitCost: "100" }],
        },
        uploads: [{ evidenceKey: "paymentSlip", originalName: "slip.jpg", type: "image/jpeg", buffer: Buffer.from("slip") }],
      }),
      (error) => {
        assert.match(error.message, /[ก-๙]/, "refusal must be a Thai error message");
        return true;
      },
    );

    // The matching receiptType must still be accepted -- this is not simply
    // refusing every substitute_receipt submission inside a workflow.
    const accepted = await serverLogic.saveSubstituteReceiptSubmission({
      rootDir,
      payload: {
        accountingMonth: "2026-09",
        receiptDate: "2026-09-05",
        receiptTitle: "ทดสอบ receiptType ถูกต้อง",
        receiptType: "stock_purchase",
        payeeName: "ผู้ขายทดสอบ",
        businessPurpose: "ทดสอบ",
        transactionNo: txn.transactionNo,
        workflowTemplateId: txn.workflowTemplateId,
        workflowStepId: receiptStepId,
        lines: [{ stockSkuId: "1", sku: "TEST-SKU", description: "รายการทดสอบ", quantity: "1", unitCost: "100" }],
      },
      uploads: [{ evidenceKey: "paymentSlip", originalName: "slip.jpg", type: "image/jpeg", buffer: Buffer.from("slip") }],
    });
    assert.ok(accepted.receiptNo, "a matching receiptType must be accepted normally");
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("saveSubstituteReceiptSubmission does not enforce receiptType when the snapshotted template step never declared one", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-workflow-"));
  try {
    const template = await serverLogic.saveWorkflowTemplate({
      rootDir,
      template: {
        templateId: "custom_unenforced_receipt",
        name: "Custom unenforced",
        documentSteps: [
          { documentKind: "purchase_order" },
          { documentKind: "substitute_receipt" },
        ],
      },
    });
    assert.equal(template.documentSteps[1].receiptType, undefined, "sanity check: this template really has no declared receiptType");

    const txn = await serverLogic.startWorkflowTransaction({
      rootDir,
      templateId: "custom_unenforced_receipt",
      accountingMonth: "2026-09",
      title: "ทดสอบไม่มีการบังคับ receiptType",
    });
    const receiptStepId = txn.steps[1].stepId;

    const submitted = await serverLogic.saveSubstituteReceiptSubmission({
      rootDir,
      payload: {
        accountingMonth: "2026-09",
        receiptDate: "2026-09-05",
        receiptTitle: "ทดสอบ",
        receiptType: "general_expense",
        payeeName: "ผู้ขายทดสอบ",
        businessPurpose: "ทดสอบ",
        transactionNo: txn.transactionNo,
        workflowTemplateId: txn.workflowTemplateId,
        workflowStepId: receiptStepId,
        lines: [{ description: "รายการทดสอบ", quantity: "1", unitCost: "100" }],
      },
      uploads: [{ evidenceKey: "paymentSlip", originalName: "slip.jpg", type: "image/jpeg", buffer: Buffer.from("slip") }],
    });
    assert.ok(submitted.receiptNo, "with no declared receiptType on the template step, any receiptType value must be accepted");
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("GET prefill route surfaces payee/purpose/lines groups from a completed sibling document", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-workflow-http-"));
  const child = spawnLocalServer(rootDir);
  try {
    const port = await waitForServerPort(child);
    const baseUrl = `http://localhost:${port}`;

    const txn = await startTransactionOverHttp(baseUrl);
    await submitAndCompletePurchaseOrder(baseUrl, txn);

    const prefill = await requestJsonOk(
      baseUrl,
      `/api/workflow-transactions/${txn.transactionNo}/prefill?documentKind=substitute_receipt&stepId=${txn.steps[1].stepId}`,
    );
    assert.equal(prefill.context.payee.name, "ร้านค้าตัวอย่าง");
    assert.deepEqual(prefill.availableGroups.slice().sort(), ["lines", "payee", "purpose"]);

    const mismatched = await requestJson(
      baseUrl,
      `/api/workflow-transactions/${txn.transactionNo}/prefill?documentKind=payment_voucher&stepId=${txn.steps[0].stepId}`,
    );
    assert.equal(mismatched.ok, false, "a documentKind that does not match the step must be refused");
  } finally {
    await stopServer(child);
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("GET workflow-transaction file route enforces the section/traversal guard and 404s cleanly", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-workflow-http-"));
  const child = spawnLocalServer(rootDir);
  try {
    const port = await waitForServerPort(child);
    const baseUrl = `http://localhost:${port}`;

    const txn = await startTransactionOverHttp(baseUrl);

    // getWorkflowTransactionFile() only allows section "pdf" — no packet PDF
    // exists yet, so there is nothing to assert a successful fetch against.
    // This route must be wired faithfully to what the guard actually does today.
    const badSection = await fetch(`${baseUrl}/api/workflow-transactions/${txn.transactionNo}/files/data/workflow-transaction.json`);
    assert.equal(badSection.status, 404);

    const traversal = await fetch(`${baseUrl}/api/workflow-transactions/${txn.transactionNo}/files/pdf/..%2Fdata%2Fworkflow-transaction.json`);
    assert.equal(traversal.status, 404);

    const notFound = await fetch(`${baseUrl}/api/workflow-transactions/${txn.transactionNo}/files/pdf/does-not-exist.pdf`);
    assert.equal(notFound.status, 404);
  } finally {
    await stopServer(child);
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("GET .../files/pdf/:fileName downloads the generated packet PDF", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-workflow-http-"));
  const child = spawnLocalServer(rootDir);
  try {
    const port = await waitForServerPort(child);
    const baseUrl = `http://localhost:${port}`;

    const txn = await requestJsonOk(baseUrl, "/api/workflow-transactions", {
      method: "POST",
      body: JSON.stringify({
        templateId: "director_expense_cash",
        accountingMonth: "2026-09",
        title: "ทดสอบดาวน์โหลด packet",
      }),
    });
    await requestJsonOk(baseUrl, `/api/workflow-transactions/${txn.transactionNo}/refresh`, { method: "POST" });

    const download = await fetch(`${baseUrl}/api/workflow-transactions/${txn.transactionNo}/files/pdf/${encodeURIComponent("99_ชุดรวมเอกสาร_workflow-transaction.pdf")}`);
    assert.equal(download.status, 200);
  } finally {
    await stopServer(child);
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("GET workflow-transaction detail carries the packet in its own pdfFiles, distinct from child documents', with a URL that really serves the PDF", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-workflow-http-"));
  const child = spawnLocalServer(rootDir);
  try {
    const port = await waitForServerPort(child);
    const baseUrl = `http://localhost:${port}`;

    const txn = await requestJsonOk(baseUrl, "/api/workflow-transactions", {
      method: "POST",
      body: JSON.stringify({
        templateId: "director_expense_cash",
        accountingMonth: "2026-09",
        title: "ทดสอบ pdfFiles ของธุรกรรม",
      }),
    });

    // Refresh is what actually generates the packet on disk.
    await requestJsonOk(baseUrl, `/api/workflow-transactions/${txn.transactionNo}/refresh`, { method: "POST" });

    // The bug under test: a later, plain GET (not the refresh response) must
    // also carry the transaction's own pdfFiles — the page loads via GET,
    // not via refresh, so refresh alone attaching pdfFiles is not enough.
    const detail = await requestJsonOk(baseUrl, `/api/workflow-transactions/${txn.transactionNo}`);

    const packetFile = (detail.pdfFiles || []).find(
      (file) => file.name === "99_ชุดรวมเอกสาร_workflow-transaction.pdf",
    );
    assert.ok(packetFile, "the transaction detail response must carry the packet in its own pdfFiles");

    // The transaction's own pdfFiles must stay distinct from every child
    // document's pdfFiles — a regression that mixed the two, or minted a
    // child document's URL for the packet (or vice versa), must fail here
    // even though the field is merely present.
    for (const doc of detail.childDocuments || []) {
      for (const file of doc.pdfFiles || []) {
        assert.notEqual(
          file.url,
          packetFile.url,
          "a child document's own PDF must not share the packet's download URL",
        );
      }
    }

    // Assert on the actually served response, not just the field: the URL
    // must resolve through getWorkflowTransactionFile to real PDF bytes, not
    // a 404 or an HTML/JSON error page that happens to return 200.
    const download = await fetch(`${baseUrl}${packetFile.url}`);
    assert.equal(download.status, 200);
    assert.equal(download.headers.get("content-type"), "application/pdf");
    const bytes = Buffer.from(await download.arrayBuffer());
    assert.equal(bytes.subarray(0, 5).toString("latin1"), "%PDF-", "the served body must be a real PDF, not JSON/HTML");
  } finally {
    await stopServer(child);
    await rm(rootDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// The workflow progress page (forms/workflow-transaction.html) has one job:
// show every child document's PDF and raw evidence links in one place. That
// requires the transaction detail response itself to carry those documents —
// GET /api/workflow-transactions/:transactionNo and POST .../refresh must
// both attach a `childDocuments` array with working pdfFiles/rawFiles URLs,
// for every document kind a template can reference. An earlier task on this
// branch shipped a six-entry table with only one entry actually asserted, so
// every one of the seven kinds gets its own real HTTP fetch below, not just a
// shared assertion helper trusted to cover all of them.
// ---------------------------------------------------------------------------

const ALL_DOCUMENT_KINDS = [
  "purchase_order",
  "payment_voucher",
  "cash_spend_declaration",
  "payee_acknowledgement",
  "goods_receipt",
  "expense_request",
  "substitute_receipt",
];

async function buildTransactionWithEveryDocumentKind(rootDir, baseUrl) {
  await requestJsonOk(baseUrl, "/api/workflow-templates", {
    method: "POST",
    body: JSON.stringify({
      templateId: "all_kinds_test_template",
      name: "ทดสอบทุกประเภทเอกสาร",
      documentSteps: ALL_DOCUMENT_KINDS.map((documentKind) => ({ documentKind })),
    }),
  });

  const txn = await startTransactionOverHttp(baseUrl, {
    templateId: "all_kinds_test_template",
    title: "ทดสอบเอกสารครบทุกประเภท",
  });
  assert.equal(txn.steps.length, ALL_DOCUMENT_KINDS.length);

  // The five lightweight kinds all go through the generic workflow-document
  // shell: submit, then complete.
  const lightweightKinds = ALL_DOCUMENT_KINDS.slice(0, 5);
  for (let i = 0; i < lightweightKinds.length; i += 1) {
    const documentKind = lightweightKinds[i];
    const formData = new FormData();
    formData.append("payload", JSON.stringify({
      documentKind,
      transactionNo: txn.transactionNo,
      workflowTemplateId: txn.workflowTemplateId,
      workflowStepId: txn.steps[i].stepId,
      accountingMonth: "2026-09",
      documentDate: "2026-09-06",
      title: `เอกสารทดสอบ ${documentKind}`,
      requesterName: "คุณต้า",
      payeeName: "ร้านค้าตัวอย่าง",
      businessPurpose: "ทดสอบ transaction detail รวมเอกสาร",
      lines: [{ description: "รายการทดสอบ", quantity: "1", unitCost: "10" }],
    }));
    formData.append("evidence_evidence", new Blob([`evidence-for-${documentKind}`], { type: "text/plain" }), "evidence.txt");

    const created = await requestJsonOk(baseUrl, "/api/workflow-documents", { method: "POST", body: formData });
    await requestJsonOk(baseUrl, `/api/workflow-documents/${documentKind}/${created.documentNo}/complete`, {
      method: "POST",
      body: JSON.stringify({ completedBy: "คุณต้า" }),
    });
  }

  // expense_request: its own dedicated submission route. A PDF is generated
  // at submission time, before any approval.
  const expenseFormData = new FormData();
  expenseFormData.append("payload", JSON.stringify({
    accountingMonth: "2026-09",
    requestTitle: "เบิกค่าใช้จ่ายทดสอบ",
    requestType: "reimbursement",
    requesterName: "คุณต้า",
    businessPurpose: "ทดสอบ transaction detail",
    paymentTargetName: "คุณต้า",
    transactionNo: txn.transactionNo,
    workflowTemplateId: txn.workflowTemplateId,
    workflowStepId: txn.steps[5].stepId,
    expenseLines: [{
      date: "2026-09-05",
      category: "ค่าส่ง/ขนส่ง",
      description: "ค่าใช้จ่ายทดสอบ",
      vendor: "ผู้ขายทดสอบ",
      amountBeforeVat: "100",
      vatAmount: "7",
      withholdingTax: "0",
    }],
  }));
  expenseFormData.append("evidence_businessEvidence", new Blob(["evidence-for-expense_request"], { type: "text/plain" }), "evidence.txt");
  const expenseSubmitted = await requestJsonOk(baseUrl, "/api/expense-requests", { method: "POST", body: expenseFormData });
  await requestJsonOk(baseUrl, `/api/expense-requests/${expenseSubmitted.requestNo}/approve`, {
    method: "POST",
    body: JSON.stringify({ approvedBy: "เจ้าของ" }),
  });
  // Completed over its real HTTP route (Important 2 fix) — an expense_request
  // step could never leave in_progress before this route was wired.
  await requestJsonOk(baseUrl, `/api/expense-requests/${expenseSubmitted.requestNo}/complete`, {
    method: "POST",
    body: JSON.stringify({ completedBy: "บัญชี" }),
  });

  // substitute_receipt: its own dedicated submission route. A general_expense
  // receipt counts as workflow-completed once approved (the hybrid rule in
  // deriveChildWorkflowStatus), which is reachable over HTTP.
  const receiptFormData = new FormData();
  receiptFormData.append("payload", JSON.stringify({
    accountingMonth: "2026-09",
    receiptDate: "2026-09-05",
    receiptTitle: "ใบรับรองแทนใบเสร็จทดสอบ",
    receiptType: "general_expense",
    payeeName: "ผู้ขายทดสอบ",
    businessPurpose: "ทดสอบ transaction detail",
    transactionNo: txn.transactionNo,
    workflowTemplateId: txn.workflowTemplateId,
    workflowStepId: txn.steps[6].stepId,
    lines: [{ description: "ค่าใช้จ่ายทดสอบ", quantity: "1", unitCost: "107" }],
  }));
  receiptFormData.append("evidence_paymentSlip", new Blob(["slip"], { type: "text/plain" }), "slip.txt");
  const receiptSubmitted = await requestJsonOk(baseUrl, "/api/substitute-receipts", { method: "POST", body: receiptFormData });
  await requestJsonOk(baseUrl, `/api/substitute-receipts/${receiptSubmitted.receiptNo}/approve`, {
    method: "POST",
    body: JSON.stringify({ approvedBy: "บัญชี" }),
  });

  return txn;
}

async function assertDetailCarriesEveryChildDocument(baseUrl, detail, txn) {
  assert.ok(Array.isArray(detail.childDocuments), "response must carry a childDocuments array");
  assert.equal(detail.childDocuments.length, ALL_DOCUMENT_KINDS.length, "every started document kind must appear");

  for (let i = 0; i < ALL_DOCUMENT_KINDS.length; i += 1) {
    const documentKind = ALL_DOCUMENT_KINDS[i];
    const doc = detail.childDocuments.find((entry) => entry.documentKind === documentKind);
    assert.ok(doc, `${documentKind}: must appear in childDocuments`);
    assert.equal(doc.workflowStepId, txn.steps[i].stepId, `${documentKind}: workflowStepId must match its step`);
    assert.ok(doc.documentNo, `${documentKind}: must carry its own document number`);
    assert.ok(doc.status, `${documentKind}: must carry its native status`);

    assert.ok(Array.isArray(doc.pdfFiles) && doc.pdfFiles.length >= 1, `${documentKind}: must carry at least one pdfFiles entry, not null`);
    const pdfFile = doc.pdfFiles[0];
    assert.ok(pdfFile.url, `${documentKind}: pdfFiles[0] must carry a url`);
    const pdfResponse = await fetch(`${baseUrl}${pdfFile.url}`);
    assert.equal(pdfResponse.status, 200, `${documentKind}: pdfFiles[0].url must actually serve the PDF`);

    assert.ok(Array.isArray(doc.rawFiles) && doc.rawFiles.length >= 1, `${documentKind}: must carry at least one rawFiles entry`);
    const rawFile = doc.rawFiles[0];
    assert.ok(rawFile.url, `${documentKind}: rawFiles[0] must carry a url`);
    const rawResponse = await fetch(`${baseUrl}${rawFile.url}`);
    assert.equal(rawResponse.status, 200, `${documentKind}: rawFiles[0].url must actually serve the raw file`);
  }
}

test("GET workflow-transaction detail carries every child document's pdfFiles/rawFiles with working URLs, for all seven document kinds", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-workflow-http-"));
  const child = spawnLocalServer(rootDir);
  try {
    const port = await waitForServerPort(child);
    const baseUrl = `http://localhost:${port}`;

    const txn = await buildTransactionWithEveryDocumentKind(rootDir, baseUrl);

    const detail = await requestJsonOk(baseUrl, `/api/workflow-transactions/${txn.transactionNo}`);
    await assertDetailCarriesEveryChildDocument(baseUrl, detail, txn);
  } finally {
    await stopServer(child);
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("POST workflow-transaction refresh carries the same childDocuments shape as the detail route", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-workflow-http-"));
  const child = spawnLocalServer(rootDir);
  try {
    const port = await waitForServerPort(child);
    const baseUrl = `http://localhost:${port}`;

    const txn = await buildTransactionWithEveryDocumentKind(rootDir, baseUrl);

    const refreshed = await requestJsonOk(baseUrl, `/api/workflow-transactions/${txn.transactionNo}/refresh`, {
      method: "POST",
    });
    await assertDetailCarriesEveryChildDocument(baseUrl, refreshed, txn);

    // All lightweight steps plus expense_request/substitute_receipt were
    // completed, so strict template order must show every step completed.
    for (const step of refreshed.steps) {
      assert.equal(step.workflowStatus, "completed", `${step.documentKind}: expected completed after every child document was finished`);
    }
  } finally {
    await stopServer(child);
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("POST .../complete refuses until every step is done, then completes and surfaces a sync_failed Drive status without hitting the network", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-workflow-http-"));
  const child = spawnLocalServer(rootDir);
  try {
    const port = await waitForServerPort(child);
    const baseUrl = `http://localhost:${port}`;

    const template = await requestJsonOk(baseUrl, "/api/workflow-templates", {
      method: "POST",
      body: JSON.stringify({
        templateId: `single_step_http_${Date.now()}`,
        name: "ทดสอบ complete ผ่าน HTTP",
        syncGoogleDrive: true,
        documentSteps: [{ documentKind: "payment_voucher" }],
      }),
    });

    const txn = await startTransactionOverHttp(baseUrl, { templateId: template.templateId });

    const refused = await requestJson(baseUrl, `/api/workflow-transactions/${txn.transactionNo}/complete`, {
      method: "POST",
      body: JSON.stringify({ completedBy: "บัญชี" }),
    });
    assert.equal(refused.ok, false, "must refuse completion while the step is incomplete");

    const submitted = await requestJsonOk(baseUrl, "/api/workflow-documents", {
      method: "POST",
      body: workflowDocumentFormData({
        documentKind: "payment_voucher",
        transactionNo: txn.transactionNo,
        workflowTemplateId: txn.workflowTemplateId,
        workflowStepId: txn.steps[0].stepId,
      }),
    });
    await requestJsonOk(baseUrl, `/api/workflow-documents/payment_voucher/${submitted.documentNo}/complete`, {
      method: "POST",
      body: JSON.stringify({ completedBy: "คุณต้า" }),
    });
    await requestJsonOk(baseUrl, `/api/workflow-transactions/${txn.transactionNo}/refresh`, { method: "POST" });

    // syncGoogleDrive is true on this template, so /complete auto-syncs using
    // the real uploadFolderToGoogleDrive — but this rootDir has no Google
    // Drive config, so it fails fast (no network call) with a clear
    // sync_failed status rather than throwing past completion.
    const completed = await requestJsonOk(baseUrl, `/api/workflow-transactions/${txn.transactionNo}/complete`, {
      method: "POST",
      body: JSON.stringify({ completedBy: "บัญชี" }),
    });
    assert.equal(completed.status, "completed");
    assert.equal(completed.driveSync.syncStatus, "sync_failed");
    assert.ok(completed.driveSync.error, "a failed sync must carry a Thai-surfaceable error message");

    // The manual sync route must also stay callable post-completion and
    // fail the same safe way.
    const manualSync = await requestJsonOk(baseUrl, `/api/workflow-transactions/${txn.transactionNo}/sync-drive`, {
      method: "POST",
    });
    assert.equal(manualSync.syncStatus, "sync_failed");
  } finally {
    await stopServer(child);
    await rm(rootDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Important 2 repro: completeExpenseRequest/completeSubstituteReceipt were
// implemented, exported, and unit-tested, but neither had an HTTP route (no
// import, no route, no UI control for expense_request), so an expense_request
// step could never leave in_progress and start-document refused every step
// after it forever. Every completion test elsewhere in this file drives a
// synthetic single-step payment_voucher template (see completeSingleStepTransaction
// above) — this is the one test that drives a REAL shipped template
// (director_expense_transfer: expense_request -> substitute_receipt ->
// payment_voucher, one of five of the six shipped templates that contain an
// expense_request step) end to end purely over HTTP, through each document's
// own real route, the way an actual user would.
// ---------------------------------------------------------------------------
test("director_expense_transfer (a real shipped template) completes end to end purely over HTTP", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-workflow-http-"));
  const child = spawnLocalServer(rootDir);
  try {
    const port = await waitForServerPort(child);
    const baseUrl = `http://localhost:${port}`;

    const txn = await startTransactionOverHttp(baseUrl, {
      templateId: "director_expense_transfer",
      title: "เบิกค่าส่งเจ้าของ ทดสอบผ่าน HTTP ทั้งกระบวนการ",
    });
    assert.deepEqual(txn.steps.map((step) => step.documentKind), ["expense_request", "substitute_receipt", "payment_voucher"]);

    // Step 1: expense_request — its own dedicated submission route, then
    // approve, then the newly-wired complete route. All three over HTTP.
    const expenseFormData = new FormData();
    expenseFormData.append("payload", JSON.stringify({
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
    }));
    expenseFormData.append("evidence_businessEvidence", new Blob(["evidence"], { type: "text/plain" }), "evidence.txt");
    const expenseSubmitted = await requestJsonOk(baseUrl, "/api/expense-requests", { method: "POST", body: expenseFormData });

    await requestJsonOk(baseUrl, `/api/expense-requests/${expenseSubmitted.requestNo}/approve`, {
      method: "POST",
      body: JSON.stringify({ approvedBy: "เจ้าของ" }),
    });
    const expenseCompleted = await requestJsonOk(baseUrl, `/api/expense-requests/${expenseSubmitted.requestNo}/complete`, {
      method: "POST",
      body: JSON.stringify({ completedBy: "บัญชี" }),
    });
    assert.equal(expenseCompleted.status, "completed");

    const afterExpense = await requestJsonOk(baseUrl, `/api/workflow-transactions/${txn.transactionNo}/refresh`, { method: "POST" });
    assert.equal(afterExpense.steps[0].workflowStatus, "completed", "expense_request step must be completed after its own /complete route");
    assert.equal(afterExpense.steps[1].workflowStatus, "not_started", "substitute_receipt step must now be unblocked");

    // Step 2: substitute_receipt — its own dedicated submission route, then
    // approve, then the newly-wired complete route (not load-bearing here —
    // the hybrid rule already completes an approved general_expense receipt —
    // but wired for consistency, so exercised here too).
    const receiptFormData = new FormData();
    receiptFormData.append("payload", JSON.stringify({
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
    }));
    receiptFormData.append("evidence_paymentSlip", new Blob(["slip"], { type: "text/plain" }), "slip.txt");
    const receiptSubmitted = await requestJsonOk(baseUrl, "/api/substitute-receipts", { method: "POST", body: receiptFormData });

    await requestJsonOk(baseUrl, `/api/substitute-receipts/${receiptSubmitted.receiptNo}/approve`, {
      method: "POST",
      body: JSON.stringify({ approvedBy: "บัญชี" }),
    });
    const receiptCompleted = await requestJsonOk(baseUrl, `/api/substitute-receipts/${receiptSubmitted.receiptNo}/complete`, {
      method: "POST",
      body: JSON.stringify({ completedBy: "บัญชี" }),
    });
    assert.equal(receiptCompleted.status, "completed");

    const afterReceipt = await requestJsonOk(baseUrl, `/api/workflow-transactions/${txn.transactionNo}/refresh`, { method: "POST" });
    assert.equal(afterReceipt.steps[1].workflowStatus, "completed");
    assert.equal(afterReceipt.steps[2].workflowStatus, "not_started", "payment_voucher step must now be unblocked");

    // Step 3: payment_voucher — the generic workflow-document shell — create
    // then complete, both over its own real routes.
    const voucherSubmitted = await requestJsonOk(baseUrl, "/api/workflow-documents", {
      method: "POST",
      body: workflowDocumentFormData({
        documentKind: "payment_voucher",
        transactionNo: txn.transactionNo,
        workflowTemplateId: txn.workflowTemplateId,
        workflowStepId: txn.steps[2].stepId,
      }),
    });
    await requestJsonOk(baseUrl, `/api/workflow-documents/payment_voucher/${voucherSubmitted.documentNo}/complete`, {
      method: "POST",
      body: JSON.stringify({ completedBy: "บัญชี" }),
    });

    const afterVoucher = await requestJsonOk(baseUrl, `/api/workflow-transactions/${txn.transactionNo}/refresh`, { method: "POST" });
    assert.equal(afterVoucher.steps[2].workflowStatus, "completed");
    assert.equal(afterVoucher.status, "completed", "every step done must already report the transaction itself as completed");

    // And the transaction can actually be closed out through its own route.
    const completedTransaction = await requestJsonOk(baseUrl, `/api/workflow-transactions/${txn.transactionNo}/complete`, {
      method: "POST",
      body: JSON.stringify({ completedBy: "บัญชี" }),
    });
    assert.equal(completedTransaction.status, "completed");
    assert.ok(completedTransaction.completedAt);
  } finally {
    await stopServer(child);
    await rm(rootDir, { recursive: true, force: true });
  }
});

// Smaller-item repro: every pdfFiles/rawFiles entry attached to the
// workflow-transaction GET/refresh/complete responses used to still carry the
// server's own absolute filesystem path, leaking it to any client. Fixed by
// omitAbsolutePathsFromWorkflowTransactionResponse in local-server.mjs,
// applied to all three routes (never to the expense-request or
// substitute-receipt routes, which are out of scope for this fix).
test("GET/refresh/complete workflow-transaction routes never leak absolutePath on any pdfFiles/rawFiles entry", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-workflow-http-"));
  const child = spawnLocalServer(rootDir);
  try {
    const port = await waitForServerPort(child);
    const baseUrl = `http://localhost:${port}`;

    const template = await requestJsonOk(baseUrl, "/api/workflow-templates", {
      method: "POST",
      body: JSON.stringify({
        templateId: `single_step_leak_${Date.now()}`,
        name: "ทดสอบไม่ให้รั่วไหล path ของเซิร์ฟเวอร์",
        syncGoogleDrive: false,
        documentSteps: [{ documentKind: "payment_voucher" }],
      }),
    });
    const txn = await startTransactionOverHttp(baseUrl, { templateId: template.templateId });
    const created = await requestJsonOk(baseUrl, "/api/workflow-documents", {
      method: "POST",
      body: workflowDocumentFormData({
        documentKind: "payment_voucher",
        transactionNo: txn.transactionNo,
        workflowTemplateId: txn.workflowTemplateId,
        workflowStepId: txn.steps[0].stepId,
      }),
    });
    await requestJsonOk(baseUrl, `/api/workflow-documents/payment_voucher/${created.documentNo}/complete`, {
      method: "POST",
      body: JSON.stringify({ completedBy: "คุณต้า" }),
    });

    const detail = await requestJsonOk(baseUrl, `/api/workflow-transactions/${txn.transactionNo}`);
    assert.equal(JSON.stringify(detail).includes("absolutePath"), false, "GET detail must never leak absolutePath");
    assert.ok(detail.pdfFiles.length > 0 || detail.childDocuments.some((doc) => doc.pdfFiles.length > 0), "sanity: this transaction must actually have files to check");

    const refreshed = await requestJsonOk(baseUrl, `/api/workflow-transactions/${txn.transactionNo}/refresh`, { method: "POST" });
    assert.equal(JSON.stringify(refreshed).includes("absolutePath"), false, "POST refresh must never leak absolutePath");

    const completed = await requestJsonOk(baseUrl, `/api/workflow-transactions/${txn.transactionNo}/complete`, {
      method: "POST",
      body: JSON.stringify({ completedBy: "คุณต้า" }),
    });
    assert.equal(JSON.stringify(completed).includes("absolutePath"), false, "POST complete must never leak absolutePath");
  } finally {
    await stopServer(child);
    await rm(rootDir, { recursive: true, force: true });
  }
});
