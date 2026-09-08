// ดัชนีเอกสารบัญชี (documents index) — ตารางอนุพันธ์ (derived) ใน SQLite
// เดียวกับที่สต๊อกใช้อยู่แล้ว (ดู forms/inventory-db.logic.js) ไฟล์บนดิสก์ใน
// documents/YYYY/MM/... ยังคงเป็นแหล่งความจริงเพียงแหล่งเดียว (source of
// truth) เสมอ — ตารางนี้มีไว้เพื่อค้นหา/รายงานเร็วขึ้นเท่านั้น และต้อง
// สร้างใหม่ได้เสมอจากไฟล์บนดิสก์ (ดู rebuildDocumentIndex ด้านล่าง)
//
// ไฟล์นี้ยังเก็บกลไก "ออกเลขที่เอกสาร" แบบอะตอมมิก (allocateDocumentNumber)
// ซึ่งเป็นตารางที่แยกต่างหากจาก documents โดยเจตนา: documents สะท้อนเฉพาะ
// เอกสารที่มีไฟล์บนดิสก์จริงเท่านั้น (เขียนเข้า documents ก็ต่อเมื่อไฟล์เขียน
// สำเร็จแล้ว) ในขณะที่ document_number_allocations คือ "ใบจอง" เลขที่ ซึ่ง
// ต้องจองก่อนที่จะรู้ด้วยซ้ำว่าไฟล์จะเขียนสำเร็จหรือไม่ (เลขที่ต้องถูกกำหนด
// ก่อนสร้าง folderPath/payload) หากเขียนไฟล์ไม่สำเร็จหลังจองเลขแล้ว เลขนั้น
// จะกลายเป็นช่องว่าง (gap) ที่ไม่ถูกใช้ซ้ำอีก — ซึ่งเป็นพฤติกรรมที่ถูกต้องตาม
// หลักการออกเลขที่เอกสารทางบัญชี (ยอมให้เลขขาดหาย แต่ห้ามเลขซ้ำหรือใช้เลข
// เดิมซ้ำ) และเป็นพฤติกรรมเดียวกับที่ mkdir-EEXIST reservation ของ
// startWorkflowTransaction เดิมทำอยู่แล้ว
const { readdir, readFile } = require("node:fs/promises");
const path = require("node:path");

const { openInventoryDatabase } = require("./inventory-db.logic.js");

const DOCUMENT_INDEX_SCHEMA_VERSION = 1;

// เจ็ดชนิดเอกสารตามที่ระบุใน spec บวก workflow_transaction (ธุรกรรมที่รวม
// เอกสารหลายชนิดเข้าด้วยกัน) — ปิดชุดค่าด้วย CHECK เพื่อกันค่าพิมพ์ผิดหลุด
// เข้าไปเงียบ ๆ (บทเรียนจากตารางหกช่องที่เทสต์ครอบคลุมช่องเดียวก่อนหน้านี้)
const DOCUMENT_KINDS = [
  "expense_request",
  "substitute_receipt",
  "purchase_order",
  "payment_voucher",
  "cash_spend_declaration",
  "payee_acknowledgement",
  "goods_receipt",
  "workflow_transaction",
];

const DOCUMENT_KIND_PREFIXES = {
  expense_request: "REQ",
  substitute_receipt: "SR",
  purchase_order: "PO",
  payment_voucher: "PV",
  cash_spend_declaration: "CSD",
  payee_acknowledgement: "PAR",
  goods_receipt: "GR",
  workflow_transaction: "TXN",
};

// รวมสถานะที่เอกสารทุกชนิดใช้จริง (แต่ละชนิดใช้ subset ของชุดนี้) เพิ่ม ''
// ไว้เผื่อ backfill เจอ payload เก่าที่ไม่มี status เพื่อไม่ให้ migration ล้ม
const DOCUMENT_STATUSES = [
  "",
  "draft",
  "submitted",
  "pending_approval",
  "approved",
  "received",
  "completed",
  "cancelled",
  "voided",
  "in_progress",
];

const CANONICAL_DOCUMENT_FILE_NAMES = new Set([
  "submission.json",
  "substitute-receipt.json",
  "workflow-document.json",
  "workflow-transaction.json",
]);

function ensureDocumentIndexSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS document_index_schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      document_kind TEXT NOT NULL,
      document_no TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      accounting_month TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT '',
      folder_path TEXT NOT NULL,
      transaction_no TEXT NOT NULL DEFAULT '',
      workflow_template_id TEXT NOT NULL DEFAULT '',
      workflow_step_id TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT '',
      UNIQUE (document_kind, document_no),
      CHECK (document_kind IN (${DOCUMENT_KINDS.map((kind) => `'${kind}'`).join(", ")})),
      CHECK (status IN (${DOCUMENT_STATUSES.map((status) => `'${status}'`).join(", ")}))
    );

    CREATE INDEX IF NOT EXISTS idx_documents_kind_month
      ON documents (document_kind, accounting_month, sequence);

    CREATE INDEX IF NOT EXISTS idx_documents_transaction_no
      ON documents (transaction_no);

    CREATE INDEX IF NOT EXISTS idx_documents_kind_status
      ON documents (document_kind, status);

    -- ใบจองเลขที่เอกสาร: ให้ฐานข้อมูลเป็นผู้ตัดสินความไม่ซ้ำกันของเลขที่
    -- ผ่าน UNIQUE constraint แทนการอ่านโฟลเดอร์แล้วค่อยเขียน (race) เดิม
    CREATE TABLE IF NOT EXISTS document_number_allocations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      document_kind TEXT NOT NULL,
      accounting_month TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      document_no TEXT NOT NULL,
      allocated_at TEXT NOT NULL,
      UNIQUE (document_kind, accounting_month, sequence),
      UNIQUE (document_kind, document_no)
    );

    CREATE INDEX IF NOT EXISTS idx_document_number_allocations_kind_month
      ON document_number_allocations (document_kind, accounting_month, sequence);
  `);

  db.prepare(`
    INSERT OR IGNORE INTO document_index_schema_migrations (version, applied_at)
    VALUES (?, ?)
  `).run(DOCUMENT_INDEX_SCHEMA_VERSION, new Date().toISOString());
}

function withDocumentIndexDatabase(rootDir, callback) {
  const db = openInventoryDatabase(rootDir);
  try {
    ensureDocumentIndexSchema(db);
    return callback(db);
  } finally {
    db.close();
  }
}

function padSequence(sequence, width = 4) {
  return String(sequence).padStart(width, "0");
}

function isUniqueConstraintViolation(error) {
  const message = String(error && error.message || "");
  return message.includes("UNIQUE constraint failed") || error?.code === "SQLITE_CONSTRAINT_UNIQUE";
}

function isTransientSqliteError(error) {
  const message = String(error && error.message || "");
  return message.includes("database is locked") || message.includes("SQLITE_BUSY") || error?.code === "SQLITE_BUSY";
}

// ออกเลขที่เอกสารถัดไปแบบอะตอมมิก: อ่านเลขสูงสุดที่เคยจองไว้สำหรับ
// (document_kind, accounting_month) แล้วพยายามจองเลขถัดไปด้วย INSERT ที่มี
// UNIQUE constraint คุ้มกันอยู่ หากมีผู้อื่นจองเลขเดียวกันสำเร็จไปก่อน (ชนกัน
// ที่ constraint ไม่ใช่แค่ "ไม่น่าจะชน") ให้เริ่มอ่านค่าสูงสุดใหม่แล้วลองอีกครั้ง
// ภายใน process เดียว (event loop เดี่ยว) การอ่าน+เขียนนี้ไม่มี await คั่นกลาง
// จึงรันจบในทีเดียวโดยไม่มีโค้ดอื่นแทรกได้อยู่แล้ว ส่วน UNIQUE constraint คือ
// เกราะชั้นที่สองที่ยังคุ้มกันความถูกต้องได้แม้มีมากกว่าหนึ่ง process เขียนฐาน
// ข้อมูลเดียวกันพร้อมกันจริง ๆ (เช่น สคริปต์ backfill รันขณะเซิร์ฟเวอร์ทำงาน)
function allocateDocumentNumber(db, { documentKind, accountingMonth, maxAttempts = 50 } = {}) {
  if (!DOCUMENT_KINDS.includes(documentKind)) {
    throw new Error(`Invalid document kind: ${documentKind}`);
  }
  if (!/^\d{4}-\d{2}$/.test(String(accountingMonth || ""))) {
    throw new Error("Invalid accounting month");
  }

  const prefix = DOCUMENT_KIND_PREFIXES[documentKind];
  const selectMax = db.prepare(`
    SELECT COALESCE(MAX(sequence), 0) AS maxSequence
    FROM document_number_allocations
    WHERE document_kind = ? AND accounting_month = ?
  `);
  const insert = db.prepare(`
    INSERT INTO document_number_allocations (document_kind, accounting_month, sequence, document_no, allocated_at)
    VALUES (?, ?, ?, ?, ?)
  `);

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const { maxSequence } = selectMax.get(documentKind, accountingMonth);
    const sequence = maxSequence + 1;
    const documentNo = `${prefix}-${accountingMonth}-${padSequence(sequence)}`;

    try {
      insert.run(documentKind, accountingMonth, sequence, documentNo, new Date().toISOString());
      return { sequence: String(sequence), documentNo };
    } catch (error) {
      if (isUniqueConstraintViolation(error) || isTransientSqliteError(error)) continue;
      throw error;
    }
  }

  throw new Error("ไม่สามารถออกเลขที่เอกสารได้ กรุณาลองใหม่อีกครั้ง");
}

function parseSequenceFromDocumentNo(documentNo) {
  const match = String(documentNo || "").match(/(\d+)$/);
  return match ? Number.parseInt(match[1], 10) : 0;
}

// เลขที่เอกสารทุกชนิดมีรูปแบบ PREFIX-YYYY-MM-NNNN เสมอ (บังคับโดย
// allocateDocumentNumber และ builder ของแต่ละชนิดเอง) จึงเป็นแหล่งความจริงของ
// "เดือนบัญชี" ที่เชื่อถือได้กว่าฟิลด์ accountingMonth ในตัว payload เอง —
// buildExpensePayload (forms/expense-request.logic.js, ห้ามแก้ในงานนี้) ไม่
// เก็บฟิลด์ accountingMonth ไว้ใน payload ที่เขียนลงดิสก์เลยด้วยซ้ำ ดัชนีจึง
// คำนวณเดือนบัญชีจากเลขที่เอกสารเสมอ แทนที่จะพึ่งพาฟิลด์ที่บางชนิดไม่มี
function parseAccountingMonthFromDocumentNo(documentNo) {
  const match = String(documentNo || "").match(/-(\d{4}-\d{2})-\d+$/);
  return match ? match[1] : "";
}

// เขียนดัชนีของเอกสารหนึ่งฉบับ (write-through) เรียกจากภายใน "ฟังก์ชันเดียวกัน"
// ที่เพิ่งเขียนไฟล์ JSON ของเอกสารนั้นสำเร็จ (ดู forms/local-server.logic.js)
// ไม่เคยเรียกก่อนไฟล์เขียนสำเร็จ — แถวดัชนีจึงไม่มีทางอ้างถึงเอกสารที่ไม่มี
// อยู่จริงบนดิสก์ upsert ด้วย document_kind+document_no กันไม่ให้ save ซ้ำ
// (แก้ไขเอกสารเดิม, อนุมัติ, เสร็จสิ้น) สร้างแถวซ้ำ
function upsertDocumentIndexRow(db, record) {
  const {
    documentKind,
    documentNo,
    status,
    folderPath,
    transactionNo = "",
    workflowTemplateId = "",
    workflowStepId = "",
    createdAt = "",
    updatedAt = "",
  } = record;

  if (!DOCUMENT_KINDS.includes(documentKind)) {
    throw new Error(`Invalid document kind: ${documentKind}`);
  }
  if (!documentNo) throw new Error("documentNo is required to index a document");
  if (!folderPath) throw new Error("folderPath is required to index a document");

  const sequence = parseSequenceFromDocumentNo(documentNo);
  const accountingMonth = parseAccountingMonthFromDocumentNo(documentNo) || record.accountingMonth;

  db.prepare(`
    INSERT INTO documents (
      document_kind, document_no, sequence, accounting_month, status, folder_path,
      transaction_no, workflow_template_id, workflow_step_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (document_kind, document_no) DO UPDATE SET
      sequence = excluded.sequence,
      accounting_month = excluded.accounting_month,
      status = excluded.status,
      folder_path = excluded.folder_path,
      transaction_no = excluded.transaction_no,
      workflow_template_id = excluded.workflow_template_id,
      workflow_step_id = excluded.workflow_step_id,
      updated_at = excluded.updated_at
  `).run(
    documentKind,
    documentNo,
    sequence,
    String(accountingMonth || ""),
    String(status || ""),
    folderPath,
    transactionNo || "",
    workflowTemplateId || "",
    workflowStepId || "",
    createdAt || updatedAt || "",
    updatedAt || createdAt || "",
  );
}

function indexDocument(rootDir, record) {
  return withDocumentIndexDatabase(rootDir, (db) => upsertDocumentIndexRow(db, record));
}

// อ่าน payload หนึ่งไฟล์บนดิสก์แล้วแปลงเป็น record ของตาราง documents
// คืนค่า null หากไฟล์นี้ไม่ใช่ไฟล์ JSON เอกสารที่ document index รู้จัก หรือ
// ขาดฟิลด์ที่จำเป็น (documentNo/folderPath) — เกิดขึ้นได้กับข้อมูลเก่าก่อนยุค
// "data/<kind>.json" (เช่น REQ-2026-08-0001 ที่ไม่มี data/submission.json)
// ซึ่ง read path ปัจจุบันของแอปก็มองไม่เห็นเอกสารเหล่านั้นเช่นกันอยู่แล้ว
function buildIndexRecordFromFile(fileName, payload, fallbackFolderPath) {
  const folderPath = payload.folderPath || fallbackFolderPath;

  if (fileName === "submission.json") {
    if (!payload.requestNo) return null;
    return {
      documentKind: "expense_request",
      documentNo: payload.requestNo,
      accountingMonth: payload.accountingMonth,
      status: payload.status,
      folderPath,
      transactionNo: payload.transactionNo,
      workflowTemplateId: payload.workflowTemplateId,
      workflowStepId: payload.workflowStepId,
      createdAt: payload.createdAt,
      updatedAt: payload.updatedAt,
    };
  }

  if (fileName === "substitute-receipt.json") {
    if (!payload.receiptNo) return null;
    return {
      documentKind: "substitute_receipt",
      documentNo: payload.receiptNo,
      accountingMonth: payload.accountingMonth,
      status: payload.status,
      folderPath,
      transactionNo: payload.transactionNo,
      workflowTemplateId: payload.workflowTemplateId,
      workflowStepId: payload.workflowStepId,
      createdAt: payload.createdAt,
      updatedAt: payload.updatedAt,
    };
  }

  if (fileName === "workflow-document.json") {
    if (!payload.documentNo || !payload.documentKind) return null;
    return {
      documentKind: payload.documentKind,
      documentNo: payload.documentNo,
      accountingMonth: payload.accountingMonth,
      status: payload.status,
      folderPath,
      transactionNo: payload.transactionNo,
      workflowTemplateId: payload.workflowTemplateId,
      workflowStepId: payload.workflowStepId,
      createdAt: payload.createdAt,
      updatedAt: payload.updatedAt,
    };
  }

  if (fileName === "workflow-transaction.json") {
    if (!payload.transactionNo) return null;
    return {
      documentKind: "workflow_transaction",
      documentNo: payload.transactionNo,
      accountingMonth: payload.accountingMonth,
      status: payload.status,
      folderPath,
      transactionNo: "",
      workflowTemplateId: payload.workflowTemplateId,
      workflowStepId: "",
      createdAt: payload.createdAt,
      updatedAt: payload.updatedAt,
    };
  }

  return null;
}

async function scanDocumentIndexRecords(rootDir) {
  const documentsRoot = path.join(rootDir, "documents");
  const records = [];

  async function walk(dir) {
    let entries = [];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      return;
    }

    for (const entry of entries) {
      const absolutePath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }

      if (!CANONICAL_DOCUMENT_FILE_NAMES.has(entry.name)) continue;

      let payload;
      try {
        payload = JSON.parse(await readFile(absolutePath, "utf8"));
      } catch (error) {
        // ไฟล์เสียหาย/อ่านไม่ได้ ไม่ควรทำให้ backfill ทั้งชุดล้ม — ข้ามและไป
        // ต่อ เหมือนกับที่ read path อื่น ๆ ของแอป degrade ต่อไฟล์เสียเดี่ยว ๆ
        console.error(`ไม่สามารถอ่านไฟล์เอกสาร ${absolutePath} ได้: ${error.message}`);
        continue;
      }

      // data/ คือโฟลเดอร์ย่อยของโฟลเดอร์เอกสาร ต้องถอยกลับสองชั้น (ชื่อไฟล์ +
      // "data") เพื่อได้โฟลเดอร์เอกสารจริง ตรงกับที่ findAllWorkflowDocuments ทำ
      const fallbackFolderPath = path.relative(rootDir, path.dirname(path.dirname(absolutePath)));
      const record = buildIndexRecordFromFile(entry.name, payload, fallbackFolderPath);
      if (record) records.push(record);
    }
  }

  await walk(documentsRoot);
  return records;
}

// สร้างดัชนีใหม่ทั้งหมดจากไฟล์บนดิสก์ — ล้างตาราง documents แล้วเขียนใหม่จาก
// ศูนย์ (idempotent โดยธรรมชาติ: รันกี่ครั้งก็ได้ผลลัพธ์เดียวกัน ไม่มีการ
// ซ้ำซ้อนสะสม) และ "จอง" เลขที่ทุกเลขที่พบบนดิสก์ไว้ใน
// document_number_allocations ด้วย INSERT OR IGNORE (ไม่ทับเลขที่จองไว้แล้ว
// จากการทำงานจริงของระบบ) เพื่อไม่ให้การจองเลขครั้งถัดไปย้อนกลับไปชนกับเลขที่
// มีอยู่จริงบนดิสก์แล้ว รันได้ตามต้องการ (ไม่ผูกกับ deploy ใด ๆ) เพื่อซ่อม
// ดัชนีหากมันเพี้ยนไปจากดิสก์
function rebuildDocumentIndex(rootDir) {
  return scanDocumentIndexRecords(rootDir).then((records) => (
    withDocumentIndexDatabase(rootDir, (db) => {
      const counts = Object.fromEntries(DOCUMENT_KINDS.map((kind) => [kind, 0]));

      db.exec("BEGIN");
      try {
        db.exec("DELETE FROM documents");

        const insertDocument = db.prepare(`
          INSERT INTO documents (
            document_kind, document_no, sequence, accounting_month, status, folder_path,
            transaction_no, workflow_template_id, workflow_step_id, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const reserveNumber = db.prepare(`
          INSERT OR IGNORE INTO document_number_allocations (
            document_kind, accounting_month, sequence, document_no, allocated_at
          ) VALUES (?, ?, ?, ?, ?)
        `);

        for (const record of records) {
          const sequence = parseSequenceFromDocumentNo(record.documentNo);
          const accountingMonth = parseAccountingMonthFromDocumentNo(record.documentNo) || String(record.accountingMonth || "");
          const nowIso = new Date().toISOString();

          insertDocument.run(
            record.documentKind,
            record.documentNo,
            sequence,
            accountingMonth,
            String(record.status || ""),
            record.folderPath,
            record.transactionNo || "",
            record.workflowTemplateId || "",
            record.workflowStepId || "",
            record.createdAt || record.updatedAt || "",
            record.updatedAt || record.createdAt || "",
          );
          reserveNumber.run(
            record.documentKind,
            accountingMonth,
            sequence,
            record.documentNo,
            nowIso,
          );

          counts[record.documentKind] = (counts[record.documentKind] || 0) + 1;
        }

        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }

      return { counts, total: records.length };
    })
  ));
}

module.exports = {
  DOCUMENT_INDEX_SCHEMA_VERSION,
  DOCUMENT_KINDS,
  DOCUMENT_KIND_PREFIXES,
  DOCUMENT_STATUSES,
  ensureDocumentIndexSchema,
  withDocumentIndexDatabase,
  allocateDocumentNumber,
  indexDocument,
  upsertDocumentIndexRow,
  parseSequenceFromDocumentNo,
  parseAccountingMonthFromDocumentNo,
  rebuildDocumentIndex,
  scanDocumentIndexRecords,
};
