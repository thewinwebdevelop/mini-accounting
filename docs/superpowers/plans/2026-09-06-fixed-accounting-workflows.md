# Document Group Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an MVP workflow system where templates define an ordered group of standalone document types, starting a workflow creates one transaction ID, and every child document created under that transaction reports completion back to the workflow.

**Architecture:** Keep standalone document flows as the source of truth for forms, approval actions, raw files, PDFs, and native document state. Add a workflow-template/transaction layer that stores document order, creates `TXN-YYYY-MM-0001`, passes that transaction ID into standalone document forms, derives progress from child document `completed` states, and generates a transaction-level review packet.

**Tech Stack:** Local Node HTTP server, static HTML/CSS/vanilla JS, Node built-in test runner, Python ReportLab PDF generation, existing filesystem storage under `documents/`, existing Google Drive/Sheets helpers.

**Spec:** `docs/superpowers/specs/2026-09-06-fixed-accounting-workflows-design.md`

## Global Constraints

- Workflow templates define only ordered document kinds and sync toggles.
- Do not duplicate standalone document forms inside workflow pages.
- Starting a workflow creates transaction numbers in the format `TXN-YYYY-MM-0001`.
- Workflow transaction records are stored under `documents/YYYY/MM/workflow-transactions/TXN-YYYY-MM-0001_<safe-title>/`.
- Every child document created from workflow must store `transactionNo`, `workflowTemplateId`, and `workflowStepId`.
- All standalone document types used in workflow must expose or normalize a `completed` state.
- Workflow next-step unlocking is based on child document completion, not a separate workflow approval state.
- Existing standalone pages must still work without `transactionNo`.
- `goods_receipt` is a lightweight standalone document (route `/workflow-document?documentKind=goods_receipt`, prefix `GR-YYYY-MM-0001`), exactly like `purchase_order` / `payment_voucher` / `cash_spend_declaration` / `payee_acknowledgement`. It is NOT the existing `/inventory-purchase-in` route. Do not modify the inventory purchase-in system (`forms/inventory.logic.js`, `createPurchaseInMovement()`) in any way while implementing this plan — stock movements remain owned exclusively by the existing `receiveSubstituteReceiptStock()` flow, which is unrelated to workflow document completion.
- `substitute_receipt` workflow completion is hybrid, keyed on `receiptType`: native `received` reports workflow `completed` only for `receiptType === "stock_purchase"`; native `approved` reports workflow `completed` only for `receiptType === "general_expense"`. Every other native `approved`, and missing/unknown status, reports workflow `in_progress`. The explicit `completeSubstituteReceipt()` action is available regardless of `receiptType` and always stamps native `status: "completed"`.
- Workflow transaction completion and sync are driven by the template's `syncGoogleDrive`/`syncGoogleSheets` toggles snapshotted onto the transaction: sync runs automatically right after all steps are `completed` when the matching toggle is `true`; when a toggle is `false`, the transaction page exposes a manual sync button for that channel instead. Manual sync must remain callable independent of the toggle value once the transaction is completed.
- Any route that serves a file by name (transaction packet files, workflow-document PDFs/raw files) must resolve the path the same way `getExpenseRequestFile()` does today: resolve against the section directory and reject any resolved path that does not start with `${baseDir}${path.sep}`, so a crafted `fileName` cannot traverse outside the document/transaction folder. `getWorkflowTransactionFile()` (Task 5) and `getWorkflowDocumentFile()` (Task 4) are the concrete implementations of this rule — see those tasks for the allowed `section` values.
- `returnTo` must be treated as untrusted input everywhere it is consumed (expense request, substitute receipt, and lightweight workflow-document pages): before assigning it to a link's `href`, validate it is a same-origin relative path — starts with a single `/`, does not start with `//`, and does not contain `\` — otherwise leave the return link hidden. Use the shared `sanitizeWorkflowReturnTo()` helper (Task 4) rather than re-implementing this check per page.
- Use `scripts/test.sh` for final verification.

---

## File Structure

- Create `forms/workflow.logic.js`
  - Owns document type registry, default template seeds, template validation, transaction payload normalization, transaction progress derivation, child document adapters, file naming, markdown formatting, and sheet entry conversion.
- Create `forms/workflow-templates.html`
  - Lets the user create/edit workflow templates by choosing document kinds in order and toggling Google Drive/Sheets sync.
- Create `forms/workflow-transactions.html`
  - Lets the user choose a template, start a transaction, and list existing transactions.
- Create `forms/workflow-transaction.html`
  - Shows one transaction's checklist/progress and links into standalone document forms.
- Create `forms/workflow.logic.browser.js`
  - Browser controller shared by workflow template/list/detail pages.
- Create `forms/workflow-document.logic.js`
  - Owns lightweight standalone document kinds that do not yet have dedicated pages: purchase order, payment voucher, cash spend declaration, payee acknowledgement, and goods receipt. Never touches `forms/inventory.logic.js` or inventory stock movements.
- Create `forms/workflow-document.html`
  - Generic standalone form for lightweight workflow-compatible documents; it must also work without workflow context.
- Create `forms/workflow-document.logic.browser.js`
  - Browser controller for the generic standalone document shell.
- Create `forms/workflow-return-link.browser.js`
  - Tiny, dependency-free helper exposing `sanitizeWorkflowReturnTo(value)` (validates the value is a same-origin relative path). Loaded via its own `<script>` tag by `forms/expense-request.html`, `forms/substitute-receipt.html`, and `forms/workflow-document.html` before their own inline/controller scripts run, so all three pages validate `returnTo` the same way without each hand-rolling the check or creating a dependency on another page's browser-logic file.
- Create `scripts/generate_workflow_packet_pdf.py`
  - Generates a transaction packet/index PDF that links/summarizes child document PDFs and raw files.
- Create `scripts/generate_workflow_document_pdf.py`
  - Generates PDFs for lightweight standalone documents.
- Modify `forms/local-server.logic.js`
  - Add workflow template storage, workflow transaction storage, sequence generation, child document lookup, progress refresh, packet generation, workflow transaction completion, auto/manual Drive and Sheets sync functions, and exported helpers.
- Modify `local-server.mjs`
  - Add static routes and API handlers for templates, transactions, transaction completion, transaction sync (Drive and Sheets), and packet files.
- Modify `forms/expense-request.logic.js`
  - Preserve workflow relation fields and add `completed` status support.
- Modify `forms/substitute-receipt.logic.js`
  - Preserve workflow relation fields and add/normalize `completed` status support.
- Modify `forms/expense-request.html` and `forms/substitute-receipt.html`
  - Read workflow query params, include them in saved payloads, and show a return link back to the workflow transaction, validated through the shared `sanitizeWorkflowReturnTo()` helper (`forms/workflow-return-link.browser.js`, Task 4) before it is ever assigned to `href`.
- Modify list pages only where useful to show transaction badges.
- Create `tests/workflow.logic.test.mjs`
- Create `tests/workflow-api.test.mjs`
- Create `tests/workflow-pages.html.test.mjs`
- Create `tests/workflow-document.logic.test.mjs`
- Create `tests/workflow-document.html.test.mjs`
- Create `scripts/test_workflow_document_pdf.py`
- Create `scripts/test_workflow_packet_pdf.py`
- Modify `scripts/test.sh` to register each new Python PDF test as it is created (Task 4 adds `test_workflow_document_pdf`, Task 7 adds `test_workflow_packet_pdf` to the same command).

---

### Task 1: Workflow Document Registry And Default Templates

**Files:**
- Create: `forms/workflow.logic.js`
- Test: `tests/workflow.logic.test.mjs`

**Interfaces:**
- Produces: `DOCUMENT_TYPE_DEFINITIONS`
- Produces: `DEFAULT_WORKFLOW_TEMPLATES`
- Produces: `getDocumentTypeDefinition(documentKind)`
- Produces: `getDefaultWorkflowTemplates()`
- Produces: `validateWorkflowTemplate(template)`
- Produces: `normalizeWorkflowTemplate(template, options)`

- [ ] **Step 1: Write failing tests**

