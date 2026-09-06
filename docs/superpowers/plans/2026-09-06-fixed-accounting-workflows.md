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
  - Owns lightweight standalone document kinds that do not yet have dedicated pages: purchase order, payment voucher, cash spend declaration, and payee acknowledgement.
- Create `forms/workflow-document.html`
  - Generic standalone form for lightweight workflow-compatible documents; it must also work without workflow context.
- Create `forms/workflow-document.logic.browser.js`
  - Browser controller for the generic standalone document shell.
- Create `scripts/generate_workflow_packet_pdf.py`
  - Generates a transaction packet/index PDF that links/summarizes child document PDFs and raw files.
- Create `scripts/generate_workflow_document_pdf.py`
  - Generates PDFs for lightweight standalone documents.
- Modify `forms/local-server.logic.js`
  - Add workflow template storage, workflow transaction storage, sequence generation, child document lookup, progress refresh, packet generation, sync functions, and exported helpers.
- Modify `local-server.mjs`
  - Add static routes and API handlers for templates, transactions, and packet files.
- Modify `forms/expense-request.logic.js`
  - Preserve workflow relation fields and add `completed` status support.
- Modify `forms/substitute-receipt.logic.js`
  - Preserve workflow relation fields and add/normalize `completed` status support.
- Modify `forms/expense-request.html` and `forms/substitute-receipt.html`
  - Read workflow query params, include them in saved payloads, and show a return link back to the workflow transaction.
- Modify list pages only where useful to show transaction badges.
- Create `tests/workflow.logic.test.mjs`
- Create `tests/workflow-api.test.mjs`
- Create `tests/workflow-pages.html.test.mjs`
- Create `tests/workflow-document.logic.test.mjs`
- Create `tests/workflow-document.html.test.mjs`
- Create `scripts/test_workflow_packet_pdf.py`
- Modify `scripts/test.sh` to include the new Python PDF test.

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
  goods_receipt: { documentKind: "goods_receipt", label: "ใบรับของ/ใบรับสินค้าเข้าคลัง", route: "/inventory-purchase-in", standalone: true },
  expense_request: { documentKind: "expense_request", label: "ใบเบิกค่าใช้จ่าย", route: "/expense-request", standalone: true },
  cash_spend_declaration: { documentKind: "cash_spend_declaration", label: "ใบรับรองการจ่ายเงินสดส่วนตัว", route: "/workflow-document?documentKind=cash_spend_declaration", standalone: true },
  payee_acknowledgement: { documentKind: "payee_acknowledgement", label: "ใบสำคัญรับเงิน/ใบรับเงินคืนค่าใช้จ่าย", route: "/workflow-document?documentKind=payee_acknowledgement", standalone: true },
};
```

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

It must map native status:

- `completed` -> workflow `completed`
- `received` -> workflow `completed` only when `documentKind === "substitute_receipt"` or `documentKind === "goods_receipt"`
- `approved` -> workflow `in_progress`
- missing/unknown -> workflow `in_progress`

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

- [ ] **Step 1: Write failing logic tests**

```js
import assert from "node:assert/strict";
import test from "node:test";

import docLogic from "../forms/workflow-document.logic.js";

