# Substitute Receipt State Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor substitute receipts so document submission, approval, and inventory receiving are separate state transitions.

**Architecture:** Keep the current file-backed document storage and PDF generator, but introduce substitute receipt drafts plus submitted receipt state metadata. `POST /api/substitute-receipts` will submit into `pending_approval` without stock movement; a separate receive action on an approved stock receipt creates idempotent `purchase_in` movements. Existing submitted receipts without `status` are loaded as `received` if their stock movements already exist.

**Tech Stack:** Node.js CommonJS business logic, local HTTP server in `local-server.mjs`, SQLite inventory via `forms/inventory.logic.js`, ReportLab/pypdf PDF generator, Node test runner through `./scripts/test.sh`.

**Spec:** `docs/superpowers/specs/2026-09-04-substitute-receipt-state-workflow-design.md`

## Global Constraints

- State flow is `draft -> pending_approval -> approved -> received`.
- Drafts must not consume `SR` numbers and must not create stock movements.
- Submitted stock purchase receipts must not create stock movements until `receive-stock`.
- `approved` and `received` stock purchase receipts lock `receiptType`, `stockSkuId`, `quantity`, `unitCost`, and line add/delete.
- Receiving stock must be idempotent for a receipt number.
- Existing submitted receipts with no `status` are inferred as `received` when stock movements exist, otherwise `pending_approval`.
- Keep raw evidence files and PDF audit packets in the existing folder style.

---

## File Structure

- `forms/substitute-receipt.logic.js`: add state constants, transition validation, locked-line comparison helpers, and status labels.
- `forms/local-server.logic.js`: add draft storage, submitted receipt listing/loading, state transitions, idempotent receiving, and non-stock edit support.
- `forms/inventory.logic.js`: expose a read helper for stock movements by reference so receiving can be idempotent and migration can infer status.
- `local-server.mjs`: add draft/list/load/approve/receive/return/cancel endpoints.
- `forms/substitute-receipt.html`: make the current form state-aware and add draft/submit controls.
- `forms/substitute-receipt.logic.browser.js`: load drafts/submitted receipts, save drafts, submit to review, approve, and receive stock.
- `forms/substitute-receipts.html`: new list/search page for drafts and submitted receipts.
- `forms/substitute-receipts.logic.browser.js`: list page controller.
- `scripts/generate_expense_pdfs.py`: include status labels and stock receipt metadata in substitute receipt PDFs.
- `docs/feature-checklist.md`: mark the state workflow and move the next suggested task forward.
- Tests: extend `tests/substitute-receipt.logic.test.mjs`, `tests/local-server.logic.test.mjs`, `tests/substitute-receipt-api.test.mjs`, `tests/substitute-receipt.html.test.mjs`, and add `tests/substitute-receipts.html.test.mjs`.

---

### Task 1: State Helpers And Inventory Reference Reads

**Files:**
- Modify: `forms/substitute-receipt.logic.js`
- Modify: `forms/inventory.logic.js`
- Test: `tests/substitute-receipt.logic.test.mjs`
- Test: `tests/inventory.logic.test.mjs`

**Interfaces:**
- Consumes: existing `buildSubstituteReceiptPayload(data)` and inventory SQLite schema.
- Produces: `SUBSTITUTE_RECEIPT_STATUSES`, `SUBSTITUTE_RECEIPT_STATUS_LABELS`, `normalizeSubstituteReceiptStatus(status)`, `assertSubstituteReceiptTransition(fromStatus, toStatus)`, `assertStockLinesUnchanged(originalPayload, nextPayload)`, and `listStockMovementsByReference(rootDir, referenceType, referenceNo)`.

- [ ] **Step 1: Write failing substitute receipt state helper tests**

Add to `tests/substitute-receipt.logic.test.mjs`:

