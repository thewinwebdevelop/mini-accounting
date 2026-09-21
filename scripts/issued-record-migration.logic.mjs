import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { lstat, open, readFile, readdir, realpath, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { indexDocument } = require("../forms/document-index.logic.js");

export const SCHEMA_VERSION = "issued-record-migration-v1";
export const MARKER_NOTE = "migration:issued-record-status-v1";
export const MARKER_ACTOR = "system:migration";

const REQ_STATUSES = new Set(["draft", "submitted", "pending_approval", "approved", "completed", "cancelled"]);
const SR_STATUSES = new Set(["draft", "pending_approval", "approved", "received", "completed", "cancelled", "voided"]);
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
// Allocator output is a four-digit, zero-padded positive sequence through
// 9999, then an unpadded positive sequence once it reaches five digits.
const SAFE_NUMBER = /^(REQ|SR)-\d{4}-(?:0[1-9]|1[0-2])-(?!0000)(?:\d{4}|[1-9]\d{4,})$/;

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function hashBytes(bytes) {
  return sha256(bytes);
}

function asRelative(rootDir, absolutePath) {
  return path.relative(rootDir, absolutePath).split(path.sep).join("/");
}

function inside(rootDir, candidate) {
  const root = path.resolve(rootDir);
  const target = path.resolve(candidate);
  return target === root || target.startsWith(`${root}${path.sep}`);
}

function errorItem(code, documentKind = "", documentNo = "", reason = "") {
  return { code, documentKind, documentNo, reason };
}

function markerFor(fromStatus, toStatus, at) {
  return { fromStatus, toStatus, changedAt: at, note: MARKER_NOTE, actor: MARKER_ACTOR };
}

function isExactMarker(value, marker) {
  return stable(value) === stable(marker);
}

function canonicalLabel(kind, status) {
  if (status === "pending_approval") return "รอตรวจอนุมัติ";
  if (kind === "substitute_receipt" && status === "received") return "รับเข้าคลังแล้ว";
  return "";
}

function canonicalFileName(kind) {
  return kind === "expense_request" ? "submission.json" : "substitute-receipt.json";
}

function numberField(kind) {
  return kind === "expense_request" ? "requestNo" : "receiptNo";
}

function dbPath(rootDir) {
  return path.join(rootDir, "data", "sweet-house.sqlite");
}

async function resolvePhysicalRoot(rootDir, label) {
  const absolute = path.resolve(rootDir);
  try {
    const info = await lstat(absolute);
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error("not a real directory");
    const physical = await realpath(absolute);
    return physical;
  } catch {
    throw new Error(label + " is unavailable");
  }
}

async function regularPath(rootDir, target, label) {
  if (!inside(rootDir, target)) throw new Error(`${label} escapes expected root`);
  await assertNoSymlinkComponents(rootDir, target, label);
  const info = await lstat(target);
  if (info.isSymbolicLink()) throw new Error(`${label} is a symlink`);
  if (!info.isFile()) throw new Error(`${label} is not a file`);
  return info;
}

async function directoryPath(rootDir, target, label) {
  if (!inside(rootDir, target)) throw new Error(`${label} escapes expected root`);
  await assertNoSymlinkComponents(rootDir, target, label);
  const info = await lstat(target);
  if (info.isSymbolicLink()) throw new Error(`${label} is a symlink`);
  if (!info.isDirectory()) throw new Error(`${label} is not a directory`);
  return info;
}

async function assertNoSymlinkComponents(rootDir, target, label) {
  const relative = path.relative(path.resolve(rootDir), path.resolve(target));
  let current = path.resolve(rootDir);
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    const info = await lstat(current);
    if (info.isSymbolicLink()) throw new Error(`${label} contains a symlink`);
  }
}

function movementHash(rows) {
  return sha256(stable(rows));
}

function readMovements(rootDir, referenceNo) {
  const file = dbPath(rootDir);
  if (!existsSync(file)) throw new Error("inventory database is missing");
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const rows = db.prepare(`
      SELECT * FROM stock_movements
      WHERE reference_type = ? AND reference_no = ?
      ORDER BY movement_date ASC, id ASC
    `).all("substitute_receipt", referenceNo);
    return { rows, hash: movementHash(rows) };
  } finally {
    db.close();
  }
}

