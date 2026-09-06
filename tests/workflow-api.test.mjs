import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
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