```js
import assert from "node:assert/strict";
import test from "node:test";

import workflowLogic from "../forms/workflow.logic.js";

const {
  DOCUMENT_TYPE_DEFINITIONS,
  DEFAULT_WORKFLOW_TEMPLATES,
  validateWorkflowTemplate,
  normalizeWorkflowTemplate,
} = workflowLogic;

test("document type registry exposes MVP standalone document kinds", () => {
  assert.deepEqual(Object.keys(DOCUMENT_TYPE_DEFINITIONS), [
    "purchase_order",
    "substitute_receipt",
    "payment_voucher",
    "goods_receipt",
    "expense_request",
    "cash_spend_declaration",
    "payee_acknowledgement",
  ]);
});

test("default workflow templates contain the six requested use cases", () => {
  assert.deepEqual(DEFAULT_WORKFLOW_TEMPLATES.map((item) => item.templateId), [
    "stock_no_tax_invoice_company_bank",
    "stock_no_tax_invoice_director_transfer",
    "director_expense_transfer",
    "director_expense_cash",
    "outsource_expense_cash",
    "outsource_expense_transfer",
  ]);
});

test("stock company bank template contains the requested document order", () => {
  const template = DEFAULT_WORKFLOW_TEMPLATES.find((item) => item.templateId === "stock_no_tax_invoice_company_bank");
  assert.deepEqual(template.documentSteps.map((step) => step.documentKind), [
    "purchase_order",
    "substitute_receipt",
    "payment_voucher",
    "goods_receipt",
  ]);
});

test("template normalization preserves order and sync toggles", () => {
  const normalized = normalizeWorkflowTemplate({
    templateId: "custom_stock",
    name: "ซื้อสต๊อกแบบ custom",
    syncGoogleDrive: true,
    syncGoogleSheets: false,
    documentSteps: [
      { documentKind: "purchase_order" },
      { documentKind: "payment_voucher" },
    ],
  }, { now: () => "2026-09-06T10:00:00.000Z" });

  assert.equal(normalized.templateId, "custom_stock");
  assert.equal(normalized.syncGoogleDrive, true);
  assert.equal(normalized.syncGoogleSheets, false);
  assert.deepEqual(normalized.documentSteps.map((step) => step.stepId), ["step-001", "step-002"]);
});

test("template validation rejects unsupported document kinds", () => {
  assert.deepEqual(validateWorkflowTemplate({
    name: "bad",
    documentSteps: [{ documentKind: "unknown_doc" }],
  }), ["ระบุรหัส template", "พบประเภทเอกสารที่ยังไม่รองรับ: unknown_doc"]);
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `/Users/tar/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/workflow.logic.test.mjs`

Expected: FAIL because `forms/workflow.logic.js` does not exist.

- [ ] **Step 3: Implement document type registry**

Use this exact registry order:

```js
const DOCUMENT_TYPE_DEFINITIONS = {
  purchase_order: { documentKind: "purchase_order", label: "ใบสั่งซื้อ", route: "/workflow-document?documentKind=purchase_order", standalone: true },
  substitute_receipt: { documentKind: "substitute_receipt", label: "ใบรับรองแทนใบเสร็จรับเงิน", route: "/substitute-receipt", standalone: true },
  payment_voucher: { documentKind: "payment_voucher", label: "ใบสำคัญจ่าย", route: "/workflow-document?documentKind=payment_voucher", standalone: true },
  goods_receipt: { documentKind: "goods_receipt", label: "ใบรับของ/ใบรับสินค้าเข้าคลัง", route: "/workflow-document?documentKind=goods_receipt", standalone: true },
  expense_request: { documentKind: "expense_request", label: "ใบเบิกค่าใช้จ่าย", route: "/expense-request", standalone: true },
  cash_spend_declaration: { documentKind: "cash_spend_declaration", label: "ใบรับรองการจ่ายเงินสดส่วนตัว", route: "/workflow-document?documentKind=cash_spend_declaration", standalone: true },
  payee_acknowledgement: { documentKind: "payee_acknowledgement", label: "ใบสำคัญรับเงิน/ใบรับเงินคืนค่าใช้จ่าย", route: "/workflow-document?documentKind=payee_acknowledgement", standalone: true },
};
```

`goods_receipt` is a lightweight standalone document handled by the same `/workflow-document` shell as `purchase_order` / `payment_voucher` / `cash_spend_declaration` / `payee_acknowledgement` (see Task 4). It is deliberately NOT the existing `/inventory-purchase-in` route: that route produces an inventory stock movement via `createPurchaseInMovement()` (`forms/inventory.logic.js`), which has no `documentNo`, folder, status, PDF, raw files, or `transactionNo`, so it cannot satisfy the Standalone Document Contract or ever reach workflow `completed`. Do not modify `forms/inventory.logic.js` or `createPurchaseInMovement()` anywhere in this plan; inventory stock movements remain owned exclusively by the existing `receiveSubstituteReceiptStock()` flow, which is unrelated to `goods_receipt` workflow documents.

- [ ] **Step 4: Implement default template seeds**

`DEFAULT_WORKFLOW_TEMPLATES` must include the six templates from the spec. Each template should include:

```js
{
  templateId,
  name,
  description,
  syncGoogleDrive: false,
  syncGoogleSheets: false,
  active: true,
  documentSteps: [
    { stepId: "step-001", documentKind: "..." },
  ],
  createdAt,
  updatedAt,
}
```

Use deterministic seed timestamps: `"2026-09-06T00:00:00.000Z"`.

- [ ] **Step 5: Implement template helpers**

`normalizeWorkflowTemplate()` must trim text, set sequential `step-001` IDs, copy sync toggles as booleans, validate document kinds, and keep `createdAt` if provided.

`validateWorkflowTemplate()` must return Thai error strings and reject empty document step lists.

- [ ] **Step 6: Run tests**

Run: `/Users/tar/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/workflow.logic.test.mjs`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add forms/workflow.logic.js tests/workflow.logic.test.mjs
git commit -m "feat: add workflow document templates"
```

---

### Task 2: Workflow Transaction Model And Progress Derivation

**Files:**
- Modify: `forms/workflow.logic.js`
- Modify: `tests/workflow.logic.test.mjs`

**Interfaces:**
- Produces: `buildWorkflowTransactionPayload(data, options)`
- Produces: `createWorkflowStepStates(template)`
- Produces: `normalizeDocumentWorkflowStatus(documentRecord)`
- Produces: `deriveWorkflowProgress(transaction, childDocuments)`
- Produces: `formatWorkflowSummaryMarkdown(transaction, childDocuments)`
- Produces: `buildWorkflowSheetEntry(transaction, childDocuments, driveMetadata, completedAt)`

- [ ] **Step 1: Write failing transaction tests**

```js
test("buildWorkflowTransactionPayload snapshots template and creates TXN folder path", () => {
  const template = DEFAULT_WORKFLOW_TEMPLATES.find((item) => item.templateId === "stock_no_tax_invoice_company_bank");
  const payload = workflowLogic.buildWorkflowTransactionPayload({
    sequence: "7",
    accountingMonth: "2026-09",
    title: "ซื้อสต๊อกล็อตกันยายน",
    template,
  }, { now: () => "2026-09-06T12:00:00.000Z" });

  assert.equal(payload.transactionNo, "TXN-2026-09-0007");
  assert.equal(payload.folderPath, "documents/2026/09/workflow-transactions/TXN-2026-09-0007_ซื้อสต๊อกล็อตกันยายน");
  assert.equal(payload.status, "in_progress");
  assert.equal(payload.templateSnapshot.templateId, "stock_no_tax_invoice_company_bank");
  assert.deepEqual(payload.steps.map((step) => step.workflowStatus), ["not_started", "blocked", "blocked", "blocked"]);
});

test("normalizeDocumentWorkflowStatus maps completed child documents", () => {
  assert.deepEqual(workflowLogic.normalizeDocumentWorkflowStatus({
    documentKind: "expense_request",
    requestNo: "REQ-2026-09-0001",
    transactionNo: "TXN-2026-09-0001",
    status: "completed",
    statusLabel: "เสร็จสิ้น",
    completedAt: "2026-09-06T13:00:00.000Z",
    completedBy: "บัญชี",
  }), {
    documentKind: "expense_request",
    documentNo: "REQ-2026-09-0001",
    transactionNo: "TXN-2026-09-0001",
    nativeStatus: "completed",
    nativeStatusLabel: "เสร็จสิ้น",
    workflowStatus: "completed",
    completedAt: "2026-09-06T13:00:00.000Z",
    completedBy: "บัญชี",
  });
});

test("normalizeDocumentWorkflowStatus reports substitute_receipt completion by receiptType", () => {
  assert.equal(workflowLogic.normalizeDocumentWorkflowStatus({
    documentKind: "substitute_receipt",
    receiptNo: "SR-2026-09-0001",
    transactionNo: "TXN-2026-09-0001",
    receiptType: "stock_purchase",
    status: "received",
    statusLabel: "รับสินค้าแล้ว",
  }).workflowStatus, "completed");

  assert.equal(workflowLogic.normalizeDocumentWorkflowStatus({
    documentKind: "substitute_receipt",
    receiptNo: "SR-2026-09-0002",
    transactionNo: "TXN-2026-09-0001",
    receiptType: "general_expense",
    status: "approved",
    statusLabel: "อนุมัติแล้ว",
  }).workflowStatus, "completed");

  assert.equal(workflowLogic.normalizeDocumentWorkflowStatus({
    documentKind: "substitute_receipt",
    receiptNo: "SR-2026-09-0003",
    transactionNo: "TXN-2026-09-0001",
    receiptType: "stock_purchase",
    status: "approved",
    statusLabel: "อนุมัติแล้ว",
  }).workflowStatus, "in_progress");

  assert.equal(workflowLogic.normalizeDocumentWorkflowStatus({
    documentKind: "substitute_receipt",
    receiptNo: "SR-2026-09-0004",
    transactionNo: "TXN-2026-09-0001",
    receiptType: "general_expense",
    status: "received",
    statusLabel: "รับสินค้าแล้ว",
  }).workflowStatus, "in_progress");
});

test("deriveWorkflowProgress unlocks next document only after current child is completed", () => {
  const template = DEFAULT_WORKFLOW_TEMPLATES.find((item) => item.templateId === "stock_no_tax_invoice_company_bank");
  const transaction = workflowLogic.buildWorkflowTransactionPayload({
    sequence: "1",
    accountingMonth: "2026-09",
    title: "ซื้อสต๊อก",
    template,
  });

  const next = workflowLogic.deriveWorkflowProgress(transaction, [
    {
      documentKind: "purchase_order",
      documentNo: "PO-2026-09-0001",
      workflowStepId: "step-001",
      transactionNo: transaction.transactionNo,
      status: "completed",
      statusLabel: "เสร็จสิ้น",
    },
  ]);

  assert.equal(next.steps[0].workflowStatus, "completed");
  assert.equal(next.steps[1].workflowStatus, "not_started");
  assert.equal(next.steps[2].workflowStatus, "blocked");
  assert.equal(next.currentStepId, "step-002");
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `/Users/tar/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/workflow.logic.test.mjs`

Expected: FAIL because transaction helpers are missing.

- [ ] **Step 3: Implement transaction payload builder**

`buildWorkflowTransactionPayload()` must validate `accountingMonth` as `YYYY-MM`, create `transactionNo`, create the workflow transaction folder path, snapshot the selected template, initialize derived step states, copy sync toggles, and set `status = "in_progress"`.

- [ ] **Step 4: Implement document completion adapter**

`normalizeDocumentWorkflowStatus()` must detect document numbers from `documentNo`, `requestNo`, `receiptNo`, `voucherNo`, `purchaseOrderNo`, or `goodsReceiptNo`.

It must map native status per document kind (substitute_receipt completion is hybrid, keyed on `receiptType`; every other kind, including the lightweight `goods_receipt` document, only reports `completed` on native `completed`):

- `completed` -> workflow `completed` (any `documentKind`)
- `documentKind === "substitute_receipt"` and `receiptType === "stock_purchase"`: native `received` -> workflow `completed`
- `documentKind === "substitute_receipt"` and `receiptType === "general_expense"`: native `approved` -> workflow `completed`
- every other `approved` (including `substitute_receipt` combinations not listed above, `goods_receipt`, and the other lightweight document kinds) -> workflow `in_progress`
- missing/unknown status -> workflow `in_progress`

This is the auto-completion signal only. `completeSubstituteReceipt()` (Task 3) and `completeWorkflowDocument()` (Task 4) remain available regardless of `receiptType` as an explicit override that always stamps native `status: "completed"`, which then satisfies the plain `completed -> completed` rule above.

- [ ] **Step 5: Implement progress derivation**

`deriveWorkflowProgress(transaction, childDocuments)` must normalize all child documents, match them by `workflowStepId` first and by `documentKind` second, unlock only the first incomplete step, and mark the transaction `completed` when every step is completed.

- [ ] **Step 6: Implement markdown and sheet entry**

`formatWorkflowSummaryMarkdown()` must output Thai tables for template, steps, child documents, PDF files, and raw files.

`buildWorkflowSheetEntry()` must return the same row shape used by `recordMonthlyExpense()` with `sourceKey: workflow_transaction:${transaction.transactionNo}` and `documentType: "Workflow ธุรกรรมเอกสาร"`.

- [ ] **Step 7: Run tests**

Run: `/Users/tar/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/workflow.logic.test.mjs`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add forms/workflow.logic.js tests/workflow.logic.test.mjs
git commit -m "feat: derive workflow transaction progress"
```

