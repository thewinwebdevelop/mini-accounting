import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import docLogic from "../forms/workflow-document.logic.js";
import serverLogic from "../forms/local-server.logic.js";

test("lightweight workflow documents expose required standalone kinds", () => {
  assert.deepEqual(docLogic.LIGHTWEIGHT_DOCUMENT_KINDS, [
    "purchase_order",
    "payment_voucher",
    "cash_spend_declaration",
    "payee_acknowledgement",
    "goods_receipt",
  ]);
});

test("buildWorkflowDocumentPayload creates document numbers by kind", () => {
  const payload = docLogic.buildWorkflowDocumentPayload({
    documentKind: "payment_voucher",
    sequence: "4",
    accountingMonth: "2026-09",
    documentDate: "2026-09-06",
    title: "คืนเงินกรรมการ",
    requesterName: "คุณต้า",
    payeeName: "กรรมการ",
    businessPurpose: "คืนเงินสำรองจ่าย",
    lines: [{ description: "ค่าส่งเข้าคลัง", quantity: "1", unitCost: "120" }],
    transactionNo: "TXN-2026-09-0001",
    workflowTemplateId: "director_expense_transfer",
    workflowStepId: "step-003",
  }, { now: () => "2026-09-06T12:00:00.000Z" });

  assert.equal(payload.documentKind, "payment_voucher");
  assert.equal(payload.documentNo, "PV-2026-09-0004");
  assert.equal(payload.transactionNo, "TXN-2026-09-0001");
  assert.equal(payload.status, "draft");
  assert.equal(payload.totals.grossAmount, "120.00");
});

test("validateWorkflowDocumentPayload requires traceable fields", () => {
  assert.deepEqual(docLogic.validateWorkflowDocumentPayload({}), [
    "เลือกประเภทเอกสาร",
    "ระบุเดือนบัญชี",
    "ระบุวันที่เอกสาร",
    "ระบุชื่อเอกสาร",
    "ระบุวัตถุประสงค์ทางธุรกิจ",
    "เพิ่มรายการอย่างน้อย 1 รายการ",
  ]);
});