```js
test("substitute receipt state helpers validate transitions and lock stock lines", () => {
  assert.equal(normalizeSubstituteReceiptStatus(""), "draft");
  assert.equal(SUBSTITUTE_RECEIPT_STATUS_LABELS.approved, "อนุมัติแล้ว");
  assert.doesNotThrow(() => assertSubstituteReceiptTransition("pending_approval", "approved"));
  assert.throws(() => assertSubstituteReceiptTransition("draft", "received"), /Invalid substitute receipt status transition/);

  const original = {
    receiptType: "stock_purchase",
    lines: [{ stockSkuId: "1", quantity: 2, unitCost: "100.00" }],
  };
  assert.doesNotThrow(() => assertStockLinesUnchanged(original, {
    receiptType: "stock_purchase",
    lines: [{ stockSkuId: "1", quantity: "2", unitCost: "100" }],
  }));
  assert.throws(() => assertStockLinesUnchanged(original, {
    receiptType: "stock_purchase",
    lines: [{ stockSkuId: "1", quantity: "3", unitCost: "100" }],
  }), /Stock lines cannot be edited/);
});
```

Update the destructuring import in that test file to include the produced helpers.

- [ ] **Step 2: Write failing inventory reference read test**

Add to `tests/inventory.logic.test.mjs`:

