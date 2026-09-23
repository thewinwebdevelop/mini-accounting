import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import inventoryDb from "../forms/inventory-db.logic.js";
import documentIndex from "../forms/document-index.logic.js";

const { openInventoryDatabase, ensureInventorySchema } = inventoryDb;
const {
  ensureDocumentIndexSchema,
  allocateDocumentNumber,
  peekNextDocumentNumber,
  getDocumentIndexRowByNumber,
  queryDocumentIndexRows,
  indexDocument,
  withDocumentIndexDatabase,
  rebuildDocumentIndex,
  DOCUMENT_KINDS,
} = documentIndex;

async function withTempRoot(callback) {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-document-index-"));
  try {
    await callback(rootDir);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
}

test("ensureDocumentIndexSchema creates documents and allocation tables", async () => {
  await withTempRoot(async (rootDir) => {
    const db = openInventoryDatabase(rootDir);
    ensureDocumentIndexSchema(db);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => row.name);

    assert.equal(tables.includes("documents"), true);
    assert.equal(tables.includes("document_number_allocations"), true);
    assert.equal(tables.includes("document_index_schema_migrations"), true);

    const columns = db.prepare("PRAGMA table_info(documents)").all().map((c) => c.name);
    assert.deepEqual(columns, [
      "id",
      "document_kind",
      "document_no",
      "sequence",
      "accounting_month",
      "status",
      "folder_path",
      "transaction_no",
      "workflow_template_id",
      "workflow_step_id",
      "created_at",
      "updated_at",
    ]);

    db.close();
  });
});

test("ensureDocumentIndexSchema is safe to run against a database already holding live inventory data", async () => {
  await withTempRoot(async (rootDir) => {
    const db = openInventoryDatabase(rootDir);
    ensureInventorySchema(db);

    db.prepare(`
      INSERT INTO products (product_code, name, category, description, status, created_at, updated_at)
      VALUES ('LIVE-1', 'สินค้าอยู่จริง', 'เสื้อ', '', 'active', '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z')
    `).run();

    ensureDocumentIndexSchema(db);
    ensureDocumentIndexSchema(db);

    const product = db.prepare("SELECT product_code FROM products WHERE product_code = 'LIVE-1'").get();
    assert.equal(product.product_code, "LIVE-1");

    const migrations = db.prepare("SELECT COUNT(*) AS c FROM document_index_schema_migrations").get();
    assert.equal(migrations.c, 1);

    db.close();
  });
});

test("allocateDocumentNumber issues sequential numbers per kind and month", async () => {
  await withTempRoot(async (rootDir) => {
    await withDocumentIndexDatabase(rootDir, (db) => {
      const first = allocateDocumentNumber(db, { documentKind: "expense_request", accountingMonth: "2026-09" });
      const second = allocateDocumentNumber(db, { documentKind: "expense_request", accountingMonth: "2026-09" });
      const otherMonth = allocateDocumentNumber(db, { documentKind: "expense_request", accountingMonth: "2026-10" });
      const otherKind = allocateDocumentNumber(db, { documentKind: "substitute_receipt", accountingMonth: "2026-09" });

      assert.deepEqual(first, { sequence: "1", documentNo: "REQ-2026-09-0001" });
      assert.deepEqual(second, { sequence: "2", documentNo: "REQ-2026-09-0002" });
      assert.deepEqual(otherMonth, { sequence: "1", documentNo: "REQ-2026-10-0001" });
      assert.deepEqual(otherKind, { sequence: "1", documentNo: "SR-2026-09-0001" });
    });
  });
});

test("document_number_allocations UNIQUE constraint makes a duplicate sequence impossible to insert twice", async () => {
  await withTempRoot(async (rootDir) => {
    await withDocumentIndexDatabase(rootDir, (db) => {
      db.prepare(`
        INSERT INTO document_number_allocations (document_kind, accounting_month, sequence, document_no, allocated_at)
        VALUES ('expense_request', '2026-09', 1, 'REQ-2026-09-0001', '2026-09-01T00:00:00.000Z')
      `).run();

      assert.throws(() => {
        db.prepare(`
          INSERT INTO document_number_allocations (document_kind, accounting_month, sequence, document_no, allocated_at)
          VALUES ('expense_request', '2026-09', 1, 'REQ-2026-09-0001-dup', '2026-09-01T00:00:00.000Z')
        `).run();
      }, /UNIQUE/);
    });
  });
});