---

### Task 3: Add Completed State And Workflow Relation To Existing Documents

**Files:**
- Modify: `forms/expense-request.logic.js`
- Modify: `forms/substitute-receipt.logic.js`
- Modify: `forms/local-server.logic.js`
- Modify: `tests/expense-request.logic.test.mjs`
- Modify: `tests/substitute-receipt.logic.test.mjs`
- Modify: `tests/local-server.logic.test.mjs`

**Interfaces:**
- Produces on expense payload: `transactionNo`, `workflowTemplateId`, `workflowStepId`, `completedAt`, `completedBy`
- Produces on substitute receipt payload: `transactionNo`, `workflowTemplateId`, `workflowStepId`, `completedAt`, `completedBy`
- Produces: `completeExpenseRequest({ rootDir, requestNo, completedBy, now })`
- Produces: `completeSubstituteReceipt({ rootDir, receiptNo, completedBy, now })`

- [ ] **Step 1: Write failing expense relation tests**

```js
test("buildExpensePayload preserves workflow relation fields and completed status", () => {
  const payload = buildExpensePayload({
    sequence: "1",
    accountingMonth: "2026-09",
    requestType: "reimbursement",
    requesterName: "คุณต้า",
    businessPurpose: "เบิกค่าใช้จ่าย",
    paymentTargetName: "คุณต้า",
    transactionNo: "TXN-2026-09-0001",
    workflowTemplateId: "director_expense_transfer",
    workflowStepId: "step-001",
    status: "completed",
    completedAt: "2026-09-06T14:00:00.000Z",
    completedBy: "บัญชี",
    expenseLines: [{ description: "ค่าส่ง", amountBeforeVat: "100", vatAmount: "0", withholdingTax: "0" }],
  });

  assert.equal(payload.transactionNo, "TXN-2026-09-0001");
  assert.equal(payload.workflowTemplateId, "director_expense_transfer");
  assert.equal(payload.workflowStepId, "step-001");
  assert.equal(payload.status, "completed");
  assert.equal(payload.completedBy, "บัญชี");
});
```

- [ ] **Step 2: Write failing substitute relation tests**

```js
test("buildSubstituteReceiptPayload preserves workflow relation fields and completed status", () => {
  const payload = buildSubstituteReceiptPayload({
    sequence: "1",
    accountingMonth: "2026-09",
    receiptDate: "2026-09-06",
    receiptType: "general_expense",
    payeeName: "ร้านค้า",
    businessPurpose: "ค่าใช้จ่ายบริษัท",
    transactionNo: "TXN-2026-09-0001",
    workflowTemplateId: "director_expense_transfer",
    workflowStepId: "step-002",
    status: "completed",
    completedAt: "2026-09-06T14:00:00.000Z",
    completedBy: "บัญชี",
    lines: [{ description: "ค่าอุปกรณ์", quantity: "1", unitCost: "100" }],
  });

  assert.equal(payload.transactionNo, "TXN-2026-09-0001");
  assert.equal(payload.workflowStepId, "step-002");
  assert.equal(payload.status, "completed");
});
```

- [ ] **Step 3: Write failing server completion tests**

```js
test("completeExpenseRequest transitions approved request to completed", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-expense-"));
  try {
    const saved = await saveExpenseSubmission({ rootDir, payload: validExpensePayload() });
    await approveExpenseRequest({
      rootDir,
      requestNo: saved.requestNo,
      approvedBy: "เจ้าของ",
      expenseRecorder: async () => ({ syncStatus: "not_required" }),
    });
    const completed = await completeExpenseRequest({
      rootDir,
      requestNo: saved.requestNo,
      completedBy: "บัญชี",
      now: () => "2026-09-06T15:00:00.000Z",
    });
    assert.equal(completed.status, "completed");
    assert.equal(completed.completedBy, "บัญชี");
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 4: Run targeted tests to verify failure**

Run: `/Users/tar/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/expense-request.logic.test.mjs tests/substitute-receipt.logic.test.mjs tests/local-server.logic.test.mjs`

Expected: FAIL because workflow fields/completion helpers are missing.

- [ ] **Step 5: Extend status labels and transitions**

Add `completed: "เสร็จสิ้น"` to expense and substitute receipt status labels. Update validation/transition helpers so existing documents can move into `completed` without breaking current `approved` or `received` behavior.

- [ ] **Step 6: Preserve relation fields in payload builders**

Add these fields to both `buildExpensePayload()` and `buildSubstituteReceiptPayload()` return objects:

```js
transactionNo: String(data.transactionNo ?? "").trim(),
workflowTemplateId: String(data.workflowTemplateId ?? "").trim(),
workflowStepId: String(data.workflowStepId ?? "").trim(),
completedAt: String(data.completedAt ?? "").trim(),
completedBy: String(data.completedBy ?? "").trim(),
```

- [ ] **Step 7: Implement completion helpers**

Add `completeExpenseRequest()` and `completeSubstituteReceipt()` in `forms/local-server.logic.js`. Each helper must load the submitted document, require a valid pre-completion state, append status history, set `completedAt` and `completedBy`, regenerate PDFs/markdown, and return a compact updated payload summary.

- [ ] **Step 8: Export completion helpers**

Add both helpers to `module.exports`.

- [ ] **Step 9: Run targeted tests**

Run: `/Users/tar/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/expense-request.logic.test.mjs tests/substitute-receipt.logic.test.mjs tests/local-server.logic.test.mjs`

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add forms/expense-request.logic.js forms/substitute-receipt.logic.js forms/local-server.logic.js tests/expense-request.logic.test.mjs tests/substitute-receipt.logic.test.mjs tests/local-server.logic.test.mjs
git commit -m "feat: mark standalone documents completed for workflows"
```

---

### Task 4: Lightweight Standalone Document Shell

**Files:**
- Create: `forms/workflow-document.logic.js`
- Create: `forms/workflow-document.html`
- Create: `forms/workflow-document.logic.browser.js`
- Create: `forms/workflow-return-link.browser.js`
- Create: `scripts/generate_workflow_document_pdf.py`
- Create: `tests/workflow-document.logic.test.mjs`
- Create: `tests/workflow-document.html.test.mjs`
- Create: `scripts/test_workflow_document_pdf.py`
- Modify: `forms/local-server.logic.js`
- Modify: `local-server.mjs`
- Modify: `scripts/test.sh`

**Interfaces:**
- Produces: `LIGHTWEIGHT_DOCUMENT_KINDS`
- Produces: `buildWorkflowDocumentPayload(data, options)`
- Produces: `validateWorkflowDocumentPayload(data)`
- Produces: `buildWorkflowDocumentRawFileName(evidenceKey, originalName, index)`
- Produces: `completeWorkflowDocument({ rootDir, documentKind, documentNo, completedBy, now })`
- Produces: `listWorkflowDocuments(rootDir, filters)`
- Produces: `getWorkflowDocument(rootDir, documentKind, documentNo)`
- Produces: `saveWorkflowDocument({ rootDir, payload, uploads })`
- Produces: `getWorkflowDocumentFile({ rootDir, documentKind, documentNo, section, fileName })`
- Produces: `sanitizeWorkflowReturnTo(value)` (browser helper, `forms/workflow-return-link.browser.js`)

- [ ] **Step 1: Write failing logic tests**

```js
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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
```

- [ ] **Step 2: Run logic tests to verify failure**

Run: `/Users/tar/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/workflow-document.logic.test.mjs`

Expected: FAIL because `forms/workflow-document.logic.js` does not exist yet, and (once it exists) because `getWorkflowDocumentFile` is not yet exported from `forms/local-server.logic.js`.

- [ ] **Step 3: Implement lightweight document logic**

Create prefixes:

```js
const DOCUMENT_PREFIXES = {
  purchase_order: "PO",
  payment_voucher: "PV",
  cash_spend_declaration: "CSD",
  payee_acknowledgement: "PAR",
  goods_receipt: "GR",
};
```