async function walkDocuments(rootDir, dir, found, errors) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return;
    errors.push(errorItem("documents_unreadable", "", "", "documents tree is unreadable"));
    return;
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const absolute = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      errors.push(errorItem("symlink_candidate", "", "", "symlink beneath documents is not permitted"));
      continue;
    }
    if (entry.isDirectory()) {
      await walkDocuments(rootDir, absolute, found, errors);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!new Set(["submission.json", "substitute-receipt.json"]).has(entry.name)) continue;
    if (path.basename(path.dirname(absolute)) !== "data") continue;
    found.push({ kind: entry.name === "submission.json" ? "expense_request" : "substitute_receipt", absolute });
  }
}

async function discoverLegacyDrafts(rootDir) {
  const result = [];
  const malformed = [];
  const errors = [];
  const draftsRoot = path.join(rootDir, "drafts");
  if (!existsSync(draftsRoot)) return { result, malformed, errors };
  let rootInfo;
  try { rootInfo = await lstat(draftsRoot); } catch { errors.push(errorItem("legacy_inventory_failed", "", "", "legacy drafts tree is unreadable")); return { result, malformed, errors }; }
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) {
    errors.push(errorItem("legacy_inventory_failed", "", "", "legacy drafts tree is not a real directory"));
    return { result, malformed, errors };
  }
  let years;
  try { years = (await readdir(draftsRoot, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name)); }
  catch { errors.push(errorItem("legacy_inventory_failed", "", "", "legacy drafts tree is unreadable")); return { result, malformed, errors }; }
  for (const year of years) {
    if (year.isSymbolicLink()) { errors.push(errorItem("legacy_symlink", "", "", "legacy drafts year is a symlink")); continue; }
    if (!year.isDirectory()) { malformed.push({ relativePath: asRelative(rootDir, path.join(draftsRoot, year.name)), reason: "legacy year is not a directory" }); continue; }
    const yearPath = path.join(draftsRoot, year.name);
    let months;
    try { months = (await readdir(yearPath, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name)); }
    catch { errors.push(errorItem("legacy_inventory_failed", "", "", "legacy year is unreadable")); continue; }
    for (const month of months) {
      if (month.isSymbolicLink()) { errors.push(errorItem("legacy_symlink", "", "", "legacy drafts month is a symlink")); continue; }
      if (!month.isDirectory()) { malformed.push({ relativePath: asRelative(rootDir, path.join(yearPath, month.name)), reason: "legacy month is not a directory" }); continue; }
      const monthPath = path.join(yearPath, month.name);
      let records;
      try { records = (await readdir(monthPath, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name)); }
      catch { errors.push(errorItem("legacy_inventory_failed", "", "", "legacy month is unreadable")); continue; }
      for (const record of records) {
        if (record.isSymbolicLink()) { errors.push(errorItem("legacy_symlink", "", "", "legacy record is a symlink")); continue; }
        if (!record.isDirectory()) {
          malformed.push({ relativePath: asRelative(rootDir, path.join(monthPath, record.name)), reason: "legacy record is not a directory" });
          continue;
        }
        if (/^DRAFT-.+/.test(record.name)) result.push({ kind: "DRAFT", identifier: record.name, relativePath: asRelative(rootDir, path.join(monthPath, record.name)) });
        else if (/^SR-DRAFT-.+/.test(record.name)) result.push({ kind: "SR-DRAFT", identifier: record.name, relativePath: asRelative(rootDir, path.join(monthPath, record.name)) });
        else malformed.push({ relativePath: asRelative(rootDir, path.join(monthPath, record.name)), reason: "unexpected legacy record identifier" });
      }
    }
  }
  return { result, malformed, errors };
}

function validateAt(at) {
  if (typeof at !== "string" || !ISO_RE.test(at) || Number.isNaN(Date.parse(at))) return false;
  return new Date(at).toISOString() === at;
}

