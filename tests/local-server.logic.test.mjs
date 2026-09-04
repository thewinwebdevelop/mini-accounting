import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import companySettingsLogic from "../forms/company-settings.logic.js";
import inventoryLogic from "../forms/inventory.logic.js";
import serverLogic from "../forms/local-server.logic.js";

const execFileAsync = promisify(execFile);
const { saveCompanySettings } = companySettingsLogic;
const {
  createProduct,
  createStockSku,
  getStockCard,
} = inventoryLogic;
const {
  approveSubstituteReceipt,
  getExpenseDraft,
  getExpenseRequestFile,
  getNextExpenseRequestInfo,
  getNextSubstituteReceiptInfo,
  getSubstituteReceiptDraft,
  getSubmittedSubstituteReceipt,
  getSubmittedExpenseRequest,
  listExpenseRequests,
  listExpenseDrafts,
  listSubstituteReceipts,
  parseMultipartForm,
  receiveSubstituteReceiptStock,
  saveExpenseDraft,
  saveExpenseSubmission,
  saveSubstituteReceiptDraft,
  saveSubstituteReceiptSubmission,
  syncExpenseRequestToDrive,
} = serverLogic;

function getPythonExecutable() {
  const bundledPython = join(
    homedir(),
    ".cache",
    "codex-runtimes",
    "codex-primary-runtime",
    "dependencies",
    "python",
    "bin",
    "python3",
  );
  return existsSync(bundledPython) ? bundledPython : "python3";
}

async function extractPdfText(pdfPath) {
  const { stdout } = await execFileAsync(getPythonExecutable(), [
    "-c",
    [
      "from pypdf import PdfReader",
      "import sys",
      "reader = PdfReader(sys.argv[1])",
      "print('\\n'.join((page.extract_text() or '') for page in reader.pages))",
    ].join("; "),
    pdfPath,
  ], {
    maxBuffer: 1024 * 1024,
  });
  return stdout;
}

function validSubstituteReceiptPayload(overrides = {}) {
  return {
    accountingMonth: "2026-09",
    receiptDate: "2026-09-04",
    receiptTitle: "ซื้อเสื้อไม่มีใบเสร็จ",
    receiptType: "stock_purchase",
    payeeName: "บริษัทขายส่งตัวอย่าง",
    paymentChannel: "โอนผ่านบัญชีบริษัท",
    paymentReference: "KBANK-TR-001",
    businessPurpose: "ซื้อสินค้าเพื่อขาย",
    lines: [
      {
        stockSkuId: "1",
        sku: "TOP-A-WHITE-M",
        description: "เสื้อ A สีขาว M",
        quantity: "2",
        unitCost: "100",
      },
    ],
    ...overrides,
  };
}

function validSlipUpload() {
  return [{ evidenceKey: "paymentSlip", originalName: "slip.jpg", type: "image/jpeg", buffer: Buffer.from("slip") }];
}

test("parseMultipartForm extracts payload fields and uploaded evidence files", () => {
  const boundary = "----sweet-house-test";
  const body = Buffer.from(
    [
      `--${boundary}`,
      'Content-Disposition: form-data; name="payload"',
      "",
      '{"requestTitle":"ค่าส่งพัสดุ"}',
      `--${boundary}`,
      'Content-Disposition: form-data; name="evidence_fullTaxInvoice"; filename="invoice.jpg"',
      "Content-Type: image/jpeg",
      "",
      "invoice-content",
      `--${boundary}--`,
      "",
    ].join("\r\n"),
  );

  const result = parseMultipartForm(body, `multipart/form-data; boundary=${boundary}`);

  assert.equal(result.fields.payload, '{"requestTitle":"ค่าส่งพัสดุ"}');
  assert.equal(result.files.length, 1);
  assert.equal(result.files[0].evidenceKey, "fullTaxInvoice");
  assert.equal(result.files[0].originalName, "invoice.jpg");
  assert.equal(result.files[0].type, "image/jpeg");
  assert.equal(result.files[0].buffer.toString("utf8"), "invoice-content");
});