test("lightweight workflow documents expose required standalone kinds", () => {
  assert.deepEqual(docLogic.LIGHTWEIGHT_DOCUMENT_KINDS, [
    "purchase_order",
    "payment_voucher",
    "cash_spend_declaration",
    "payee_acknowledgement",
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
```

- [ ] **Step 2: Run logic tests to verify failure**

Run: `/Users/tar/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/workflow-document.logic.test.mjs`

Expected: FAIL because `forms/workflow-document.logic.js` does not exist.

- [ ] **Step 3: Implement lightweight document logic**

Create prefixes:

```js
const DOCUMENT_PREFIXES = {
  purchase_order: "PO",
  payment_voucher: "PV",
  cash_spend_declaration: "CSD",
  payee_acknowledgement: "PAR",
};
```

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
- file route for PDF/raw

- [ ] **Step 7: Create generic standalone HTML page**

The page must include:

- hidden `documentKind`, `transactionNo`, `workflowTemplateId`, `workflowStepId`
- document date, title, requester, payee, purpose
- line items
- evidence uploads
- save button
- complete button
- return-to-workflow link when `returnTo` exists

- [ ] **Step 8: Add tests to `scripts/test.sh`**

Run both new Python tests:

```bash
(cd "$SCRIPT_DIR" && "$PYTHON_BIN" -m unittest test_substitute_receipt_pdf test_workflow_document_pdf test_workflow_packet_pdf -v)
```

- [ ] **Step 9: Run targeted tests**

Run:

```bash
/Users/tar/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/workflow-document.logic.test.mjs tests/workflow-document.html.test.mjs
PYTHONPATH=scripts /Users/tar/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 -m unittest test_workflow_document_pdf -v
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add forms/workflow-document.logic.js forms/workflow-document.html forms/workflow-document.logic.browser.js scripts/generate_workflow_document_pdf.py scripts/test_workflow_document_pdf.py tests/workflow-document.logic.test.mjs tests/workflow-document.html.test.mjs forms/local-server.logic.js local-server.mjs scripts/test.sh
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
import { mkdir, mkdtemp, rm } from "node:fs/promises";
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

Filter records where `payload.transactionNo === transactionNo`. Add an empty extension point for future lightweight document kinds:

```js
async function findLightweightWorkflowDocuments(rootDir, transactionNo) {
  return [];
}
```

- [ ] **Step 7: Implement refresh**

`refreshWorkflowTransaction()` loads the transaction, loads child documents, calls `deriveWorkflowProgress()`, rewrites JSON/markdown, regenerates packet PDF after Task 7, and returns the updated transaction.

- [ ] **Step 8: Export workflow functions**

Add all functions listed in this task's interface to `module.exports`.

- [ ] **Step 9: Run tests**

Run: `/Users/tar/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/workflow-api.test.mjs`

Expected: PASS, except packet-related assertions should wait until Task 7.

- [ ] **Step 10: Commit**

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

**Interfaces:**
- Consumes query params: `transactionNo`, `workflowTemplateId`, `workflowStepId`, `returnTo`
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
});

test("substitute receipt form preserves workflow context query params", async () => {
  const html = await readFile(new URL("../forms/substitute-receipt.html", import.meta.url), "utf8");
  assert.match(html, /transactionNo/);
  assert.match(html, /workflowTemplateId/);
  assert.match(html, /workflowStepId/);
  assert.match(html, /returnTo/);
  assert.match(html, /กลับไปที่ Workflow/);
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

If `returnTo` is present, set `workflowReturnLink.href = returnTo` and unhide it. Keep it hidden for standalone use.

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

- [ ] **Step 4: Add Python test to `scripts/test.sh`**

Change the Python test command to:

```bash
(cd "$SCRIPT_DIR" && "$PYTHON_BIN" -m unittest test_substitute_receipt_pdf test_workflow_packet_pdf -v)
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

### Task 8: HTTP Routes

**Files:**
- Modify: `local-server.mjs`
- Test: `tests/workflow-api.test.mjs`

**Interfaces:**
- Consumes server logic from Task 5 and Task 7.
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

Follow existing `sendJson()` error style. Add handlers for listing document types, listing/saving templates, next transaction number, listing/starting/getting transactions, refreshing a transaction, starting a child document, and serving transaction packet files.

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
- `/api/workflow-transactions/:transactionNo/complete`
- `/api/workflow-transactions/:transactionNo/sync-drive`

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

### Task 9: Workflow Template, Transaction List, And Progress UI

**Files:**
- Create: `forms/workflow-templates.html`
- Create: `forms/workflow-transactions.html`
- Create: `forms/workflow-transaction.html`
- Create: `forms/workflow.logic.browser.js`
- Test: `tests/workflow-pages.html.test.mjs`

**Interfaces:**
- Consumes API routes from Task 8.
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
function renderTransaction(transaction) { /* checklist + files */ }
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

### Task 10: Navigation And Final Verification

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

- [ ] **Step 6: Commit verification fixes**

```bash
git status --short
git add <fixed-files>
git commit -m "fix: polish workflow group mvp"
```

---

## Handoff Notes

Work only inside:

`/Users/tar/Documents/หจกสวีทเฮาส์/.worktrees/fixed-accounting-workflows`

Branch:

`codex/fixed-accounting-workflows`

Baseline before the plan:

`./scripts/test.sh` passed with 128 tests.

Important architecture correction:

Workflow is not a duplicate workflow engine with its own document forms. It is a transaction-level group/progress layer over standalone documents. Each standalone document must finish its own internal process and expose `completed` before workflow unlocks the next document.

## Self-Review

- Spec coverage: Covers template builder, ordered document kinds, transaction ID relation, standalone document reuse, completed state requirement, child document adapters, progress derivation, packet aggregation, sync settings, APIs, UI, and tests.
- Placeholder scan: No TBD/TODO placeholders. Each task includes concrete files, interfaces, tests, commands, and commit messages.
- Type consistency: Public helper names introduced in earlier tasks are reused with the same names later.