```js
test("listStockMovementsByReference returns movements for idempotent document receiving", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-inventory-ref-"));
  try {
    const product = createProduct(rootDir, { productCode: "REF", name: "เสื้อ REF", category: "เสื้อ" });
    const sku = createStockSku(rootDir, { productId: product.id, sku: "REF-WHITE-M", color: "ขาว", size: "M", defaultUnitCost: "100" });
    createPurchaseInMovement(rootDir, {
      stockSkuId: sku.id,
      movementDate: "2026-09-04",
      quantity: "2",
      unitCost: "100",
      referenceType: "substitute_receipt",
      referenceNo: "SR-2026-09-0001",
    });

    const movements = listStockMovementsByReference(rootDir, "substitute_receipt", "SR-2026-09-0001");
    assert.equal(movements.length, 1);
    assert.equal(movements[0].referenceNo, "SR-2026-09-0001");
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 3: Run RED tests**

Run:

```bash
/Users/tar/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/substitute-receipt.logic.test.mjs tests/inventory.logic.test.mjs
```

Expected: FAIL because helper exports do not exist.

- [ ] **Step 4: Implement helper functions**

In `forms/substitute-receipt.logic.js`, add:

```js
const SUBSTITUTE_RECEIPT_STATUSES = ["draft", "pending_approval", "approved", "received", "cancelled", "voided"];
const SUBSTITUTE_RECEIPT_STATUS_LABELS = {
  draft: "แบบร่าง",
  pending_approval: "รอตรวจอนุมัติ",
  approved: "อนุมัติแล้ว",
  received: "รับเข้าคลังแล้ว",
  cancelled: "ยกเลิก",
  voided: "ยกเลิกหลังรับรู้",
};
```

Implement `normalizeSubstituteReceiptStatus`, `assertSubstituteReceiptTransition`, and `assertStockLinesUnchanged` using the allowed transitions from the spec. Normalize stock line comparison by comparing `receiptType`, line count, `stockSkuId`, integer `quantity`, and two-decimal `unitCost`.

In `forms/inventory.logic.js`, add `listStockMovementsByReference(rootDir, referenceType, referenceNo)` using the existing SQLite connection and return rows normalized through the same mapper used by stock card movements.

- [ ] **Step 5: Run GREEN tests**

Run:

```bash
/Users/tar/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/substitute-receipt.logic.test.mjs tests/inventory.logic.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add forms/substitute-receipt.logic.js forms/inventory.logic.js tests/substitute-receipt.logic.test.mjs tests/inventory.logic.test.mjs
git commit -m "Add substitute receipt state helpers"
```

---

### Task 2: Draft Storage For Substitute Receipts

**Files:**
- Modify: `forms/local-server.logic.js`
- Test: `tests/local-server.logic.test.mjs`

**Interfaces:**
- Consumes: `buildSubstituteReceiptPayload(data)`, `validateSubstituteReceipt(data)`, `prepareUploadRecords(uploads, existingEvidenceFiles, fileNameBuilder)`, and existing expense draft storage patterns.
- Produces: `saveSubstituteReceiptDraft({ rootDir, payload, uploads }): Promise<{ draftId, folderPath, absoluteFolderPath, rawFiles, updatedAt }>` and `getSubstituteReceiptDraft(rootDir, draftId)`.

- [ ] **Step 1: Write failing draft tests**

Add to `tests/local-server.logic.test.mjs`:

```js
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
```

Update destructuring imports to include `saveSubstituteReceiptDraft` and `getSubstituteReceiptDraft`.

- [ ] **Step 2: Run RED test**

Run:

```bash
/Users/tar/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/local-server.logic.test.mjs
```

Expected: FAIL because draft functions do not exist.

- [ ] **Step 3: Implement draft storage**

Add helpers in `forms/local-server.logic.js`:

```js
function createSubstituteReceiptDraftId(accountingMonth) {
  const { year, month } = getMonthParts(accountingMonth);
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return `SR-DRAFT-${year}-${month}-${unique}`;
}
```

Store draft JSON at `drafts/YYYY/MM/substitute-receipts/<draftId>/data/draft.json`, store raw files under `raw/`, preserve previous raw files when updating an existing draft, and export both functions.

- [ ] **Step 4: Run GREEN test**

Run:

```bash
/Users/tar/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/local-server.logic.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add forms/local-server.logic.js tests/local-server.logic.test.mjs
git commit -m "Add substitute receipt drafts"
```

---

### Task 3: Submit Without Stock Receiving

**Files:**
- Modify: `forms/local-server.logic.js`
- Modify: `tests/local-server.logic.test.mjs`
- Modify: `tests/substitute-receipt-api.test.mjs`

**Interfaces:**
- Consumes: Task 2 `getSubstituteReceiptDraft(rootDir, draftId, options)`, Task 1 state helpers.
- Produces: `saveSubstituteReceiptSubmission({ rootDir, payload, uploads, createStockMovements }): Promise<{ receiptNo, status, folderPath, absoluteFolderPath, pdfFiles, rawFiles, stockMovements }>` returns `status: "pending_approval"`, `stockMovements: []`, and writes `statusHistory`.

- [ ] **Step 1: Update failing local-server tests**

Change the existing stock movement test expectation:

```js
assert.equal(result.status, "pending_approval");
assert.equal(result.stockMovements.length, 0);
const card = getStockCard(rootDir, stockSku.id);
assert.equal(card.balance.quantityOnHand, 0);
```

Add a submit-from-draft assertion:

```js
test("saveSubstituteReceiptSubmission submits a draft into pending approval", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-substitute-submit-draft-"));
  try {
    const draft = await saveSubstituteReceiptDraft({ rootDir, payload: validSubstituteReceiptPayload(), uploads: validSlipUpload() });
    const result = await saveSubstituteReceiptSubmission({ rootDir, payload: { draftId: draft.draftId } });
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
```

If helper functions `validSubstituteReceiptPayload` and `validSlipUpload` do not exist in the test file, create them near the top with the exact payload already used by existing substitute receipt tests.

- [ ] **Step 2: Update failing API test**

In `tests/substitute-receipt-api.test.mjs`, change submit expectations:

```js
assert.equal(submitted.status, "pending_approval");
assert.equal(submitted.stockMovements.length, 0);
const stockCard = await requestJson(baseUrl, `/api/inventory/stock-card?stockSkuId=${stockSku.id}`);
assert.equal(stockCard.balance.quantityOnHand, 0);
```

- [ ] **Step 3: Run RED tests**

Run:

```bash
/Users/tar/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/local-server.logic.test.mjs tests/substitute-receipt-api.test.mjs
```

Expected: FAIL because submit still creates stock movements immediately.

- [ ] **Step 4: Refactor submission**

In `saveSubstituteReceiptSubmission`:

- Allow payload `{ draftId }` by loading the draft payload and raw evidence.
- Assign the next SR number only when submitting.
- Set `status: "pending_approval"`.
- Write `statusHistory: [{ fromStatus: "", toStatus: "pending_approval", changedAt, note: "submitted" }]`.
- Remove automatic `createPurchaseInMovement` from submission.
- Return `stockMovements: []`.
- Mark source draft record as `submitted`.

- [ ] **Step 5: Run GREEN tests**

Run:

```bash
/Users/tar/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/local-server.logic.test.mjs tests/substitute-receipt-api.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add forms/local-server.logic.js tests/local-server.logic.test.mjs tests/substitute-receipt-api.test.mjs
git commit -m "Submit substitute receipts without receiving stock"
```

---

### Task 4: Approve And Receive Stock Transitions

**Files:**
- Modify: `forms/local-server.logic.js`
- Modify: `local-server.mjs`
- Test: `tests/local-server.logic.test.mjs`
- Test: `tests/substitute-receipt-api.test.mjs`

**Interfaces:**
- Consumes: Task 1 `assertSubstituteReceiptTransition`, `listStockMovementsByReference`.
- Produces: `approveSubstituteReceipt({ rootDir, receiptNo, approvedBy }): Promise<{ receiptNo, status }>` and `receiveSubstituteReceiptStock({ rootDir, receiptNo, receivedDate, receivedBy }): Promise<{ receiptNo, status, stockMovements }>` plus POST endpoints.

- [ ] **Step 1: Write failing transition tests**

Add to `tests/local-server.logic.test.mjs`:

```js
test("approve and receive substitute receipt stock are separate idempotent transitions", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-substitute-receive-"));
  try {
    const product = createProduct(rootDir, { productCode: "APR", name: "เสื้อ APR", category: "เสื้อ" });
    const stockSku = createStockSku(rootDir, { productId: product.id, sku: "APR-WHITE-M", color: "ขาว", size: "M", defaultUnitCost: "125" });
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

    const received = await receiveSubstituteReceiptStock({ rootDir, receiptNo: submitted.receiptNo, receivedDate: "2026-09-05", receivedBy: "คลัง" });
    assert.equal(received.status, "received");
    assert.equal(received.stockMovements.length, 1);
    assert.equal(getStockCard(rootDir, stockSku.id).balance.quantityOnHand, 4);

    const receivedAgain = await receiveSubstituteReceiptStock({ rootDir, receiptNo: submitted.receiptNo, receivedDate: "2026-09-05", receivedBy: "คลัง" });
    assert.equal(receivedAgain.stockMovements.length, 1);
    assert.equal(getStockCard(rootDir, stockSku.id).movements.length, 1);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});
```

Update imports for `approveSubstituteReceipt` and `receiveSubstituteReceiptStock`.

- [ ] **Step 2: Write failing API transition test**

In `tests/substitute-receipt-api.test.mjs`, after submit:

```js
const approved = await requestJson(baseUrl, `/api/substitute-receipts/${submitted.receiptNo}/approve`, {
  method: "POST",
  body: JSON.stringify({ approvedBy: "บัญชี" }),
});
assert.equal(approved.status, "approved");

const received = await requestJson(baseUrl, `/api/substitute-receipts/${submitted.receiptNo}/receive-stock`, {
  method: "POST",
  body: JSON.stringify({ receivedDate: "2026-09-05", receivedBy: "คลัง" }),
});
assert.equal(received.status, "received");
assert.equal(received.stockMovements.length, 1);
```

- [ ] **Step 3: Run RED tests**

Run:

```bash
/Users/tar/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/local-server.logic.test.mjs tests/substitute-receipt-api.test.mjs
```

Expected: FAIL because transition functions and routes do not exist.

- [ ] **Step 4: Implement state transition functions**

Add submitted receipt finder/loader if not present:

```js
async function getSubmittedSubstituteReceipt(rootDir, receiptNo) {
  const records = await findSubmittedSubstituteReceipts(rootDir);
  const record = records.find((item) => item.receiptNo === receiptNo);
  if (!record) throw new Error("Substitute receipt not found");
  return record;
}

async function writeSubmittedSubstituteReceipt(rootDir, record) {
  await writeFile(
    path.join(rootDir, record.folderPath, "data", "substitute-receipt.json"),
    `${JSON.stringify(record.payload, null, 2)}\n`,
    "utf8",
  );
}
```

`approveSubstituteReceipt` loads the receipt, verifies `pending_approval -> approved`, updates `status`, appends `statusHistory`, writes JSON, regenerates PDFs, and returns the updated record summary.

`receiveSubstituteReceiptStock` loads approved receipt, checks existing movements through `listStockMovementsByReference(rootDir, "substitute_receipt", receiptNo)`, creates missing movements only when none exist, stores `stockReceipt`, updates `status` to `received`, regenerates PDFs, and returns movement metadata.

- [ ] **Step 5: Add HTTP routes**

In `local-server.mjs`, import transition functions and add:

```js
if (request.method === "POST" && url.pathname.startsWith("/api/substitute-receipts/") && url.pathname.endsWith("/approve")) {
  const receiptNo = decodeURIComponent(url.pathname.replace("/api/substitute-receipts/", "").replace("/approve", ""));
  await handleSubstituteReceiptApprove(receiptNo, request, response);
  return;
}

if (request.method === "POST" && url.pathname.startsWith("/api/substitute-receipts/") && url.pathname.endsWith("/receive-stock")) {
  const receiptNo = decodeURIComponent(url.pathname.replace("/api/substitute-receipts/", "").replace("/receive-stock", ""));
  await handleSubstituteReceiptReceiveStock(receiptNo, request, response);
  return;
}
```

- [ ] **Step 6: Run GREEN tests**

Run:

```bash
/Users/tar/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/local-server.logic.test.mjs tests/substitute-receipt-api.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add forms/local-server.logic.js local-server.mjs tests/local-server.logic.test.mjs tests/substitute-receipt-api.test.mjs
git commit -m "Add substitute receipt approve and receive states"
```

---

### Task 5: List And Load Submitted Receipts

**Files:**
- Modify: `forms/local-server.logic.js`
- Modify: `local-server.mjs`
- Create: `forms/substitute-receipts.html`
- Create: `forms/substitute-receipts.logic.browser.js`
- Modify: navigation menus in `forms/*.html`
- Test: `tests/local-server.logic.test.mjs`
- Test: `tests/substitute-receipts.html.test.mjs`
- Test: `tests/navigation.html.test.mjs`

**Interfaces:**
- Consumes: submitted/draft storage from Tasks 2-4.
- Produces: `listSubstituteReceipts(rootDir): Promise<Array<{ id, status, receiptNo, draftId, receiptTitle, payeeName, accountingMonth, totalAmount, pdfFiles, rawFiles, editUrl, nextAction }>>`, `GET /api/substitute-receipts`, and route `/substitute-receipts`.

- [ ] **Step 1: Write failing list logic test**

Add:

```js
test("listSubstituteReceipts combines drafts and submitted state records", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-substitute-list-"));
  try {
    const draft = await saveSubstituteReceiptDraft({ rootDir, payload: validSubstituteReceiptPayload(), uploads: validSlipUpload() });
    const submitted = await saveSubstituteReceiptSubmission({ rootDir, payload: validSubstituteReceiptPayload(), uploads: validSlipUpload() });
    const records = await listSubstituteReceipts(rootDir);
    assert.deepEqual(records.map((record) => record.status).sort(), ["draft", "pending_approval"]);
    assert.equal(records.some((record) => record.draftId === draft.draftId), true);
    assert.equal(records.some((record) => record.receiptNo === submitted.receiptNo), true);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Write failing HTML/navigation tests**

Create `tests/substitute-receipts.html.test.mjs`:

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("substitute receipt list page exposes filters and action columns", async () => {
  const html = await readFile(new URL("../forms/substitute-receipts.html", import.meta.url), "utf8");
  assert.match(html, /<title>รายการใบรับรองแทนใบเสร็จ - หจก\.สวีทเฮาส์<\/title>/);
  assert.match(html, /id="substituteReceiptRows"/);
  assert.match(html, /id="statusFilter"/);
  assert.match(html, /id="searchText"/);
  assert.match(html, /src="\.\/substitute-receipts\.logic\.browser\.js"/);
});
```

Update `tests/navigation.html.test.mjs` to include `href="/substitute-receipts"` and page `substitute-receipts.html`.

- [ ] **Step 3: Run RED tests**

Run:

```bash
/Users/tar/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/local-server.logic.test.mjs tests/substitute-receipts.html.test.mjs tests/navigation.html.test.mjs
```

Expected: FAIL because list APIs and page do not exist.

- [ ] **Step 4: Implement list logic and API**

Scan `drafts/**/substitute-receipts/**/data/draft.json` and `documents/**/ใบรับรองแทนใบเสร็จ/**/data/substitute-receipt.json`. Add inferred status behavior for records without status. Add GET route `/api/substitute-receipts`.

- [ ] **Step 5: Implement list page**

Create a dense operational page with a status filter, text search, table rows, PDF/raw links, and next action labels:

- `pending_approval`: `อนุมัติ`
- `approved`: `รับสินค้าเข้าคลัง`
- `received`: `ดูเอกสาร`
- `draft`: `แก้ไขแบบร่าง`

- [ ] **Step 6: Run GREEN tests**

Run:

```bash
/Users/tar/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/local-server.logic.test.mjs tests/substitute-receipts.html.test.mjs tests/navigation.html.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add forms/local-server.logic.js local-server.mjs forms/substitute-receipts.html forms/substitute-receipts.logic.browser.js forms/*.html tests/local-server.logic.test.mjs tests/substitute-receipts.html.test.mjs tests/navigation.html.test.mjs
git commit -m "Add substitute receipt list"
```

---

### Task 6: State-Aware Form UI

**Files:**
- Modify: `forms/substitute-receipt.html`
- Modify: `forms/substitute-receipt.logic.browser.js`
- Modify: `tests/substitute-receipt.html.test.mjs`

**Interfaces:**
- Consumes: Draft and transition APIs from Tasks 2-5.
- Produces: UI controls `#saveDraft`, `#submitForApproval`, `#approveReceipt`, `#receiveStock`, `#receiptStatus`, and query handling for `draftId` and `receiptNo`.

- [ ] **Step 1: Write failing HTML tests**

Extend `tests/substitute-receipt.html.test.mjs`:

```js
assert.match(html, /id="saveDraft"/);
assert.match(html, /id="submitForApproval"/);
assert.match(html, /id="approveReceipt"/);
assert.match(html, /id="receiveStock"/);
assert.match(html, /id="receiptStatus"/);
assert.match(html, /new URLSearchParams\(location\.search\)\.get\("draftId"\)/);
assert.match(html, /new URLSearchParams\(location\.search\)\.get\("receiptNo"\)/);
```

- [ ] **Step 2: Run RED test**

Run:

```bash
/Users/tar/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/substitute-receipt.html.test.mjs
```

Expected: FAIL because state-aware controls are missing.

- [ ] **Step 3: Update form markup**

Add a status summary row and separate actions:

```html
<dd id="receiptStatus">แบบร่าง</dd>
<button class="button secondary" type="button" id="saveDraft">บันทึกแบบร่าง</button>
<button class="button primary" type="button" id="submitForApproval">ส่งตรวจอนุมัติ</button>
<button class="button primary" type="button" id="approveReceipt">อนุมัติ</button>
<button class="button primary" type="button" id="receiveStock">รับสินค้าเข้าคลัง</button>
```

Keep the old submit button only if tests or UX require it; otherwise use explicit action buttons.

- [ ] **Step 4: Update browser controller**

Implement:

- Load by `draftId` from `/api/substitute-receipt-drafts/:draftId`.
- Load by `receiptNo` from `/api/substitute-receipts/:receiptNo`.
- `saveDraft` posts multipart to `/api/substitute-receipt-drafts`.
- `submitForApproval` posts multipart to `/api/substitute-receipts`.
- `approveReceipt` posts JSON to `/api/substitute-receipts/:receiptNo/approve`.
- `receiveStock` posts JSON to `/api/substitute-receipts/:receiptNo/receive-stock`.
- Disable stock line controls when loaded status is `approved` or `received`.

- [ ] **Step 5: Run GREEN test**

Run:

```bash
/Users/tar/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/substitute-receipt.html.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add forms/substitute-receipt.html forms/substitute-receipt.logic.browser.js tests/substitute-receipt.html.test.mjs
git commit -m "Make substitute receipt form state aware"
```

---

### Task 7: PDF Status Metadata And Checklist Update

**Files:**
- Modify: `scripts/generate_expense_pdfs.py`
- Modify: `docs/feature-checklist.md`
- Test: `tests/local-server.logic.test.mjs`

**Interfaces:**
- Consumes: submitted receipt JSON with `status`, `statusHistory`, and `stockReceipt`.
- Produces: PDFs that show status and stock receipt metadata.

- [ ] **Step 1: Write failing PDF text assertion**

In the approved/received transition test, after receiving stock:

```js
const loaded = await getSubmittedSubstituteReceipt(rootDir, submitted.receiptNo);
const pdfText = await extractPdfText(join(rootDir, loaded.folderPath, "pdf", "01_ใบรับรองแทนใบเสร็จรับเงิน.pdf"));
assert.match(pdfText, /สถานะเอกสาร/);
assert.match(pdfText, /รับเข้าคลังแล้ว/);
assert.match(pdfText, /วันที่รับสินค้า/);
```

- [ ] **Step 2: Run RED test**

Run:

```bash
/Users/tar/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/local-server.logic.test.mjs
```

Expected: FAIL because PDF does not include state metadata.

- [ ] **Step 3: Update PDF generator**

In `build_substitute_receipt_story`, add rows:

- `("สถานะเอกสาร", payload.get("statusLabel") or payload.get("status"))`
- `("วันที่รับสินค้า", payload.get("stockReceipt", {}).get("receivedDate"))`
- `("ผู้รับสินค้า", payload.get("stockReceipt", {}).get("receivedBy"))`

Only show stock receipt rows when `stockReceipt.receivedDate` exists.

- [ ] **Step 4: Update checklist**

In `docs/feature-checklist.md`, add this checked item under `Done`:

```markdown
- [x] Substitute receipt state workflow: draft, pending approval, approved, and received states with separate stock receiving.
  - Next suggested task after completion: Google Drive sync for substitute receipt packets.
```

Set `Current` to:

```markdown
- [ ] Google Drive sync for substitute receipt packets.
  - Next suggested task after completion: monthly stock purchase report.
```

- [ ] **Step 5: Run full verification**

Run:

```bash
./scripts/test.sh
```

Expected: PASS with all tests.

- [ ] **Step 6: Commit**

```bash
git add scripts/generate_expense_pdfs.py docs/feature-checklist.md tests/local-server.logic.test.mjs
git commit -m "Show substitute receipt workflow state in PDFs"
```

---

### Task 8: Manual Smoke Test

**Files:**
- No code changes expected.

**Interfaces:**
- Consumes: complete feature from Tasks 1-7.
- Produces: fresh verification evidence and running local server URL.

- [ ] **Step 1: Run full test suite**

```bash
./scripts/test.sh
```

Expected: PASS.

- [ ] **Step 2: Start server**

If port 8787 is free:

```bash
PORT=8787 /Users/tar/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node local-server.mjs
```

Expected log:

```text
Expense request local web app: http://localhost:8787/
```

- [ ] **Step 3: Smoke the API flow in a temp root**

Create a stock SKU, save a draft, submit it, approve it, receive stock, and confirm stock card quantity changes only after receive.

- [ ] **Step 4: Render one generated audit packet page**

Use `pdftoppm` on the generated audit packet and inspect the rendered PNG to confirm the PDF contains the `SR` number and readable evidence preview when the raw file is a valid image.

- [ ] **Step 5: Report outcome**

Tell the user:

- Feature state flow implemented.
- Tests passed with count.
- Server URL.
- Next recommended task from checklist.