`LIGHTWEIGHT_DOCUMENT_KINDS` must list all five kinds in this order: `purchase_order`, `payment_voucher`, `cash_spend_declaration`, `payee_acknowledgement`, `goods_receipt`. `goods_receipt` documents created here are unrelated to inventory stock movements — do not call into `forms/inventory.logic.js` from this file.

Status labels:

```js
const WORKFLOW_DOCUMENT_STATUS_LABELS = {
  draft: "แบบร่าง",
  pending_approval: "รอตรวจอนุมัติ",
  approved: "อนุมัติแล้ว",
  completed: "เสร็จสิ้น",
  cancelled: "ยกเลิก",
};
```

`buildWorkflowDocumentPayload()` must preserve `transactionNo`, `workflowTemplateId`, and `workflowStepId`. It must calculate line totals from `quantity * unitCost`, store `evidenceFiles`, and keep `rawFiles`.

- [ ] **Step 4: Write failing PDF test**

```python
import os
import tempfile
import unittest
from pathlib import Path

from generate_workflow_document_pdf import build_document_pdf

class WorkflowDocumentPdfTests(unittest.TestCase):
    def test_build_document_pdf_creates_payment_voucher_pdf(self):
        payload = {
            "documentKind": "payment_voucher",
            "documentNo": "PV-2026-09-0001",
            "title": "คืนเงินกรรมการ",
            "documentDate": "2026-09-06",
            "businessPurpose": "คืนเงินสำรองจ่าย",
            "requesterName": "คุณต้า",
            "payeeName": "กรรมการ",
            "lines": [{"description": "ค่าส่งเข้าคลัง", "quantity": 1, "unitCost": "120.00", "lineTotal": "120.00"}],
            "totals": {"grossAmount": "120.00"},
        }
        with tempfile.TemporaryDirectory() as tmp:
            output_path = Path(tmp) / "document.pdf"
            build_document_pdf(payload, str(output_path))
            self.assertTrue(output_path.exists())
            self.assertGreater(os.path.getsize(output_path), 0)
```

- [ ] **Step 5: Implement PDF generator**

Use `pdf_common.py`. Generate one simple A4 landscape PDF with:

- document title from kind label
- document number/date
- transaction number if present
- requester/payee
- business purpose
- line table
- total
- signature boxes

- [ ] **Step 6: Implement server storage and routes**

In `forms/local-server.logic.js`, store lightweight docs under:

`documents/YYYY/MM/<documentKind>/<documentNo>_<safe-title>/`

Write:

- `data/workflow-document.json`
- `working-md/workflow-document.md`
- `pdf/01_<documentKind>.pdf`
- uploaded raw files in `raw/`

In `local-server.mjs`, add:

- static route `/workflow-document`
- `GET /api/workflow-documents`
- `POST /api/workflow-documents`
- `GET /api/workflow-documents/:documentKind/:documentNo`
- `POST /api/workflow-documents/:documentKind/:documentNo/complete`
- file route for PDF/raw (implemented in Step 7 below)

- [ ] **Step 7: Implement `getWorkflowDocumentFile()` and wire the file route**

This is the file-serving guard for lightweight workflow documents, mirrored verbatim in shape from `getExpenseRequestFile()` (`forms/local-server.logic.js:1500-1522`), added to `forms/local-server.logic.js`:

```js
async function getWorkflowDocumentFile({ rootDir, documentKind, documentNo, section, fileName }) {
  if (!documentNo) throw new Error("Missing document number");
  if (!["pdf", "raw"].includes(section)) throw new Error("Invalid file section");
  if (!fileName || fileName.includes("/") || fileName.includes("\\") || fileName === "." || fileName === "..") {
    throw new Error("Invalid file name");
  }

  const record = await getWorkflowDocument(rootDir, documentKind, documentNo);
  if (!record) throw new Error("Workflow document not found");

  const baseDir = path.resolve(rootDir, record.folderPath, section);
  const absolutePath = path.resolve(baseDir, fileName);
  if (!absolutePath.startsWith(`${baseDir}${path.sep}`)) {
    throw new Error("Invalid file name");
  }

  return { absolutePath, fileName, section };
}
```

Only `pdf` and `raw` are allowed `section` values — the same two sections `getExpenseRequestFile()` allows — because those are the only lightweight-document subfolders meant to be downloaded by filename (the generated PDF and uploaded evidence files). `data/workflow-document.json` and `working-md/workflow-document.md` are internal/derived state read through `getWorkflowDocument()`, never served as raw files by name — same rationale as `getWorkflowTransactionFile()` in Task 5.

In `local-server.mjs`, add `GET /workflow-documents/:documentKind/:documentNo/:section/:fileName` (matching the existing expense-request/substitute-receipt file-route path shape) that calls `getWorkflowDocumentFile()` and streams `absolutePath`, returning 404 on any thrown error.

- [ ] **Step 8: Create the shared `returnTo` validation helper**