async function readCandidate(rootDir, candidate) {
  const { kind, absolute } = candidate;
  const relativeFile = asRelative(rootDir, absolute);
  const errors = [];
  let bytes;
  try {
    await regularPath(rootDir, absolute, "candidate");
    bytes = await readFile(absolute);
  } catch {
    errors.push(errorItem("candidate_unreadable", kind, "", "candidate file is unreadable"));
    return { errors, relativeFile, absolute };
  }
  let payload;
  try {
    payload = JSON.parse(bytes.toString("utf8"));
  } catch {
    errors.push(errorItem("malformed_json", kind, "", "candidate JSON is malformed"));
    return { errors, relativeFile, absolute };
  }
  const field = numberField(kind);
  const documentNo = typeof payload[field] === "string" ? payload[field] : "";
  const expectedPrefix = kind === "expense_request" ? "REQ" : "SR";
  if (!SAFE_NUMBER.test(documentNo) || !documentNo.startsWith(`${expectedPrefix}-`)) errors.push(errorItem("invalid_document_number", kind, documentNo, "document number format is invalid"));
  if (payload.documentKind && payload.documentKind !== kind) errors.push(errorItem("cross_kind_document", kind, documentNo, "document kind does not match candidate file"));
  const month = documentNo.match(/^[A-Z]+-(\d{4}-\d{2})-/)?.[1] || "";
  if (payload.accountingMonth && payload.accountingMonth !== month) errors.push(errorItem("accounting_month_mismatch", kind, documentNo, "accounting month does not match document number"));
  const folderPath = typeof payload.folderPath === "string" ? payload.folderPath.replace(/\\/g, "/") : "";
  const expectedFolder = asRelative(rootDir, path.dirname(path.dirname(absolute)));
  const folderAbs = folderPath ? path.resolve(rootDir, folderPath) : "";
  if (!folderPath || !inside(rootDir, folderAbs) || folderPath !== expectedFolder || folderAbs !== path.resolve(rootDir, expectedFolder)) errors.push(errorItem("folder_path_mismatch", kind, documentNo, "folder path does not match candidate location"));
  if (payload.statusHistory !== undefined && !Array.isArray(payload.statusHistory)) errors.push(errorItem("invalid_status_history", kind, documentNo, "statusHistory must be an array"));
  return { kind, documentNo, absolute, relativeFile, bytes, beforeHash: hashBytes(bytes), payload, errors };
}

function makeUnchanged(record) {
  return { documentKind: record.kind, documentNo: record.documentNo, relativeFile: record.relativeFile, status: record.payload.status || "", fileHash: record.beforeHash };
}