test("indexDocument upserts a row keyed by document_kind + document_no", async () => {
  await withTempRoot(async (rootDir) => {
    indexDocument(rootDir, {
      documentKind: "expense_request",
      documentNo: "REQ-2026-09-0001",
      accountingMonth: "2026-09",
      status: "submitted",
      folderPath: "documents/2026/09/เบิกจ่าย/REQ-2026-09-0001_ทดสอบ",
      transactionNo: "",
      workflowTemplateId: "",
      workflowStepId: "",
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
    });

    indexDocument(rootDir, {
      documentKind: "expense_request",
      documentNo: "REQ-2026-09-0001",
      accountingMonth: "2026-09",
      status: "approved",
      folderPath: "documents/2026/09/เบิกจ่าย/REQ-2026-09-0001_ทดสอบ",
      transactionNo: "",
      workflowTemplateId: "",
      workflowStepId: "",
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-02T00:00:00.000Z",
    });

    await withDocumentIndexDatabase(rootDir, (db) => {
      const rows = db.prepare("SELECT * FROM documents").all();
      assert.equal(rows.length, 1);
      assert.equal(rows[0].status, "approved");
      assert.equal(rows[0].updated_at, "2026-09-02T00:00:00.000Z");
      assert.equal(rows[0].created_at, "2026-09-01T00:00:00.000Z");
      assert.equal(rows[0].sequence, 1);
    });
  });
});