Create `forms/workflow-return-link.browser.js` as a plain classic script (no module wrapper, matching `forms/workflow.logic.browser.js`'s style) so `sanitizeWorkflowReturnTo` is globally available to any page that loads it with a `<script>` tag:

```js
function sanitizeWorkflowReturnTo(value) {
  if (typeof value !== "string" || value === "") return "";
  if (!value.startsWith("/")) return "";
  if (value.startsWith("//")) return "";
  if (value.includes("\\")) return "";
  return value;
}
```

This is the single implementation used by `forms/workflow-document.html` (this task), `forms/expense-request.html`, and `forms/substitute-receipt.html` (Task 6) — none of those pages re-implement the check. It has no dependency on any other browser-logic file, so loading it from expense-request/substitute-receipt does not pull in `workflow-document.logic.browser.js` or vice versa.

- [ ] **Step 9: Create generic standalone HTML page**

The page must include:

- hidden `documentKind`, `transactionNo`, `workflowTemplateId`, `workflowStepId`
- document date, title, requester, payee, purpose
- line items
- evidence uploads
- save button
- complete button
- a `<script src="./workflow-return-link.browser.js"></script>` tag, loaded before this page's own inline/controller script
- return-to-workflow link, shown only when `sanitizeWorkflowReturnTo(returnTo)` returns a non-empty value; assign that sanitized value (never the raw query param) to the link's `href`, and keep the link hidden otherwise

Add matching assertions to `tests/workflow-document.html.test.mjs`:

```js
test("workflow document shell validates returnTo before showing the return link", async () => {
  const html = await readFile(new URL("../forms/workflow-document.html", import.meta.url), "utf8");
  assert.match(html, /workflow-return-link\.browser\.js/);
  assert.match(html, /sanitizeWorkflowReturnTo/);
});
```

- [ ] **Step 10: Add this task's test to `scripts/test.sh`**

`test_workflow_packet_pdf` is not created until Task 7 — only register the Python test this task actually creates, so `./scripts/test.sh` keeps passing for Tasks 4 through 6:

```bash
(cd "$SCRIPT_DIR" && "$PYTHON_BIN" -m unittest test_substitute_receipt_pdf test_workflow_document_pdf -v)
```

- [ ] **Step 11: Run targeted tests**

Run:

```bash
/Users/tar/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/workflow-document.logic.test.mjs tests/workflow-document.html.test.mjs
PYTHONPATH=scripts /Users/tar/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 -m unittest test_workflow_document_pdf -v
```

Expected: PASS.

- [ ] **Step 12: Commit**

```bash
git add forms/workflow-document.logic.js forms/workflow-document.html forms/workflow-document.logic.browser.js forms/workflow-return-link.browser.js scripts/generate_workflow_document_pdf.py scripts/test_workflow_document_pdf.py tests/workflow-document.logic.test.mjs tests/workflow-document.html.test.mjs forms/local-server.logic.js local-server.mjs scripts/test.sh
git commit -m "feat: add lightweight standalone workflow documents"
```

---

### Task 5: Workflow Template And Transaction Storage APIs

**Files:**
- Modify: `forms/local-server.logic.js`
- Test: `tests/workflow-api.test.mjs`

**Interfaces:**
- Produces: `listWorkflowDocumentTypes()`
- Produces: `listWorkflowTemplates(rootDir)`
- Produces: `saveWorkflowTemplate({ rootDir, template })`
- Produces: `getWorkflowTemplate(rootDir, templateId)`
- Produces: `getNextWorkflowTransactionInfo(rootDir, accountingMonth)`
- Produces: `startWorkflowTransaction({ rootDir, templateId, accountingMonth, title })`
- Produces: `listWorkflowTransactions(rootDir)`
- Produces: `getWorkflowTransaction(rootDir, transactionNo)`
- Produces: `refreshWorkflowTransaction({ rootDir, transactionNo })`
- Produces: `getWorkflowTransactionFile({ rootDir, transactionNo, section, fileName })`

- [ ] **Step 1: Write failing workflow API tests**

```js
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import serverLogic from "../forms/local-server.logic.js";

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
```

- [ ] **Step 2: Run tests to verify failure**

Run: `/Users/tar/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/workflow-api.test.mjs`

Expected: FAIL because server workflow APIs are missing.

- [ ] **Step 3: Add workflow imports**

In `forms/local-server.logic.js`, import:

```js
const {
  DOCUMENT_TYPE_DEFINITIONS,
  buildWorkflowTransactionPayload,
  deriveWorkflowProgress,
  formatWorkflowSummaryMarkdown,
  getDefaultWorkflowTemplates,
  normalizeWorkflowTemplate,
  validateWorkflowTemplate,
} = require("./workflow.logic.js");
```

- [ ] **Step 4: Implement template storage**

Store templates at `data/workflow-templates.json`. `listWorkflowTemplates(rootDir)` returns `getDefaultWorkflowTemplates()` when absent. `saveWorkflowTemplate()` creates `data/`, merges by `templateId`, and writes the whole JSON array.

- [ ] **Step 5: Implement transaction storage**

Use `documents/YYYY/MM/workflow-transactions` and prefix `TXN-${year}-${month}-`. Write `data/workflow-transaction.json` and `working-md/workflow-summary.md`.

- [ ] **Step 6: Implement child document lookup**

Create `findWorkflowChildDocuments(rootDir, transactionNo)`. For MVP, scan:

- expense requests from `findSubmittedExpenseRequests(rootDir)`
- substitute receipts from `findSubmittedSubstituteReceipts(rootDir)`
- lightweight documents (`purchase_order`, `payment_voucher`, `cash_spend_declaration`, `payee_acknowledgement`, `goods_receipt`) from `findLightweightWorkflowDocuments(rootDir, transactionNo)`

Filter records where `payload.transactionNo === transactionNo`.

`findLightweightWorkflowDocuments()` must be a real implementation, not a stub returning `[]` — every one of the six default templates contains at least one lightweight document, so a stub would make every template unable to advance past its lightweight steps. It must scan the lightweight document storage created in Task 4 (`listWorkflowDocuments(rootDir, { transactionNo })` from `forms/workflow-document.logic.js`, or an equivalent directory scan under `documents/YYYY/MM/<documentKind>/`), filter to the given `transactionNo`, and return one record per lightweight document carrying at least: `documentKind`, `documentNo`, `status`, `statusLabel`, `folderPath`, `pdfFiles`, `rawFiles`, `workflowStepId`, `completedAt`, `completedBy`.

Expense-request and substitute-receipt records loaded from `findSubmittedExpenseRequests()` / `findSubmittedSubstituteReceipts()` do not store a `documentKind` field on their payload — the child-document lookup must inject the correct `documentKind` (`"expense_request"` / `"substitute_receipt"`) onto each record before handing it to `normalizeDocumentWorkflowStatus()`, otherwise the hybrid `substitute_receipt` completion rule and the generic status mapping cannot dispatch correctly.

- [ ] **Step 7: Implement refresh**

`refreshWorkflowTransaction()` loads the transaction, loads child documents, calls `deriveWorkflowProgress()`, rewrites JSON/markdown, regenerates packet PDF after Task 7, and returns the updated transaction.

- [ ] **Step 8: Implement `getWorkflowTransactionFile()`**

Mirror `getExpenseRequestFile()` (`forms/local-server.logic.js:1500-1522`) verbatim in shape:

```js
async function getWorkflowTransactionFile({ rootDir, transactionNo, section, fileName }) {
  if (!transactionNo) throw new Error("Missing transaction number");
  if (!["pdf"].includes(section)) throw new Error("Invalid file section");
  if (!fileName || fileName.includes("/") || fileName.includes("\\") || fileName === "." || fileName === "..") {
    throw new Error("Invalid file name");
  }

  const transaction = await getWorkflowTransaction(rootDir, transactionNo);
  if (!transaction) throw new Error("Workflow transaction not found");

  const baseDir = path.resolve(rootDir, transaction.folderPath, section);
  const absolutePath = path.resolve(baseDir, fileName);
  if (!absolutePath.startsWith(`${baseDir}${path.sep}`)) {
    throw new Error("Invalid file name");
  }

  return { absolutePath, fileName, section };
}
```

Only `pdf` is an allowed `section` for a transaction folder. The transaction directory (Global Constraints, `documents/YYYY/MM/workflow-transactions/TXN-.../`) has three subfolders: `data/` (raw `workflow-transaction.json`, read through `getWorkflowTransaction()`/the JSON API), `working-md/` (the human-readable `workflow-summary.md` source, same rationale), and `pdf/` (the packet PDF generated in Task 7 — the only artifact meant to be downloaded by filename through this route). Do not add `data` or `working-md` to the allowed set: unlike `raw/` on expense-request, substitute-receipt, or lightweight-document folders, nothing in `data/`/`working-md/` is an uploaded or generated artifact meant for direct download — it is server-authored JSON/markdown already reachable through its own read path, so serving it by arbitrary filename would only add attack surface with no benefit.

- [ ] **Step 9: Export workflow functions**

Add all functions listed in this task's interface to `module.exports`.

- [ ] **Step 10: Run tests**

Run: `/Users/tar/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/workflow-api.test.mjs`

Expected: PASS, except packet-related assertions should wait until Task 7.

- [ ] **Step 11: Commit**

```bash
git add forms/local-server.logic.js tests/workflow-api.test.mjs
git commit -m "feat: store workflow templates and transactions"
```

---

### Task 6: Pass Workflow Context Into Existing Standalone Forms

**Files:**
- Modify: `forms/expense-request.html`
- Modify: `forms/substitute-receipt.html`
- Modify: related inline browser scripts in those files
- Modify: `tests/expense-request.html.test.mjs`
- Modify: `tests/substitute-receipt.html.test.mjs`
- Consume (already created in Task 4, not modified here): `forms/workflow-return-link.browser.js`

**Interfaces:**
- Consumes query params: `transactionNo`, `workflowTemplateId`, `workflowStepId`, `returnTo`
- Consumes: `sanitizeWorkflowReturnTo(value)` from `forms/workflow-return-link.browser.js` (Task 4)
- Produces saved payload fields with the same names.

- [ ] **Step 1: Write failing HTML tests**

```js
test("expense request form preserves workflow context query params", async () => {
  const html = await readFile(new URL("../forms/expense-request.html", import.meta.url), "utf8");
  assert.match(html, /transactionNo/);
  assert.match(html, /workflowTemplateId/);
  assert.match(html, /workflowStepId/);
  assert.match(html, /returnTo/);
  assert.match(html, /กลับไปที่ Workflow/);
  assert.match(html, /workflow-return-link\.browser\.js/);
  assert.match(html, /sanitizeWorkflowReturnTo/);
});

test("substitute receipt form preserves workflow context query params", async () => {
  const html = await readFile(new URL("../forms/substitute-receipt.html", import.meta.url), "utf8");
  assert.match(html, /transactionNo/);
  assert.match(html, /workflowTemplateId/);
  assert.match(html, /workflowStepId/);
  assert.match(html, /returnTo/);
  assert.match(html, /กลับไปที่ Workflow/);
  assert.match(html, /workflow-return-link\.browser\.js/);
  assert.match(html, /sanitizeWorkflowReturnTo/);
});
```

- [ ] **Step 2: Run targeted HTML tests to verify failure**

Run: `/Users/tar/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/expense-request.html.test.mjs tests/substitute-receipt.html.test.mjs`

Expected: FAIL until workflow context fields are added.

- [ ] **Step 3: Add hidden fields and return link**

Add hidden inputs to each form:

```html
<input type="hidden" name="transactionNo" id="transactionNo">
<input type="hidden" name="workflowTemplateId" id="workflowTemplateId">
<input type="hidden" name="workflowStepId" id="workflowStepId">
```

Add a return link near top actions:

```html
<a class="button secondary" id="workflowReturnLink" href="/workflow-transactions" hidden>กลับไปที่ Workflow</a>
```

Add `<script src="./workflow-return-link.browser.js"></script>` before this page's own inline script / `<page-name>.logic.browser.js` tag, so `sanitizeWorkflowReturnTo()` is available globally when the boot script runs.

- [ ] **Step 4: Read query params in browser scripts**

In each page's script, add:

```js
const workflowContext = {
  transactionNo: params.get("transactionNo") || "",
  workflowTemplateId: params.get("workflowTemplateId") || "",
  workflowStepId: params.get("workflowStepId") || "",
  returnTo: params.get("returnTo") || "",
};
```

Set hidden input values during boot. When collecting payload, include the three workflow fields.

- [ ] **Step 5: Show return link after save/approve/complete**

`returnTo` is attacker-controllable query-string input (a hand-crafted link such as `/expense-request?returnTo=https://evil.example` would otherwise leave the user a return button that navigates off-site right after they save/approve a real accounting document). Never assign it to `href` directly. Instead:

```js
const safeReturnTo = window.sanitizeWorkflowReturnTo(workflowContext.returnTo);
if (safeReturnTo) {
  workflowReturnLink.href = safeReturnTo;
  workflowReturnLink.hidden = false;
}
```

`sanitizeWorkflowReturnTo()` (from `forms/workflow-return-link.browser.js`, loaded in Step 3) returns the value unchanged only if it starts with a single `/`, does not start with `//`, and does not contain `\`; otherwise it returns `""`. Keep the link hidden for standalone use and whenever validation fails.

- [ ] **Step 6: Run tests**

Run: `/Users/tar/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/expense-request.html.test.mjs tests/substitute-receipt.html.test.mjs tests/expense-request.logic.test.mjs tests/substitute-receipt.logic.test.mjs`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add forms/expense-request.html forms/substitute-receipt.html tests/expense-request.html.test.mjs tests/substitute-receipt.html.test.mjs
git commit -m "feat: pass workflow context into document forms"
```

---

### Task 7: Workflow Packet PDF And Aggregated Files

**Files:**
- Create: `scripts/generate_workflow_packet_pdf.py`
- Create: `scripts/test_workflow_packet_pdf.py`
- Modify: `scripts/test.sh`
- Modify: `forms/local-server.logic.js`
- Test: `tests/workflow-api.test.mjs`

**Interfaces:**
- Produces CLI: `scripts/generate_workflow_packet_pdf.py --payload <json> --output <pdf>`
- Produces: `generateWorkflowPacketPdf({ transaction, childDocuments, outputPath })` server helper

- [ ] **Step 1: Write failing Python tests**

```python
import os
import tempfile
import unittest
from pathlib import Path

from generate_workflow_packet_pdf import build_packet_pdf


class WorkflowPacketPdfTests(unittest.TestCase):
    def test_build_packet_pdf_creates_summary_pdf(self):
        transaction = {
            "transactionNo": "TXN-2026-09-0001",
            "title": "ซื้อสต๊อกล็อตกันยายน",
            "templateSnapshot": {"name": "ซื้อสต๊อกสินค้าแบบไม่มีใบกำกับภาษี"},
            "status": "completed",
            "steps": [
                {"stepId": "step-001", "documentKind": "purchase_order", "label": "ใบสั่งซื้อ", "workflowStatus": "completed"},
                {"stepId": "step-002", "documentKind": "substitute_receipt", "label": "ใบรับรองแทนใบเสร็จรับเงิน", "workflowStatus": "completed"},
            ],
        }
        child_documents = [
            {"documentKind": "purchase_order", "documentNo": "PO-2026-09-0001", "pdfFiles": [{"name": "po.pdf"}], "rawFiles": []},
            {"documentKind": "substitute_receipt", "documentNo": "SR-2026-09-0001", "pdfFiles": [{"name": "sr.pdf"}], "rawFiles": [{"name": "slip.jpg"}]},
        ]
        with tempfile.TemporaryDirectory() as tmp:
            output_path = Path(tmp) / "workflow-packet.pdf"
            build_packet_pdf(transaction, child_documents, str(output_path))
            self.assertTrue(output_path.exists())
            self.assertGreater(os.path.getsize(output_path), 0)
```

- [ ] **Step 2: Run Python test to verify failure**

Run: `PYTHONPATH=scripts /Users/tar/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 -m unittest test_workflow_packet_pdf -v`

Expected: FAIL because generator does not exist.

- [ ] **Step 3: Implement packet PDF**

Use `pdf_common.py` helpers. The PDF must include transaction number, title, template name, status, step table, child document table, PDF file table, and raw file table.

Output filename:

`pdf/99_ชุดรวมเอกสาร_workflow-transaction.pdf`

- [ ] **Step 4: Add this task's test to `scripts/test.sh`**

Append `test_workflow_packet_pdf` to the same command Task 4 registered — do not drop `test_workflow_document_pdf`:

```bash
(cd "$SCRIPT_DIR" && "$PYTHON_BIN" -m unittest test_substitute_receipt_pdf test_workflow_document_pdf test_workflow_packet_pdf -v)
```

- [ ] **Step 5: Add server packet generation**

In `forms/local-server.logic.js`, after `refreshWorkflowTransaction()` derives progress, write a packet payload JSON into the transaction data folder with `{ transaction, childDocuments }`, run the Python script, and store the output in the transaction `pdf/` folder.

- [ ] **Step 6: Add API test**

```js
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
```

- [ ] **Step 7: Run tests**

Run: `./scripts/test.sh`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add scripts/generate_workflow_packet_pdf.py scripts/test_workflow_packet_pdf.py scripts/test.sh forms/local-server.logic.js tests/workflow-api.test.mjs
git commit -m "feat: generate workflow transaction packets"
```

---

### Task 8: Workflow Completion And Sync

**Files:**
- Modify: `forms/local-server.logic.js`
- Test: `tests/workflow-api.test.mjs`

**Interfaces:**
- Produces: `completeWorkflowTransaction({ rootDir, transactionNo, completedBy, now, driveUploader, sheetsRecorder })`
- Produces: `syncWorkflowTransactionToDrive({ rootDir, transactionNo, driveUploader, now })`
- Produces: `syncWorkflowTransactionToSheets({ rootDir, transactionNo, sheetsRecorder, now })`

No task before this one calls `buildWorkflowSheetEntry()` (Task 2) or wires transaction-level Drive/Sheets sync, even though the spec requires `POST /.../complete`, `POST /.../sync-drive`, and "one Sheets summary row per completed transaction." This task closes that gap. Follow the existing standalone-document pattern before writing code: read `approveExpenseRequest()`, `syncExpenseRequestToDrive()`, and `recordExpenseSheetMetadata()` in `forms/local-server.logic.js` (around lines 538, 1373, and 1524) — they show the established shape for injecting a stubbable uploader/recorder with a default (`driveUploader = uploadFolderToGoogleDrive`, `expenseRecorder = recordMonthlyExpense`), writing `{ syncStatus, ... }` metadata back onto the record, and turning a sync failure into a `sync_failed` status instead of throwing.

- [ ] **Step 1: Write failing tests**

```js
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
      syncGoogleSheets: false,
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
  const doc = await serverLogic.saveWorkflowDocument({
    rootDir,
    payload: {
      documentKind: "payment_voucher",
      sequence: "1",
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
    },
  });
  await serverLogic.completeWorkflowDocument({
    rootDir,
    documentKind: "payment_voucher",
    documentNo: doc.documentNo,
    completedBy: "บัญชี",
  });
  await serverLogic.refreshWorkflowTransaction({ rootDir, transactionNo: txn.transactionNo });
  return txn;
}

