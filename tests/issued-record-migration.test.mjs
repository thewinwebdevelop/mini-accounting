import assert from "node:assert/strict";
import { cp, mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { openInventoryDatabase, ensureInventorySchema } from "../forms/inventory-db.logic.js";
import documentIndex from "../forms/document-index.logic.js";
import { runMigration } from "../scripts/issued-record-migration.logic.mjs";

const AT = "2026-09-20T12:00:00.000Z";
const execFileAsync = promisify(execFile);

async function makeRoot(prefix = "sweet-house-issued-migration-") {
  return mkdtemp(join(tmpdir(), prefix));
}

async function writeIssued(rootDir, kind, documentNo, payload, folderName = "issued") {
  const fileName = kind === "expense_request" ? "submission.json" : "substitute-receipt.json";
  const folderPath = `documents/2026/09/${folderName}/${documentNo}_fixture`;
  const filePath = join(rootDir, folderPath, "data", fileName);
  await mkdir(join(rootDir, folderPath, "data"), { recursive: true });
  await writeFile(filePath, JSON.stringify({ ...payload, folderPath }, null, 2) + "\n");
  return { filePath, folderPath };
}

async function snapshotRoot(sourceRoot) {
  const destination = await makeRoot("sweet-house-issued-backup-");
  await cp(sourceRoot, destination, { recursive: true, force: true });
  return destination;
}

async function seedEmptyDatabase(rootDir) {
  const db = openInventoryDatabase(rootDir);
  ensureInventorySchema(db);
  documentIndex.ensureDocumentIndexSchema(db);
  db.close();
}

async function seedIndex(rootDir, record) {
  const { indexDocument } = await import("../forms/document-index.logic.js");
  indexDocument(rootDir, record);
}

function seedMovement(rootDir, referenceNo) {
  const db = openInventoryDatabase(rootDir);
  ensureInventorySchema(db);
  const product = db.prepare(`
    INSERT INTO products (product_code, name, category, status, created_at, updated_at)
    VALUES ('FIXTURE', 'Fixture', 'เสื้อ', 'active', ?, ?)
    RETURNING id
  `).get(AT, AT);
  const sku = db.prepare(`
    INSERT INTO stock_skus (product_id, sku, status, created_at, updated_at)
    VALUES (?, 'FIXTURE-SKU', 'active', ?, ?)
    RETURNING id
  `).get(product.id, AT, AT);
  db.prepare(`
    INSERT INTO stock_movements (
      movement_no, stock_sku_id, movement_type, movement_date, quantity,
      unit_cost, total_cost, reference_type, reference_no, note, created_at
    ) VALUES ('MOV-FIXTURE-001', ?, 'purchase_in', '2026-09-20', 1,
      10, 10, 'substitute_receipt', ?, '', ?)
  `).run(sku.id, referenceNo, AT);
  db.close();
}

test("missing-status REQ plans submitted to pending_approval without changing the fixture", async () => {
  const rootDir = await makeRoot();
  try {
    const beforeHistory = [{ fromStatus: "draft", toStatus: "submitted", changedAt: "2026-09-19T10:00:00.000Z" }];
    const { filePath } = await writeIssued(rootDir, "expense_request", "REQ-2026-09-0001", {
      requestNo: "REQ-2026-09-0001",
      documentKind: "expense_request",
      accountingMonth: "2026-09",
      statusLabel: "ส่งแล้ว",
      statusHistory: beforeHistory,
      createdAt: "2026-09-19T09:00:00.000Z",
      updatedAt: "2026-09-19T10:00:00.000Z",
    });
    const beforeBytes = await readFile(filePath);

    const { report } = await runMigration({ rootDir, at: AT, mode: "dry-run" });

    assert.equal(report.changes.length, 1);
    assert.equal(report.changes[0].beforeStatus, "submitted");
    assert.equal(report.changes[0].afterStatus, "pending_approval");
    assert.equal(report.changes[0].statusWasMissing, true);
    assert.equal(report.changes[0].beforeHistoryLength, 1);
    assert.equal(report.changes[0].afterHistoryLength, 2);
    assert.deepEqual(report.changes[0].migrationMarker, {
      fromStatus: "submitted",
      toStatus: "pending_approval",
      changedAt: AT,
      note: "migration:issued-record-status-v1",
      actor: "system:migration",
    });
    assert.deepEqual(await readFile(filePath), beforeBytes);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("missing-status SR with an exact movement plans received without touching stock", async () => {
  const rootDir = await makeRoot();
  try {
    const receiptNo = "SR-2026-09-0001";
    const stockReceipt = { receivedAt: "2026-09-19T11:00:00.000Z", movementIds: [1] };
    const { filePath } = await writeIssued(rootDir, "substitute_receipt", receiptNo, {
      receiptNo,
      documentKind: "substitute_receipt",
      accountingMonth: "2026-09",
      receiptType: "stock_purchase",
      statusHistory: [],
      stockReceipt,
      createdAt: "2026-09-19T09:00:00.000Z",
      updatedAt: "2026-09-19T09:00:00.000Z",
    });
    seedMovement(rootDir, receiptNo);
    const beforeBytes = await readFile(filePath);
    const db = openInventoryDatabase(rootDir);
    const beforeMovements = db.prepare("SELECT * FROM stock_movements ORDER BY id").all();
    db.close();

    const { report } = await runMigration({ rootDir, at: AT, mode: "dry-run" });

    assert.equal(report.changes.length, 1);
    assert.equal(report.changes[0].beforeStatus, "received");
    assert.equal(report.changes[0].afterStatus, "received");
    assert.equal(report.changes[0].statusWasMissing, true);
    assert.deepEqual(await readFile(filePath), beforeBytes);
    const afterDb = openInventoryDatabase(rootDir);
    assert.deepEqual(afterDb.prepare("SELECT * FROM stock_movements ORDER BY id").all(), beforeMovements);
    afterDb.close();
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("literal submitted REQ maps identically and canonical REQ stays byte-identical", async () => {
  const rootDir = await makeRoot();
  try {
    const literal = await writeIssued(rootDir, "expense_request", "REQ-2026-09-0002", {
      requestNo: "REQ-2026-09-0002", documentKind: "expense_request", accountingMonth: "2026-09", status: "submitted", statusLabel: "บันทึกแล้ว", statusHistory: [],
    }, "literal");
    const canonical = await writeIssued(rootDir, "expense_request", "REQ-2026-09-0003", {
      requestNo: "REQ-2026-09-0003", documentKind: "expense_request", accountingMonth: "2026-09", status: "approved", statusLabel: "อนุมัติแล้ว", statusHistory: [],
    }, "canonical");
    const literalBefore = await readFile(literal.filePath);
    const canonicalBefore = await readFile(canonical.filePath);
    const { report } = await runMigration({ rootDir, at: AT });
    assert.equal(report.changes.length, 1);
    assert.equal(report.changes[0].documentNo, "REQ-2026-09-0002");
    assert.equal(report.unchanged.length, 1);
    assert.deepEqual(await readFile(literal.filePath), literalBefore);
    assert.deepEqual(await readFile(canonical.filePath), canonicalBefore);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("missing-status SR without movements becomes pending approval", async () => {
  const rootDir = await makeRoot();
  try {
    await seedEmptyDatabase(rootDir);
    await writeIssued(rootDir, "substitute_receipt", "SR-2026-09-0002", {
      receiptNo: "SR-2026-09-0002", documentKind: "substitute_receipt", accountingMonth: "2026-09", receiptType: "stock_purchase", statusHistory: [],
    }, "no-movement");
    const { report } = await runMigration({ rootDir, at: AT });
    assert.equal(report.changes[0].beforeStatus, "pending_approval");
    assert.equal(report.changes[0].afterStatus, "pending_approval");
    assert.equal(report.changes[0].migrationMarker.fromStatus, "pending_approval");
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("canonical received SR is unchanged and no history or movement is created", async () => {
  const rootDir = await makeRoot();
  try {
    await seedEmptyDatabase(rootDir);
    const { filePath } = await writeIssued(rootDir, "substitute_receipt", "SR-2026-09-0003", {
      receiptNo: "SR-2026-09-0003", documentKind: "substitute_receipt", accountingMonth: "2026-09", status: "received", statusLabel: "รับเข้าคลังแล้ว", statusHistory: [{ status: "received" }],
    }, "canonical-received");
    const before = await readFile(filePath);
    const { report } = await runMigration({ rootDir, at: AT });
    assert.equal(report.changes.length, 0);
    assert.equal(report.unchanged.length, 1);
    assert.deepEqual(await readFile(filePath), before);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("contradictory evidence, unsupported status, malformed JSON, duplicate, hostile path, symlink, and inventory failure fail closed", async () => {
  const rootDir = await makeRoot();
  try {
    await seedEmptyDatabase(rootDir);
    await writeIssued(rootDir, "substitute_receipt", "SR-2026-09-0010", { receiptNo: "SR-2026-09-0010", documentKind: "substitute_receipt", accountingMonth: "2026-09", receiptType: "stock_purchase", stockReceipt: { receivedAt: AT } }, "contradictory");
    await writeIssued(rootDir, "expense_request", "REQ-2026-09-0010", { requestNo: "REQ-2026-09-0010", documentKind: "expense_request", accountingMonth: "2026-09", status: "not-supported" }, "unsupported");
    const malformedDir = join(rootDir, "documents/2026/09/malformed/data");
    await mkdir(malformedDir, { recursive: true });
    await writeFile(join(malformedDir, "submission.json"), "{broken\n");
    await writeIssued(rootDir, "expense_request", "REQ-2026-09-0011", { requestNo: "REQ-2026-09-0011", documentKind: "expense_request", accountingMonth: "2026-09" }, "duplicate-a");
    await writeIssued(rootDir, "expense_request", "REQ-2026-09-0011", { requestNo: "REQ-2026-09-0011", documentKind: "expense_request", accountingMonth: "2026-09" }, "duplicate-b");
    const hostile = await writeIssued(rootDir, "expense_request", "REQ-2026-09-0012", { requestNo: "REQ-2026-09-0012", documentKind: "expense_request", accountingMonth: "2026-09" }, "hostile");
    await writeFile(hostile.filePath, JSON.stringify({ requestNo: "REQ-2026-09-0012", documentKind: "expense_request", accountingMonth: "2026-09", folderPath: "../../escape" }));
    const symlinkTarget = join(rootDir, "documents/2026/09/linked-target");
    await mkdir(join(symlinkTarget, "data"), { recursive: true });
    await writeFile(join(symlinkTarget, "data", "submission.json"), JSON.stringify({ requestNo: "REQ-2026-09-0013", documentKind: "expense_request", accountingMonth: "2026-09", folderPath: "documents/2026/09/linked-target" }));
    await symlink(symlinkTarget, join(rootDir, "documents/2026/09/linked"));
    const { report } = await runMigration({ rootDir, at: AT });
    const codes = new Set(report.errors.map((error) => error.code));
    assert.ok(codes.has("unsupported_status"));
    assert.ok(codes.has("malformed_json"));
    assert.ok(codes.has("duplicate_document_number"));
    assert.ok(codes.has("folder_path_mismatch"));
    assert.ok(codes.has("symlink_candidate"));
    assert.ok(codes.has("contradictory_missing_stock_evidence"));
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("mixed valid and ambiguous fixtures block the entire plan before any write", async () => {
  const rootDir = await makeRoot();
  const planDir = await makeRoot("sweet-house-plan-");
  try {
    await seedEmptyDatabase(rootDir);
    const valid = await writeIssued(rootDir, "expense_request", "REQ-2026-09-0020", { requestNo: "REQ-2026-09-0020", documentKind: "expense_request", accountingMonth: "2026-09" }, "mixed-valid");
    await writeIssued(rootDir, "expense_request", "REQ-2026-09-0021", { requestNo: "REQ-2026-09-0021", documentKind: "expense_request", accountingMonth: "2026-09", status: "legacy" }, "mixed-ambiguous");
    await seedIndex(rootDir, {
      documentKind: "expense_request", documentNo: "REQ-2026-09-0998", status: "approved",
      folderPath: "documents/2026/09/unrelated-index/REQ-2026-09-0998_fixture", createdAt: AT, updatedAt: AT,
    });
    const before = await readFile(valid.filePath);
    const beforeIndex = (() => {
      const db = openInventoryDatabase(rootDir);
      const rows = db.prepare("SELECT * FROM documents ORDER BY document_kind, document_no").all();
      db.close();
      return rows;
    })();
    const planPath = join(planDir, "plan.json");
    const { report } = await runMigration({ rootDir, at: AT, reportPath: planPath });
    assert.equal(report.ok, undefined);
    assert.ok(report.errors.length > 0);
    assert.deepEqual(await readFile(valid.filePath), before);
    const backupRoot = await snapshotRoot(rootDir);
    const apply = await runMigration({ rootDir, at: AT, mode: "apply", reviewedPlanPath: planPath, backupRoot });
    assert.equal(apply.ok, false);
    assert.deepEqual(await readFile(valid.filePath), before);
    const afterIndex = (() => {
      const db = openInventoryDatabase(rootDir);
      const rows = db.prepare("SELECT * FROM documents ORDER BY document_kind, document_no").all();
      db.close();
      return rows;
    })();
    assert.deepEqual(afterIndex, beforeIndex);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
    await rm(planDir, { recursive: true, force: true });
  }
});

test("legacy DRAFT and SR-DRAFT trees are counted and untouched", async () => {
  const rootDir = await makeRoot();
  try {
    const draftDir = join(rootDir, "drafts/2026/09/DRAFT-legacy-001");
    const srDraftDir = join(rootDir, "drafts/2026/09/SR-DRAFT-legacy-002");
    await mkdir(join(draftDir, "attachments"), { recursive: true });
    await mkdir(join(srDraftDir, "attachments"), { recursive: true });
    await writeFile(join(draftDir, "payload.json"), "legacy-draft");
    await writeFile(join(srDraftDir, "attachments", "proof.txt"), "legacy-sr");
    const before = [await readFile(join(draftDir, "payload.json")), await readFile(join(srDraftDir, "attachments", "proof.txt"))];
    const { report } = await runMigration({ rootDir, at: AT });
    assert.equal(report.counts.legacyDrafts, 2);
    assert.deepEqual(await readFile(join(draftDir, "payload.json")), before[0]);
    assert.deepEqual(await readFile(join(srDraftDir, "attachments", "proof.txt")), before[1]);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("default and explicit dry-run are deterministic, root-safe, and report-safe", async () => {
  const rootDir = await makeRoot();
  const reportPath = join(await makeRoot("sweet-house-report-"), "dry-run.json");
  try {
    await writeIssued(rootDir, "expense_request", "REQ-2026-09-0030", { requestNo: "REQ-2026-09-0030", documentKind: "expense_request", accountingMonth: "2026-09" }, "issued");
    const before = JSON.stringify(await readdir(rootDir, { recursive: true }));
    const first = (await runMigration({ rootDir, at: AT })).report;
    const second = (await runMigration({ rootDir, at: AT, mode: "dry-run", reportPath })).report;
    assert.deepEqual(first, second);
    assert.equal((await readFile(reportPath, "utf8")).includes(rootDir), false);
    assert.equal((await readFile(reportPath, "utf8")).includes("deterministic"), false);
    assert.equal(JSON.stringify(await readdir(rootDir, { recursive: true })), before);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
    await rm(dirname(reportPath), { recursive: true, force: true });
  }
});

test("valid apply writes planned JSON and index rows, preserving unrelated files and stock", async () => {
  const rootDir = await makeRoot();
  const reportDir = await makeRoot("sweet-house-plan-");
  try {
    await seedEmptyDatabase(rootDir);
    const req = await writeIssued(rootDir, "expense_request", "REQ-2026-09-0040", { requestNo: "REQ-2026-09-0040", documentKind: "expense_request", accountingMonth: "2026-09" }, "apply-req");
    const sr = await writeIssued(rootDir, "substitute_receipt", "SR-2026-09-0040", { receiptNo: "SR-2026-09-0040", documentKind: "substitute_receipt", accountingMonth: "2026-09", receiptType: "stock_purchase" }, "apply-sr");
    await writeFile(join(rootDir, req.folderPath, "evidence.pdf"), "req-pdf");
    await writeFile(join(rootDir, sr.folderPath, "receipt.md"), "sr-markdown");
    seedMovement(rootDir, "SR-2026-09-unrelated");
    await seedIndex(rootDir, {
      documentKind: "expense_request", documentNo: "REQ-2026-09-0999", status: "approved",
      folderPath: "documents/2026/09/unrelated-index/REQ-2026-09-0999_fixture", createdAt: AT, updatedAt: AT,
    });
    const beforeStock = (() => {
      const db = openInventoryDatabase(rootDir);
      const rows = db.prepare("SELECT * FROM stock_movements ORDER BY id").all();
      db.close();
      return rows;
    })();
    const beforeUnrelatedIndex = (() => {
      const db = openInventoryDatabase(rootDir);
      const row = db.prepare("SELECT * FROM documents WHERE document_no = ?").get("REQ-2026-09-0999");
      db.close();
      return row;
    })();
    await mkdir(join(rootDir, "drafts/2026/09/DRAFT-untouched"), { recursive: true });
    await writeFile(join(rootDir, "drafts/2026/09/DRAFT-untouched", "note.md"), "draft");
    await writeFile(join(rootDir, "unrelated.md"), "unrelated");
    const planPath = join(reportDir, "plan.json");
    const dry = (await runMigration({ rootDir, at: AT, reportPath: planPath })).report;
    const backupRoot = await snapshotRoot(rootDir);
    const result = await runMigration({ rootDir, at: AT, mode: "apply", reviewedPlanPath: planPath, backupRoot });
    assert.equal(result.ok, true, JSON.stringify(result.report));
    assert.equal(result.report.counts.applied, 2);
    const reqAfter = JSON.parse(await readFile(req.filePath, "utf8"));
    const srAfter = JSON.parse(await readFile(sr.filePath, "utf8"));
    assert.equal(reqAfter.status, "pending_approval");
    assert.equal(srAfter.status, "pending_approval");
    assert.equal(reqAfter.statusHistory.length, 1);
    assert.equal(srAfter.statusHistory.length, 1);
    assert.equal(await readFile(join(rootDir, "unrelated.md"), "utf8"), "unrelated");
    assert.equal(await readFile(join(rootDir, "drafts/2026/09/DRAFT-untouched/note.md"), "utf8"), "draft");
    assert.equal(await readFile(join(rootDir, req.folderPath, "evidence.pdf"), "utf8"), "req-pdf");
    assert.equal(await readFile(join(rootDir, sr.folderPath, "receipt.md"), "utf8"), "sr-markdown");
    const db = openInventoryDatabase(rootDir);
    const rows = db.prepare("SELECT document_kind, document_no, status FROM documents ORDER BY document_kind, document_no").all().map((row) => ({ ...row }));
    const afterStock = db.prepare("SELECT * FROM stock_movements ORDER BY id").all();
    const afterUnrelatedIndex = db.prepare("SELECT * FROM documents WHERE document_no = ?").get("REQ-2026-09-0999");
    db.close();
    assert.deepEqual(rows, [
      { document_kind: "expense_request", document_no: "REQ-2026-09-0040", status: "pending_approval" },
      { document_kind: "expense_request", document_no: "REQ-2026-09-0999", status: "approved" },
      { document_kind: "substitute_receipt", document_no: "SR-2026-09-0040", status: "pending_approval" },
    ]);
    assert.deepEqual(afterStock, beforeStock);
    assert.deepEqual(afterUnrelatedIndex, beforeUnrelatedIndex);
    assert.equal(dry.changes.length, 2);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
    await rm(reportDir, { recursive: true, force: true });
  }
});

test("apply rejects absent, same-root, stale, partial, and symlinked backups without source writes", async () => {
  const rootDir = await makeRoot();
  const planDir = await makeRoot("sweet-house-plan-");
  try {
    const item = await writeIssued(rootDir, "expense_request", "REQ-2026-09-0050", { requestNo: "REQ-2026-09-0050", documentKind: "expense_request", accountingMonth: "2026-09" }, "backup-gates");
    const planPath = join(planDir, "plan.json");
    await runMigration({ rootDir, at: AT, reportPath: planPath });
    const before = await readFile(item.filePath);
    for (const backupRoot of [join(planDir, "missing"), rootDir]) {
      const result = await runMigration({ rootDir, at: AT, mode: "apply", reviewedPlanPath: planPath, backupRoot });
      assert.equal(result.ok, false);
      assert.ok(result.report.errors.some((error) => error.code === "backup_invalid"));
      assert.deepEqual(await readFile(item.filePath), before);
    }
    const stale = await snapshotRoot(rootDir);
    await writeFile(item.filePath, JSON.stringify({ requestNo: "REQ-2026-09-0050", documentKind: "expense_request", accountingMonth: "2026-09", status: "draft", folderPath: "documents/2026/09/backup-gates/REQ-2026-09-0050_fixture" }));
    const staleResult = await runMigration({ rootDir, at: AT, mode: "apply", reviewedPlanPath: planPath, backupRoot: stale });
    assert.equal(staleResult.ok, false);
    assert.ok(staleResult.report.errors.some((error) => error.code === "stale_reviewed_plan"));
    const partial = await snapshotRoot(rootDir);
    await rm(join(partial, "documents/2026/09/backup-gates/REQ-2026-09-0050_fixture/data/submission.json"));
    const partialResult = await runMigration({ rootDir, at: AT, mode: "apply", reviewedPlanPath: planPath, backupRoot: partial });
    assert.equal(partialResult.ok, false);
    assert.ok(partialResult.report.errors.some((error) => error.code === "backup_invalid"));
    const symlinkBackup = await makeRoot("sweet-house-symlink-backup-");
    await symlink(join(rootDir, "documents"), join(symlinkBackup, "documents"));
    const symlinkResult = await runMigration({ rootDir, at: AT, mode: "apply", reviewedPlanPath: planPath, backupRoot: symlinkBackup });
    assert.equal(symlinkResult.ok, false);
    await rm(symlinkBackup, { recursive: true, force: true });
  } finally {
    await rm(rootDir, { recursive: true, force: true });
    await rm(planDir, { recursive: true, force: true });
  }
});

test("second apply is idempotent and repairs an interrupted index reconciliation", async () => {
  const rootDir = await makeRoot();
  const planDir = await makeRoot("sweet-house-plan-");
  try {
    await seedEmptyDatabase(rootDir);
    const item = await writeIssued(rootDir, "expense_request", "REQ-2026-09-0060", { requestNo: "REQ-2026-09-0060", documentKind: "expense_request", accountingMonth: "2026-09" }, "retry");
    const planPath = join(planDir, "plan.json");
    await runMigration({ rootDir, at: AT, reportPath: planPath });
    const backupRoot = await snapshotRoot(rootDir);
    let interrupted = true;
    const first = await runMigration({ rootDir, at: AT, mode: "apply", reviewedPlanPath: planPath, backupRoot, hooks: { beforeIndexUpsert: () => { if (interrupted) { interrupted = false; throw new Error("simulated index interruption"); } } } });
    assert.equal(first.ok, false);
    assert.deepEqual(first.report.appliedBeforeFailure, ["REQ-2026-09-0060"], JSON.stringify(first.report));
    assert.equal(JSON.parse(await readFile(item.filePath, "utf8")).statusHistory.length, 1);
    const retry = await runMigration({ rootDir, at: AT, mode: "apply", reviewedPlanPath: planPath, backupRoot });
    assert.equal(retry.ok, true);
    assert.equal(retry.report.counts.applied, 0);
    assert.equal(retry.report.counts.indexReconciliations, 1);
    const second = await runMigration({ rootDir, at: AT, mode: "apply", reviewedPlanPath: planPath, backupRoot });
    assert.equal(second.ok, true);
    assert.equal(second.report.counts.applied, 0);
    assert.equal(JSON.parse(await readFile(item.filePath, "utf8")).statusHistory.length, 1);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
    await rm(planDir, { recursive: true, force: true });
  }
});

test("apply stops after the first of two records and reports deterministic appliedBeforeFailure", async () => {
  const rootDir = await makeRoot();
  const planDir = await makeRoot("sweet-house-plan-");
  try {
    await seedEmptyDatabase(rootDir);
    const first = await writeIssued(rootDir, "expense_request", "REQ-2026-09-0070", { requestNo: "REQ-2026-09-0070", documentKind: "expense_request", accountingMonth: "2026-09" }, "failure-a");
    const second = await writeIssued(rootDir, "expense_request", "REQ-2026-09-0071", { requestNo: "REQ-2026-09-0071", documentKind: "expense_request", accountingMonth: "2026-09" }, "failure-b");
    const planPath = join(planDir, "plan.json");
    await runMigration({ rootDir, at: AT, reportPath: planPath });
    const backupRoot = await snapshotRoot(rootDir);
    const result = await runMigration({ rootDir, at: AT, mode: "apply", reviewedPlanPath: planPath, backupRoot, hooks: { beforeJsonWrite: (change) => { if (change.documentNo === "REQ-2026-09-0071") throw new Error("simulated second failure"); } } });
    assert.equal(result.ok, false);
    assert.deepEqual(result.report.appliedBeforeFailure, ["REQ-2026-09-0070"], JSON.stringify(result.report));
    assert.equal(JSON.parse(await readFile(first.filePath, "utf8")).status, "pending_approval");
    assert.equal(Object.hasOwn(JSON.parse(await readFile(second.filePath, "utf8")), "status"), false);
    const retry = await runMigration({ rootDir, at: AT, mode: "apply", reviewedPlanPath: planPath, backupRoot });
    assert.equal(retry.ok, true, JSON.stringify(retry.report));
    assert.equal(retry.report.counts.applied, 1);
    assert.equal(retry.report.counts.indexReconciliations, 2);
    assert.equal(JSON.parse(await readFile(second.filePath, "utf8")).status, "pending_approval");
    const finalRetry = await runMigration({ rootDir, at: AT, mode: "apply", reviewedPlanPath: planPath, backupRoot });
    assert.equal(finalRetry.ok, true, JSON.stringify(finalRetry.report));
    assert.equal(finalRetry.report.counts.applied, 0);
    assert.equal(JSON.parse(await readFile(first.filePath, "utf8")).statusHistory.length, 1);
    assert.equal(JSON.parse(await readFile(second.filePath, "utf8")).statusHistory.length, 1);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
    await rm(planDir, { recursive: true, force: true });
  }
});

test("CLI enforces gates, redacts paths, emits JSON, and returns exact exit status", async () => {
  const rootDir = await makeRoot();
  try {
    await writeIssued(rootDir, "expense_request", "REQ-2026-09-0080", { requestNo: "REQ-2026-09-0080", documentKind: "expense_request", accountingMonth: "2026-09" }, "cli");
    const cli = join(process.cwd(), "scripts", "migrate-issued-record-statuses.mjs");
    const base = [cli, "--root", rootDir, "--at", AT];
    const dry = await execFileAsync(process.execPath, base, { encoding: "utf8" });
    assert.deepEqual(Object.keys(JSON.parse(dry.stdout)).sort(), ["at", "changes", "counts", "errors", "legacyDrafts", "mode", "planDigest", "rootLabel", "schemaVersion", "unchanged"].sort());
    await assert.rejects(() => execFileAsync(process.execPath, [...base, "--unknown"], { encoding: "utf8" }));
    await assert.rejects(() => execFileAsync(process.execPath, [cli, "--root", rootDir], { encoding: "utf8" }));
    await assert.rejects(() => execFileAsync(process.execPath, [...base, "--apply"], { encoding: "utf8" }));
    assert.equal(dry.stdout.includes(rootDir), false);
    assert.equal(dry.stderr, "");
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("apply rejects byte drift in a reviewed unchanged candidate before writing planned records", async () => {
  const rootDir = await makeRoot();
  const planDir = await makeRoot("sweet-house-plan-");
  try {
    await seedEmptyDatabase(rootDir);
    const unchanged = await writeIssued(rootDir, "expense_request", "REQ-2026-09-0090", { requestNo: "REQ-2026-09-0090", documentKind: "expense_request", accountingMonth: "2026-09", status: "approved", statusLabel: "อนุมัติแล้ว", statusHistory: [] }, "unchanged");
    const planned = await writeIssued(rootDir, "expense_request", "REQ-2026-09-0091", { requestNo: "REQ-2026-09-0091", documentKind: "expense_request", accountingMonth: "2026-09" }, "planned");
    const planPath = join(planDir, "plan.json");
    await runMigration({ rootDir, at: AT, reportPath: planPath });
    const backupRoot = await snapshotRoot(rootDir);
    const drifted = JSON.parse(await readFile(unchanged.filePath, "utf8"));
    drifted.updatedAt = "2026-09-20T12:01:00.000Z";
    await writeFile(unchanged.filePath, JSON.stringify(drifted, null, 2) + "\n");
    const result = await runMigration({ rootDir, at: AT, mode: "apply", reviewedPlanPath: planPath, backupRoot });
    assert.equal(result.ok, false);
    assert.ok(result.report.errors.some((error) => error.code === "stale_reviewed_plan"));
    assert.equal(Object.hasOwn(JSON.parse(await readFile(planned.filePath, "utf8")), "status"), false);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
    await rm(planDir, { recursive: true, force: true });
  }
});

test("empty status, malformed v1 marker, invalid month/sequence fail closed while allocator-sized sequence is valid", async () => {
  const rootDir = await makeRoot();
  try {
    const empty = await writeIssued(rootDir, "expense_request", "REQ-2026-09-0092", { requestNo: "REQ-2026-09-0092", documentKind: "expense_request", accountingMonth: "2026-09", status: "" }, "empty-status");
    await writeIssued(rootDir, "expense_request", "REQ-2026-09-0093", { requestNo: "REQ-2026-09-0093", documentKind: "expense_request", accountingMonth: "2026-09", status: "pending_approval", statusHistory: [{ fromStatus: "submitted", toStatus: "pending_approval", changedAt: AT, note: "migration:issued-record-status-v1", actor: "other" }] }, "bad-marker");
    await writeIssued(rootDir, "expense_request", "REQ-2026-99-0001", { requestNo: "REQ-2026-99-0001", documentKind: "expense_request", accountingMonth: "2026-99" }, "bad-month");
    await writeIssued(rootDir, "expense_request", "REQ-2026-09-0000", { requestNo: "REQ-2026-09-0000", documentKind: "expense_request", accountingMonth: "2026-09" }, "zero-seq");
    await writeIssued(rootDir, "expense_request", "REQ-2026-09-1", { requestNo: "REQ-2026-09-1", documentKind: "expense_request", accountingMonth: "2026-09" }, "short-seq");
    await writeIssued(rootDir, "expense_request", "REQ-2026-09-1/01/001", { requestNo: "REQ-2026-09-1/01/001", documentKind: "expense_request", accountingMonth: "2026-09" }, "slash-seq");
    await writeIssued(rootDir, "expense_request", "REQ-2026-09-00001", { requestNo: "REQ-2026-09-00001", documentKind: "expense_request", accountingMonth: "2026-09" }, "leading-zero-seq");
    await writeIssued(rootDir, "expense_request", "REQ-2026-09-0001", { requestNo: "REQ-2026-09-0001", documentKind: "expense_request", accountingMonth: "2026-09" }, "canonical-one");
    await writeIssued(rootDir, "expense_request", "REQ-2026-09-0999", { requestNo: "REQ-2026-09-0999", documentKind: "expense_request", accountingMonth: "2026-09" }, "canonical-999");
    await writeIssued(rootDir, "expense_request", "REQ-2026-09-1000", { requestNo: "REQ-2026-09-1000", documentKind: "expense_request", accountingMonth: "2026-09" }, "four-digit-seq");
    await writeIssued(rootDir, "expense_request", "REQ-2026-09-9999", { requestNo: "REQ-2026-09-9999", documentKind: "expense_request", accountingMonth: "2026-09" }, "max-padded-seq");
    const valid = await writeIssued(rootDir, "expense_request", "REQ-2026-09-10000", { requestNo: "REQ-2026-09-10000", documentKind: "expense_request", accountingMonth: "2026-09" }, "large-seq");
    const { report } = await runMigration({ rootDir, at: AT });
    const codes = new Set(report.errors.map((error) => error.code));
    assert.ok(codes.has("unsupported_status"));
    assert.ok(codes.has("conflicting_migration_marker"));
    assert.ok(codes.has("invalid_document_number"));
    const changedNumbers = new Set(report.changes.map((change) => change.documentNo));
    for (const sequence of ["0001", "0999", "1000", "9999", "10000"]) {
      assert.equal(changedNumbers.has(`REQ-2026-09-${sequence}`), true, `sequence ${sequence} must be accepted`);
    }
    for (const documentNo of ["REQ-2026-99-0001", "REQ-2026-09-0000", "REQ-2026-09-1", "REQ-2026-09-1/01/001", "REQ-2026-09-00001"]) {
      assert.ok(report.errors.some((error) => error.code === "invalid_document_number" && error.documentNo === documentNo), `${documentNo} must be rejected individually`);
    }
    assert.ok(report.errors.some((error) => error.code === "unsupported_status" && error.documentNo === "REQ-2026-09-0092"));
    assert.ok(report.errors.some((error) => error.code === "conflicting_migration_marker" && error.documentNo === "REQ-2026-09-0093"));
    assert.equal(Object.hasOwn(JSON.parse(await readFile(empty.filePath, "utf8")), "status"), true);
    assert.equal(Object.hasOwn(JSON.parse(await readFile(valid.filePath, "utf8")), "status"), false);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("a submitted REQ carrying the exact target marker is not accepted as already applied", async () => {
  const rootDir = await makeRoot();
  try {
    await writeIssued(rootDir, "expense_request", "REQ-2026-09-0096", {
      requestNo: "REQ-2026-09-0096", documentKind: "expense_request", accountingMonth: "2026-09", status: "submitted",
      statusHistory: [{ fromStatus: "submitted", toStatus: "pending_approval", changedAt: AT, note: "migration:issued-record-status-v1", actor: "system:migration" }],
    }, "submitted-target-marker");
    const { report } = await runMigration({ rootDir, at: AT });
    assert.ok(report.errors.some((error) => error.code === "conflicting_migration_marker"));
    assert.equal(report.changes.length, 0);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("inventory failures and general-expense movement conflicts fail closed", async () => {
  const missingInventory = await makeRoot();
  const conflicting = await makeRoot();
  try {
    await writeIssued(missingInventory, "substitute_receipt", "SR-2026-09-0097", {
      receiptNo: "SR-2026-09-0097", documentKind: "substitute_receipt", accountingMonth: "2026-09", receiptType: "stock_purchase",
    }, "inventory-read-failed");
    const missingReport = (await runMigration({ rootDir: missingInventory, at: AT })).report;
    assert.ok(missingReport.errors.some((error) => error.code === "inventory_read_failed"));

    await seedEmptyDatabase(conflicting);
    await writeIssued(conflicting, "substitute_receipt", "SR-2026-09-0098", {
      receiptNo: "SR-2026-09-0098", documentKind: "substitute_receipt", accountingMonth: "2026-09", receiptType: "general_expense",
    }, "general-expense-movement");
    seedMovement(conflicting, "SR-2026-09-0098");
    const conflictReport = (await runMigration({ rootDir: conflicting, at: AT })).report;
    assert.ok(conflictReport.errors.some((error) => error.code === "contradictory_stock_evidence"));
  } finally {
    await rm(missingInventory, { recursive: true, force: true });
    await rm(conflicting, { recursive: true, force: true });
  }
});

test("physical source or backup aliases and a backup without index schema fail closed", async () => {
  const rootDir = await makeRoot();
  const planDir = await makeRoot("sweet-house-plan-");
  const aliasDir = await makeRoot("sweet-house-alias-");
  try {
    await seedEmptyDatabase(rootDir);
    await writeIssued(rootDir, "expense_request", "REQ-2026-09-0094", { requestNo: "REQ-2026-09-0094", documentKind: "expense_request", accountingMonth: "2026-09" }, "physical");
    const planPath = join(planDir, "plan.json");
    await runMigration({ rootDir, at: AT, reportPath: planPath });
    const backupRoot = await snapshotRoot(rootDir);
    const backupDb = openInventoryDatabase(backupRoot);
    backupDb.exec("DROP TABLE documents");
    backupDb.close();
    const schemaResult = await runMigration({ rootDir, at: AT, mode: "apply", reviewedPlanPath: planPath, backupRoot });
    assert.equal(schemaResult.ok, false);
    assert.ok(schemaResult.report.errors.some((error) => error.code === "backup_invalid"));
    const sourceAlias = join(aliasDir, "source-alias");
    await symlink(rootDir, sourceAlias);
    const aliasResult = await runMigration({ rootDir: sourceAlias, at: AT });
    assert.equal(aliasResult.ok, false);
    assert.ok(aliasResult.report.errors.some((error) => error.code === "source_root_invalid"));
    const backupAlias = join(aliasDir, "backup-alias");
    await symlink(backupRoot, backupAlias);
    const backupAliasResult = await runMigration({ rootDir, at: AT, mode: "apply", reviewedPlanPath: planPath, backupRoot: backupAlias });
    assert.equal(backupAliasResult.ok, false);
    assert.ok(backupAliasResult.report.errors.some((error) => error.code === "backup_invalid"));
  } finally {
    await rm(rootDir, { recursive: true, force: true });
    await rm(planDir, { recursive: true, force: true });
    await rm(aliasDir, { recursive: true, force: true });
  }
});

test("legacy symlink inventory blocks apply planning and CLI report-write errors redact paths", async () => {
  const rootDir = await makeRoot();
  const outside = await makeRoot("sweet-house-legacy-outside-");
  try {
    await mkdir(join(rootDir, "drafts/2026"), { recursive: true });
    await symlink(outside, join(rootDir, "drafts/2026/09"));
    const { report } = await runMigration({ rootDir, at: AT });
    assert.ok(report.errors.some((error) => error.code === "legacy_symlink"));
    const cli = join(process.cwd(), "scripts", "migrate-issued-record-statuses.mjs");
    const reportPath = join(rootDir, "missing", "report.json");
    await writeIssued(rootDir, "expense_request", "REQ-2026-09-0095", { requestNo: "REQ-2026-09-0095", documentKind: "expense_request", accountingMonth: "2026-09" }, "cli-error");
    await assert.rejects(async () => {
      try {
        await execFileAsync(process.execPath, [cli, "--root", rootDir, "--at", AT, "--report", reportPath], { encoding: "utf8" });
      } catch (error) {
        assert.equal(error.stdout, "");
        assert.equal(error.stderr.includes(reportPath), false);
        assert.equal(error.stderr.includes(rootDir), false);
        throw error;
      }
    });
  } finally {
    await rm(rootDir, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