test("getWorkflowDocumentFile rejects path traversal and resolves legitimate files", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-workflow-"));
  try {
    const payload = docLogic.buildWorkflowDocumentPayload({
      documentKind: "payment_voucher",
      sequence: "1",
      accountingMonth: "2026-09",
      documentDate: "2026-09-06",
      title: "ทดสอบ",
      requesterName: "คุณต้า",
      payeeName: "ร้านค้า",
      businessPurpose: "ทดสอบ",
      lines: [{ description: "ค่าใช้จ่าย", quantity: "1", unitCost: "100" }],
    }, { now: () => "2026-09-06T12:00:00.000Z" });
    const saved = await serverLogic.saveWorkflowDocument({ rootDir, payload, uploads: [] });
    const record = await serverLogic.getWorkflowDocument(rootDir, "payment_voucher", saved.documentNo);

    const pdfDir = join(rootDir, record.folderPath, "pdf");
    await mkdir(pdfDir, { recursive: true });
    await writeFile(join(pdfDir, "01_payment_voucher.pdf"), "stub-pdf");

    const legit = await serverLogic.getWorkflowDocumentFile({
      rootDir,
      documentKind: "payment_voucher",
      documentNo: saved.documentNo,
      section: "pdf",
      fileName: "01_payment_voucher.pdf",
    });
    assert.ok(legit.absolutePath.startsWith(pdfDir));

    await assert.rejects(() => serverLogic.getWorkflowDocumentFile({
      rootDir,
      documentKind: "payment_voucher",
      documentNo: saved.documentNo,
      section: "raw",
      fileName: "../data/workflow-document.json",
    }));
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("getWorkflowDocumentFile rejects every invalid input branch, not just path traversal", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-workflow-"));
  try {
    const payload = docLogic.buildWorkflowDocumentPayload({
      documentKind: "purchase_order",
      sequence: "1",
      accountingMonth: "2026-09",
      documentDate: "2026-09-06",
      title: "ทดสอบ branch",
      businessPurpose: "ทดสอบ",
      lines: [{ description: "รายการ", quantity: "1", unitCost: "10" }],
    }, { now: () => "2026-09-06T12:00:00.000Z" });
    const saved = await serverLogic.saveWorkflowDocument({ rootDir, payload, uploads: [] });

    await assert.rejects(
      () => serverLogic.getWorkflowDocumentFile({ rootDir, documentKind: "purchase_order", documentNo: "", section: "pdf", fileName: "01_purchase_order.pdf" }),
      /ไม่มีเลขที่เอกสาร/,
    );
    await assert.rejects(
      () => serverLogic.getWorkflowDocumentFile({ rootDir, documentKind: "purchase_order", documentNo: saved.documentNo, section: "data", fileName: "workflow-document.json" }),
      /ส่วนไฟล์ไม่ถูกต้อง/,
    );
    await assert.rejects(
      () => serverLogic.getWorkflowDocumentFile({ rootDir, documentKind: "purchase_order", documentNo: saved.documentNo, section: "pdf", fileName: ".." }),
      /ชื่อไฟล์ไม่ถูกต้อง/,
    );
    await assert.rejects(
      () => serverLogic.getWorkflowDocumentFile({ rootDir, documentKind: "purchase_order", documentNo: "PO-2026-09-9999", section: "pdf", fileName: "01_purchase_order.pdf" }),
      /ไม่พบเอกสาร/,
    );
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("WORKFLOW_DOCUMENT_STATUS_LABELS covers every standalone status", () => {
  assert.deepEqual(docLogic.WORKFLOW_DOCUMENT_STATUS_LABELS, {
    draft: "แบบร่าง",
    pending_approval: "รอตรวจอนุมัติ",
    approved: "อนุมัติแล้ว",
    completed: "เสร็จสิ้น",
    cancelled: "ยกเลิก",
  });
});

test("buildWorkflowDocumentPayload assigns the right prefix for every lightweight kind", () => {
  const expectedPrefixes = {
    purchase_order: "PO",
    payment_voucher: "PV",
    cash_spend_declaration: "CSD",
    payee_acknowledgement: "PAR",
    goods_receipt: "GR",
  };

  for (const kind of docLogic.LIGHTWEIGHT_DOCUMENT_KINDS) {
    const payload = docLogic.buildWorkflowDocumentPayload({
      documentKind: kind,
      sequence: "1",
      accountingMonth: "2026-09",
      documentDate: "2026-09-06",
      title: `ทดสอบ ${kind}`,
      businessPurpose: "ทดสอบ",
      lines: [{ description: "รายการ", quantity: "1", unitCost: "10" }],
    }, { now: () => "2026-09-06T12:00:00.000Z" });

    assert.equal(payload.documentNo, `${expectedPrefixes[kind]}-2026-09-0001`, `wrong document number for ${kind}`);
    assert.equal(payload.folderPath, `documents/2026/09/${kind}/${payload.documentNo}_ทดสอบ-${kind}`, `wrong folder path for ${kind}`);
  }
});

test("buildWorkflowDocumentPayload rejects an unknown document kind", () => {
  assert.throws(() => docLogic.buildWorkflowDocumentPayload({ documentKind: "not_a_real_kind" }));
});

test("buildWorkflowDocumentRawFileName produces sequential, extension-preserving names", () => {
  assert.equal(docLogic.buildWorkflowDocumentRawFileName("evidence", "photo.JPG", 0), "evidence_001.jpg");
  assert.equal(docLogic.buildWorkflowDocumentRawFileName("evidence", "photo.jpg", 1), "evidence_002.jpg");
  assert.equal(docLogic.buildWorkflowDocumentRawFileName("evidence", "no-extension", 0), "evidence_001");
});

test("Critical 2 exploit: a hostile evidenceKey cannot escape the raw/ directory via buildWorkflowDocumentRawFileName", () => {
  // Reproduction from the security review: evidenceKey is the multipart field
  // name minus the "evidence_" prefix, which is fully attacker-controlled.
  // Before the fix, buildWorkflowDocumentRawFileName("../../../ESCAPED", "x.txt", 0)
  // produced "../../../ESCAPED_001.txt" — a name that, joined onto rawDir, writes
  // clean outside rootDir.
  const hostileKeys = [
    "../../../ESCAPED",
    "..\\..\\ESCAPED",
    "/etc/passwd",
    "....//....//ESCAPED",
    "...",
    "..",
    "/",
    "\\",
  ];

  for (const hostileKey of hostileKeys) {
    const name = docLogic.buildWorkflowDocumentRawFileName(hostileKey, "x.txt", 0);
    assert.ok(!name.includes("/"), `${JSON.stringify(hostileKey)} -> ${JSON.stringify(name)} must not contain "/"`);
    assert.ok(!name.includes("\\"), `${JSON.stringify(hostileKey)} -> ${JSON.stringify(name)} must not contain "\\"`);
    assert.ok(!name.includes(".."), `${JSON.stringify(hostileKey)} -> ${JSON.stringify(name)} must not contain ".."`);
  }
});

test("getWorkflowDocument returns null (not a throw) when the document does not exist", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-workflow-"));
  try {
    const record = await serverLogic.getWorkflowDocument(rootDir, "payment_voucher", "PV-2026-09-9999");
    assert.equal(record, null);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("saveWorkflowDocument persists data/working-md/pdf files and listWorkflowDocuments filters by kind and transaction", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-workflow-"));
  try {
    const poPayload = docLogic.buildWorkflowDocumentPayload({
      documentKind: "purchase_order",
      sequence: "1",
      accountingMonth: "2026-09",
      documentDate: "2026-09-06",
      title: "สั่งซื้อ Lot กันยายน",
      businessPurpose: "สั่งซื้อสินค้า",
      lines: [{ description: "สินค้า A", quantity: "2", unitCost: "50" }],
      transactionNo: "TXN-2026-09-0001",
      workflowStepId: "step-001",
    }, { now: () => "2026-09-06T12:00:00.000Z" });
    const savedPo = await serverLogic.saveWorkflowDocument({ rootDir, payload: poPayload, uploads: [] });

    const grPayload = docLogic.buildWorkflowDocumentPayload({
      documentKind: "goods_receipt",
      sequence: "1",
      accountingMonth: "2026-09",
      documentDate: "2026-09-07",
      title: "รับของ Lot กันยายน",
      businessPurpose: "รับสินค้าเข้าคลัง",
      lines: [{ description: "สินค้า A", quantity: "2", unitCost: "50" }],
    }, { now: () => "2026-09-07T12:00:00.000Z" });
    await serverLogic.saveWorkflowDocument({ rootDir, payload: grPayload, uploads: [] });

    const record = await serverLogic.getWorkflowDocument(rootDir, "purchase_order", savedPo.documentNo);
    assert.ok(record);
    assert.equal(record.payload.documentNo, savedPo.documentNo);

    const { readFile, stat } = await import("node:fs/promises");
    const dataJson = JSON.parse(await readFile(join(rootDir, record.folderPath, "data", "workflow-document.json"), "utf8"));
    assert.equal(dataJson.documentNo, savedPo.documentNo);
    const markdown = await readFile(join(rootDir, record.folderPath, "working-md", "workflow-document.md"), "utf8");
    assert.match(markdown, /สั่งซื้อ Lot กันยายน/);
    const pdfStat = await stat(join(rootDir, record.folderPath, "pdf", "01_purchase_order.pdf"));
    assert.ok(pdfStat.size > 0);

    const onlyPurchaseOrders = await serverLogic.listWorkflowDocuments(rootDir, { documentKind: "purchase_order" });
    assert.equal(onlyPurchaseOrders.length, 1);
    assert.equal(onlyPurchaseOrders[0].documentNo, savedPo.documentNo);

    const byTransaction = await serverLogic.listWorkflowDocuments(rootDir, { transactionNo: "TXN-2026-09-0001" });
    assert.equal(byTransaction.length, 1);
    assert.equal(byTransaction[0].documentKind, "purchase_order");

    const all = await serverLogic.listWorkflowDocuments(rootDir, {});
    assert.equal(all.length, 2);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("completeWorkflowDocument stamps completedAt/completedBy once and is idempotent on repeat calls", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-workflow-"));
  try {
    const payload = docLogic.buildWorkflowDocumentPayload({
      documentKind: "cash_spend_declaration",
      sequence: "1",
      accountingMonth: "2026-09",
      documentDate: "2026-09-06",
      title: "จ่ายเงินสดค่าขนส่ง",
      businessPurpose: "จ่ายเงินสด",
      lines: [{ description: "ค่าขนส่ง", quantity: "1", unitCost: "300" }],
    }, { now: () => "2026-09-06T12:00:00.000Z" });
    const saved = await serverLogic.saveWorkflowDocument({ rootDir, payload, uploads: [] });

    const first = await serverLogic.completeWorkflowDocument({
      rootDir,
      documentKind: "cash_spend_declaration",
      documentNo: saved.documentNo,
      completedBy: "คุณต้า",
      now: () => "2026-09-06T13:00:00.000Z",
    });
    assert.equal(first.status, "completed");
    assert.equal(first.completedAt, "2026-09-06T13:00:00.000Z");
    assert.equal(first.completedBy, "คุณต้า");

    const second = await serverLogic.completeWorkflowDocument({
      rootDir,
      documentKind: "cash_spend_declaration",
      documentNo: saved.documentNo,
      completedBy: "someone-else",
      now: () => "2026-09-06T14:00:00.000Z",
    });
    assert.equal(second.status, "completed");
    assert.equal(second.completedAt, "2026-09-06T13:00:00.000Z", "repeat completion must not overwrite the original completedAt");
    assert.equal(second.completedBy, "คุณต้า", "repeat completion must not overwrite the original completedBy");
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("saveWorkflowDocument names multiple uploads sequentially from index 0, even when the payload carries no prior evidenceFiles guess", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-workflow-"));
  try {
    const payload = docLogic.buildWorkflowDocumentPayload({
      documentKind: "purchase_order",
      sequence: "1",
      accountingMonth: "2026-09",
      documentDate: "2026-09-06",
      title: "แนบหลักฐานหลายไฟล์",
      businessPurpose: "ทดสอบ",
      lines: [{ description: "รายการ", quantity: "1", unitCost: "10" }],
    }, { now: () => "2026-09-06T12:00:00.000Z" });

    // buildWorkflowDocumentPayload was called with no evidenceFiles at all — this mirrors
    // what the real browser controller now sends (it does not pre-guess stored names for
    // files that have not been uploaded yet), so saveWorkflowDocument's own upload-naming
    // must start counting from zero rather than double-counting a client-side guess.
    assert.deepEqual(payload.evidenceFiles, {});

    const uploads = [
      { evidenceKey: "evidence", originalName: "quote-a.txt", buffer: Buffer.from("a"), type: "text/plain" },
      { evidenceKey: "evidence", originalName: "quote-b.txt", buffer: Buffer.from("b"), type: "text/plain" },
    ];
    const saved = await serverLogic.saveWorkflowDocument({ rootDir, payload, uploads });

    assert.deepEqual(saved.rawFiles.sort(), ["evidence_001.txt", "evidence_002.txt"]);

    const { readFile: readFileAsync } = await import("node:fs/promises");
    const rawDir = join(rootDir, saved.folderPath, "raw");
    assert.equal(await readFileAsync(join(rawDir, "evidence_001.txt"), "utf8"), "a");
    assert.equal(await readFileAsync(join(rawDir, "evidence_002.txt"), "utf8"), "b");
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("saveWorkflowDocument keeps two raw evidence keys that sanitize to the same slug from clobbering each other", async () => {
  // sanitizeEvidenceKey lowercases and strips a wide character class including
  // dots, so "a.b" and "ab" — two different raw multipart field names a client
  // is free to send — both collapse to the slug "ab". prepareUploadRecords used
  // to count occurrences of the *raw* evidenceKey while the stored file name was
  // built from the *sanitized* slug, so each raw key started its own counter at
  // 0 and both files landed on "ab_001.jpg" — the second write silently clobbered
  // the first, and the first upload's evidenceFiles metadata then pointed at
  // content it never held.
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-workflow-"));
  try {
    const payload = docLogic.buildWorkflowDocumentPayload({
      documentKind: "purchase_order",
      sequence: "1",
      accountingMonth: "2026-09",
      documentDate: "2026-09-06",
      title: "หลักฐานชื่อคีย์ชนกัน",
      businessPurpose: "ทดสอบ",
      lines: [{ description: "รายการ", quantity: "1", unitCost: "10" }],
    }, { now: () => "2026-09-06T12:00:00.000Z" });

    const uploads = [
      { evidenceKey: "a.b", originalName: "first.jpg", buffer: Buffer.from("first"), type: "image/jpeg" },
      { evidenceKey: "ab", originalName: "second.jpg", buffer: Buffer.from("second"), type: "image/jpeg" },
    ];
    const saved = await serverLogic.saveWorkflowDocument({ rootDir, payload, uploads });

    assert.deepEqual(
      saved.rawFiles.sort(),
      ["ab_001.jpg", "ab_002.jpg"],
      "colliding raw evidence keys must produce two distinct stored files, not the same name twice",
    );

    const { readFile: readFileAsync } = await import("node:fs/promises");
    const rawDir = join(rootDir, saved.folderPath, "raw");
    const contents = await Promise.all(
      ["ab_001.jpg", "ab_002.jpg"].map((name) => readFileAsync(join(rawDir, name), "utf8")),
    );
    assert.deepEqual(contents.sort(), ["first", "second"], "both uploaded files must survive on disk, unclobbered");

    const record = await serverLogic.getWorkflowDocument(rootDir, "purchase_order", saved.documentNo);
    const allFiles = Object.values(record.payload.evidenceFiles).flat();
    assert.equal(allFiles.length, 2, "evidenceFiles metadata must track both uploads, not just one surviving pointer");
    for (const file of allFiles) {
      const content = await readFileAsync(join(rawDir, file.storedName), "utf8");
      assert.ok(content.length > 0, `metadata entry for ${file.storedName} must point at real content on disk`);
    }
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("saveWorkflowDocument works without any workflow context (transactionNo absent)", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-workflow-"));
  try {
    const payload = docLogic.buildWorkflowDocumentPayload({
      documentKind: "payee_acknowledgement",
      sequence: "1",
      accountingMonth: "2026-09",
      documentDate: "2026-09-06",
      title: "รับทราบการรับเงิน",
      businessPurpose: "ยืนยันรับเงินคืน",
      lines: [{ description: "รับเงินคืน", quantity: "1", unitCost: "500" }],
    }, { now: () => "2026-09-06T12:00:00.000Z" });
    assert.equal(payload.transactionNo, "");

    const saved = await serverLogic.saveWorkflowDocument({ rootDir, payload, uploads: [] });
    const record = await serverLogic.getWorkflowDocument(rootDir, "payee_acknowledgement", saved.documentNo);
    assert.equal(record.payload.transactionNo, "");

    const completed = await serverLogic.completeWorkflowDocument({
      rootDir,
      documentKind: "payee_acknowledgement",
      documentNo: saved.documentNo,
      completedBy: "คุณต้า",
      now: () => "2026-09-06T15:00:00.000Z",
    });
    assert.equal(completed.status, "completed");
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("assertPathWithinDirectory allows a path inside the base directory and refuses one that escapes it", () => {
  // Direct unit coverage for the defense-in-depth guard saveWorkflowDocument now
  // applies on both the folder-path and the raw-evidence-write side, independent
  // of whatever upstream sanitization happens to prevent a hostile path from
  // reaching it today.
  assert.doesNotThrow(() => serverLogic.assertPathWithinDirectory("/root/docs", "/root/docs/raw/file.txt", "should not throw"));
  assert.doesNotThrow(() => serverLogic.assertPathWithinDirectory("/root/docs", "/root/docs", "should not throw"));
  assert.throws(() => serverLogic.assertPathWithinDirectory("/root/docs", "/root/other/file.txt", "escaped"), /escaped/);
  assert.throws(() => serverLogic.assertPathWithinDirectory("/root/docs", "/root/docs-sibling/file.txt", "escaped"), /escaped/, "a sibling directory that merely shares a prefix must still be rejected");
  assert.throws(() => serverLogic.assertPathWithinDirectory("/root/docs", "/tmp/escaped", "escaped"), /escaped/);
});

test("Critical 3 exploit: saveWorkflowDocument refuses a folderPath that resolves outside rootDir", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-workflow-"));
  try {
    const payload = docLogic.buildWorkflowDocumentPayload({
      documentKind: "purchase_order",
      sequence: "1",
      accountingMonth: "2026-09",
      documentDate: "2026-09-06",
      title: "ทดสอบ",
      businessPurpose: "ทดสอบ",
      lines: [{ description: "รายการ", quantity: "1", unitCost: "10" }],
      // A client posting raw JSON can set folderPath directly (this is exactly
      // what buildWorkflowDocumentPayload accepts verbatim when present) — this
      // reproduces the exploit from the security review: honoring it verbatim
      // let a client's write land anywhere on disk.
      folderPath: "../../../../tmp/sweet-house-escaped",
    }, { now: () => "2026-09-06T12:00:00.000Z" });

    await assert.rejects(
      () => serverLogic.saveWorkflowDocument({ rootDir, payload, uploads: [] }),
      /ที่อยู่โฟลเดอร์เอกสารไม่ถูกต้อง/,
    );

    const { existsSync } = await import("node:fs");
    assert.equal(existsSync("/tmp/sweet-house-escaped"), false, "the escaping folder must never be created");
  } finally {
    await rm(rootDir, { recursive: true, force: true });
    const { rm: rmAsync } = await import("node:fs/promises");
    await rmAsync("/tmp/sweet-house-escaped", { recursive: true, force: true });
  }
});

test("completeWorkflowDocument refuses to complete a cancelled document but allows every other origin status", async () => {
  const statusOutcomes = {
    draft: "accepted",
    pending_approval: "accepted",
    approved: "accepted",
    cancelled: "rejected",
  };

  for (const [originStatus, outcome] of Object.entries(statusOutcomes)) {
    const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-workflow-"));
    try {
      const payload = docLogic.buildWorkflowDocumentPayload({
        documentKind: "purchase_order",
        sequence: "1",
        accountingMonth: "2026-09",
        documentDate: "2026-09-06",
        title: `ทดสอบสถานะ ${originStatus}`,
        businessPurpose: "ทดสอบ",
        lines: [{ description: "รายการ", quantity: "1", unitCost: "10" }],
        status: originStatus,
      }, { now: () => "2026-09-06T12:00:00.000Z" });
      const saved = await serverLogic.saveWorkflowDocument({ rootDir, payload, uploads: [] });

      const attempt = serverLogic.completeWorkflowDocument({
        rootDir,
        documentKind: "purchase_order",
        documentNo: saved.documentNo,
        completedBy: "คุณต้า",
        now: () => "2026-09-06T13:00:00.000Z",
      });

      if (outcome === "accepted") {
        const result = await attempt;
        assert.equal(result.status, "completed", `origin status "${originStatus}" must be completable`);
      } else {
        await assert.rejects(() => attempt, undefined, `origin status "${originStatus}" must not be completable`);
        const record = await serverLogic.getWorkflowDocument(rootDir, "purchase_order", saved.documentNo);
        assert.equal(record.status, originStatus, `a rejected completion must leave status "${originStatus}" unchanged`);
      }
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  }
});

test("completeWorkflowDocument stays idempotent even though completed is not in the completable-origin set", async () => {
  // completed -> completed is the one self-transition that must still succeed as
  // a no-op (retry / double-click / replayed request), even though "completed"
  // is not itself an origin status the transition guard is meant to open up.
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-workflow-"));
  try {
    const payload = docLogic.buildWorkflowDocumentPayload({
      documentKind: "purchase_order",
      sequence: "1",
      accountingMonth: "2026-09",
      documentDate: "2026-09-06",
      title: "ทดสอบซ้ำ",
      businessPurpose: "ทดสอบ",
      lines: [{ description: "รายการ", quantity: "1", unitCost: "10" }],
    }, { now: () => "2026-09-06T12:00:00.000Z" });
    const saved = await serverLogic.saveWorkflowDocument({ rootDir, payload, uploads: [] });

    await serverLogic.completeWorkflowDocument({
      rootDir,
      documentKind: "purchase_order",
      documentNo: saved.documentNo,
      completedBy: "คุณต้า",
      now: () => "2026-09-06T13:00:00.000Z",
    });

    const again = await serverLogic.completeWorkflowDocument({
      rootDir,
      documentKind: "purchase_order",
      documentNo: saved.documentNo,
      completedBy: "someone-else",
      now: () => "2026-09-06T14:00:00.000Z",
    });
    assert.equal(again.status, "completed");
    assert.equal(again.completedBy, "คุณต้า");
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("saveWorkflowDocument re-checks status immediately before writing and refuses a document completed behind its back", async () => {
  // handleWorkflowDocumentSubmission reads the existing document, confirms it is
  // not "completed", then awaits saveWorkflowDocument (mkdir + writeFile + a
  // spawned PDF generator). If a POST .../complete lands in that window, the
  // save must not proceed from its now-stale pre-completion snapshot and
  // silently revert the freshly completed record. This test drives that race
  // deterministically: build the payload the route would have built from a
  // pre-completion read, then — behind saveWorkflowDocument's back — flip the
  // stored record to "completed" directly on disk, exactly as a concurrent
  // /complete request would have. saveWorkflowDocument must then refuse.
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-workflow-"));
  try {
    const created = await serverLogic.saveWorkflowDocument({
      rootDir,
      payload: docLogic.buildWorkflowDocumentPayload({
        documentKind: "purchase_order",
        sequence: "1",
        accountingMonth: "2026-09",
        documentDate: "2026-09-06",
        title: "เอกสารก่อนเสร็จสิ้น",
        businessPurpose: "ทดสอบ",
        lines: [{ description: "รายการ", quantity: "1", unitCost: "10" }],
      }, { now: () => "2026-09-06T12:00:00.000Z" }),
      uploads: [],
    });

    const preCompletionRecord = await serverLogic.getWorkflowDocument(rootDir, "purchase_order", created.documentNo);

    // This mirrors exactly what handleWorkflowDocumentSubmission builds for an
    // edit: the client's new field values plus the server-owned fields carried
    // forward from the (still pre-completion) stored record.
    const stalePayload = docLogic.buildWorkflowDocumentPayload({
      documentKind: "purchase_order",
      accountingMonth: "2026-09",
      documentDate: "2026-09-06",
      title: "พยายามแก้ไขระหว่างแข่งขัน",
      businessPurpose: "ทดสอบ",
      lines: [{ description: "รายการแก้ไข", quantity: "2", unitCost: "20" }],
      documentNo: preCompletionRecord.documentNo,
      folderPath: preCompletionRecord.folderPath,
      status: preCompletionRecord.status,
      statusHistory: preCompletionRecord.payload.statusHistory,
      completedAt: preCompletionRecord.payload.completedAt,
      completedBy: preCompletionRecord.payload.completedBy,
      createdAt: preCompletionRecord.payload.createdAt,
    }, { now: () => "2026-09-06T12:05:00.000Z" });

    // Simulate a concurrent /complete request winning the race: flip the
    // stored record to completed directly on disk, behind saveWorkflowDocument's
    // back, in between the route's own early check and the save that follows.
    const { readFile: readFileAsync } = await import("node:fs/promises");
    const dataPath = join(rootDir, preCompletionRecord.folderPath, "data", "workflow-document.json");
    const onDisk = JSON.parse(await readFileAsync(dataPath, "utf8"));
    onDisk.status = "completed";
    onDisk.statusLabel = docLogic.WORKFLOW_DOCUMENT_STATUS_LABELS.completed;
    onDisk.completedAt = "2026-09-06T12:03:00.000Z";
    onDisk.completedBy = "คนอื่น";
    onDisk.statusHistory = [
      ...onDisk.statusHistory,
      { fromStatus: "draft", toStatus: "completed", changedAt: "2026-09-06T12:03:00.000Z", note: "completed" },
    ];
    await writeFile(dataPath, `${JSON.stringify(onDisk, null, 2)}\n`, "utf8");

    await assert.rejects(
      () => serverLogic.saveWorkflowDocument({ rootDir, payload: stalePayload, uploads: [] }),
      /ไม่สามารถแก้ไขเอกสารที่เสร็จสิ้นแล้วได้/,
      "a save built from a stale pre-completion snapshot must be refused once the document has since been completed",
    );

    const afterAttempt = JSON.parse(await readFileAsync(dataPath, "utf8"));
    assert.equal(afterAttempt.status, "completed", "the refused save must not have reverted the completed status");
    assert.equal(afterAttempt.completedBy, "คนอื่น", "the refused save must not have touched the real completion audit stamp");
    assert.equal(afterAttempt.title, "เอกสารก่อนเสร็จสิ้น", "the refused save must not have overwritten the stored title");
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("saveWorkflowDocument refused by the completed guard leaves no orphaned raw evidence file behind", async () => {
  // A save that the completed-on-disk guard refuses must not have left any new
  // file in the document's raw/ folder — such a file would be unreferenced by
  // the persisted evidenceFiles metadata (the refused save never committed),
  // and every retry of a naive client would leak another one. Drive it the
  // same deterministic way as the race test above: mutate the stored JSON on
  // disk to "completed" behind saveWorkflowDocument's back, then attempt an
  // edit that also uploads a new evidence file (mirroring the reviewer's
  // sneaky_001.jpg repro), and assert the raw folder ends up exactly as it
  // started.
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-workflow-"));
  try {
    const created = await serverLogic.saveWorkflowDocument({
      rootDir,
      payload: docLogic.buildWorkflowDocumentPayload({
        documentKind: "purchase_order",
        sequence: "1",
        accountingMonth: "2026-09",
        documentDate: "2026-09-06",
        title: "เอกสารก่อนเสร็จสิ้น",
        businessPurpose: "ทดสอบ",
        lines: [{ description: "รายการ", quantity: "1", unitCost: "10" }],
      }, { now: () => "2026-09-06T12:00:00.000Z" }),
      uploads: [],
    });

    const preCompletionRecord = await serverLogic.getWorkflowDocument(rootDir, "purchase_order", created.documentNo);
    const rawDir = join(rootDir, preCompletionRecord.folderPath, "raw");
    const rawFilesBefore = existsSync(rawDir) ? (await readdir(rawDir)).sort() : [];

    const stalePayload = docLogic.buildWorkflowDocumentPayload({
      documentKind: "purchase_order",
      accountingMonth: "2026-09",
      documentDate: "2026-09-06",
      title: "พยายามแนบไฟล์ระหว่างแข่งขัน",
      businessPurpose: "ทดสอบ",
      lines: [{ description: "รายการแก้ไข", quantity: "2", unitCost: "20" }],
      documentNo: preCompletionRecord.documentNo,
      folderPath: preCompletionRecord.folderPath,
      status: preCompletionRecord.status,
      statusHistory: preCompletionRecord.payload.statusHistory,
      completedAt: preCompletionRecord.payload.completedAt,
      completedBy: preCompletionRecord.payload.completedBy,
      createdAt: preCompletionRecord.payload.createdAt,
    }, { now: () => "2026-09-06T12:05:00.000Z" });

    const { readFile: readFileAsync } = await import("node:fs/promises");
    const dataPath = join(rootDir, preCompletionRecord.folderPath, "data", "workflow-document.json");
    const onDisk = JSON.parse(await readFileAsync(dataPath, "utf8"));
    onDisk.status = "completed";
    onDisk.statusLabel = docLogic.WORKFLOW_DOCUMENT_STATUS_LABELS.completed;
    onDisk.completedAt = "2026-09-06T12:03:00.000Z";
    onDisk.completedBy = "คนอื่น";
    onDisk.statusHistory = [
      ...onDisk.statusHistory,
      { fromStatus: "draft", toStatus: "completed", changedAt: "2026-09-06T12:03:00.000Z", note: "completed" },
    ];
    await writeFile(dataPath, `${JSON.stringify(onDisk, null, 2)}\n`, "utf8");

    const sneakyUploads = [
      { evidenceKey: "evidence", originalName: "sneaky.jpg", buffer: Buffer.from("sneaky"), type: "image/jpeg" },
    ];

    await assert.rejects(
      () => serverLogic.saveWorkflowDocument({ rootDir, payload: stalePayload, uploads: sneakyUploads }),
      /ไม่สามารถแก้ไขเอกสารที่เสร็จสิ้นแล้วได้/,
      "a save built from a stale pre-completion snapshot must be refused once the document has since been completed",
    );

    const rawFilesAfter = existsSync(rawDir) ? (await readdir(rawDir)).sort() : [];
    assert.deepEqual(rawFilesAfter, rawFilesBefore, "a refused save must not leave any new file in raw/");
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("writeWorkflowDocumentFiles checks beforeCommit immediately before the json commit, after the directories are created", async () => {
  // Issue: the guard used to live only in saveWorkflowDocument, several awaited
  // mkdir calls (and a markdown write) away from the actual commit write in
  // writeWorkflowDocumentFiles. Each await is an event-loop yield a concurrent
  // .../complete request can land in. This test exercises writeWorkflowDocumentFiles
  // directly (it is not deterministically reachable through saveWorkflowDocument's
  // public API without real concurrency) to confirm: the mkdir calls still run,
  // beforeCommit is awaited immediately after them, and if it refuses, the json
  // commit file is never written.
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-workflow-"));
  try {
    const payload = docLogic.buildWorkflowDocumentPayload({
      documentKind: "purchase_order",
      sequence: "1",
      accountingMonth: "2026-09",
      documentDate: "2026-09-06",
      title: "ทดสอบ beforeCommit",
      businessPurpose: "ทดสอบ",
      lines: [{ description: "รายการ", quantity: "1", unitCost: "10" }],
    }, { now: () => "2026-09-06T12:00:00.000Z" });
    payload.folderPath = "documents/purchase_order/2026-09/PO-TEST-0001";

    let beforeCommitCalled = false;
    await assert.rejects(
      () => serverLogic.writeWorkflowDocumentFiles(rootDir, payload, {
        beforeCommit: async () => {
          beforeCommitCalled = true;
          throw new Error("ไม่สามารถแก้ไขเอกสารที่เสร็จสิ้นแล้วได้");
        },
      }),
      /ไม่สามารถแก้ไขเอกสารที่เสร็จสิ้นแล้วได้/,
    );

    assert.equal(beforeCommitCalled, true, "beforeCommit must be awaited before the commit write");

    const dataDir = join(rootDir, payload.folderPath, "data");
    assert.equal(existsSync(dataDir), true, "the mkdir calls must still have run before beforeCommit was checked");
    assert.equal(
      existsSync(join(dataDir, "workflow-document.json")),
      false,
      "the json commit must not be written once beforeCommit refuses",
    );
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});