test("completeWorkflowTransaction succeeds and auto-syncs when template toggles are on", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-workflow-"));
  try {
    const txn = await completeSingleStepTransaction(rootDir, { syncGoogleDrive: true, syncGoogleSheets: true });
    let driveCalls = 0;
    let sheetCalls = 0;
    const completed = await serverLogic.completeWorkflowTransaction({
      rootDir,
      transactionNo: txn.transactionNo,
      completedBy: "บัญชี",
      driveUploader: async () => { driveCalls += 1; return { driveFolderId: "f1", driveFolderUrl: "https://drive/f1", drivePath: "p", uploadedFileCount: 1 }; },
      sheetsRecorder: async () => { sheetCalls += 1; return { syncStatus: "synced" }; },
    });

    assert.equal(completed.status, "completed");
    assert.equal(completed.completedBy, "บัญชี");
    assert.equal(driveCalls, 1);
    assert.equal(sheetCalls, 1);
    assert.equal(completed.driveSync.syncStatus, "synced");
    assert.equal(completed.sheetSync.syncStatus, "synced");
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("completeWorkflowTransaction does not auto-sync when toggles are off, and manual sync works afterward", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-workflow-"));
  try {
    const txn = await completeSingleStepTransaction(rootDir, { syncGoogleDrive: false, syncGoogleSheets: false });
    let driveCalls = 0;
    let sheetCalls = 0;
    const stubDrive = async () => { driveCalls += 1; return { driveFolderId: "f1", driveFolderUrl: "https://drive/f1", drivePath: "p", uploadedFileCount: 1 }; };
    const stubSheets = async () => { sheetCalls += 1; return { syncStatus: "synced" }; };

    const completed = await serverLogic.completeWorkflowTransaction({
      rootDir,
      transactionNo: txn.transactionNo,
      completedBy: "บัญชี",
      driveUploader: stubDrive,
      sheetsRecorder: stubSheets,
    });
    assert.equal(completed.status, "completed");
    assert.equal(driveCalls, 0);
    assert.equal(sheetCalls, 0);

    const manualDrive = await serverLogic.syncWorkflowTransactionToDrive({ rootDir, transactionNo: txn.transactionNo, driveUploader: stubDrive });
    assert.equal(driveCalls, 1);
    assert.equal(manualDrive.syncStatus, "synced");

    const manualSheets = await serverLogic.syncWorkflowTransactionToSheets({ rootDir, transactionNo: txn.transactionNo, sheetsRecorder: stubSheets });
    assert.equal(sheetCalls, 1);
    assert.equal(manualSheets.syncStatus, "synced");
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `/Users/tar/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/workflow-api.test.mjs`

Expected: FAIL because `completeWorkflowTransaction`, `syncWorkflowTransactionToDrive`, and `syncWorkflowTransactionToSheets` do not exist yet.

- [ ] **Step 3: Implement `completeWorkflowTransaction()`**

Load the transaction with `getWorkflowTransaction()`, load its child documents (the same lookup `refreshWorkflowTransaction()` uses), and call `deriveWorkflowProgress()`. If any step's `workflowStatus !== "completed"`, throw a Thai error (e.g. `"ยังไม่เสร็จสิ้นทุกขั้นตอนของ Workflow"`) and make no changes. Otherwise:

- set `status: "completed"`, `completedAt: now()`, `completedBy`
- append a status history entry (same shape as `appendExpenseRequestStatus()`/`appendSubstituteReceiptStatus()`)
- rewrite `data/workflow-transaction.json` and `working-md/workflow-summary.md` (`formatWorkflowSummaryMarkdown()`)
- regenerate the packet PDF via the Task 7 helper
- if `transaction.templateSnapshot.syncGoogleDrive` (the value snapshotted at start time, not a live template lookup) is `true`, call `syncWorkflowTransactionToDrive({ rootDir, transactionNo, driveUploader })` internally and attach the result as `transaction.driveSync`
- if `transaction.templateSnapshot.syncGoogleSheets` is `true`, call `syncWorkflowTransactionToSheets({ rootDir, transactionNo, sheetsRecorder })` internally and attach the result as `transaction.sheetSync`
- when a toggle is `false`, leave the matching `driveSync`/`sheetSync` field as `{ syncStatus: "not_required" }` so the UI can tell "not needed" apart from "not yet synced"
- accept `driveUploader` and `sheetsRecorder` as injectable parameters (defaults below) so both the auto-sync-on and auto-sync-off paths are testable without hitting the network
- return the updated transaction, including `driveSync`/`sheetSync`

- [ ] **Step 4: Implement manual sync fallbacks**

`syncWorkflowTransactionToDrive({ rootDir, transactionNo, driveUploader = uploadFolderToGoogleDrive, now = () => new Date().toISOString() })` and `syncWorkflowTransactionToSheets({ rootDir, transactionNo, sheetsRecorder = recordMonthlyExpense, now = () => new Date().toISOString() })`:

- load the transaction; throw if not found
- require `transaction.status === "completed"` — refuse to sync an incomplete transaction, mirroring the enable condition the UI uses to show these buttons
- Drive: call `driveUploader({ rootDir, folderPath: transaction.folderPath })`, write `{ syncStatus: "synced", driveFolderId, driveFolderUrl, drivePath, uploadedFileCount, syncedAt, updatedAt }` (or `{ syncStatus: "sync_failed", error, updatedAt }` on rejection, without throwing past this function) into `transaction.driveSync`, persist the transaction JSON, and return the same metadata object — this is exactly the `syncExpenseRequestToDrive()` shape applied to a workflow transaction folder instead of a document folder
- Sheets: build one row with `buildWorkflowSheetEntry(transaction, childDocuments, driveMetadata, syncedAt)` (Task 2) with `sourceKey: workflow_transaction:${transaction.transactionNo}` so re-running sync updates rather than duplicates the row, call `sheetsRecorder({ rootDir, entry, now })`, store the result as `transaction.sheetSync`, persist, and return it

  Verified fact (no further dedupe layer needed here): `recordMonthlyExpense()` in `forms/google-sheets.logic.js` already upserts on `sourceKey` — line 235 does `rows.findIndex((existingRow, index) => index > 0 && existingRow[0] === entry.sourceKey)` and updates that row in place when found, only appending a new row when no match exists. So passing `sourceKey: workflow_transaction:${transactionNo}` on every call (auto-sync and every manual re-sync) genuinely yields one Sheets row per transaction; do not add a separate duplicate-check before calling `sheetsRecorder()`.
- both functions are callable standalone (manual button press) and are also the functions `completeWorkflowTransaction()` calls internally for auto-sync — do not fork the logic into two implementations

- [ ] **Step 5: Export functions**

Add `completeWorkflowTransaction`, `syncWorkflowTransactionToDrive`, and `syncWorkflowTransactionToSheets` to `module.exports`.

- [ ] **Step 6: Run tests**

Run: `/Users/tar/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/workflow-api.test.mjs`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add forms/local-server.logic.js tests/workflow-api.test.mjs
git commit -m "feat: complete workflow transactions and sync them to Drive/Sheets"
```

---

### Task 9: HTTP Routes

**Files:**
- Modify: `local-server.mjs`
- Test: `tests/workflow-api.test.mjs`

**Interfaces:**
- Consumes server logic from Task 5, Task 7, and Task 8.
- Produces API routes from the spec.

- [ ] **Step 1: Write failing static route tests**

```js
import { readFile } from "node:fs/promises";

test("local server exposes workflow template and transaction routes", async () => {
  const source = await readFile(new URL("../local-server.mjs", import.meta.url), "utf8");
  assert.match(source, /\/api\/workflow-document-types/);
  assert.match(source, /\/api\/workflow-templates/);
  assert.match(source, /\/api\/workflow-transactions\/next/);
  assert.match(source, /\/api\/workflow-transactions/);
  assert.match(source, /start-document/);
  assert.match(source, /refreshWorkflowTransaction/);
  assert.match(source, /completeWorkflowTransaction/);
  assert.match(source, /syncWorkflowTransactionToDrive/);
  assert.match(source, /syncWorkflowTransactionToSheets/);
  assert.match(source, /\/complete/);
  assert.match(source, /\/sync-drive/);
  assert.match(source, /\/sync-sheets/);
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `/Users/tar/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/workflow-api.test.mjs`

Expected: FAIL until routes are added.

- [ ] **Step 3: Add imports**

Extend `require("./forms/local-server.logic.js")` destructuring with:

```js
getWorkflowTransactionFile,
getNextWorkflowTransactionInfo,
getWorkflowTransaction,
listWorkflowDocumentTypes,
listWorkflowTemplates,
listWorkflowTransactions,
refreshWorkflowTransaction,
saveWorkflowTemplate,
startWorkflowTransaction,
completeWorkflowTransaction,
syncWorkflowTransactionToDrive,
syncWorkflowTransactionToSheets,
```

- [ ] **Step 4: Add static page routes**

In `safeStaticPath()` route map:

```js
"/workflow-templates": "/workflow-templates.html",
"/workflow-templates/": "/workflow-templates.html",
"/workflow-transactions": "/workflow-transactions.html",
"/workflow-transactions/": "/workflow-transactions.html",
"/workflow-transaction": "/workflow-transaction.html",
"/workflow-transaction/": "/workflow-transaction.html",
```

- [ ] **Step 5: Add API handlers**

Follow existing `sendJson()` error style. Add handlers for listing document types, listing/saving templates, next transaction number, listing/starting/getting transactions, refreshing a transaction, starting a child document, completing a transaction (`completeWorkflowTransaction`), manually syncing a transaction to Drive (`syncWorkflowTransactionToDrive`), manually syncing a transaction to Sheets (`syncWorkflowTransactionToSheets`), and serving transaction packet files.

For `start-document`, return the standalone document URL:

```js
function buildWorkflowDocumentStartUrl(transaction, step) {
  const route = DOCUMENT_TYPE_DEFINITIONS[step.documentKind].route;
  const params = new URLSearchParams({
    transactionNo: transaction.transactionNo,
    workflowTemplateId: transaction.templateSnapshot.templateId,
    workflowStepId: step.stepId,
    returnTo: `/workflow-transaction?transactionNo=${encodeURIComponent(transaction.transactionNo)}`,
  });
  return `${route}?${params.toString()}`;
}
```

- [ ] **Step 6: Register routes**

POST routes:

- `/api/workflow-templates`
- `/api/workflow-transactions`
- `/api/workflow-transactions/:transactionNo/start-document/:stepId`
- `/api/workflow-transactions/:transactionNo/refresh`
- `/api/workflow-transactions/:transactionNo/complete` (calls `completeWorkflowTransaction`, refuses unless every step is `completed`, auto-syncs per the transaction's snapshotted toggles)
- `/api/workflow-transactions/:transactionNo/sync-drive` (calls `syncWorkflowTransactionToDrive`, manual fallback usable any time after completion)
- `/api/workflow-transactions/:transactionNo/sync-sheets` (calls `syncWorkflowTransactionToSheets`, manual fallback usable any time after completion)

GET routes:

- `/api/workflow-document-types`
- `/api/workflow-templates`
- `/api/workflow-transactions/next`
- `/api/workflow-transactions`
- `/api/workflow-transactions/:transactionNo`
- file route

- [ ] **Step 7: Run route tests**

Run: `/Users/tar/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/workflow-api.test.mjs`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add local-server.mjs tests/workflow-api.test.mjs
git commit -m "feat: expose workflow template routes"
```

---

### Task 10: Workflow Template, Transaction List, And Progress UI

**Files:**
- Create: `forms/workflow-templates.html`
- Create: `forms/workflow-transactions.html`
- Create: `forms/workflow-transaction.html`
- Create: `forms/workflow.logic.browser.js`
- Test: `tests/workflow-pages.html.test.mjs`

**Interfaces:**
- Consumes API routes from Task 9.
- Produces usable MVP pages.

- [ ] **Step 1: Write failing HTML tests**

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("workflow template page edits document order and sync toggles", async () => {
  const html = await readFile(new URL("../forms/workflow-templates.html", import.meta.url), "utf8");
  assert.match(html, /ตั้งค่า Workflow Template/);
  assert.match(html, /\/api\/workflow-document-types/);
  assert.match(html, /\/api\/workflow-templates/);
  assert.match(html, /syncGoogleDrive/);
  assert.match(html, /syncGoogleSheets/);
  assert.match(html, /documentSteps/);
});

test("workflow transactions page starts transactions from templates", async () => {
  const html = await readFile(new URL("../forms/workflow-transactions.html", import.meta.url), "utf8");
  assert.match(html, /เริ่ม Workflow/);
  assert.match(html, /\/api\/workflow-templates/);
  assert.match(html, /\/api\/workflow-transactions/);
  assert.match(html, /accountingMonth/);
  assert.match(html, /templateId/);
});

test("workflow transaction page shows progress checklist and standalone document links", async () => {
  const html = await readFile(new URL("../forms/workflow-transaction.html", import.meta.url), "utf8");
  assert.match(html, /id="workflowProgress"/);
  assert.match(html, /id="documentChecklist"/);
  assert.match(html, /id="childDocumentFiles"/);
  assert.match(html, /start-document/);
  assert.match(html, /refresh/);
  assert.match(html, /เปิดเอกสาร/);
});

test("workflow transaction page shows manual sync buttons and auto-sync status", async () => {
  const html = await readFile(new URL("../forms/workflow-transaction.html", import.meta.url), "utf8");
  assert.match(html, /id="syncDriveButton"/);
  assert.match(html, /id="syncSheetsButton"/);
  assert.match(html, /id="driveSyncStatus"/);
  assert.match(html, /id="sheetSyncStatus"/);
  assert.match(html, /sync-drive/);
  assert.match(html, /sync-sheets/);
  assert.match(html, /\/complete/);
});
```

- [ ] **Step 2: Run HTML tests to verify failure**

Run: `/Users/tar/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/workflow-pages.html.test.mjs`

Expected: FAIL because pages do not exist.

- [ ] **Step 3: Build template page**

Use existing topbar/menu styles. UI controls:

- template selector
- template name input
- description textarea
- Google Drive sync checkbox
- Google Sheets sync checkbox
- document kind select
- add document button
- ordered document list with up/down/remove buttons
- save template button

No conditional builder.

- [ ] **Step 4: Build transaction list page**

Controls:

- template select
- accounting month input
- transaction title input
- start button
- transaction table with status/current step

On start success, navigate to `/workflow-transaction?transactionNo=${encodeURIComponent(transactionNo)}`.

- [ ] **Step 5: Build transaction detail page**

Render:

- header with transaction number/title/template
- progress summary
- ordered checklist
- for each step: document label, workflow status, native document status, child document number, action button
- locked steps disabled until previous document is complete
- PDF/raw file links grouped by child document
- packet PDF link
- a "complete transaction" button, enabled only when every step is `completed` and the transaction is not already `completed`; calls `POST /api/workflow-transactions/:transactionNo/complete`
- sync section driven by the transaction's `driveSync`/`sheetSync` state and the template snapshot's `syncGoogleDrive`/`syncGoogleSheets` toggles, shown only once the transaction is `completed`:
  - when a toggle is `true`: show `#driveSyncStatus` / `#sheetSyncStatus` text reflecting the auto-sync result (e.g. synced / failed / pending) — no button
  - when a toggle is `false`: show `#syncDriveButton` / `#syncSheetsButton` respectively, calling `POST .../sync-drive` and `POST .../sync-sheets`, and update the matching status text after the call resolves

- [ ] **Step 6: Implement browser controller**

`forms/workflow.logic.browser.js` must include:

```js
async function fetchJson(url, options = {}) { /* throw on !ok with Thai-friendly error */ }
function getQueryParam(name) { /* URLSearchParams helper */ }
function renderTemplateEditor(documentTypes, templates) { /* template page */ }
function collectTemplatePayload() { /* ordered document kinds + sync toggles */ }
async function saveTemplate() { /* POST /api/workflow-templates */ }
async function startTransaction() { /* POST /api/workflow-transactions */ }
async function loadTransaction() { /* GET transaction by transactionNo */ }
async function refreshTransaction() { /* POST refresh */ }
async function startDocument(stepId) { /* POST start-document and navigate to returned url */ }
function renderTransaction(transaction) { /* checklist + files + sync section */ }
async function completeTransaction() { /* POST .../complete, then re-render */ }
async function syncTransactionDrive() { /* POST .../sync-drive, then re-render */ }
async function syncTransactionSheets() { /* POST .../sync-sheets, then re-render */ }
```

- [ ] **Step 7: Run tests**

Run: `/Users/tar/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/workflow-pages.html.test.mjs`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add forms/workflow-templates.html forms/workflow-transactions.html forms/workflow-transaction.html forms/workflow.logic.browser.js tests/workflow-pages.html.test.mjs
git commit -m "feat: add workflow group pages"
```

---

### Task 11: Navigation And Final Verification

**Files:**
- Modify: `forms/index.html`
- Modify: major existing HTML pages that include the hamburger menu
- Modify: `tests/navigation.html.test.mjs`

**Interfaces:**
- Produces discoverable links to workflow pages.

- [ ] **Step 1: Write failing nav test**

```js
test("main navigation links to workflow group pages", async () => {
  const pages = [
    "../forms/index.html",
    "../forms/expense-request.html",
    "../forms/expense-requests.html",
    "../forms/substitute-receipt.html",
    "../forms/substitute-receipts.html",
  ];
  for (const page of pages) {
    const html = await readFile(new URL(page, import.meta.url), "utf8");
    assert.match(html, /href="\/workflow-transactions"/, page);
    assert.match(html, /href="\/workflow-templates"/, page);
  }
});
```

- [ ] **Step 2: Run nav test to verify failure**

Run: `/Users/tar/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/navigation.html.test.mjs`

Expected: FAIL until menu links are added.

- [ ] **Step 3: Add menu links**

Add near existing accounting/document links:

```html
<a class="menu-item" href="/workflow-transactions">Workflow ธุรกรรมเอกสาร</a>
<a class="menu-item" href="/workflow-templates">ตั้งค่า Workflow Template</a>
```

- [ ] **Step 4: Run full suite**

Run: `./scripts/test.sh`

Expected: PASS.

- [ ] **Step 5: Start local server**

Run: `PORT=8788 node local-server.mjs`

Open:

- `http://localhost:8788/workflow-templates`
- `http://localhost:8788/workflow-transactions`

Manual smoke checklist:

- Six seeded templates appear.
- Template order can be changed and saved.
- Starting "ซื้อสต๊อกสินค้าแบบไม่มีใบกำกับภาษีโดยเงินบัญชีบริษัท" creates a `TXN-YYYY-MM-0001`.
- Transaction page shows `ใบสั่งซื้อ`, `ใบรับรองแทนใบเสร็จรับเงิน`, `ใบสำคัญจ่าย`, `ใบรับของ` in order.
- Only the first document can be opened initially.
- Opening a document passes `transactionNo`, `workflowTemplateId`, and `workflowStepId` in the URL.
- Completing the child document and refreshing the transaction unlocks the next document.
- Packet PDF link appears in the transaction page.
- After the last document is completed, the "complete transaction" button becomes enabled; clicking it marks the transaction `completed`.
- For a template with a sync toggle on, completion shows an auto-sync status instead of a button; for a toggle off, completion shows a manual sync button that succeeds when clicked.

- [ ] **Step 6: Commit verification fixes**

```bash
git status --short
git add <fixed-files>
git commit -m "fix: polish workflow group mvp"
```

---

## Handoff Notes

Work only inside:

`/Users/tar/Documents/หจกสวีทเฮาส์/.claude/worktrees/fixed-accounting-workflows-c59bfb`

Branch:

`claude/fixed-accounting-workflows-c59bfb`

Baseline before the plan:

`./scripts/test.sh` passed with 128 tests.

Important architecture correction:

Workflow is not a duplicate workflow engine with its own document forms. It is a transaction-level group/progress layer over standalone documents. Each standalone document must finish its own internal process and expose `completed` before workflow unlocks the next document. `goods_receipt` is one of the lightweight standalone documents handled by the generic `/workflow-document` shell (Task 4) — it is unrelated to the existing `/inventory-purchase-in` stock-movement flow, and nothing in this plan touches `forms/inventory.logic.js`.

Decision ledger: `.superpowers/sdd/progress.md` records the four PM decisions this revision applies (goods_receipt as a 5th lightweight kind, hybrid substitute_receipt completion, toggle-driven completion/sync with manual fallback, and the reporting cadence for the executing agent) plus two plan-defect fixes (`findLightweightWorkflowDocuments` must be real, and `scripts/test.sh` must only register each task's own Python test). Read it before starting Task 1.

A follow-up architecture/security pass closed three gaps the first revision flagged but left open: `getWorkflowTransactionFile()` now has a real implementation step (Task 5, Step 8) and `getWorkflowDocumentFile()` was added to Task 4 (Step 7) with the same path-traversal guard as `getExpenseRequestFile()`; `returnTo` is now validated through a shared `sanitizeWorkflowReturnTo()` helper (`forms/workflow-return-link.browser.js`, created in Task 4 Step 8, consumed in Task 4's own shell and in Task 6) instead of being assigned to `href` unchecked; and Task 8's Sheets-sync step now cites the verified upsert behavior of `recordMonthlyExpense()` (`forms/google-sheets.logic.js:235`) so no implementer adds a redundant dedupe layer. Details: `.superpowers/sdd/architecture-gap-closure-report.md`.

## Self-Review

- Spec coverage: Covers template builder, ordered document kinds, transaction ID relation, standalone document reuse, completed state requirement, child document adapters, progress derivation, packet aggregation, sync settings, workflow completion, Drive/Sheets sync (auto + manual fallback), APIs, UI, and tests.
- Decision coverage: D1 (`goods_receipt` is now a 5th lightweight document kind routed through `/workflow-document`, with an explicit no-touch note on `forms/inventory.logic.js` in Global Constraints, Task 1, and Task 4) — D2 (Task 2's mapping and new failing test cover both `substitute_receipt` hybrid branches; `completeSubstituteReceipt()` from Task 3 is unchanged and still available in all cases) — D3 (new Task 8 implements `completeWorkflowTransaction`/`syncWorkflowTransactionToDrive`/`syncWorkflowTransactionToSheets`; Task 9 exposes the three HTTP routes; Task 10 adds the manual-button/auto-status UI) — D4 (Task 5 Step 6 now specifies a real `findLightweightWorkflowDocuments()` with the `documentKind`-injection caveat for expense/substitute records; Task 4/Task 7's `scripts/test.sh` edits are additive so `./scripts/test.sh` stays green from Task 4 onward).
- Placeholder scan: No TBD/TODO placeholders, including the former `findLightweightWorkflowDocuments() { return []; }` stub. Each task includes concrete files, interfaces, tests, commands, and commit messages.
- Type consistency: Public helper names introduced in earlier tasks are reused with the same names later. `LIGHTWEIGHT_DOCUMENT_KINDS` and `DOCUMENT_PREFIXES` both carry `goods_receipt` as a fifth entry; `DOCUMENT_TYPE_DEFINITIONS`' key order is unchanged from the original plan (only `goods_receipt.route` changed).
- Task numbering: Tasks 1–7 are unchanged. Task 8 (Workflow Completion And Sync) is new. The original Task 8 (HTTP Routes) is now Task 9, the original Task 9 (UI) is now Task 10, and the original Task 10 (Navigation And Final Verification) is now Task 11. Every cross-reference to a renumbered task was checked and updated. This total of 11 tasks is unchanged by the follow-up gap-closure pass — that pass only inserted steps inside Task 4, Task 5, Task 6, and Task 8, renumbering each task's own later steps; no task was added, removed, or renumbered.
- Gap-closure follow-up (this pass): (1) Task 5 gained Step 8, `getWorkflowTransactionFile()` implementation with its containment guard and allowed-`section` rationale (`pdf` only), plus a traversal/legitimate-file test appended to Step 1; Task 4 gained the equivalent Step 7 (`getWorkflowDocumentFile()`, sections `pdf`/`raw`) with its own test. (2) Every page that consumes `returnTo` (`workflow-document.html`, `expense-request.html`, `substitute-receipt.html`) now validates it through one shared `sanitizeWorkflowReturnTo()` helper (new Task 4 Step 8, file `forms/workflow-return-link.browser.js`) before ever assigning it to `href`; Task 6's Steps 1, 3, and 5 were updated to load and use it, with new HTML-test assertions in both tasks; a Global Constraints bullet states the rule once. (3) Task 8's Sheets-sync step now cites the verified `recordMonthlyExpense()` upsert-by-`sourceKey` behavior (`forms/google-sheets.logic.js:235`) as fact, closing the open question without changing Task 8's behavior.