async function makePlan({ rootDir, at }) {
  const errors = [];
  const found = [];
  const documentsRoot = path.join(rootDir, "documents");
  if (!existsSync(documentsRoot)) errors.push(errorItem("documents_missing", "", "", "documents root is missing"));
  else await walkDocuments(rootDir, documentsRoot, found, errors);
  const discovered = [];
  for (const candidate of found) discovered.push(await readCandidate(rootDir, candidate));
  discovered.sort((a, b) => `${a.kind}:${a.documentNo}:${a.relativeFile}`.localeCompare(`${b.kind}:${b.documentNo}:${b.relativeFile}`));
  const seen = new Map();
  for (const record of discovered) {
    for (const error of record.errors) errors.push(error);
    if (!record.documentNo) continue;
    const key = `${record.kind}:${record.documentNo}`;
    if (seen.has(key)) errors.push(errorItem("duplicate_document_number", record.kind, record.documentNo, "duplicate issued document number"));
    else seen.set(key, record.relativeFile);
  }
  const changes = [];
  const unchanged = [];
  for (const record of discovered) {
    if (record.errors.length) continue;
    const { kind, payload, documentNo } = record;
    const statusMissing = !Object.prototype.hasOwnProperty.call(payload, "status");
    const status = statusMissing ? "" : payload.status;
    const allowed = kind === "expense_request" ? REQ_STATUSES : SR_STATUSES;
    let effectiveStatus = status;
    let evidenceHash = "";
    if (kind === "substitute_receipt" && statusMissing) {
      try {
        const evidence = readMovements(rootDir, documentNo);
        evidenceHash = evidence.hash;
        if (evidence.rows.length && payload.receiptType === "general_expense") {
          errors.push(errorItem("contradictory_stock_evidence", kind, documentNo, "general-expense receipt has stock movements"));
          continue;
        }
        if (evidence.rows.length) effectiveStatus = "received";
        else if (payload.stockReceipt?.receivedAt || (Array.isArray(payload.stockReceipt?.movementIds) && payload.stockReceipt.movementIds.length)) {
          errors.push(errorItem("contradictory_missing_stock_evidence", kind, documentNo, "receipt claims stock receipt without matching movement"));
          continue;
        } else effectiveStatus = "pending_approval";
      } catch {
        errors.push(errorItem("inventory_read_failed", kind, documentNo, "inventory movement query failed"));
        continue;
      }
    } else if (statusMissing && kind === "expense_request") effectiveStatus = "submitted";
    if (!statusMissing && !allowed.has(status)) {
      errors.push(errorItem("unsupported_status", kind, documentNo, "stored status is unsupported"));
      continue;
    }
    const expectedTarget = kind === "expense_request" ? "pending_approval" : effectiveStatus;
    const marker = markerFor(effectiveStatus, expectedTarget, at);
    const history = Array.isArray(payload.statusHistory) ? payload.statusHistory : [];
    const exactMarkers = history.filter((entry) => entry && entry.note === MARKER_NOTE);
    const expectedRetryMarker = kind === "expense_request"
      ? markerFor("submitted", "pending_approval", at)
      : markerFor(status, status, at);
    const existingAppliedMarker = exactMarkers.length === 1 && !statusMissing
      && ((kind === "expense_request" && status === "pending_approval") || kind === "substitute_receipt")
      && isExactMarker(exactMarkers[0], expectedRetryMarker)
      ? exactMarkers[0]
      : null;
    if (exactMarkers.length && !existingAppliedMarker) {
      errors.push(errorItem("conflicting_migration_marker", kind, documentNo, "conflicting v1 migration marker"));
      continue;
    }
    if (existingAppliedMarker && status && !statusMissing) {
      changes.push({
        documentKind: kind, documentNo, relativeFile: record.relativeFile, statusWasMissing: false,
        beforeStatus: status, effectiveSourceStatus: existingAppliedMarker.fromStatus, afterStatus: status,
        beforeHistoryLength: history.length, afterHistoryLength: history.length, migrationMarker: existingAppliedMarker,
        fileHashBefore: record.beforeHash, fileHashAfter: record.beforeHash, movementEvidenceHash: evidenceHash,
        alreadyApplied: true, payload, absolute: record.absolute,
      });
      continue;
    }
    if (!statusMissing && kind === "expense_request" && status !== "submitted") { unchanged.push(makeUnchanged(record)); continue; }
    if (!statusMissing && kind === "substitute_receipt") { unchanged.push(makeUnchanged(record)); continue; }
    const nextPayload = { ...payload };
    nextPayload.status = expectedTarget;
    nextPayload.statusLabel = canonicalLabel(kind, expectedTarget);
    nextPayload.updatedAt = at;
    nextPayload.statusHistory = [...history, marker];
    const nextBytes = Buffer.from(`${JSON.stringify(nextPayload, null, 2)}\n`);
    changes.push({
      documentKind: kind, documentNo, relativeFile: record.relativeFile, statusWasMissing: statusMissing,
      beforeStatus: effectiveStatus, effectiveSourceStatus: effectiveStatus, afterStatus: expectedTarget,
      beforeHistoryLength: history.length, afterHistoryLength: nextPayload.statusHistory.length,
      migrationMarker: marker, fileHashBefore: record.beforeHash, fileHashAfter: hashBytes(nextBytes),
      movementEvidenceHash: evidenceHash, alreadyApplied: false, payload, nextPayload, nextBytes, absolute: record.absolute,
    });
  }
  const legacy = await discoverLegacyDrafts(rootDir);
  for (const item of legacy.malformed) errors.push(errorItem("legacy_unexpected_entry", "", "", item.reason));
  errors.push(...legacy.errors);
  changes.sort((a, b) => `${a.documentKind}:${a.documentNo}:${a.relativeFile}`.localeCompare(`${b.documentKind}:${b.documentNo}:${b.relativeFile}`));
  unchanged.sort((a, b) => `${a.documentKind}:${a.documentNo}:${a.relativeFile}`.localeCompare(`${b.documentKind}:${b.documentNo}:${b.relativeFile}`));
  errors.sort((a, b) => stable(a).localeCompare(stable(b)));
  const counts = {
    scannedReq: discovered.filter((record) => record.kind === "expense_request").length,
    scannedSr: discovered.filter((record) => record.kind === "substitute_receipt").length,
    plannedChanges: changes.length,
    plannedByKindSourceTarget: {},
    unchangedCanonical: unchanged.length,
    legacyDrafts: legacy.result.length,
    legacyMalformed: legacy.malformed.length,
    ambiguousErrors: errors.length,
    applied: 0,
    indexReconciliations: 0,
  };
  for (const change of changes) {
    const key = `${change.documentKind}:${change.beforeStatus}:${change.afterStatus}`;
    counts.plannedByKindSourceTarget[key] = (counts.plannedByKindSourceTarget[key] || 0) + 1;
  }
  const reportCore = {
    schemaVersion: SCHEMA_VERSION, mode: "dry-run", at, rootLabel: ".", counts,
    changes: changes.map(({ payload, nextPayload, nextBytes, absolute, ...safe }) => safe), unchanged,
    legacyDrafts: legacy.result, errors,
  };
  return { reportCore, changes, unchanged, errors, legacy: legacy.result, discovered };
}