test("getNextExpenseRequestInfo calculates the next sequence from saved request folders", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-expense-"));

  try {
    await mkdir(join(rootDir, "documents", "2026", "09", "เบิกจ่าย", "REQ-2026-09-0002_old"), { recursive: true });
    await mkdir(join(rootDir, "documents", "2026", "09", "เบิกจ่าย", "REQ-2026-09-0010_latest"), { recursive: true });
    await mkdir(join(rootDir, "documents", "2026", "10", "เบิกจ่าย", "REQ-2026-10-0004_other-month"), { recursive: true });

    assert.deepEqual(await getNextExpenseRequestInfo(rootDir, "2026-09"), {
      sequence: "11",
      requestNo: "REQ-2026-09-0011",
    });
    assert.deepEqual(await getNextExpenseRequestInfo(rootDir, "2026-11"), {
      sequence: "1",
      requestNo: "REQ-2026-11-0001",
    });
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("getNextSubstituteReceiptInfo calculates the next SR sequence from saved receipt folders", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-substitute-"));

  try {
    await mkdir(join(rootDir, "documents", "2026", "09", "ใบรับรองแทนใบเสร็จ", "SR-2026-09-0002_old"), { recursive: true });
    await mkdir(join(rootDir, "documents", "2026", "09", "ใบรับรองแทนใบเสร็จ", "SR-2026-09-0010_latest"), { recursive: true });
    await mkdir(join(rootDir, "documents", "2026", "10", "ใบรับรองแทนใบเสร็จ", "SR-2026-10-0004_other-month"), { recursive: true });

    assert.deepEqual(await getNextSubstituteReceiptInfo(rootDir, "2026-09"), {
      sequence: "11",
      receiptNo: "SR-2026-09-0011",
    });
    assert.deepEqual(await getNextSubstituteReceiptInfo(rootDir, "2026-11"), {
      sequence: "1",
      receiptNo: "SR-2026-11-0001",
    });
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("saveExpenseDraft writes editable drafts without consuming a real request number", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-expense-"));

  try {
    const result = await saveExpenseDraft({
      rootDir,
      payload: {
        accountingMonth: "2026-09",
        requestTitle: "ร่างค่าแพ็คสินค้า",
        requestType: "reimbursement",
        requesterName: "คุณร่าง",
        expenseLines: [],
      },
      uploads: [
        {
          evidenceKey: "receipt",
          originalName: "receipt.jpg",
          type: "image/jpeg",
          buffer: Buffer.from("receipt image"),
        },
      ],
    });

    assert.match(result.draftId, /^DRAFT-2026-09-/);
    assert.match(result.folderPath, /^drafts\/2026\/09\/DRAFT-2026-09-/);
    assert.equal(result.rawFiles[0].storedName, "A1_receipt_001.jpg");

    const next = await getNextExpenseRequestInfo(rootDir, "2026-09");
    assert.equal(next.requestNo, "REQ-2026-09-0001");

    const loaded = await getExpenseDraft(rootDir, result.draftId);
    assert.equal(loaded.draftId, result.draftId);
    assert.equal(loaded.payload.requesterName, "คุณร่าง");
    assert.deepEqual(loaded.evidenceFiles.receipt.map((file) => file.storedName), ["A1_receipt_001.jpg"]);

    const drafts = await listExpenseDrafts(rootDir);
    assert.deepEqual(drafts.map((draft) => draft.draftId), [result.draftId]);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("saveExpenseDraft updates an existing draft and keeps previous raw files", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-expense-"));

  try {
    const first = await saveExpenseDraft({
      rootDir,
      payload: {
        accountingMonth: "2026-09",
        requestTitle: "ร่างค่าแพ็คสินค้า",
        requestType: "reimbursement",
      },
      uploads: [
        {
          evidenceKey: "receipt",
          originalName: "receipt.jpg",
          type: "image/jpeg",
          buffer: Buffer.from("receipt image"),
        },
      ],
    });

    const updated = await saveExpenseDraft({
      rootDir,
      payload: {
        draftId: first.draftId,
        accountingMonth: "2026-09",
        requestTitle: "ร่างค่าแพ็คสินค้าแก้ไข",
        requestType: "reimbursement",
      },
      uploads: [
        {
          evidenceKey: "receipt",
          originalName: "receipt-2.jpg",
          type: "image/jpeg",
          buffer: Buffer.from("receipt image 2"),
        },
      ],
    });

    assert.equal(updated.draftId, first.draftId);
    assert.deepEqual(updated.rawFiles.map((file) => file.storedName), [
      "A1_receipt_001.jpg",
      "A1_receipt_002.jpg",
    ]);
    assert.equal(await readFile(join(updated.absoluteFolderPath, "raw", "A1_receipt_001.jpg"), "utf8"), "receipt image");
    assert.equal(await readFile(join(updated.absoluteFolderPath, "raw", "A1_receipt_002.jpg"), "utf8"), "receipt image 2");
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("saveSubstituteReceiptDraft writes editable drafts without consuming SR numbers or stock", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-substitute-draft-"));

  try {
    const draft = await saveSubstituteReceiptDraft({
      rootDir,
      payload: {
        accountingMonth: "2026-09",
        receiptDate: "2026-09-04",
        receiptTitle: "รอของจากผู้ขาย",
        receiptType: "stock_purchase",
        payeeName: "บริษัทขายส่งตัวอย่าง",
        businessPurpose: "ซื้อสินค้าเพื่อขาย",
        lines: [{ stockSkuId: "1", sku: "TOP-A", description: "เสื้อ A", quantity: "2", unitCost: "100" }],
      },
      uploads: [{ evidenceKey: "paymentSlip", originalName: "slip.jpg", type: "image/jpeg", buffer: Buffer.from("slip") }],
    });

    assert.match(draft.draftId, /^SR-DRAFT-2026-09-/);
    assert.match(draft.folderPath, /^drafts\/2026\/09\/substitute-receipts\//);
    assert.equal((await getNextSubstituteReceiptInfo(rootDir, "2026-09")).receiptNo, "SR-2026-09-0001");
    assert.deepEqual(draft.rawFiles.map((file) => file.storedName), ["B1_payment-slip_001.jpg"]);

    const loaded = await getSubstituteReceiptDraft(rootDir, draft.draftId);
    assert.equal(loaded.status, "draft");
    assert.equal(loaded.payload.receiptTitle, "รอของจากผู้ขาย");
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("saveExpenseSubmission writes uploaded raw files and workflow data into the request folder", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-expense-"));

  try {
    const result = await saveExpenseSubmission({
      rootDir,
      payload: {
        sequence: "5",
        accountingMonth: "2026-09",
        requestTitle: "ค่าส่งพัสดุ",
        requestType: "reimbursement",
        requesterName: "คุณตัวอย่าง",
        businessPurpose: "ค่าส่งสินค้าให้ลูกค้า",
        paymentTargetName: "คุณตัวอย่าง",
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
      uploads: [
        {
          evidenceKey: "fullTaxInvoice",
          originalName: "invoice.jpg",
          type: "image/jpeg",
          buffer: Buffer.from("invoice image"),
        },
        {
          evidenceKey: "vendorPaymentSlip",
          originalName: "slip.pdf",
          type: "application/pdf",
          buffer: Buffer.from("payment slip"),
        },
      ],
    });

    assert.equal(result.requestNo, "REQ-2026-09-0001");
    assert.equal(result.rawFiles.length, 2);
    assert.deepEqual(result.pdfFiles.map((file) => file.name), [
      "01_ใบเบิกจ่าย.pdf",
      "02_ชุดรวมส่งตรวจ_audit-packet.pdf",
    ]);
    const auditPacket = result.pdfFiles.find((file) => file.name === "02_ชุดรวมส่งตรวจ_audit-packet.pdf");
    assert.equal(auditPacket.annexedRawFiles, 2);
    assert.ok(auditPacket.pageCount > 2);
    assert.deepEqual(result.rawFiles.map((file) => file.storedName), [
      "A2_tax-invoice_001.jpg",
      "A3_vendor-payment-slip_001.pdf",
    ]);

    const savedJson = JSON.parse(await readFile(join(result.absoluteFolderPath, "data", "submission.json"), "utf8"));
    assert.equal(savedJson.requestNo, "REQ-2026-09-0001");
    assert.deepEqual(savedJson.rawFiles, ["A2_tax-invoice_001.jpg", "A3_vendor-payment-slip_001.pdf"]);

    const savedMarkdown = await readFile(join(result.absoluteFolderPath, "working-md", "submission.md"), "utf8");
    assert.match(savedMarkdown, /REQ-2026-09-0001/);
    assert.equal(await readFile(join(result.absoluteFolderPath, "raw", "A2_tax-invoice_001.jpg"), "utf8"), "invoice image");
    assert.equal(await readFile(join(result.absoluteFolderPath, "raw", "A3_vendor-payment-slip_001.pdf"), "utf8"), "payment slip");

    const reimbursementPdf = await readFile(join(result.absoluteFolderPath, "pdf", "01_ใบเบิกจ่าย.pdf"));
    const auditPacketPdf = await readFile(join(result.absoluteFolderPath, "pdf", "02_ชุดรวมส่งตรวจ_audit-packet.pdf"));
    assert.equal(reimbursementPdf.subarray(0, 5).toString("utf8"), "%PDF-");
    assert.equal(auditPacketPdf.subarray(0, 5).toString("utf8"), "%PDF-");
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("saveSubstituteReceiptSubmission writes PDF packet, raw evidence, and workflow data", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-substitute-"));

  try {
    const result = await saveSubstituteReceiptSubmission({
      rootDir,
      payload: {
        sequence: "3",
        accountingMonth: "2026-09",
        receiptDate: "2026-09-04",
        receiptTitle: "ซื้อเสื้อไม่มีใบเสร็จ",
        receiptType: "stock_purchase",
        payeeName: "บริษัทขายส่งตัวอย่าง",
        paymentChannel: "โอนผ่านบัญชีบริษัท",
        paymentReference: "KBANK-TR-001",
        businessPurpose: "ซื้อสินค้าเพื่อขาย",
        lines: [
          {
            stockSkuId: "1",
            sku: "TOP-A-WHITE-M",
            description: "เสื้อ A สีขาว M",
            quantity: "2",
            unitCost: "100",
          },
        ],
      },
      uploads: [
        {
          evidenceKey: "paymentSlip",
          originalName: "slip.jpg",
          type: "image/jpeg",
          buffer: Buffer.from("payment slip image"),
        },
        {
          evidenceKey: "purchaseOrder",
          originalName: "order.pdf",
          type: "application/pdf",
          buffer: Buffer.from("purchase order pdf"),
        },
      ],
      createStockMovements: false,
    });

    assert.equal(result.receiptNo, "SR-2026-09-0001");
    assert.equal(result.status, "pending_approval");
    assert.match(result.folderPath, /documents\/2026\/09\/ใบรับรองแทนใบเสร็จ/);
    assert.deepEqual(result.rawFiles.map((file) => file.storedName), [
      "B1_payment-slip_001.jpg",
      "B2_purchase-order_001.pdf",
    ]);
    assert.deepEqual(result.pdfFiles.map((file) => file.name), [
      "01_ใบรับรองแทนใบเสร็จรับเงิน.pdf",
      "02_ชุดรวมส่งตรวจ_ใบรับรองแทนใบเสร็จ.pdf",
    ]);
    assert.equal(result.pdfFiles[1].annexedRawFiles, 2);

    const savedJson = JSON.parse(await readFile(join(result.absoluteFolderPath, "data", "substitute-receipt.json"), "utf8"));
    assert.equal(savedJson.receiptNo, "SR-2026-09-0001");
    assert.equal(savedJson.status, "pending_approval");
    assert.equal(savedJson.statusHistory[0].toStatus, "pending_approval");
    assert.equal(savedJson.totals.totalAmount, "200.00");
    assert.equal(savedJson.evidence.paymentSlip.status, "มี");
    assert.equal(await readFile(join(result.absoluteFolderPath, "raw", "B1_payment-slip_001.jpg"), "utf8"), "payment slip image");

    const receiptText = await extractPdfText(join(result.absoluteFolderPath, "pdf", "01_ใบรับรองแทนใบเสร็จรับเงิน.pdf"));
    assert.match(receiptText, /ใบรับรองแทนใบเสร็จรับเงิน/);
    assert.match(receiptText, /SR-2026-09-0001/);

    const auditText = await extractPdfText(join(result.absoluteFolderPath, "pdf", "02_ชุดรวมส่งตรวจ_ใบรับรองแทนใบเสร็จ.pdf"));
    assert.doesNotMatch(auditText, /เลขที่เอกสาร\s*-\s*รหัส\/ประเภทหลักฐาน/);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("saveSubstituteReceiptSubmission submits stock purchases without receiving stock", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-substitute-"));

  try {
    const product = createProduct(rootDir, {
      productCode: "TOP-A",
      name: "เสื้อ A",
      category: "เสื้อ",
    });
    const sku = createStockSku(rootDir, {
      productId: product.id,
      sku: "TOP-A-WHITE-M",
      color: "ขาว",
      size: "M",
      defaultUnitCost: "100",
    });

    const result = await saveSubstituteReceiptSubmission({
      rootDir,
      payload: {
        accountingMonth: "2026-09",
        receiptDate: "2026-09-04",
        receiptTitle: "ซื้อสต๊อกเสื้อ",
        receiptType: "stock_purchase",
        payeeName: "บริษัทขายส่งตัวอย่าง",
        paymentChannel: "โอนผ่านบัญชีบริษัท",
        businessPurpose: "ซื้อสินค้าเพื่อขาย",
        lines: [
          {
            stockSkuId: String(sku.id),
            sku: sku.sku,
            description: "เสื้อ A สีขาว M",
            quantity: "4",
            unitCost: "125.50",
          },
        ],
        evidenceFiles: {
          paymentSlip: [{ storedName: "B1_payment-slip_001.jpg" }],
        },
      },
      uploads: [],
    });

    assert.equal(result.status, "pending_approval");
    assert.equal(result.stockMovements.length, 0);

    const card = getStockCard(rootDir, sku.id);
    assert.equal(card.balance.quantityOnHand, 0);
    assert.equal(card.balance.inventoryValue, "0.00");
    assert.deepEqual(card.movements.map((movement) => movement.referenceNo), []);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("saveSubstituteReceiptSubmission submits a draft into pending approval", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-substitute-submit-draft-"));

  try {
    const draft = await saveSubstituteReceiptDraft({
      rootDir,
      payload: validSubstituteReceiptPayload(),
      uploads: validSlipUpload(),
    });
    const result = await saveSubstituteReceiptSubmission({
      rootDir,
      payload: { draftId: draft.draftId },
    });

    assert.equal(result.receiptNo, "SR-2026-09-0001");
    assert.equal(result.status, "pending_approval");
    assert.equal(result.stockMovements.length, 0);
    const loaded = await getSubstituteReceiptDraft(rootDir, draft.draftId, { includeSubmitted: true });
    assert.equal(loaded.status, "submitted");
    assert.equal(loaded.submittedReceiptNo, "SR-2026-09-0001");
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("listSubstituteReceipts combines drafts and submitted state records", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-substitute-list-"));

  try {
    const draft = await saveSubstituteReceiptDraft({
      rootDir,
      payload: validSubstituteReceiptPayload(),
      uploads: validSlipUpload(),
    });
    const submitted = await saveSubstituteReceiptSubmission({
      rootDir,
      payload: validSubstituteReceiptPayload({ receiptTitle: "ส่งตรวจแล้ว" }),
      uploads: validSlipUpload(),
    });

    const records = await listSubstituteReceipts(rootDir);

    assert.deepEqual(records.map((record) => record.status).sort(), ["draft", "pending_approval"]);
    assert.equal(records.some((record) => record.draftId === draft.draftId), true);
    assert.equal(records.some((record) => record.receiptNo === submitted.receiptNo), true);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("approve and receive substitute receipt stock are separate idempotent transitions", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-substitute-receive-"));

  try {
    const product = createProduct(rootDir, { productCode: "APR", name: "เสื้อ APR", category: "เสื้อ" });
    const stockSku = createStockSku(rootDir, {
      productId: product.id,
      sku: "APR-WHITE-M",
      color: "ขาว",
      size: "M",
      defaultUnitCost: "125",
    });
    const submitted = await saveSubstituteReceiptSubmission({
      rootDir,
      payload: Object.assign(validSubstituteReceiptPayload(), {
        lines: [{ stockSkuId: String(stockSku.id), sku: stockSku.sku, description: "เสื้อ APR", quantity: "4", unitCost: "125" }],
      }),
      uploads: validSlipUpload(),
    });

    const approved = await approveSubstituteReceipt({ rootDir, receiptNo: submitted.receiptNo, approvedBy: "บัญชี" });
    assert.equal(approved.status, "approved");
    assert.equal(getStockCard(rootDir, stockSku.id).balance.quantityOnHand, 0);

    const received = await receiveSubstituteReceiptStock({
      rootDir,
      receiptNo: submitted.receiptNo,
      receivedDate: "2026-09-05",
      receivedBy: "คลัง",
    });
    assert.equal(received.status, "received");
    assert.equal(received.stockMovements.length, 1);
    assert.equal(getStockCard(rootDir, stockSku.id).balance.quantityOnHand, 4);

    const loaded = await getSubmittedSubstituteReceipt(rootDir, submitted.receiptNo);
    assert.equal(loaded.payload.stockReceipt.receivedDate, "2026-09-05");
    assert.deepEqual(loaded.payload.stockReceipt.movementIds, received.stockMovements.map((movement) => movement.id));

    const receivedAgain = await receiveSubstituteReceiptStock({
      rootDir,
      receiptNo: submitted.receiptNo,
      receivedDate: "2026-09-05",
      receivedBy: "คลัง",
    });
    assert.equal(receivedAgain.stockMovements.length, 1);
    assert.equal(getStockCard(rootDir, stockSku.id).movements.length, 1);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("saveExpenseSubmission includes the reimbursement PDF inside the audit packet", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-expense-"));

  try {
    const result = await saveExpenseSubmission({
      rootDir,
      payload: {
        accountingMonth: "2026-09",
        requestTitle: "ค่าแพ็คสินค้า",
        requestType: "reimbursement",
        requesterName: "คุณตัวอย่าง",
        businessPurpose: "ซื้อวัสดุแพ็คสินค้า",
        paymentTargetName: "คุณตัวอย่าง",
        expenseLines: [
          {
            date: "2026-09-05",
            category: "วัสดุสิ้นเปลือง",
            description: "ถุงแพ็คสินค้า",
            vendor: "ร้านแพ็คสินค้า",
            amountBeforeVat: "100",
            vatAmount: "7",
            withholdingTax: "0",
          },
        ],
      },
      uploads: [],
    });

    const reimbursementPdf = result.pdfFiles.find((file) => file.name === "01_ใบเบิกจ่าย.pdf");
    const auditPacket = result.pdfFiles.find((file) => file.name === "02_ชุดรวมส่งตรวจ_audit-packet.pdf");
    assert.equal(auditPacket.annexedRawFiles, 0);
    assert.ok(auditPacket.pageCount > reimbursementPdf.pageCount);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("saveExpenseSubmission injects company settings into saved data and PDFs", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-expense-"));

  try {
    await saveCompanySettings({
      rootDir,
      legalName: "หจก.สวีทเฮาส์ เดซี่",
      taxId: "0103569007277",
      branch: "สำนักงานใหญ่",
      address: "500 หมู่ 10 แขวงหนองแขม เขตหนองแขม กรุงเทพฯ 10160",
    });

    const result = await saveExpenseSubmission({
      rootDir,
      payload: {
        accountingMonth: "2026-09",
        requestTitle: "ค่าโฆษณา",
        requestType: "reimbursement",
        requesterName: "คุณตัวอย่าง",
        businessPurpose: "ลงโฆษณา TikTok",
        paymentTargetName: "TikTok",
        expenseLines: [
          {
            date: "2026-09-05",
            category: "ค่าโฆษณา",
            description: "ค่าโฆษณา TikTok",
            vendor: "TikTok",
            amountBeforeVat: "100",
            vatAmount: "0",
            withholdingTax: "0",
          },
        ],
      },
      uploads: [],
    });

    const savedJson = JSON.parse(await readFile(join(result.absoluteFolderPath, "data", "submission.json"), "utf8"));
    assert.deepEqual(savedJson.company, {
      legalName: "หจก.สวีทเฮาส์ เดซี่",
      taxId: "0103569007277",
      branch: "สำนักงานใหญ่",
      address: "500 หมู่ 10 แขวงหนองแขม เขตหนองแขม กรุงเทพฯ 10160",
    });

    const reimbursementText = await extractPdfText(join(result.absoluteFolderPath, "pdf", "01_ใบเบิกจ่าย.pdf"));
    assert.match(reimbursementText, /หจก\.สวีทเฮาส์ เดซี่/);
    assert.match(reimbursementText, /0103569007277/);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("saveExpenseSubmission renders signable approval lines in the reimbursement PDF", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-expense-"));

  try {
    const result = await saveExpenseSubmission({
      rootDir,
      payload: {
        accountingMonth: "2026-09",
        requestTitle: "ค่าโฆษณา",
        requestType: "reimbursement",
        requesterName: "คุณตัวอย่าง",
        businessPurpose: "ลงโฆษณา TikTok",
        paymentTargetName: "TikTok",
        expenseLines: [
          {
            date: "2026-09-05",
            category: "ค่าโฆษณา",
            description: "ค่าโฆษณา TikTok",
            vendor: "TikTok",
            amountBeforeVat: "100",
            vatAmount: "0",
            withholdingTax: "0",
          },
        ],
      },
      uploads: [],
    });

    const reimbursementText = await extractPdfText(join(result.absoluteFolderPath, "pdf", "01_ใบเบิกจ่าย.pdf"));
    assert.match(reimbursementText, /ลงชื่อผู้ขอเบิก/);
    assert.match(reimbursementText, /ลงชื่อผู้ตรวจเอกสารบัญชี/);
    assert.match(reimbursementText, /ลงชื่อผู้อนุมัติ/);
    assert.match(reimbursementText, /ลงชื่อผู้จ่ายเงิน/);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("saveExpenseSubmission copies draft raw files into the final request folder", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-expense-"));

  try {
    const draft = await saveExpenseDraft({
      rootDir,
      payload: {
        accountingMonth: "2026-09",
        requestTitle: "ร่างค่าส่ง",
        requestType: "reimbursement",
        requesterName: "คุณร่าง",
        businessPurpose: "ค่าส่งสินค้า",
        paymentTargetName: "คุณร่าง",
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
      uploads: [
        {
          evidenceKey: "vendorPaymentSlip",
          originalName: "slip.jpg",
          type: "image/jpeg",
          buffer: Buffer.from("draft slip"),
        },
      ],
    });

    const final = await saveExpenseSubmission({
      rootDir,
      payload: {
        draftId: draft.draftId,
        accountingMonth: "2026-09",
        requestTitle: "ร่างค่าส่ง",
        requestType: "reimbursement",
        requesterName: "คุณร่าง",
        businessPurpose: "ค่าส่งสินค้า",
        paymentTargetName: "คุณร่าง",
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
      uploads: [],
    });

    assert.equal(final.requestNo, "REQ-2026-09-0001");
    assert.deepEqual(final.rawFiles.map((file) => file.storedName), ["A3_vendor-payment-slip_001.jpg"]);
    assert.equal(await readFile(join(final.absoluteFolderPath, "raw", "A3_vendor-payment-slip_001.jpg"), "utf8"), "draft slip");

    const submittedDraft = await getExpenseDraft(rootDir, draft.draftId, { includeSubmitted: true });
    assert.equal(submittedDraft.status, "submitted");
    assert.equal(submittedDraft.submittedRequestNo, "REQ-2026-09-0001");
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("getSubmittedExpenseRequest returns editable saved request data with raw evidence files", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-expense-"));

  try {
    const submitted = await saveExpenseSubmission({
      rootDir,
      payload: {
        accountingMonth: "2026-09",
        requestTitle: "ค่าส่งพัสดุ",
        requestType: "reimbursement",
        requesterName: "คุณส่ง",
        requesterRole: "marketing",
        requesterContact: "Line shop",
        expenseDate: "2026-09-05",
        businessPurpose: "ค่าส่งสินค้า",
        paymentTargetName: "คุณส่ง",
        paymentBankName: "กสิกรไทย",
        paymentAccountNo: "123-4-56789-0",
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
      uploads: [
        {
          evidenceKey: "receipt",
          originalName: "receipt.jpg",
          type: "image/jpeg",
          buffer: Buffer.from("receipt image"),
        },
      ],
    });

    const editable = await getSubmittedExpenseRequest(rootDir, submitted.requestNo);

    assert.equal(editable.requestNo, "REQ-2026-09-0001");
    assert.equal(editable.payload.requesterRole, "marketing");
    assert.equal(editable.payload.paymentBankName, "กสิกรไทย");
    assert.equal(editable.evidenceFiles.receipt[0].storedName, "A1_receipt_001.jpg");
    assert.equal(editable.editUrl, "/expense-request?requestNo=REQ-2026-09-0001");
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("saveExpenseSubmission updates an existing synced request in place and marks it for resync", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-expense-"));

  try {
    const submitted = await saveExpenseSubmission({
      rootDir,
      payload: {
        accountingMonth: "2026-09",
        requestTitle: "ค่าส่งพัสดุ",
        requestType: "reimbursement",
        requesterName: "คุณส่ง",
        requesterRole: "marketing",
        requesterContact: "Line shop",
        expenseDate: "2026-09-05",
        businessPurpose: "ค่าส่งสินค้า",
        paymentTargetName: "คุณส่ง",
        paymentBankName: "กสิกรไทย",
        paymentAccountNo: "123-4-56789-0",
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
      uploads: [
        {
          evidenceKey: "receipt",
          originalName: "receipt.jpg",
          type: "image/jpeg",
          buffer: Buffer.from("receipt image"),
        },
      ],
    });

    await syncExpenseRequestToDrive({
      rootDir,
      requestNo: submitted.requestNo,
      now: () => "2026-09-01T10:00:00.000Z",
      driveUploader: async () => ({
        driveFolderId: "drive-folder-123",
        driveFolderUrl: "https://drive.google.com/drive/folders/drive-folder-123",
        drivePath: "หจก.สวีทเฮาส์ เดซี่/เอกสารบัญชี/2026/09/เบิกจ่าย/REQ-2026-09-0001_ค่าส่งพัสดุ",
        uploadedFileCount: 4,
        syncStatus: "synced",
      }),
    });

    const updated = await saveExpenseSubmission({
      rootDir,
      payload: {
        requestNo: submitted.requestNo,
        accountingMonth: "2026-09",
        requestTitle: "ค่าส่งพัสดุแก้ไข",
        requestType: "reimbursement",
        requesterName: "คุณส่งแก้ไข",
        requesterRole: "marketing",
        requesterContact: "Line shop",
        expenseDate: "2026-09-06",
        businessPurpose: "ค่าส่งสินค้าเพิ่มเติม",
        paymentTargetName: "คุณส่ง",
        paymentBankName: "กสิกรไทย",
        paymentAccountNo: "123-4-56789-0",
        expenseLines: [
          {
            date: "2026-09-06",
            category: "ค่าส่ง/ขนส่ง",
            description: "ค่าส่งสินค้าเพิ่มเติม",
            vendor: "ขนส่งตัวอย่าง",
            amountBeforeVat: "200",
            vatAmount: "14",
            withholdingTax: "0",
          },
        ],
      },
      uploads: [
        {
          evidenceKey: "businessEvidence",
          originalName: "usage.png",
          type: "image/png",
          buffer: Buffer.from("usage image"),
        },
      ],
    });

    assert.equal(updated.requestNo, submitted.requestNo);
    assert.equal(updated.folderPath, submitted.folderPath);
    assert.deepEqual(updated.rawFiles.map((file) => file.storedName), [
      "A1_receipt_001.jpg",
      "A5_business-evidence_001.png",
    ]);

    const savedJson = JSON.parse(await readFile(join(updated.absoluteFolderPath, "data", "submission.json"), "utf8"));
    assert.equal(savedJson.requesterName, "คุณส่งแก้ไข");
    assert.equal(savedJson.totals.netPayment, "214.00");
    assert.deepEqual(savedJson.rawFiles, ["A1_receipt_001.jpg", "A5_business-evidence_001.png"]);

    const requests = await listExpenseRequests(rootDir);
    assert.equal(requests.filter((request) => request.status === "submitted").length, 1);
    const submittedRecord = requests.find((request) => request.requestNo === submitted.requestNo);
    assert.equal(submittedRecord.syncStatus, "needs_resync");
    assert.equal(submittedRecord.driveFolderUrl, "https://drive.google.com/drive/folders/drive-folder-123");
    assert.equal(submittedRecord.editUrl, "/expense-request?requestNo=REQ-2026-09-0001");
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("listExpenseRequests combines submitted requests and editable drafts", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-expense-"));

  try {
    const draft = await saveExpenseDraft({
      rootDir,
      payload: {
        accountingMonth: "2026-09",
        requestTitle: "ร่างค่าแพ็คสินค้า",
        requestType: "reimbursement",
        requesterName: "คุณร่าง",
        businessPurpose: "ซื้อวัสดุแพ็คสินค้า",
        paymentTargetName: "คุณร่าง",
        expenseLines: [],
      },
      uploads: [
        {
          evidenceKey: "receipt",
          originalName: "receipt.jpg",
          type: "image/jpeg",
          buffer: Buffer.from("receipt image"),
        },
      ],
    });

    const submitted = await saveExpenseSubmission({
      rootDir,
      payload: {
        accountingMonth: "2026-09",
        requestTitle: "ค่าส่งพัสดุ",
        requestType: "reimbursement",
        requesterName: "คุณส่ง",
        businessPurpose: "ค่าส่งสินค้า",
        paymentTargetName: "คุณส่ง",
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
      uploads: [
        {
          evidenceKey: "receipt",
          originalName: "receipt.jpg",
          type: "image/jpeg",
          buffer: Buffer.from("receipt image"),
        },
      ],
    });

    const requests = await listExpenseRequests(rootDir);
    assert.equal(requests.length, 2);
    assert.deepEqual(requests.map((request) => request.status).sort(), ["draft", "submitted"]);

    const draftRecord = requests.find((request) => request.status === "draft");
    assert.equal(draftRecord.draftId, draft.draftId);
    assert.equal(draftRecord.editUrl, `/expense-request?draftId=${encodeURIComponent(draft.draftId)}`);

    const submittedRecord = requests.find((request) => request.status === "submitted");
    assert.equal(submittedRecord.requestNo, submitted.requestNo);
    assert.equal(submittedRecord.pdfFiles.length, 2);
    assert.equal(submittedRecord.rawFiles.length, 1);
    assert.match(submittedRecord.pdfFiles[0].url, /^\/api\/expense-requests\/REQ-2026-09-0001\/files\/pdf\//);
    assert.equal(submittedRecord.rawFiles[0].url, "/api/expense-requests/REQ-2026-09-0001/files/raw/A1_receipt_001.jpg");
    assert.match(submittedRecord.folderPath, /documents\/2026\/09\/เบิกจ่าย/);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("getExpenseRequestFile resolves request files without allowing path traversal", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-expense-"));

  try {
    const submitted = await saveExpenseSubmission({
      rootDir,
      payload: {
        accountingMonth: "2026-09",
        requestTitle: "ค่าส่งพัสดุ",
        requestType: "reimbursement",
        requesterName: "คุณส่ง",
        businessPurpose: "ค่าส่งสินค้า",
        paymentTargetName: "คุณส่ง",
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
      uploads: [
        {
          evidenceKey: "receipt",
          originalName: "receipt.jpg",
          type: "image/jpeg",
          buffer: Buffer.from("receipt image"),
        },
      ],
    });

    const rawFile = await getExpenseRequestFile({
      rootDir,
      requestNo: submitted.requestNo,
      section: "raw",
      fileName: "A1_receipt_001.jpg",
    });
    assert.equal(await readFile(rawFile.absolutePath, "utf8"), "receipt image");

    await assert.rejects(
      () => getExpenseRequestFile({
        rootDir,
        requestNo: submitted.requestNo,
        section: "raw",
        fileName: "../data/submission.json",
      }),
      /Invalid file name/,
    );
    await assert.rejects(
      () => getExpenseRequestFile({
        rootDir,
        requestNo: submitted.requestNo,
        section: "data",
        fileName: "submission.json",
      }),
      /Invalid file section/,
    );
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("syncExpenseRequestToDrive uploads a submitted request folder with Google Drive API and records metadata", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-expense-"));
  const calls = [];

  try {
    const submitted = await saveExpenseSubmission({
      rootDir,
      payload: {
        accountingMonth: "2026-09",
        requestTitle: "ค่าส่งพัสดุ",
        requestType: "reimbursement",
        requesterName: "คุณส่ง",
        businessPurpose: "ค่าส่งสินค้า",
        paymentTargetName: "คุณส่ง",
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
      uploads: [],
    });

    const result = await syncExpenseRequestToDrive({
      rootDir,
      requestNo: submitted.requestNo,
      now: () => "2026-09-01T10:00:00.000Z",
      driveUploader: async (options) => {
        calls.push(options);
        return {
          driveFolderId: "drive-folder-123",
          driveFolderUrl: "https://drive.google.com/drive/folders/drive-folder-123",
          drivePath: "หจก.สวีทเฮาส์ เดซี่/เอกสารบัญชี/2026/09/เบิกจ่าย/REQ-2026-09-0001_ค่าส่งพัสดุ",
          uploadedFileCount: 4,
          syncStatus: "synced",
        };
      },
    });

    assert.equal(result.syncStatus, "synced");
    assert.equal(result.syncedAt, "2026-09-01T10:00:00.000Z");
    assert.equal(result.driveFolderId, "drive-folder-123");
    assert.equal(result.driveFolderUrl, "https://drive.google.com/drive/folders/drive-folder-123");
    assert.equal(result.uploadedFileCount, 4);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].rootDir, rootDir);
    assert.equal(calls[0].folderPath, submitted.folderPath);

    const metadata = JSON.parse(await readFile(join(submitted.absoluteFolderPath, "data", "drive-sync.json"), "utf8"));
    assert.equal(metadata.syncStatus, "synced");
    assert.equal(metadata.driveFolderUrl, result.driveFolderUrl);

    const requests = await listExpenseRequests(rootDir);
    const submittedRecord = requests.find((request) => request.requestNo === submitted.requestNo);
    assert.equal(submittedRecord.syncStatus, "synced");
    assert.equal(submittedRecord.driveFolderUrl, result.driveFolderUrl);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});