async function writeCanonicalDocument(rootDir, relativeFolderPath, fileName, payload) {
  const dataDir = join(rootDir, relativeFolderPath, "data");
  await mkdir(dataDir, { recursive: true });
  await writeFile(join(dataDir, fileName), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

test("rebuildDocumentIndex backfills every document kind found on disk", async () => {
  await withTempRoot(async (rootDir) => {
    await writeCanonicalDocument(
      rootDir,
      "documents/2026/09/เบิกจ่าย/REQ-2026-09-0001_ค่าน้ำ",
      "submission.json",
      {
        requestNo: "REQ-2026-09-0001",
        accountingMonth: "2026-09",
        status: "submitted",
        folderPath: "documents/2026/09/เบิกจ่าย/REQ-2026-09-0001_ค่าน้ำ",
        transactionNo: "",
        workflowTemplateId: "",
        workflowStepId: "",
        createdAt: "2026-09-01T00:00:00.000Z",
        updatedAt: "2026-09-01T00:00:00.000Z",
      },
    );
    await writeCanonicalDocument(
      rootDir,
      "documents/2026/09/ใบรับรองแทนใบเสร็จ/SR-2026-09-0001_ซื้อของ",
      "substitute-receipt.json",
      {
        receiptNo: "SR-2026-09-0001",
        accountingMonth: "2026-09",
        status: "pending_approval",
        folderPath: "documents/2026/09/ใบรับรองแทนใบเสร็จ/SR-2026-09-0001_ซื้อของ",
        transactionNo: "",
        workflowTemplateId: "",
        workflowStepId: "",
        createdAt: "2026-09-01T00:00:00.000Z",
        updatedAt: "2026-09-01T00:00:00.000Z",
      },
    );
    await writeCanonicalDocument(
      rootDir,
      "documents/2026/09/purchase_order/PO-2026-09-0001_สั่งของ",
      "workflow-document.json",
      {
        documentKind: "purchase_order",
        documentNo: "PO-2026-09-0001",
        accountingMonth: "2026-09",
        status: "draft",
        folderPath: "documents/2026/09/purchase_order/PO-2026-09-0001_สั่งของ",
        transactionNo: "TXN-2026-09-0001",
        workflowTemplateId: "tpl-1",
        workflowStepId: "step-1",
        createdAt: "2026-09-01T00:00:00.000Z",
        updatedAt: "2026-09-01T00:00:00.000Z",
      },
    );
    await writeCanonicalDocument(
      rootDir,
      "documents/2026/09/workflow-transactions/TXN-2026-09-0001_ซื้อสต๊อก",
      "workflow-transaction.json",
      {
        transactionNo: "TXN-2026-09-0001",
        accountingMonth: "2026-09",
        status: "in_progress",
        folderPath: "documents/2026/09/workflow-transactions/TXN-2026-09-0001_ซื้อสต๊อก",
        workflowTemplateId: "tpl-1",
        createdAt: "2026-09-01T00:00:00.000Z",
        updatedAt: "2026-09-01T00:00:00.000Z",
      },
    );

    const result = await rebuildDocumentIndex(rootDir);
    assert.equal(result.total, 4);
    assert.equal(result.counts.expense_request, 1);
    assert.equal(result.counts.substitute_receipt, 1);
    assert.equal(result.counts.purchase_order, 1);
    assert.equal(result.counts.workflow_transaction, 1);
    assert.equal(result.counts.payment_voucher, 0);

    await withDocumentIndexDatabase(rootDir, (db) => {
      const rows = db.prepare("SELECT document_kind, document_no, status, transaction_no FROM documents ORDER BY document_kind").all().map((row) => ({ ...row }));
      assert.deepEqual(rows, [
        { document_kind: "expense_request", document_no: "REQ-2026-09-0001", status: "submitted", transaction_no: "" },
        { document_kind: "purchase_order", document_no: "PO-2026-09-0001", status: "draft", transaction_no: "TXN-2026-09-0001" },
        { document_kind: "substitute_receipt", document_no: "SR-2026-09-0001", status: "pending_approval", transaction_no: "" },
        { document_kind: "workflow_transaction", document_no: "TXN-2026-09-0001", status: "in_progress", transaction_no: "" },
      ]);

      const allocation = db.prepare(`
        SELECT sequence FROM document_number_allocations
        WHERE document_kind = 'expense_request' AND accounting_month = '2026-09'
      `).get();
      assert.equal(allocation.sequence, 1);
    });
  });
});

test("rebuildDocumentIndex is idempotent: running it twice does not duplicate or corrupt rows", async () => {
  await withTempRoot(async (rootDir) => {
    await writeCanonicalDocument(
      rootDir,
      "documents/2026/09/เบิกจ่าย/REQ-2026-09-0001_ค่าน้ำ",
      "submission.json",
      {
        requestNo: "REQ-2026-09-0001",
        accountingMonth: "2026-09",
        status: "submitted",
        folderPath: "documents/2026/09/เบิกจ่าย/REQ-2026-09-0001_ค่าน้ำ",
        createdAt: "2026-09-01T00:00:00.000Z",
        updatedAt: "2026-09-01T00:00:00.000Z",
      },
    );

    const first = await rebuildDocumentIndex(rootDir);
    const second = await rebuildDocumentIndex(rootDir);
    assert.equal(first.total, 1);
    assert.equal(second.total, 1);

    await withDocumentIndexDatabase(rootDir, (db) => {
      const rows = db.prepare("SELECT COUNT(*) AS c FROM documents").get();
      assert.equal(rows.c, 1);
    });

    // A subsequent real allocation must continue after the backfilled number,
    // never reuse it.
    await withDocumentIndexDatabase(rootDir, (db) => {
      const next = allocateDocumentNumber(db, { documentKind: "expense_request", accountingMonth: "2026-09" });
      assert.equal(next.documentNo, "REQ-2026-09-0002");
    });
  });
});

test("rebuildDocumentIndex ignores legacy document folders without a canonical data/<kind>.json file", async () => {
  await withTempRoot(async (rootDir) => {
    const legacyDir = join(rootDir, "documents/2026/08/เบิกจ่าย/REQ-2026-08-0001_เก่า", "pdf");
    await mkdir(legacyDir, { recursive: true });
    await writeFile(join(legacyDir, "01.pdf"), "not a real pdf", "utf8");

    const result = await rebuildDocumentIndex(rootDir);
    assert.equal(result.total, 0);
  });
});

test("DOCUMENT_KINDS covers all seven document kinds plus workflow transactions", () => {
  assert.deepEqual([...DOCUMENT_KINDS].sort(), [
    "cash_spend_declaration",
    "expense_request",
    "goods_receipt",
    "payee_acknowledgement",
    "payment_voucher",
    "purchase_order",
    "substitute_receipt",
    "workflow_transaction",
  ]);
});

test("peekNextDocumentNumber reads document_number_allocations without inserting anything", async () => {
  await withTempRoot(async (rootDir) => {
    await withDocumentIndexDatabase(rootDir, (db) => {
      const first = allocateDocumentNumber(db, { documentKind: "expense_request", accountingMonth: "2026-09" });
      assert.deepEqual(first, { sequence: "1", documentNo: "REQ-2026-09-0001" });

      // Peeking never inserts a row, so it must be safe to call any number of
      // times (a user reopening a form, switching months back and forth)
      // without ever moving what the *next real* allocation will be.
      assert.deepEqual(
        peekNextDocumentNumber(db, { documentKind: "expense_request", accountingMonth: "2026-09" }),
        { sequence: "2", documentNo: "REQ-2026-09-0002" },
      );
      assert.deepEqual(
        peekNextDocumentNumber(db, { documentKind: "expense_request", accountingMonth: "2026-09" }),
        { sequence: "2", documentNo: "REQ-2026-09-0002" },
      );

      const count = db.prepare("SELECT COUNT(*) AS c FROM document_number_allocations").get();
      assert.equal(count.c, 1, "peeking must not have inserted a second allocation row");

      const second = allocateDocumentNumber(db, { documentKind: "expense_request", accountingMonth: "2026-09" });
      assert.deepEqual(second, { sequence: "2", documentNo: "REQ-2026-09-0002" },
        "the real allocation right after a peek must land on exactly the number the peek reported");
    });
  });
});

test("peekNextDocumentNumber starts at sequence 1 for a kind/month with no allocations yet", async () => {
  await withTempRoot(async (rootDir) => {
    await withDocumentIndexDatabase(rootDir, (db) => {
      assert.deepEqual(
        peekNextDocumentNumber(db, { documentKind: "workflow_transaction", accountingMonth: "2026-09" }),
        { sequence: "1", documentNo: "TXN-2026-09-0001" },
      );
    });
  });
});

test("peekNextDocumentNumber validates document kind and accounting month like allocateDocumentNumber", async () => {
  await withTempRoot(async (rootDir) => {
    await withDocumentIndexDatabase(rootDir, (db) => {
      assert.throws(() => peekNextDocumentNumber(db, { documentKind: "not_a_kind", accountingMonth: "2026-09" }));
      assert.throws(() => peekNextDocumentNumber(db, { documentKind: "expense_request", accountingMonth: "not-a-month" }));
    });
  });
});

test("getDocumentIndexRowByNumber finds a single row by document_kind + document_no and returns null otherwise", async () => {
  await withTempRoot(async (rootDir) => {
    indexDocument(rootDir, {
      documentKind: "expense_request",
      documentNo: "REQ-2026-09-0001",
      accountingMonth: "2026-09",
      status: "submitted",
      folderPath: "documents/2026/09/เบิกจ่าย/REQ-2026-09-0001_ทดสอบ",
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
    });

    await withDocumentIndexDatabase(rootDir, (db) => {
      const row = getDocumentIndexRowByNumber(db, "expense_request", "REQ-2026-09-0001");
      assert.equal(row.folderPath, "documents/2026/09/เบิกจ่าย/REQ-2026-09-0001_ทดสอบ");
      assert.equal(row.documentNo, "REQ-2026-09-0001");

      assert.equal(getDocumentIndexRowByNumber(db, "expense_request", "REQ-2026-09-9999"), null);
      // Same document_no under a different kind must not match (kind is part
      // of the key documents.document_no is only unique within).
      assert.equal(getDocumentIndexRowByNumber(db, "substitute_receipt", "REQ-2026-09-0001"), null);
    });
  });
});

test("queryDocumentIndexRows pushes every supported filter down to SQL", async () => {
  await withTempRoot(async (rootDir) => {
    indexDocument(rootDir, {
      documentKind: "purchase_order",
      documentNo: "PO-2026-09-0001",
      accountingMonth: "2026-09",
      status: "draft",
      folderPath: "documents/2026/09/purchase_order/PO-2026-09-0001_a",
      transactionNo: "TXN-2026-09-0001",
      workflowTemplateId: "tpl-1",
      workflowStepId: "step-1",
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
    });
    indexDocument(rootDir, {
      documentKind: "goods_receipt",
      documentNo: "GR-2026-09-0001",
      accountingMonth: "2026-09",
      status: "draft",
      folderPath: "documents/2026/09/goods_receipt/GR-2026-09-0001_a",
      transactionNo: "TXN-2026-09-0001",
      workflowTemplateId: "tpl-1",
      workflowStepId: "step-2",
      createdAt: "2026-09-02T00:00:00.000Z",
      updatedAt: "2026-09-02T00:00:00.000Z",
    });
    indexDocument(rootDir, {
      documentKind: "purchase_order",
      documentNo: "PO-2026-09-0002",
      accountingMonth: "2026-09",
      status: "approved",
      folderPath: "documents/2026/09/purchase_order/PO-2026-09-0002_b",
      transactionNo: "TXN-2026-09-0002",
      workflowTemplateId: "tpl-2",
      workflowStepId: "step-1",
      createdAt: "2026-09-03T00:00:00.000Z",
      updatedAt: "2026-09-03T00:00:00.000Z",
    });

    await withDocumentIndexDatabase(rootDir, (db) => {
      const byKind = queryDocumentIndexRows(db, { documentKind: "purchase_order" });
      assert.deepEqual(byKind.map((r) => r.documentNo).sort(), ["PO-2026-09-0001", "PO-2026-09-0002"]);

      const byKinds = queryDocumentIndexRows(db, { documentKinds: ["purchase_order", "goods_receipt"] });
      assert.equal(byKinds.length, 3);

      const byTransaction = queryDocumentIndexRows(db, { transactionNo: "TXN-2026-09-0001" });
      assert.deepEqual(byTransaction.map((r) => r.documentNo).sort(), ["GR-2026-09-0001", "PO-2026-09-0001"]);

      const byStatus = queryDocumentIndexRows(db, { status: "approved" });
      assert.deepEqual(byStatus.map((r) => r.documentNo), ["PO-2026-09-0002"]);

      const byTemplateAndStep = queryDocumentIndexRows(db, { workflowTemplateId: "tpl-1", workflowStepId: "step-1" });
      assert.deepEqual(byTemplateAndStep.map((r) => r.documentNo), ["PO-2026-09-0001"]);

      const everything = queryDocumentIndexRows(db, {});
      assert.equal(everything.length, 3);
    });
  });
});

// The /workflow-documents list page filters by accounting month; that filter
// must be pushed down to SQL (an indexed column) as a bound parameter, the
// same as every other filter above.
test("queryDocumentIndexRows narrows by accountingMonth as a bound SQL filter", async () => {
  await withTempRoot(async (rootDir) => {
    const rows = [
      ["purchase_order", "PO-2026-08-0001", "2026-08"],
      ["purchase_order", "PO-2026-09-0001", "2026-09"],
      ["goods_receipt", "GR-2026-09-0001", "2026-09"],
    ];
    for (const [documentKind, documentNo, accountingMonth] of rows) {
      indexDocument(rootDir, {
        documentKind,
        documentNo,
        accountingMonth,
        status: "draft",
        folderPath: `documents/${accountingMonth.replace("-", "/")}/${documentKind}/${documentNo}_a`,
        createdAt: `${accountingMonth}-01T00:00:00.000Z`,
        updatedAt: `${accountingMonth}-01T00:00:00.000Z`,
      });
    }

    await withDocumentIndexDatabase(rootDir, (db) => {
      assert.deepEqual(
        queryDocumentIndexRows(db, { accountingMonth: "2026-09" }).map((row) => row.documentNo).sort(),
        ["GR-2026-09-0001", "PO-2026-09-0001"],
      );
      assert.deepEqual(
        queryDocumentIndexRows(db, { documentKind: "purchase_order", accountingMonth: "2026-08" }).map((row) => row.documentNo),
        ["PO-2026-08-0001"],
      );
      assert.deepEqual(
        queryDocumentIndexRows(db, { documentKinds: ["purchase_order", "goods_receipt"], accountingMonth: "2026-09" }).map((row) => row.documentNo).sort(),
        ["GR-2026-09-0001", "PO-2026-09-0001"],
      );
      // A value that would widen the query if it were ever spliced into the
      // SQL text must match nothing when bound.
      assert.deepEqual(queryDocumentIndexRows(db, { accountingMonth: "2026-09' OR '1'='1" }), []);
    });
  });
});