function digestForReport(report) {
  const copy = { ...report };
  delete copy.planDigest;
  delete copy.reviewedPlanDigest;
  delete copy.backupValidation;
  delete copy.appliedBeforeFailure;
  delete copy.error;
  delete copy.counts;
  copy.counts = report.counts;
  return sha256(stable(copy));
}

function safeReport(plan, mode, at) {
  const report = { ...plan.reportCore, mode, at };
  report.planDigest = digestForReport(report);
  return report;
}

async function writeReport(reportPath, report) {
  if (!reportPath) return;
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
}

function comparableChange(change) {
  return {
    documentKind: change.documentKind, documentNo: change.documentNo, relativeFile: change.relativeFile,
    statusWasMissing: change.statusWasMissing, beforeStatus: change.beforeStatus,
    effectiveSourceStatus: change.effectiveSourceStatus, afterStatus: change.afterStatus,
    beforeHistoryLength: change.beforeHistoryLength, afterHistoryLength: change.afterHistoryLength,
    migrationMarker: change.migrationMarker, fileHashBefore: change.fileHashBefore, fileHashAfter: change.fileHashAfter,
    movementEvidenceHash: change.movementEvidenceHash || "",
  };
}

async function validateBackup({ rootDir, backupRoot, reviewedChanges }) {
  const result = { valid: false, checkedFiles: 0, checkedMovements: 0 };
  try {
    const source = await resolvePhysicalRoot(rootDir, "source root");
    const backup = await resolvePhysicalRoot(backupRoot || "", "backup root");
    if (source === backup || inside(source, backup) || inside(backup, source)) throw new Error("backup root overlaps source root");
    for (const change of reviewedChanges) {
      const file = path.join(backup, change.relativeFile);
      await regularPath(backup, file, "backup candidate");
      const bytes = await readFile(file);
      if (hashBytes(bytes) !== change.fileHashBefore) throw new Error("backup candidate does not match reviewed before hash");
      result.checkedFiles += 1;
    }
    const backupDb = dbPath(backup);
    await regularPath(backup, backupDb, "backup inventory database");
    const db = new DatabaseSync(backupDb, { readOnly: true });
    try {
      const integrity = db.prepare("PRAGMA integrity_check").get();
      if (!integrity || Object.values(integrity)[0] !== "ok") throw new Error("backup database integrity failed");
      const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name));
      if (!tables.has("documents") || !tables.has("document_index_schema_migrations")) throw new Error("backup database index schema is missing");
      for (const change of reviewedChanges.filter((item) => item.documentKind === "substitute_receipt")) {
        const rows = db.prepare(`SELECT * FROM stock_movements WHERE reference_type = ? AND reference_no = ? ORDER BY movement_date ASC, id ASC`).all("substitute_receipt", change.documentNo);
        if (movementHash(rows) !== (change.movementEvidenceHash || movementHash([]))) throw new Error("backup movement evidence does not match reviewed plan");
        result.checkedMovements += 1;
      }
    } finally {
      db.close();
    }
    result.valid = true;
    return result;
  } catch {
    return result;
  }
}

