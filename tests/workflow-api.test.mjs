import assert from "node:assert/strict";
import { spawn } from "node:child_process";
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