async function durableReplace(file, bytes) {
  const temp = `${file}.migration-tmp-${process.pid}-${Date.now()}`;
  const handle = await open(temp, "wx", 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temp, file);
}

function indexRecordFromPayload(change, payload) {
  return {
    documentKind: change.documentKind,
    documentNo: change.documentNo,
    status: payload.status,
    folderPath: payload.folderPath,
    transactionNo: payload.transactionNo,
    workflowTemplateId: payload.workflowTemplateId,
    workflowStepId: payload.workflowStepId,
    createdAt: payload.createdAt,
    updatedAt: payload.updatedAt,
  };
}

export async function runMigration(options = {}) {
  let rootDir = path.resolve(String(options.rootDir || ""));
  const at = options.at;
  const mode = options.mode === "apply" || options.apply ? "apply" : "dry-run";
  if (!rootDir || !validateAt(at)) {
    return { ok: false, report: { schemaVersion: SCHEMA_VERSION, mode, at: at || "", rootLabel: ".", counts: {}, changes: [], unchanged: [], legacyDrafts: [], errors: [errorItem("invalid_timestamp", "", "", "at must be a canonical ISO-8601 timestamp")] } };
  }
  try {
    rootDir = await resolvePhysicalRoot(rootDir, "source root");
  } catch {
    return { ok: false, report: { schemaVersion: SCHEMA_VERSION, mode, at, rootLabel: ".", counts: {}, changes: [], unchanged: [], legacyDrafts: [], errors: [errorItem("source_root_invalid", "", "", "source root is unavailable")] } };
  }
  const plan = await makePlan({ rootDir, at });
  if (mode === "dry-run") {
    const report = safeReport(plan, "dry-run", at);
    await writeReport(options.reportPath, report);
    return { ok: plan.errors.length === 0, report };
  }
  let reviewed;
  try {
    reviewed = JSON.parse(await readFile(options.reviewedPlanPath, "utf8"));
  } catch {
    const report = safeReport(plan, "apply", at);
    report.errors = [...report.errors, errorItem("reviewed_plan_unreadable", "", "", "reviewed plan is unreadable")];
    report.planDigest = digestForReport(report);
    await writeReport(options.reportPath, report);
    return { ok: false, report };
  }
  const report = safeReport(plan, "apply", at);
  report.reviewedPlanDigest = reviewed.planDigest || "";
  const reviewChanges = Array.isArray(reviewed.changes) ? reviewed.changes : [];
  if (reviewed.schemaVersion !== SCHEMA_VERSION || reviewed.at !== at || !reviewed.planDigest || digestForReport(reviewed) !== reviewed.planDigest) {
    report.errors.push(errorItem("stale_reviewed_plan", "", "", "reviewed plan digest or timestamp does not match"));
  }
  if (plan.errors.length) report.errors.push(...plan.errors.filter((item) => !report.errors.some((existing) => stable(existing) === stable(item))));
  const reviewByKey = new Map(reviewChanges.map((change) => [`${change.documentKind}:${change.documentNo}`, change]));
  const reviewedKeys = new Set([
    ...reviewChanges.map((change) => `${change.documentKind}:${change.documentNo}`),
    ...(Array.isArray(reviewed.unchanged) ? reviewed.unchanged : []).map((change) => `${change.documentKind}:${change.documentNo}`),
  ]);
  const currentKeys = new Set([
    ...plan.changes.map((change) => `${change.documentKind}:${change.documentNo}`),
    ...plan.unchanged.map((change) => `${change.documentKind}:${change.documentNo}`),
  ]);
  if (stable([...reviewedKeys].sort()) !== stable([...currentKeys].sort())) report.errors.push(errorItem("stale_reviewed_plan", "", "", "candidate set differs from reviewed plan"));
  const reviewUnchangedByKey = new Map((Array.isArray(reviewed.unchanged) ? reviewed.unchanged : []).map((change) => [String(change.documentKind) + ":" + String(change.documentNo), change]));
  for (const unchanged of plan.unchanged) {
    const reviewedUnchanged = reviewUnchangedByKey.get(String(unchanged.documentKind) + ":" + String(unchanged.documentNo));
    if (!reviewedUnchanged || stable(unchanged) !== stable(reviewedUnchanged)) report.errors.push(errorItem("stale_reviewed_plan", unchanged.documentKind, unchanged.documentNo, "unchanged candidate differs from reviewed plan"));
  }
  for (const change of plan.changes) {
    const reviewedChange = reviewByKey.get(`${change.documentKind}:${change.documentNo}`);
    const retryMatches = change.alreadyApplied && reviewedChange && change.fileHashBefore === reviewedChange.fileHashAfter
      && stable(change.migrationMarker) === stable(reviewedChange.migrationMarker);
    if (!reviewedChange || (!retryMatches && stable(comparableChange(change)) !== stable(comparableChange(reviewedChange)))) report.errors.push(errorItem("stale_reviewed_plan", change.documentKind, change.documentNo, "candidate differs from reviewed plan"));
  }
  if (reviewChanges.length !== plan.changes.length) report.errors.push(errorItem("stale_reviewed_plan", "", "", "candidate set differs from reviewed plan"));
  const backupValidation = await validateBackup({ rootDir, backupRoot: options.backupRoot, reviewedChanges: reviewChanges });
  report.backupValidation = backupValidation;
  if (!backupValidation.valid) report.errors.push(errorItem("backup_invalid", "", "", "backup is missing, stale, partial, unreadable, or overlaps source"));
  report.errors.sort((a, b) => stable(a).localeCompare(stable(b)));
  report.counts.ambiguousErrors = report.errors.length;
  if (report.errors.length) {
    report.planDigest = digestForReport(report);
    await writeReport(options.reportPath, report);
    return { ok: false, report };
  }
  const appliedBeforeFailure = [];
  try {
    for (const change of plan.changes) {
      if (!change.alreadyApplied) {
        if (options.hooks?.beforeJsonWrite) await options.hooks.beforeJsonWrite(change);
        await durableReplace(change.absolute, change.nextBytes);
        appliedBeforeFailure.push(change.documentNo);
      }
      if (options.hooks?.afterJsonWrite) await options.hooks.afterJsonWrite(change);
      if (options.hooks?.beforeIndexUpsert) await options.hooks.beforeIndexUpsert(change);
      indexDocument(rootDir, indexRecordFromPayload(change, change.alreadyApplied ? change.payload : change.nextPayload));
      report.counts.indexReconciliations += 1;
      if (!change.alreadyApplied) report.counts.applied += 1;
    }
    report.appliedBeforeFailure = appliedBeforeFailure;
    report.planDigest = digestForReport(report);
    await writeReport(options.reportPath, report);
    return { ok: true, report };
  } catch {
    report.appliedBeforeFailure = appliedBeforeFailure;
    report.errors.push(errorItem("apply_failed", "", "", "apply stopped after a durable record or index failure"));
    report.errors.sort((a, b) => stable(a).localeCompare(stable(b)));
    report.counts.ambiguousErrors = report.errors.length;
    report.planDigest = digestForReport(report);
    await writeReport(options.reportPath, report);
    return { ok: false, report };
  }
}

export { digestForReport, markerFor, movementHash };
