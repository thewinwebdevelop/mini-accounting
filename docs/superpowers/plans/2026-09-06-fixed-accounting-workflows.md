# Document Group Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an MVP workflow system where templates define an ordered group of standalone document types, starting a workflow creates one transaction ID, and every child document created under that transaction reports completion back to the workflow.

**Architecture:** Keep standalone document flows as the source of truth for forms, approval actions, raw files, PDFs, and native document state. Add a workflow-template/transaction layer that stores document order, creates `TXN-YYYY-MM-0001`, passes that transaction ID into standalone document forms, derives progress from child document `completed` states, and generates a transaction-level review packet.

**Tech Stack:** Local Node HTTP server, static HTML/CSS/vanilla JS, Node built-in test runner, Python ReportLab PDF generation, existing filesystem storage under `documents/`, existing Google Drive/Sheets helpers.

**Spec:** `docs/superpowers/specs/2026-09-06-fixed-accounting-workflows-design.md`

## Global Constraints

> **Reorder note (fifth follow-up pass, 2026-09-07):** Tasks 1-6 are implemented and committed. The plan was originally layered strictly bottom-up: every `/api/workflow-*` route lived in one "HTTP Routes" task and every workflow page lived in one "UI" task, both positioned as tasks 10 and 11 of 12 — meaning nothing was reachable by an actual user until task ten of twelve. The product owner asked to reach a usable product much sooner, since the workflow template/transaction pages are the natural entry point to the whole feature and everything they need (`listWorkflowTemplates()`, `saveWorkflowTemplate()`, `getNextWorkflowTransactionInfo()`, `startWorkflowTransaction()`, `listWorkflowTransactions()`, `getWorkflowTransaction()`, `refreshWorkflowTransaction()`, `getWorkflowTransactionFile()`, `getWorkflowTransactionPrefill()`) was already committed by the end of Task 6. This pass splits the user-facing slice out of the former Tasks 10-11 into a new **Task 7 (Workflow Template And Transaction Routes)** and **Task 8 (Workflow Template And Transaction Pages)**, so the templates/transactions/checklist UI is usable by Task 8 of 12 instead of Task 11. Former Task 7 (Pass Workflow Context Into Existing Standalone Forms) is now Task 9, former Task 8 (Workflow Packet PDF) is now Task 10, former Task 9 (Workflow Completion And Sync) is now Task 11, and Task 12 (Navigation And Final Verification) is unchanged in position. The former Task 10 and Task 11 no longer exist as whole tasks — their leftover pieces (the packet-file download path and packet link, the `/complete`/`/sync-drive` routes and the complete/sync UI) are redistributed onto Task 10 and Task 11 respectively, which now register their own remaining routes and extend the page Task 8 already built, instead of deferring to a separate routes/UI task. Total task count stays 12. See the Handoff Notes and Self-Review for the full old-to-new task map.
- Workflow templates define only ordered document kinds and a Google Drive sync toggle (`syncGoogleDrive`). There is no workflow-level Google Sheets sync and no `syncGoogleSheets` toggle anywhere in the template shape — see the D6 deviation note below.
- Do not duplicate standalone document forms inside workflow pages.
- Starting a workflow creates transaction numbers in the format `TXN-YYYY-MM-0001`.
- Workflow transaction records are stored under `documents/YYYY/MM/workflow-transactions/TXN-YYYY-MM-0001_<safe-title>/`.
- Every child document created from workflow must store `transactionNo`, `workflowTemplateId`, and `workflowStepId`.
- All standalone document types used in workflow must expose or normalize a `completed` state.
- Workflow next-step unlocking is based on child document completion, not a separate workflow approval state.
- Documents must be created in strict template order. A step after the first incomplete step is `blocked`, even when that later step's own child document already exists and independently reports `completed` (e.g. a document created out of band, or a stale/duplicate document number reused from another transaction). This is not only a UI affordance: the server must refuse to let a document be started for any step that is not the transaction's currently unlocked step. `deriveWorkflowProgress()` (Task 2) computes the block; the `POST /api/workflow-transactions/:transactionNo/start-document/:stepId` handler (Task 7) enforces it, by calling `refreshWorkflowTransaction()` first and comparing the requested `stepId` against the freshly derived `currentStepId` (decisions D5 and D7, `.superpowers/sdd/progress.md`) — not the last-persisted value.
- Existing standalone pages must still work without `transactionNo`.
- Cross-document prefill (decision D8, `.superpowers/sdd/progress.md`, Task 6) lets the user reuse `payee`, `purpose`, or `lines` from an earlier `completed` child document in the same transaction when opening a later one, per group, never all-or-nothing. It is built from one canonical transaction context (not N-by-N per-kind mappings) via a `toWorkflowContext(payload)` / `applyWorkflowContext(context, groups)` adapter pair per document kind. When two or more `completed` documents supply the same group, the most recently completed one wins that group; an earlier `completed` document only fills a group no later document supplied. Only documents whose workflow status (per `normalizeDocumentWorkflowStatus()`, Task 2) is `completed` are ever used as a source. The following fields are never copied by any group, on any document kind: `documentNo`, `documentDate` (a prefilled document always defaults its own date to today, never the source document's date), `status`, `statusHistory`, `completedAt`, `completedBy`, signature fields, and evidence/raw file lists — the canonical group shapes structurally have no room for these fields, so no adapter ever emits them. `goods_receipt` line **quantities** are additionally never prefilled (they must reflect goods actually received, so a short delivery stays visible) even though `goods_receipt` line descriptions and stock SKUs may be prefilled. Every prefilled value remains a fully editable default, never a lock, and the UI marks prefilled fields with the source document number that supplied them.
- **Decision D10** (`.superpowers/sdd/progress.md`, user-approved, overrides the original Task 6 design): `expense_request` **does** source and receive the `lines` group, mapped line by line, because the product owner rejected the original single-seeded-placeholder-line design for `totals`. Sourcing: each `expenseLines` entry becomes one canonical line (`quantity` fixed at `"1"`, `unitCost` and `lineTotal` both set to the expense line's `amountBeforeVat`, `stockSkuId` fixed at `""`). Receiving: each canonical line becomes one `expenseLines` entry (`description` carried over verbatim, `amountBeforeVat` = the canonical line's `lineTotal`, `vatAmount`/`withholdingTax` fixed at `"0.00"` — these six templates are all no-tax-invoice cases, so VAT is genuinely zero). The canonical `quantity`/`unitCost` have no target field on an expense line and are dropped. Every document kind can now source and receive all three tickable groups uniformly — there is no longer any kind-specific exclusion. **Consequence: `totals` is no longer a group at all**, tickable or otherwise — every kind (including `expense_request`, now that it derives totals from its own `expenseLines` the same way every other kind derives totals from its `lines`) recomputes its totals from its own lines on save, so an independently-carried `totals` value would only ever go stale. The canonical context and every group list in this plan carry exactly three groups: `payee`, `purpose`, `lines`. See Task 6 for the full per-kind field mapping.
- `goods_receipt` is a lightweight standalone document (route `/workflow-document?documentKind=goods_receipt`, prefix `GR-YYYY-MM-0001`), exactly like `purchase_order` / `payment_voucher` / `cash_spend_declaration` / `payee_acknowledgement`. It is NOT the existing `/inventory-purchase-in` route. Do not modify the inventory purchase-in system (`forms/inventory.logic.js`, `createPurchaseInMovement()`) in any way while implementing this plan — stock movements remain owned exclusively by the existing `receiveSubstituteReceiptStock()` flow, which is unrelated to workflow document completion.
- `substitute_receipt` workflow completion is hybrid, keyed on `receiptType`: native `received` reports workflow `completed` only for `receiptType === "stock_purchase"`; native `approved` reports workflow `completed` only for `receiptType === "general_expense"`. Every other native `approved`, and missing/unknown status, reports workflow `in_progress`. The explicit `completeSubstituteReceipt()` action is available regardless of `receiptType` and always stamps native `status: "completed"`.
- Workflow transaction completion and sync are Drive-only, driven by the template's `syncGoogleDrive` toggle snapshotted onto the transaction: Drive sync runs automatically right after all steps are `completed` when the toggle is `true`; when the toggle is `false`, the transaction page exposes a manual "Sync Drive" button instead. Manual sync must remain callable independent of the toggle value once the transaction is completed. The workflow layer never writes a Google Sheets row — see the D6 deviation note below.
- Any route that serves a file by name (transaction packet files, workflow-document PDFs/raw files) must resolve the path the same way `getExpenseRequestFile()` does today: resolve against the section directory and reject any resolved path that does not start with `${baseDir}${path.sep}`, so a crafted `fileName` cannot traverse outside the document/transaction folder. `getWorkflowTransactionFile()` (Task 5) and `getWorkflowDocumentFile()` (Task 4) are the concrete implementations of this rule — see those tasks for the allowed `section` values.
- `returnTo` must be treated as untrusted input everywhere it is consumed (expense request, substitute receipt, and lightweight workflow-document pages): before assigning it to a link's `href`, validate it is a same-origin relative path — starts with a single `/`, does not start with `//`, and does not contain `\` — otherwise leave the return link hidden. Use the shared `sanitizeWorkflowReturnTo()` helper (Task 4) rather than re-implementing this check per page.
- Use `scripts/test.sh` for final verification.

> **Deliberate deviation from spec (D6):** The spec's `## Sync Rules` section says "Google Sheets sync should write one summary row per completed transaction." The product owner overrode this on 2026-09-06 (see `.superpowers/sdd/progress.md`, decision D6): a workflow transaction bundles several child documents that cover the *same* underlying money, and each child document (expense request, substitute receipt) already writes its own Google Sheets row with the real amount via `recordMonthlyExpense()`. A workflow-level row would double- or triple-count that money in the monthly sheet. **This plan governs**: there is no workflow-level Sheets row, no `syncGoogleSheets` toggle, and no `sync-sheets` route anywhere in this plan. Do not edit the spec file to match — the spec is left as-is and this note records the intentional divergence. `recordMonthlyExpense()` (`forms/google-sheets.logic.js:235`) upserts on `sourceKey`, so this change does not affect child documents' existing Sheets behavior at all.

---

## File Structure

> **Reorder note:** the file list below is annotated with the task that now creates/first-modifies each file. `forms/workflow-templates.html`, `forms/workflow-transactions.html`, `forms/workflow-transaction.html`, and `forms/workflow.logic.browser.js` move from the old UI task (formerly 11) to the new **Task 8**; `local-server.mjs`'s workflow-transaction routes are split between **Task 7** (templates, transactions, refresh, start-document, prefill, transaction file download), **Task 10** (packet PDF — extends the file-download path Task 7 already wired by giving it real content), and **Task 11** (`/complete`, `/sync-drive` — new routes registered directly in the completion task instead of a separate routes task).

- Create `forms/workflow.logic.js` (Task 1, extended Task 2)
  - Owns document type registry, default template seeds, template validation, transaction payload normalization, transaction progress derivation, child document adapters, file naming, and markdown formatting. Does not produce a Sheets row — see D6.
- Create `forms/workflow-templates.html` (Task 8)
  - Lets the user create/edit workflow templates by choosing document kinds in order and toggling Google Drive sync.
- Create `forms/workflow-transactions.html` (Task 8)
  - Lets the user choose a template, start a transaction, and list existing transactions.
- Create `forms/workflow-transaction.html` (Task 8; extended by Task 10 with the packet PDF link and by Task 11 with the complete-transaction button and Drive sync section)
  - Shows one transaction's checklist/progress and links into standalone document forms.
- Create `forms/workflow.logic.browser.js` (Task 8; extended by Task 10 and Task 11)
  - Browser controller shared by workflow template/list/detail pages.
- Create `forms/workflow-document.logic.js` (Task 4)
  - Owns lightweight standalone document kinds that do not yet have dedicated pages: purchase order, payment voucher, cash spend declaration, payee acknowledgement, and goods receipt. Never touches `forms/inventory.logic.js` or inventory stock movements.
- Create `forms/workflow-document.html` (Task 4)
  - Generic standalone form for lightweight workflow-compatible documents; it must also work without workflow context.
- Create `forms/workflow-document.logic.browser.js` (Task 4)
  - Browser controller for the generic standalone document shell.
- Create `forms/workflow-return-link.browser.js` (Task 4)
  - Tiny, dependency-free helper exposing `sanitizeWorkflowReturnTo(value)` (validates the value is a same-origin relative path). Loaded via its own `<script>` tag by `forms/expense-request.html`, `forms/substitute-receipt.html`, and `forms/workflow-document.html` before their own inline/controller scripts run, so all three pages validate `returnTo` the same way without each hand-rolling the check or creating a dependency on another page's browser-logic file.
- Create `forms/workflow-prefill.logic.js` (Task 6)
  - Cross-document prefill (decision D8, `.superpowers/sdd/progress.md`, revised by decision D10): one canonical transaction context plus a `toWorkflowContext(payload)`/`applyWorkflowContext(context, groups)` adapter pair per document kind (14 functions for the 7 kinds), `buildWorkflowPrefillContext()` implementing the most-recently-completed-wins precedence rule, and `RECEIVABLE_PREFILL_GROUPS` stating which of `payee`/`purpose`/`lines` each kind can receive (D10: uniformly all three, for every kind — `totals` is no longer a group). Pure — no filesystem, no network, no bare `new Date()`. Same CommonJS/`window` dual-export tail as the other `forms/*.logic.js` modules, loadable client-side like `forms/workflow-return-link.browser.js`.
- Create `scripts/generate_workflow_packet_pdf.py` (Task 10)
  - Generates a transaction packet/index PDF that links/summarizes child document PDFs and raw files.
- Create `scripts/generate_workflow_document_pdf.py` (Task 4)
  - Generates PDFs for lightweight standalone documents.
- Modify `forms/local-server.logic.js` (Task 5, extended by Task 6, Task 10, Task 11)
  - Add workflow template storage, workflow transaction storage, sequence generation, child document lookup, progress refresh, packet generation, workflow transaction completion, auto/manual Drive sync functions, cross-document prefill orchestration (`getWorkflowTransactionPrefill()`, Task 6), and exported helpers. No Sheets sync function — see D6.
- Modify `local-server.mjs` (Task 7, extended by Task 8, Task 10, Task 11)
  - Task 7 adds static-independent API handlers for templates, transactions, refresh, start-document, transaction prefill (`GET .../prefill`), and the transaction file-download route. Task 8 adds the three static page routes (`/workflow-templates`, `/workflow-transactions`, `/workflow-transaction`) once the pages exist to serve. Task 10 gives the already-wired file-download route something real to serve (the packet PDF) and adds its download-happy-path test. Task 11 adds the `/complete` and `/sync-drive` API handlers.
- Modify `forms/expense-request.logic.js` (Task 3)
  - Preserve workflow relation fields and add `completed` status support.
- Modify `forms/substitute-receipt.logic.js` (Task 3)
  - Preserve workflow relation fields and add/normalize `completed` status support.
- Modify `forms/expense-request.html` and `forms/substitute-receipt.html` (Task 9)
  - Read workflow query params, include them in saved payloads, show a return link back to the workflow transaction validated through the shared `sanitizeWorkflowReturnTo()` helper (`forms/workflow-return-link.browser.js`, Task 4) before it is ever assigned to `href`, and show the cross-document prefill banner (Task 6 logic, wired to HTTP already in Task 7, banner UI added here in Task 9).
- Modify `forms/workflow-document.html` and `forms/workflow-document.logic.browser.js` (Task 4; verified end to end once Task 7 lands)
  - Show the same cross-document prefill banner (Task 4 UI; Task 6 provides the logic and Task 7 provides the live HTTP endpoint and end-to-end verification).
- Modify list pages only where useful to show transaction badges.
- Modify `forms/index.html` (Task 8; other major pages follow in Task 12)
  - Add the two workflow menu links (`/workflow-transactions`, `/workflow-templates`) so the feature is reachable from the home page as soon as Task 8 lands.
- Create `tests/workflow.logic.test.mjs` (Task 1, extended Task 2)
- Create `tests/workflow-api.test.mjs` (Task 5; extended by Task 6, Task 7, Task 10, Task 11)
- Create `tests/workflow-pages.html.test.mjs` (Task 8; extended by Task 10, Task 11)
- Create `tests/workflow-document.logic.test.mjs` (Task 4)
- Create `tests/workflow-document.html.test.mjs` (Task 4)
- Create `tests/workflow-prefill.logic.test.mjs` (Task 6)
- Create `tests/navigation.html.test.mjs` (Task 8, with the `index.html` assertion only; extended by Task 12 with the remaining major pages)
- Create `scripts/test_workflow_document_pdf.py` (Task 4)
- Create `scripts/test_workflow_packet_pdf.py` (Task 10)
- Modify `scripts/test.sh` to register each new Python PDF test as it is created (Task 4 adds `test_workflow_document_pdf`, Task 10 adds `test_workflow_packet_pdf` to the same command). Tasks 6, 7, 8, and 9 add no Python test and do not touch `scripts/test.sh`.

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

test("template normalization preserves order and sync toggle", () => {
  const normalized = normalizeWorkflowTemplate({
    templateId: "custom_stock",
    name: "ซื้อสต๊อกแบบ custom",
    syncGoogleDrive: true,
    documentSteps: [
      { documentKind: "purchase_order" },
      { documentKind: "payment_voucher" },
    ],
  }, { now: () => "2026-09-06T10:00:00.000Z" });

  assert.equal(normalized.templateId, "custom_stock");
  assert.equal(normalized.syncGoogleDrive, true);
  assert.equal(normalized.syncGoogleSheets, undefined);
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
  active: true,
  documentSteps: [
    { stepId: "step-001", documentKind: "..." },
  ],
  createdAt,
  updatedAt,
}
```

There is no `syncGoogleSheets` field anywhere in the template shape (decision D6, `.superpowers/sdd/progress.md`) — `syncGoogleDrive` is the only sync toggle a template carries.

Use deterministic seed timestamps: `"2026-09-06T00:00:00.000Z"`.

- [ ] **Step 5: Implement template helpers**

`normalizeWorkflowTemplate()` must trim text, set sequential `step-001` IDs, copy `syncGoogleDrive` as a boolean, validate document kinds, and keep `createdAt` if provided. It must not read or emit `syncGoogleSheets`.

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

test("deriveWorkflowProgress blocks a later step even when its own child document already reports completed out of order", () => {
  // Decision D5 (.superpowers/sdd/progress.md): documents must be created in
  // strict template order. step-001 has no child document at all, but
  // step-002 already has one that independently reports native "completed".
  // step-002 must still come back "blocked" and currentStepId must stay
  // "step-001" -- a completed child document for a later step never skips
  // the earlier, still-incomplete step.
  const template = DEFAULT_WORKFLOW_TEMPLATES.find((item) => item.templateId === "stock_no_tax_invoice_company_bank");
  const transaction = workflowLogic.buildWorkflowTransactionPayload({
    sequence: "2",
    accountingMonth: "2026-09",
    title: "ทดสอบลำดับเอกสาร",
    template,
  });

  const next = workflowLogic.deriveWorkflowProgress(transaction, [
    {
      documentKind: "substitute_receipt",
      documentNo: "SR-2026-09-0001",
      workflowStepId: "step-002",
      transactionNo: transaction.transactionNo,
      status: "completed",
      statusLabel: "เสร็จสิ้น",
    },
  ]);

  assert.equal(next.steps[0].workflowStatus, "not_started");
  assert.equal(next.steps[1].workflowStatus, "blocked");
  assert.equal(next.steps[2].workflowStatus, "blocked");
  assert.equal(next.currentStepId, "step-001");
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `/Users/tar/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/workflow.logic.test.mjs`

Expected: FAIL because transaction helpers are missing.

- [ ] **Step 3: Implement transaction payload builder**

`buildWorkflowTransactionPayload()` must validate `accountingMonth` as `YYYY-MM`, create `transactionNo`, create the workflow transaction folder path, snapshot the selected template (including its `syncGoogleDrive` toggle — there is no `syncGoogleSheets` field to snapshot), initialize derived step states, and set `status = "in_progress"`.

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

`deriveWorkflowProgress(transaction, childDocuments)` must normalize all child documents, match them by `workflowStepId` first and by `documentKind` second, and mark the transaction `completed` when every step is completed.

Strict-order rule (decision D5, `.superpowers/sdd/progress.md`): walk `template.documentSteps` in order and find the index of the first step whose normalized child document is not `completed` (or has no child document at all) — call this `firstIncompleteIndex`. Every step at an index `> firstIncompleteIndex` is `blocked`, **unconditionally** — do not special-case a later step whose own child document happens to already report `completed`. Only the step at `firstIncompleteIndex` may be `not_started`/`in_progress`; steps before it are `completed`. `currentStepId` is always the `stepId` at `firstIncompleteIndex` (or `null` when every step is completed). Do not implement this as "unlock only the first incomplete step" while leaving later steps to report whatever their own child document says — that reading is exactly the ambiguity that produced the out-of-order bug this step's test now covers; a later step's own `completed` child document must never promote it past `blocked` while an earlier step is still incomplete.

- [ ] **Step 6: Implement markdown formatting**

`formatWorkflowSummaryMarkdown()` must output Thai tables for template, steps, child documents, PDF files, and raw files.

There is no workflow-level Sheets row (decision D6, `.superpowers/sdd/progress.md`) — do not implement `buildWorkflowSheetEntry()` or any equivalent. Child documents (expense request, substitute receipt) already write their own Sheets rows with the real amounts via `recordMonthlyExpense()`; a workflow-level row would double-count that money in the monthly sheet.

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
- Consume (created in Task 6, loaded but not modified here — see Step 10): `forms/workflow-prefill.logic.js`

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

This is the single implementation used by `forms/workflow-document.html` (this task), `forms/expense-request.html`, and `forms/substitute-receipt.html` (Task 9) — none of those pages re-implement the check. It has no dependency on any other browser-logic file, so loading it from expense-request/substitute-receipt does not pull in `workflow-document.logic.browser.js` or vice versa.

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

- [ ] **Step 10: Add the cross-document prefill banner**

Decision D8 (`.superpowers/sdd/progress.md`, Task 6). When the page is opened with both `transactionNo` and `workflowStepId` present, the boot script calls `GET /api/workflow-transactions/${transactionNo}/prefill?documentKind=${documentKind}&stepId=${workflowStepId}` (Task 6's `getWorkflowTransactionPrefill()`; the route itself is wired in Task 7, Step 5). **This is a forward reference**: Task 4 runs before Task 6 and Task 7 in execution order, so until those land, this fetch 404s and the banner simply never shows — the same harmless-until-later-tasks-land pattern this page already uses for `transactionNo`/`workflowStepId` themselves, which do nothing useful until Task 8 builds the transaction page that sets them. Task 4's own tests only assert on static markup/script content, so this forward reference does not block Task 4's tests from passing. Once Task 7 lands (only three tasks later, not seven), add an end-to-end check confirming this banner actually appears: with a completed prior-step document in the same transaction, load `forms/workflow-document.html` behavior through `fetchWorkflowPrefill()` against a live server and assert the fetched `availableGroups` is non-empty — see Task 7, Step 7.

Load `forms/workflow-prefill.logic.js` via `<script src="./workflow-prefill.logic.js"></script>` — placed after `workflow-return-link.browser.js` and before this page's own controller script — so `window.WorkflowPrefillLogic.applyWorkflowPrefillGroups()` is available client-side without duplicating any field-mapping logic.

Markup:

```html
<div id="workflowPrefillBanner" class="prefill-banner" hidden>
  <p>พบข้อมูลจากเอกสารก่อนหน้าใน Workflow นี้ เลือกกลุ่มข้อมูลที่ต้องการนำมาใช้</p>
  <div id="workflowPrefillGroups"></div>
  <button type="button" id="workflowPrefillApply">ใช้ข้อมูลเดิม</button>
  <button type="button" id="workflowPrefillDismiss">กรอกใหม่</button>
</div>
```

Behavior in `forms/workflow-document.logic.browser.js`:

- `fetchWorkflowPrefill({ transactionNo, documentKind, stepId })` calls the endpoint above and returns `null` on any error (network failure, 404 before Task 7 lands, or a 400 from a step mismatch) instead of throwing, so a missing/not-yet-built endpoint never blocks the form from loading.
- `renderPrefillBanner(prefill)` is only called when `prefill.availableGroups.length > 0`; it renders one checkbox per group in `availableGroups` (Thai labels: `payee` → "ผู้รับเงิน/คู่ค้า", `purpose` → "วัตถุประสงค์", `lines` → "รายการ" — three groups total, per decision D10; there is no `totals` group), each labeled with its source document number from `prefill.sources[group]` (e.g. "ผู้รับเงิน/คู่ค้า (จาก PO-2026-09-0001)"), and un-hides `#workflowPrefillBanner`.
- Clicking `#workflowPrefillApply` reads the checked groups, calls `window.WorkflowPrefillLogic.applyWorkflowPrefillGroups(prefill.context, documentKind, checkedGroups)`, merges the returned patch onto the (still-blank) form fields, and visibly marks each populated field with its source document number (a small caption/badge next to the field, not a `readonly`/`disabled` attribute — prefilled values stay fully editable, per the never-a-lock rule in Global Constraints).
- Clicking `#workflowPrefillDismiss` hides the banner without touching any field.

Add matching assertions to `tests/workflow-document.html.test.mjs`:

```js
test("workflow document shell shows a prefill banner with apply/dismiss actions", async () => {
  const html = await readFile(new URL("../forms/workflow-document.html", import.meta.url), "utf8");
  assert.match(html, /workflow-prefill\.logic\.js/);
  assert.match(html, /id="workflowPrefillBanner"/);
  assert.match(html, /id="workflowPrefillApply"/);
  assert.match(html, /id="workflowPrefillDismiss"/);
  assert.match(html, /ใช้ข้อมูลเดิม/);
  assert.match(html, /กรอกใหม่/);
});
```

- [ ] **Step 11: Add this task's test to `scripts/test.sh`**

`test_workflow_packet_pdf` is not created until Task 10 — only register the Python test this task actually creates, so `./scripts/test.sh` keeps passing for Tasks 4 through 9 (Task 6 Cross-Document Prefill, Task 7 Workflow Template And Transaction Routes, Task 8 Workflow Template And Transaction Pages, and Task 9 Pass Workflow Context Into Existing Standalone Forms all add no Python test of their own):

```bash
(cd "$SCRIPT_DIR" && "$PYTHON_BIN" -m unittest test_substitute_receipt_pdf test_workflow_document_pdf -v)
```

- [ ] **Step 12: Run targeted tests**

Run:

```bash
/Users/tar/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/workflow-document.logic.test.mjs tests/workflow-document.html.test.mjs
PYTHONPATH=scripts /Users/tar/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 -m unittest test_workflow_document_pdf -v
```

Expected: PASS.

- [ ] **Step 13: Commit**

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

`refreshWorkflowTransaction()` loads the transaction, loads child documents, calls `deriveWorkflowProgress()`, rewrites JSON/markdown, regenerates packet PDF after Task 10, and returns the updated transaction.

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

Only `pdf` is an allowed `section` for a transaction folder. The transaction directory (Global Constraints, `documents/YYYY/MM/workflow-transactions/TXN-.../`) has three subfolders: `data/` (raw `workflow-transaction.json`, read through `getWorkflowTransaction()`/the JSON API), `working-md/` (the human-readable `workflow-summary.md` source, same rationale), and `pdf/` (the packet PDF generated in Task 10 — the only artifact meant to be downloaded by filename through this route). Do not add `data` or `working-md` to the allowed set: unlike `raw/` on expense-request, substitute-receipt, or lightweight-document folders, nothing in `data/`/`working-md/` is an uploaded or generated artifact meant for direct download — it is server-authored JSON/markdown already reachable through its own read path, so serving it by arbitrary filename would only add attack surface with no benefit.

Note for Task 7, which is the task that registers the HTTP route calling this function: at the time Task 7 runs, no task has generated a packet PDF yet (that is Task 10), so `pdf/` is legitimately always empty for a brand-new transaction. Task 7's own HTTP-level test therefore only proves traversal-rejection and a clean 404 for a plausible-but-nonexistent filename — it must not assert a successful download of packet content that does not exist yet. Task 10 adds the happy-path download test once it actually produces a file for this route to serve.

- [ ] **Step 9: Export workflow functions**

Add all functions listed in this task's interface to `module.exports`.

- [ ] **Step 10: Run tests**

Run: `/Users/tar/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/workflow-api.test.mjs`

Expected: PASS, except packet-related assertions should wait until Task 10, and prefill-related assertions should wait until Task 6.

- [ ] **Step 11: Commit**

```bash
git add forms/local-server.logic.js tests/workflow-api.test.mjs
git commit -m "feat: store workflow templates and transactions"
```

---

### Task 6: Cross-Document Prefill

**Why:** Within one workflow transaction, four or five documents describe the same purchase (`purchase_order` → `substitute_receipt` → `payment_voucher` → `goods_receipt`, or the expense-transfer/cash equivalents). Re-typing the payee, the purpose, and the line items across all of them is both the bulk of the user's work and the main source of documents disagreeing with each other. Decision D8 (`.superpowers/sdd/progress.md`, user-approved) puts cross-document reuse in scope, with the user choosing per group of fields whether to reuse or type fresh.

> **Deviation note (D8):** Cross-document prefill does not appear in `docs/superpowers/specs/2026-09-06-fixed-accounting-workflows-design.md` at all — it is a pure product-owner addition on top of the spec's existing standalone-document-reuse architecture. Nothing in the spec conflicts with it, so this is an addition, not a deviation from stated spec text. The spec file is left unedited, consistent with how this plan already treats D6.

> **Revision note (D10):** the first cut of this task made `expense_request` the only kind that could receive a `totals` group (applied as one seeded placeholder expense line) and the only kind that could never source or receive `lines`. The product owner rejected that in favor of `expense_request` participating in `lines` like every other kind, mapped line by line in both directions. This revision applies that ruling: `totals` is gone as a group entirely, and the field table, `RECEIVABLE_PREFILL_GROUPS`, the adapters, and the tests below all reflect the line-by-line mapping. Everything else about this task (the canonical-context design, the precedence rule, the never-auto-copied list, the deferred route wiring in Task 7) is unchanged.

**Design:** one canonical transaction context, not N-by-N pairwise mappings. Seven document kinds would mean 42 mappings; instead each kind gets exactly two small adapters — `toWorkflowContext(payload)` and `applyWorkflowContext(context, groups)` — for 14 functions total, growing linearly as new kinds are added.

Canonical shape, reconciled against the real payload builders (`buildExpensePayload()`/`calculateExpenseTotals()` in `forms/expense-request.logic.js`, `buildSubstituteReceiptPayload()` in `forms/substitute-receipt.logic.js`, and the lightweight `buildWorkflowDocumentPayload()` shell shared by `purchase_order`/`payment_voucher`/`cash_spend_declaration`/`payee_acknowledgement`/`goods_receipt`, spec'd in Task 4):

```
{
  payee:   { name, taxId, address, bankName, accountNo },
  purpose: { title, businessPurpose },
  lines:   [{ description, quantity, unitCost, lineTotal, stockSkuId }],
  parties: { requesterName, requesterRole },
  sources: { payee: "PO-2026-09-0001", lines: "SR-2026-09-0001", ... },
}
```

There is deliberately no `totals` group (D10). Every kind — `expense_request` included, now that it maps line-for-line like the rest — recomputes its own totals from its own lines when it saves (`calculateExpenseTotals()` for `expense_request`, the equivalent line-sum for every other kind), so an independently-carried total would only ever go stale between prefill and save. A caller that wants to *show* a reference total (e.g. "the source document totalled 1,070.00 บาท") can already do so today by looking up the source document via `sources.lines` and reading its own stored `totals` — nothing in this task needs to duplicate that number into the canonical context to make it displayable.

`payee`, `purpose`, `lines` are the three groups the user ticks independently (checkboxes in the UI, Task 4/Task 9). `parties` and `sources` are **not** user-tickable: `parties` (requester name/role) always rides along automatically whenever a source document supplies it, regardless of which of the three boxes the user checks — it is low-friction metadata about who is asking, not binding document content, so there is no reason to gate it behind a checkbox. `sources` is metadata for the UI (which document number supplied which group) and is always present.

Field-shape reconciliation, per kind — this is the actual field mapping the adapters below implement:

| Kind | `payee` source fields | `purpose` source fields | `lines` source fields | `parties` source fields |
|---|---|---|---|---|
| `expense_request` | `paymentTargetName`→name, `paymentBankName`→bankName, `paymentAccountNo`→accountNo (no `taxId`/`address` — not collected) | `requestTitle`→title, `businessPurpose` | `expenseLines[].{description,amountBeforeVat}` → one canonical line each: `description` verbatim, `quantity` fixed at `"1"`, `unitCost` and `lineTotal` both set to the expense line's `amountBeforeVat`, `stockSkuId` fixed at `""`. `vatAmount`/`withholdingTax` are dropped — the canonical line shape has no slot for them (D10) | `requesterName`, `requesterRole` |
| `substitute_receipt` | `payeeName`→name, `payeeTaxId`→taxId (no `bankName`/`accountNo` — only `paymentChannel`/`paymentReference`, not structured bank fields) | `receiptTitle`→title, `businessPurpose` | `lines[].{description,quantity,unitCost,lineTotal,stockSkuId}` (drops `vendorSku` — not part of the canonical shape) | **none** — no requester field on this document |
| `purchase_order` / `payment_voucher` / `cash_spend_declaration` / `payee_acknowledgement` / `goods_receipt` (generic `workflow-document` shell) | `payeeName`→name only (the generic shell, as spec'd in Task 4, has no `taxId`/`address`/`bankName`/`accountNo` fields — a known limitation of the lightweight shell, not of this adapter) | `title`, `businessPurpose` | `lines[].{description,quantity,unitCost,lineTotal,stockSkuId}` (`stockSkuId` is a small addition to Task 4's line shape — see the note at the end of this task) | `requesterName` only (no `requesterRole` field on the generic shell) |

**`expense_request`'s receiving direction (D10):** `applyWorkflowContextToExpenseRequest()` maps `context.lines` (when the `lines` group is requested) onto `expenseLines`, one canonical line to one expense line: `description` carried over verbatim, `amountBeforeVat` = the canonical line's `lineTotal`, and `vatAmount`/`withholdingTax` fixed at `"0.00"` — these six templates are all no-tax-invoice cases, so VAT is genuinely zero, and one row per real source line means the totals still reconcile line-for-line against the source document. The canonical `quantity`/`unitCost` have no target field on an expense line and are dropped.

**Note on Task 4:** Task 4's line item shape (`{ description, quantity, unitCost }`) needs one additional optional field, `stockSkuId`, so `goods_receipt` and `purchase_order` lines can carry a stock SKU reference the way `substitute_receipt` lines already do. Task 4 is not yet implemented, so add `stockSkuId: cleanText(line.stockSkuId)` (or equivalent) to `buildWorkflowDocumentPayload()`'s per-line normalization when Task 4 is built; this task's tests assume it is there.

**Precedence rule:** the most recently `completed` child document wins per field group; an earlier `completed` document only fills a group that no later `completed` document supplied. Recency is `completedAt` (ISO string, lexicographically comparable); documents with equal or missing `completedAt` are resolved by their position in the `childDocuments` array the caller passes in (stable order — callers pass documents in template step order, which is a reasonable proxy for recency when timestamps tie). Only documents whose **workflow** status (`normalizeDocumentWorkflowStatus()` from Task 2 — not native status) is `completed` are ever used as a source; this reuses the same hybrid `substitute_receipt` rule Task 2 already established rather than re-deriving completion here.

**Never auto-copied**, on any group, any kind: `documentNo`, `documentDate` (a prefilled document's date always defaults to today via the target form's own boot logic, never the source document's date), `status`, `statusHistory`, `completedAt`, `completedBy`, signature fields, evidence/raw file lists. This list is enforced **structurally**: no group in the canonical shape has a slot for any of these fields, and no adapter's `toWorkflowContext()` ever reads them onto the context — there is no downstream filter to bypass. `goods_receipt` line **quantities** are the one additional, kind-specific exclusion: `applyWorkflowContextToGoodsReceipt()` always clears `quantity` back to `""` on every line it applies, even though `description` and `stockSkuId` carry over, because a received quantity must reflect what actually arrived — prefilling it from the purchase order would hide a short delivery.

**Every kind can now receive every group (D10).** The original design excluded `expense_request` from `lines` and reserved `totals` for it alone; D10 replaced both exclusions with the line-by-line mapping above, so all seven kinds now source and receive the same three groups uniformly. `RECEIVABLE_PREFILL_GROUPS` is kept as a per-kind map (rather than one flat array) purely so a future document kind that genuinely cannot support one of these groups has somewhere to say so — today every entry is identical:

```js
const RECEIVABLE_PREFILL_GROUPS = {
  expense_request: ["payee", "purpose", "lines"],
  substitute_receipt: ["payee", "purpose", "lines"],
  purchase_order: ["payee", "purpose", "lines"],
  payment_voucher: ["payee", "purpose", "lines"],
  cash_spend_declaration: ["payee", "purpose", "lines"],
  payee_acknowledgement: ["payee", "purpose", "lines"],
  goods_receipt: ["payee", "purpose", "lines"],
};
```

**Files:**
- Create: `forms/workflow-prefill.logic.js`
- Create: `tests/workflow-prefill.logic.test.mjs`
- Modify: `forms/local-server.logic.js`
- Modify: `tests/workflow-api.test.mjs`

**Interfaces:**
- Produces: `PREFILL_GROUPS` (`["payee", "purpose", "lines"]`)
- Produces: `RECEIVABLE_PREFILL_GROUPS` (map of `documentKind` -> array of receivable group names, above)
- Produces adapters (14 functions): `expenseRequestToWorkflowContext` / `applyWorkflowContextToExpenseRequest`, `substituteReceiptToWorkflowContext` / `applyWorkflowContextToSubstituteReceipt`, `purchaseOrderToWorkflowContext` / `applyWorkflowContextToPurchaseOrder`, `paymentVoucherToWorkflowContext` / `applyWorkflowContextToPaymentVoucher`, `cashSpendDeclarationToWorkflowContext` / `applyWorkflowContextToCashSpendDeclaration`, `payeeAcknowledgementToWorkflowContext` / `applyWorkflowContextToPayeeAcknowledgement`, `goodsReceiptToWorkflowContext` / `applyWorkflowContextToGoodsReceipt`
- Produces: `WORKFLOW_CONTEXT_ADAPTERS` (registry: `documentKind` -> `{ toWorkflowContext, applyWorkflowContext }`)
- Produces: `buildWorkflowPrefillContext(childDocuments, targetDocumentKind, options)` -> `{ context, sources }`
- Produces: `applyWorkflowPrefillGroups(context, targetDocumentKind, groups)` -> a plain object of target-kind field names/values, ready to merge onto a fresh form draft
- Produces (in `forms/local-server.logic.js`): `getWorkflowTransactionPrefill({ rootDir, transactionNo, documentKind, stepId })` -> `{ context, sources, availableGroups }`
- Consumes: `normalizeDocumentWorkflowStatus` (Task 2, `forms/workflow.logic.js`)
- Consumes: `findWorkflowChildDocuments`, `getWorkflowTransaction` (Task 5, `forms/local-server.logic.js`)
- **Does not** register an HTTP route. `GET /api/workflow-transactions/:transactionNo/prefill` is added in Task 7 (Step 5), alongside every other `/api/workflow-transactions/...` route this plan can wire before a page needs it — Task 7 is the single place the plan wires the user-facing workflow-transaction HTTP surface. This lands two tasks after this one, not the five-plus tasks it would have taken in the original bottom-up ordering (see the reorder note at the top of Global Constraints). This task's own tests call `getWorkflowTransactionPrefill()` directly, the same way Task 5's tests call its storage functions directly before Task 7 exists.

- [ ] **Step 1: Write failing adapter and precedence tests**

```js
import assert from "node:assert/strict";
import test from "node:test";

import workflowPrefillLogic from "../forms/workflow-prefill.logic.js";

test("expense_request adapter extracts payee, purpose, parties, and lines mapped from expenseLines (D10)", () => {
  const context = workflowPrefillLogic.expenseRequestToWorkflowContext({
    requestTitle: "เบิกค่าส่งของ",
    businessPurpose: "ค่าส่งสินค้า",
    paymentTargetName: "คุณต้า",
    paymentBankName: "SCB",
    paymentAccountNo: "1112223334",
    requesterName: "คุณต้า",
    requesterRole: "ผู้จัดการ",
    expenseLines: [
      { description: "ค่าขนส่ง", amountBeforeVat: "100.00", vatAmount: "0.00", withholdingTax: "0.00" },
    ],
  });

  assert.deepEqual(context.payee, { name: "คุณต้า", bankName: "SCB", accountNo: "1112223334" });
  assert.deepEqual(context.purpose, { title: "เบิกค่าส่งของ", businessPurpose: "ค่าส่งสินค้า" });
  assert.deepEqual(context.parties, { requesterName: "คุณต้า", requesterRole: "ผู้จัดการ" });
  assert.deepEqual(context.lines, [
    { description: "ค่าขนส่ง", quantity: "1", unitCost: "100.00", lineTotal: "100.00", stockSkuId: "" },
  ]);
});

test("substitute_receipt adapter extracts payee name+taxId, purpose, and lines with stockSkuId", () => {
  const context = workflowPrefillLogic.substituteReceiptToWorkflowContext({
    receiptTitle: "",
    businessPurpose: "ซื้อวัสดุ",
    payeeName: "ร้านค้า A",
    payeeTaxId: "1234567890123",
    lines: [{ description: "กระดาษ", quantity: "5", unitCost: "20.00", lineTotal: "100.00", stockSkuId: "SKU-100", vendorSku: "V-9" }],
  });

  assert.deepEqual(context.payee, { name: "ร้านค้า A", taxId: "1234567890123" });
  assert.deepEqual(context.purpose, { businessPurpose: "ซื้อวัสดุ" });
  assert.deepEqual(context.lines, [{ description: "กระดาษ", quantity: "5", unitCost: "20.00", lineTotal: "100.00", stockSkuId: "SKU-100" }]);
  assert.equal(context.parties, undefined);
});

test("the five generic workflow-document adapters extract payee name, purpose, lines, and requesterName from the shared shell payload", () => {
  const payload = {
    title: "คืนเงินกรรมการ",
    businessPurpose: "คืนเงินสำรองจ่าย",
    payeeName: "กรรมการ",
    requesterName: "คุณต้า",
    lines: [{ description: "ค่าส่งเข้าคลัง", quantity: "1", unitCost: "120.00", lineTotal: "120.00", stockSkuId: "" }],
  };
  const adapters = [
    workflowPrefillLogic.purchaseOrderToWorkflowContext,
    workflowPrefillLogic.paymentVoucherToWorkflowContext,
    workflowPrefillLogic.cashSpendDeclarationToWorkflowContext,
    workflowPrefillLogic.payeeAcknowledgementToWorkflowContext,
    workflowPrefillLogic.goodsReceiptToWorkflowContext,
  ];
  for (const toWorkflowContext of adapters) {
    const context = toWorkflowContext(payload);
    assert.deepEqual(context.payee, { name: "กรรมการ" });
    assert.deepEqual(context.purpose, { title: "คืนเงินกรรมการ", businessPurpose: "คืนเงินสำรองจ่าย" });
    assert.deepEqual(context.lines, [{ description: "ค่าส่งเข้าคลัง", quantity: "1", unitCost: "120.00", lineTotal: "120.00", stockSkuId: "" }]);
    assert.deepEqual(context.parties, { requesterName: "คุณต้า" });
  }
});

test("applyWorkflowContextToGoodsReceipt clears quantity while keeping description and stockSkuId", () => {
  const context = {
    lines: [{ description: "กระดาษ A4", quantity: "10", unitCost: "120.00", lineTotal: "1200.00", stockSkuId: "SKU-001" }],
  };
  const patch = workflowPrefillLogic.applyWorkflowContextToGoodsReceipt(context, ["lines"]);

  assert.equal(patch.lines[0].description, "กระดาษ A4");
  assert.equal(patch.lines[0].stockSkuId, "SKU-001");
  assert.equal(patch.lines[0].quantity, "");
});

test("applyWorkflowContextToExpenseRequest maps payee/purpose fields and one expenseLines entry per canonical line (D10)", () => {
  const context = {
    payee: { name: "คุณต้า", bankName: "SCB", accountNo: "1112223334" },
    purpose: { title: "เบิกค่าส่ง", businessPurpose: "ค่าส่งสินค้า" },
    lines: [{ description: "ค่าขนส่งเข้าคลัง", quantity: "1", unitCost: "100.00", lineTotal: "100.00", stockSkuId: "" }],
  };
  const patch = workflowPrefillLogic.applyWorkflowContextToExpenseRequest(context, ["payee", "purpose", "lines"]);

  assert.equal(patch.paymentTargetName, "คุณต้า");
  assert.equal(patch.paymentBankName, "SCB");
  assert.equal(patch.paymentAccountNo, "1112223334");
  assert.equal(patch.requestTitle, "เบิกค่าส่ง");
  assert.equal(patch.businessPurpose, "ค่าส่งสินค้า");
  assert.deepEqual(patch.expenseLines, [
    { description: "ค่าขนส่งเข้าคลัง", amountBeforeVat: "100.00", vatAmount: "0.00", withholdingTax: "0.00" },
  ]);
});

test("expense_request lines round-trip: sourcing maps one canonical line per expenseLines entry, receiving maps back with VAT/withholding zeroed and description preserved (D10)", () => {
  const sourceContext = workflowPrefillLogic.expenseRequestToWorkflowContext({
    expenseLines: [
      { description: "ค่าขนส่งเข้าคลัง", amountBeforeVat: "250.00", vatAmount: "17.50", withholdingTax: "5.00" },
      { description: "ค่าบรรจุภัณฑ์", amountBeforeVat: "80.00", vatAmount: "0.00", withholdingTax: "0.00" },
    ],
  });

  assert.deepEqual(sourceContext.lines, [
    { description: "ค่าขนส่งเข้าคลัง", quantity: "1", unitCost: "250.00", lineTotal: "250.00", stockSkuId: "" },
    { description: "ค่าบรรจุภัณฑ์", quantity: "1", unitCost: "80.00", lineTotal: "80.00", stockSkuId: "" },
  ]);

  const patch = workflowPrefillLogic.applyWorkflowContextToExpenseRequest({ lines: sourceContext.lines }, ["lines"]);

  // Descriptions survive verbatim, and VAT/withholding land at zero even though the
  // original expense lines had nonzero VAT/withholding — these six templates are all
  // no-tax-invoice cases, so VAT is genuinely zero on a prefilled line (D10).
  assert.deepEqual(patch.expenseLines, [
    { description: "ค่าขนส่งเข้าคลัง", amountBeforeVat: "250.00", vatAmount: "0.00", withholdingTax: "0.00" },
    { description: "ค่าบรรจุภัณฑ์", amountBeforeVat: "80.00", vatAmount: "0.00", withholdingTax: "0.00" },
  ]);
});

test("buildWorkflowPrefillContext lets the most recently completed document win per group; earlier ones fill the rest", () => {
  const po = {
    documentKind: "purchase_order",
    documentNo: "PO-2026-09-0001",
    status: "completed",
    completedAt: "2026-09-01T08:00:00.000Z",
    title: "สั่งซื้อวัสดุ",
    businessPurpose: "ซื้อวัสดุสำนักงาน",
    payeeName: "ร้านค้า A",
    lines: [{ description: "กระดาษ", quantity: "10", unitCost: "100.00", lineTotal: "1000.00" }],
  };
  const sr = {
    documentKind: "substitute_receipt",
    documentNo: "SR-2026-09-0001",
    status: "completed",
    receiptType: "general_expense",
    completedAt: "2026-09-02T08:00:00.000Z",
    payeeName: "ร้านค้า B",
    payeeTaxId: "1234567890123",
    businessPurpose: "",
    lines: [{ description: "หมึกพิมพ์", quantity: "2", unitCost: "50.00", lineTotal: "100.00" }],
  };

  const { context, sources } = workflowPrefillLogic.buildWorkflowPrefillContext([po, sr], "payment_voucher");

  // sr completed after po, so sr's payee and lines win.
  assert.equal(context.payee.name, "ร้านค้า B");
  assert.equal(sources.payee, "SR-2026-09-0001");
  assert.deepEqual(context.lines.map((line) => line.description), ["หมึกพิมพ์"]);
  assert.equal(sources.lines, "SR-2026-09-0001");
  // sr supplied an empty businessPurpose, so po's non-empty purpose fills the gap.
  assert.equal(context.purpose.businessPurpose, "ซื้อวัสดุสำนักงาน");
  assert.equal(sources.purpose, "PO-2026-09-0001");
});

test("buildWorkflowPrefillContext ignores documents that are not workflow-completed", () => {
  const draftPo = {
    documentKind: "purchase_order",
    documentNo: "PO-2026-09-0002",
    status: "draft",
    payeeName: "ร้านค้า C",
    businessPurpose: "ไม่ควรถูกใช้",
    lines: [{ description: "ไม่ควรถูกใช้", quantity: "1", unitCost: "1.00", lineTotal: "1.00" }],
  };

  const { context, sources } = workflowPrefillLogic.buildWorkflowPrefillContext([draftPo], "payment_voucher");

  assert.deepEqual(context.payee, {});
  assert.deepEqual(context.lines, []);
  assert.deepEqual(sources, {});
});

test("buildWorkflowPrefillContext groups never carry excluded fields like documentNo, status, or signatures", () => {
  const source = {
    documentKind: "expense_request",
    requestNo: "REQ-2026-09-0001",
    documentDate: "2026-09-01",
    status: "completed",
    statusHistory: [{ status: "completed" }],
    completedAt: "2026-09-05T10:00:00.000Z",
    completedBy: "บัญชี",
    signature: "base64...",
    evidenceFiles: { receipt: [{ name: "a.jpg" }] },
    rawFiles: [{ name: "a.jpg" }],
    workflowStepId: "step-001",
    transactionNo: "TXN-2026-09-0001",
    requestTitle: "เบิกค่าส่ง",
    businessPurpose: "ค่าส่งสินค้า",
    paymentTargetName: "คุณต้า",
    paymentBankName: "SCB",
    paymentAccountNo: "1234567890",
    requesterName: "คุณต้า",
    requesterRole: "ผู้จัดการ",
    expenseLines: [
      { description: "เบิกค่าส่ง", amountBeforeVat: "100.00", vatAmount: "7.00", withholdingTax: "0.00", vendorInvoiceNo: "INV-001" },
    ],
  };

  const { context } = workflowPrefillLogic.buildWorkflowPrefillContext([source], "expense_request");

  assert.deepEqual(Object.keys(context.payee).sort(), ["accountNo", "bankName", "name"]);
  assert.deepEqual(Object.keys(context.purpose).sort(), ["businessPurpose", "title"]);
  assert.equal(context.payee.documentNo, undefined);
  assert.equal(context.purpose.status, undefined);
  // The canonical line shape has no room for vatAmount/withholdingTax or any extra
  // per-line field the source document happened to carry (e.g. vendorInvoiceNo).
  assert.deepEqual(Object.keys(context.lines[0]).sort(), ["description", "lineTotal", "quantity", "stockSkuId", "unitCost"]);
});

test("RECEIVABLE_PREFILL_GROUPS: every kind can receive payee, purpose, and lines; totals is not a group at all (D10)", () => {
  for (const kind of Object.keys(workflowPrefillLogic.RECEIVABLE_PREFILL_GROUPS)) {
    assert.deepEqual(workflowPrefillLogic.RECEIVABLE_PREFILL_GROUPS[kind].slice().sort(), ["lines", "payee", "purpose"]);
  }
  assert.deepEqual(workflowPrefillLogic.PREFILL_GROUPS.slice().sort(), ["lines", "payee", "purpose"]);
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `/Users/tar/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/workflow-prefill.logic.test.mjs`

Expected: FAIL because `forms/workflow-prefill.logic.js` does not exist.

- [ ] **Step 3: Implement the per-kind adapters and the registry**

Implement the 14 functions per the field table above. Every `toWorkflowContext()` only sets a group key when at least one field in that group is non-blank (skip the group entirely — leave it `undefined` — when the source document has nothing to offer, e.g. `substitute_receipt` with a blank `receiptTitle` and blank `businessPurpose` produces no `purpose` key at all, not `{ title: "", businessPurpose: "" }`). `purchaseOrderToWorkflowContext`, `paymentVoucherToWorkflowContext`, `cashSpendDeclarationToWorkflowContext`, `payeeAcknowledgementToWorkflowContext`, and `goodsReceiptToWorkflowContext` may all delegate to one shared internal helper (they read an identical payload shape) but must still be exported under their own five names — `WORKFLOW_CONTEXT_ADAPTERS` dispatches on `documentKind`, so each kind needs its own registry entry even when the implementation is shared.

`applyWorkflowContextToGoodsReceipt()` wraps the shared generic `applyWorkflowContext` and then maps `quantity` to `""` on every line, per the never-copied rule above.

`expenseRequestToWorkflowContext()` (D10) maps `expenseLines` onto `lines`: each entry becomes one canonical line with `description` carried over verbatim, `quantity` fixed at `"1"`, `unitCost` and `lineTotal` both set to the expense line's `amountBeforeVat` (so the `unitCost * quantity = lineTotal` invariant every other adapter's lines already satisfy still holds), and `stockSkuId` fixed at `""` (expense lines carry no SKU reference). `vatAmount`/`withholdingTax` are dropped — the canonical line shape has no slot for them. `applyWorkflowContextToExpenseRequest()` (D10) maps `payee`/`purpose` onto `paymentTargetName`/`paymentBankName`/`paymentAccountNo`/`requestTitle`/`businessPurpose` directly, and maps `lines` (when requested) onto `expenseLines`, one canonical line to one expense line: `description` carried over verbatim, `amountBeforeVat` set to the canonical line's `lineTotal`, and `vatAmount`/`withholdingTax` both fixed at `"0.00"` — these six templates are all no-tax-invoice cases, so VAT is genuinely zero on every prefilled line, and one row per source line keeps the totals reconciling line-for-line. `quantity`/`unitCost` have no target field on an expense line and are dropped. Neither function ever reads or writes a `totals` field — there is no such group any more (D10).

Assemble `WORKFLOW_CONTEXT_ADAPTERS` keyed by `documentKind`.

- [ ] **Step 4: Implement `buildWorkflowPrefillContext()`**

```js
function isGroupNonEmpty(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (!value || typeof value !== "object") return false;
  return Object.values(value).some((field) => field !== undefined && field !== null && field !== "");
}

function buildWorkflowPrefillContext(childDocuments = [], targetDocumentKind, options = {}) {
  const context = { payee: {}, purpose: {}, lines: [], parties: {} };
  const sources = {};

  const completedInOrder = childDocuments
    .map((doc, index) => ({ doc, index, normalized: normalizeDocumentWorkflowStatus(doc) }))
    .filter((entry) => entry.normalized.workflowStatus === "completed")
    .sort((a, b) => {
      const left = a.doc.completedAt || "";
      const right = b.doc.completedAt || "";
      if (left === right) return a.index - b.index;
      return left < right ? -1 : 1;
    });

  for (const { doc, normalized } of completedInOrder) {
    const adapter = WORKFLOW_CONTEXT_ADAPTERS[doc.documentKind];
    if (!adapter) continue;
    const partial = adapter.toWorkflowContext(doc);
    for (const group of ["payee", "purpose", "parties"]) {
      if (isGroupNonEmpty(partial[group])) {
        context[group] = partial[group];
        sources[group] = normalized.documentNo;
      }
    }
    if (isGroupNonEmpty(partial.lines)) {
      context.lines = partial.lines;
      sources.lines = normalized.documentNo;
    }
  }

  return { context, sources };
}
```

Iterating oldest-to-newest and always overwriting on a non-empty group naturally yields "most recent wins, earlier fills the gaps": a later document's non-empty group always overwrites; a group no later document supplies keeps whatever the earliest supplying document set.

- [ ] **Step 5: Implement `applyWorkflowPrefillGroups()`**

```js
function applyWorkflowPrefillGroups(context, targetDocumentKind, groups = []) {
  const adapter = WORKFLOW_CONTEXT_ADAPTERS[targetDocumentKind];
  if (!adapter) return {};
  const receivable = RECEIVABLE_PREFILL_GROUPS[targetDocumentKind] || [];
  const requested = groups.filter((group) => receivable.includes(group));
  const filteredContext = {
    ...Object.fromEntries(requested.map((group) => [group, context[group]])),
    parties: context.parties, // always applied when present, never user-tickable
  };
  return adapter.applyWorkflowContext(filteredContext, requested);
}
```

- [ ] **Step 6: Implement `getWorkflowTransactionPrefill()` in `forms/local-server.logic.js`**

```js
async function getWorkflowTransactionPrefill({ rootDir, transactionNo, documentKind, stepId }) {
  const transaction = await getWorkflowTransaction(rootDir, transactionNo);
  if (!transaction) throw new Error("ไม่พบ Workflow transaction");

  const step = transaction.steps.find((item) => item.stepId === stepId);
  if (!step) throw new Error("ไม่พบขั้นตอนนี้ใน Workflow");
  if (documentKind && documentKind !== step.documentKind) {
    throw new Error("ประเภทเอกสารไม่ตรงกับขั้นตอนนี้");
  }

  const childDocuments = await findWorkflowChildDocuments(rootDir, transactionNo);
  const siblingDocuments = childDocuments.filter((doc) => doc.workflowStepId !== stepId);
  const { context, sources } = buildWorkflowPrefillContext(siblingDocuments, step.documentKind);
  const availableGroups = (RECEIVABLE_PREFILL_GROUPS[step.documentKind] || [])
    .filter((group) => Object.prototype.hasOwnProperty.call(sources, group));

  return { context, sources, availableGroups };
}
```

A document never sources prefill data from its own step (the `siblingDocuments` filter) — mainly relevant if a step is ever re-opened after already having a child document. Import `buildWorkflowPrefillContext` and `RECEIVABLE_PREFILL_GROUPS` from `./workflow-prefill.logic.js` alongside the existing `./workflow.logic.js` import.

- [ ] **Step 7: Export functions**

Add all functions/constants listed in this task's Interfaces to `module.exports` in both `forms/workflow-prefill.logic.js` (with the `window.WorkflowPrefillLogic` browser fallback) and `forms/local-server.logic.js` (`getWorkflowTransactionPrefill`).

- [ ] **Step 8: Add server-level tests to `tests/workflow-api.test.mjs`**

```js
test("getWorkflowTransactionPrefill builds context from completed sibling documents and reports availableGroups", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-workflow-"));
  try {
    const txn = await serverLogic.startWorkflowTransaction({
      rootDir,
      templateId: "stock_no_tax_invoice_company_bank",
      accountingMonth: "2026-09",
      title: "ทดสอบ prefill",
    });
    const po = await serverLogic.saveWorkflowDocument({
      rootDir,
      payload: {
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
      },
    });
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
```

- [ ] **Step 9: Run tests**

Run:

```bash
/Users/tar/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/workflow-prefill.logic.test.mjs tests/workflow-api.test.mjs
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add forms/workflow-prefill.logic.js tests/workflow-prefill.logic.test.mjs forms/local-server.logic.js tests/workflow-api.test.mjs
git commit -m "feat: build cross-document prefill context for workflow transactions"
```

---

### Task 7: Workflow Template And Transaction Routes

**Why now (reorder rationale):** Tasks 1-6 already committed every storage/derivation function this task's routes call: `listWorkflowDocumentTypes()`, `listWorkflowTemplates()`, `saveWorkflowTemplate()`, `getNextWorkflowTransactionInfo()`, `startWorkflowTransaction()`, `listWorkflowTransactions()`, `getWorkflowTransaction()`, `refreshWorkflowTransaction()`, `getWorkflowTransactionFile()` (Task 5), and `getWorkflowTransactionPrefill()` (Task 6). Only the HTTP routes and the pages are missing, and until they exist nothing in this feature is reachable by an actual user. This task wires the routes; Task 8 builds the pages in front of them. Routes for functionality that does not exist yet are registered later, by the task that builds that functionality: transaction completion/sync (`/complete`, `/sync-drive`) is new Task 11's job, not this task's. The packet PDF this task's file-download route will eventually serve is not generated until new Task 10 — see Step 6.

**Files:**
- Modify: `local-server.mjs`
- Test: `tests/workflow-api.test.mjs`

**Interfaces:**
- Consumes server logic from Task 5 (storage) and Task 6 (prefill).
- Produces API routes:
  - `GET /api/workflow-document-types`
  - `GET /api/workflow-templates`, `POST /api/workflow-templates`
  - `GET /api/workflow-transactions/next?accountingMonth=YYYY-MM`
  - `GET /api/workflow-transactions`, `POST /api/workflow-transactions`
  - `GET /api/workflow-transactions/:transactionNo`
  - `POST /api/workflow-transactions/:transactionNo/refresh`
  - `POST /api/workflow-transactions/:transactionNo/start-document/:stepId`
  - `GET /api/workflow-transactions/:transactionNo/prefill?documentKind=...&stepId=...`
  - `GET /api/workflow-transactions/:transactionNo/files/:section/:fileName`

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
  assert.match(source, /getWorkflowTransactionPrefill/);
  assert.match(source, /\/prefill/);
  assert.match(source, /getWorkflowTransactionFile/);
  // Completion/sync routes are new Task 11's job -- they do not exist yet.
  assert.doesNotMatch(source, /completeWorkflowTransaction/);
  assert.doesNotMatch(source, /syncWorkflowTransactionToDrive/);
  assert.doesNotMatch(source, /syncWorkflowTransactionToSheets/);
  assert.doesNotMatch(source, /\/sync-sheets/);
});

test("starting a document for a locked step is refused server-side", async () => {
  // Decision D5 (.superpowers/sdd/progress.md): the strict document order is
  // enforced by the server, not only hidden/disabled in the UI. Decision D7
  // additionally requires the handler to call refreshWorkflowTransaction()
  // first and compare stepId against the freshly derived currentStepId, not
  // a stale persisted value -- so a child document completed moments earlier
  // unlocks the next step without the caller pressing refresh first. Attempting
  // start-document on any step other than the freshly-derived current step
  // must be refused with a JSON error in the existing sendJson() style, and
  // must not return a document start URL. Follows the
  // spawn/waitForServer/requestJsonResponse pattern already used in
  // tests/substitute-receipt-api.test.mjs.
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-workflow-api-"));
  const port = 19195;
  const baseUrl = `http://localhost:${port}`;
  const child = spawn(process.execPath, ["local-server.mjs"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, PORT: String(port), SWEET_HOUSE_ROOT_DIR: rootDir },
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    await waitForServer(child);

    const { body: txn } = await requestJsonResponse(baseUrl, "/api/workflow-transactions", {
      method: "POST",
      body: JSON.stringify({
        templateId: "stock_no_tax_invoice_company_bank",
        accountingMonth: "2026-09",
        title: "ทดสอบล็อกลำดับเอกสาร",
      }),
    });
    // txn.currentStepId is "step-001" (purchase_order); step-002 (substitute_receipt) is locked.
    assert.equal(txn.currentStepId, "step-001");

    const { response, body } = await requestJsonResponse(baseUrl, `/api/workflow-transactions/${txn.transactionNo}/start-document/step-002`, {
      method: "POST",
    });
    assert.equal(response.ok, false);
    assert.equal(response.status, 400);
    assert.match(body.error, /ยังไม่ถึงลำดับ|ลำดับเอกสาร|ขั้นตอนนี้ยังไม่เปิด/);
    assert.equal(body.url, undefined);

    // The unlocked step must still be startable.
    const { response: okResponse } = await requestJsonResponse(baseUrl, `/api/workflow-transactions/${txn.transactionNo}/start-document/step-001`, {
      method: "POST",
    });
    assert.equal(okResponse.ok, true);
  } finally {
    child.kill();
    await rm(rootDir, { recursive: true, force: true });
  }
});
```

This test needs the same `spawn`, `waitForServer`, and `requestJsonResponse` helpers already present at the top of `tests/substitute-receipt-api.test.mjs` — reuse that exact pattern in `tests/workflow-api.test.mjs` (add the helpers if this test file doesn't already have them from an earlier task) rather than inventing a second convention for spawning the server.

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
getWorkflowTransactionPrefill,
```

Do not import `completeWorkflowTransaction` or `syncWorkflowTransactionToDrive` here — they do not exist until Task 11. Do not import `syncWorkflowTransactionToSheets` anywhere — it never exists (decision D6).

- [ ] **Step 4: Add API handlers**

Follow existing `sendJson()` error style. Add handlers for: listing document types, listing/saving templates, next transaction number, listing/starting/getting transactions, refreshing a transaction, starting a child document, and reading a transaction's cross-document prefill context (`getWorkflowTransactionPrefill`, Task 6).

For `start-document`, enforce the strict-order rule per decisions D5 and D7 (`.superpowers/sdd/progress.md`) before building the start URL:

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

The `start-document` handler must:

1. Call `refreshWorkflowTransaction({ rootDir, transactionNo })` **first** — decision D7: a child document completed moments earlier should unlock the next step without the caller pressing refresh separately, so the handler always re-derives progress from the current child-document states before deciding anything. 404 if the transaction does not exist.
2. Look up the requested step in the *refreshed* `transaction.steps` by `stepId`; 404 if the step doesn't exist on this transaction/template.
3. Compare `stepId` against the refreshed transaction's `currentStepId` — the value this same call to `refreshWorkflowTransaction()` just computed, never a previously-persisted value. If they don't match, respond with `sendJson(res, 400, { error: "ยังไม่ถึงลำดับเอกสารนี้ ต้องทำเอกสารก่อนหน้าให้เสร็จก่อน" })` (or an equivalent Thai message) and return — do not build or return a start URL.
4. Otherwise build and return `{ url: buildWorkflowDocumentStartUrl(transaction, step) }`.

This refusal is the server-side half of decision D5: a client that bypasses the UI's disabled buttons and calls `start-document` directly for a locked step must still be turned away. Decision D7 is why the comparison is against a value derived fresh in this same request, not the transaction's last-persisted `currentStepId`.

- [ ] **Step 5: Add the prefill GET route**

`GET /api/workflow-transactions/:transactionNo/prefill?documentKind=<kind>&stepId=<stepId>` is registered here, as soon as both the storage layer (Task 5) and the prefill logic (Task 6) it calls exist:

```js
if (req.method === "GET" && pathname.match(/^\/api\/workflow-transactions\/[^/]+\/prefill$/)) {
  const transactionNo = decodeURIComponent(pathname.split("/")[3]);
  const documentKind = url.searchParams.get("documentKind") || "";
  const stepId = url.searchParams.get("stepId") || "";
  try {
    const prefill = await getWorkflowTransactionPrefill({ rootDir, transactionNo, documentKind, stepId });
    return sendJson(res, 200, prefill);
  } catch (error) {
    return sendJson(res, 400, { error: error.message });
  }
}
```

Add a failing-then-passing test to `tests/workflow-api.test.mjs` using the same `spawn`/`waitForServer`/`requestJsonResponse` helpers as the `start-document` test above:

```js
test("GET .../prefill returns context, sources, and availableGroups for the requested step", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-workflow-api-"));
  const port = 19196;
  const baseUrl = `http://localhost:${port}`;
  const child = spawn(process.execPath, ["local-server.mjs"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, PORT: String(port), SWEET_HOUSE_ROOT_DIR: rootDir },
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    await waitForServer(child);

    const { body: txn } = await requestJsonResponse(baseUrl, "/api/workflow-transactions", {
      method: "POST",
      body: JSON.stringify({
        templateId: "stock_no_tax_invoice_company_bank",
        accountingMonth: "2026-09",
        title: "ทดสอบ prefill ผ่าน HTTP",
      }),
    });

    const { body: startResult } = await requestJsonResponse(baseUrl, `/api/workflow-transactions/${txn.transactionNo}/start-document/step-001`, {
      method: "POST",
    });
    assert.ok(startResult.url);

    const { response, body: prefill } = await requestJsonResponse(
      baseUrl,
      `/api/workflow-transactions/${txn.transactionNo}/prefill?documentKind=substitute_receipt&stepId=step-002`,
    );
    assert.equal(response.ok, true);
    assert.deepEqual(prefill.availableGroups, []);
    assert.deepEqual(prefill.sources, {});
  } finally {
    child.kill();
    await rm(rootDir, { recursive: true, force: true });
  }
});
```

(No completed sibling document exists yet in this test, so `availableGroups`/`sources` are empty — this test only proves the route is wired end-to-end. Step 7 below adds a second test with a real completed sibling document, to prove the prefill banner Task 4 already built has real data to show.)

- [ ] **Step 6: Add the transaction file-download route**

`GET /api/workflow-transactions/:transactionNo/files/:section/:fileName` calls `getWorkflowTransactionFile({ rootDir, transactionNo, section, fileName })` (Task 5) and streams `absolutePath`, returning 404 on any thrown error — same shape as the existing expense-request/substitute-receipt/workflow-document file routes.

**Reality check:** `getWorkflowTransactionFile()` only allows `section: "pdf"`, and no task before Task 10 ever writes anything into a transaction's `pdf/` folder — the packet PDF does not exist yet. So at this point in the plan, this route can only ever legitimately 404 (or reject a traversal attempt); it has no successful-download case to test yet. Write the test accordingly, not against a file no task has produced:

```js
test("GET .../files/:section/:fileName rejects traversal and 404s for a file that does not exist yet", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-workflow-api-"));
  const port = 19197;
  const baseUrl = `http://localhost:${port}`;
  const child = spawn(process.execPath, ["local-server.mjs"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, PORT: String(port), SWEET_HOUSE_ROOT_DIR: rootDir },
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    await waitForServer(child);

    const { body: txn } = await requestJsonResponse(baseUrl, "/api/workflow-transactions", {
      method: "POST",
      body: JSON.stringify({
        templateId: "director_expense_cash",
        accountingMonth: "2026-09",
        title: "ทดสอบไฟล์ transaction",
      }),
    });

    const traversal = await fetch(`${baseUrl}/api/workflow-transactions/${txn.transactionNo}/files/pdf/..%2Fdata%2Fworkflow-transaction.json`);
    assert.equal(traversal.status, 404);

    // No packet PDF exists until Task 10 generates one -- this is the
    // correct, reality-matching outcome for this task, not a bug to work
    // around.
    const missing = await fetch(`${baseUrl}/api/workflow-transactions/${txn.transactionNo}/files/pdf/99_${encodeURIComponent("ชุดรวมเอกสาร")}_workflow-transaction.pdf`);
    assert.equal(missing.status, 404);
  } finally {
    child.kill();
    await rm(rootDir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 7: Verify the cross-document prefill banner end to end**

Task 4 already added a prefill banner to `forms/workflow-document.html` (Task 9 later adds the same banner to `forms/expense-request.html`/`forms/substitute-receipt.html`); until now its fetch to `GET /api/workflow-transactions/:transactionNo/prefill` has always 404'd, so the banner has never actually appeared. Now that this task wires the route, prove the whole path works with real data — not just that the route responds, but that it responds with something the banner will render:

```js
test("GET .../prefill returns real availableGroups once an earlier step has a completed document", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-workflow-api-"));
  const port = 19198;
  const baseUrl = `http://localhost:${port}`;
  const child = spawn(process.execPath, ["local-server.mjs"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, PORT: String(port), SWEET_HOUSE_ROOT_DIR: rootDir },
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    await waitForServer(child);

    const { body: txn } = await requestJsonResponse(baseUrl, "/api/workflow-transactions", {
      method: "POST",
      body: JSON.stringify({
        templateId: "stock_no_tax_invoice_company_bank",
        accountingMonth: "2026-09",
        title: "ทดสอบ banner ปรากฏจริง",
      }),
    });

    await requestJsonResponse(baseUrl, `/api/workflow-transactions/${txn.transactionNo}/start-document/step-001`, { method: "POST" });

    const { body: po } = await requestJsonResponse(baseUrl, "/api/workflow-documents", {
      method: "POST",
      body: JSON.stringify({
        documentKind: "purchase_order",
        accountingMonth: "2026-09",
        documentDate: "2026-09-07",
        title: "สั่งซื้อวัสดุ",
        requesterName: "คุณต้า",
        payeeName: "ร้านค้า A",
        businessPurpose: "ซื้อวัสดุสำนักงาน",
        lines: [{ description: "กระดาษ A4", quantity: "10", unitCost: "100.00" }],
        transactionNo: txn.transactionNo,
        workflowTemplateId: txn.templateSnapshot.templateId,
        workflowStepId: txn.steps[0].stepId,
      }),
    });
    await requestJsonResponse(baseUrl, `/api/workflow-documents/purchase_order/${po.documentNo}/complete`, {
      method: "POST",
      body: JSON.stringify({ completedBy: "บัญชี" }),
    });

    const { response, body: prefill } = await requestJsonResponse(
      baseUrl,
      `/api/workflow-transactions/${txn.transactionNo}/prefill?documentKind=substitute_receipt&stepId=${txn.steps[1].stepId}`,
    );
    assert.equal(response.ok, true);
    // This is what forms/workflow-document.html's banner has been fetching
    // and silently discarding since Task 4 -- it now has real content to show.
    assert.ok(prefill.availableGroups.length > 0);
    assert.equal(prefill.sources.payee, po.documentNo);
  } finally {
    child.kill();
    await rm(rootDir, { recursive: true, force: true });
  }
});
```

Match the exact `POST /api/workflow-documents` and `.../complete` request/response shapes already established by `tests/workflow-document-api.test.mjs` (Task 4) — this test reuses Task 4's existing lightweight-document HTTP surface, it does not invent a new one.

- [ ] **Step 8: Run tests**

Run: `/Users/tar/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/workflow-api.test.mjs`

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add local-server.mjs tests/workflow-api.test.mjs
git commit -m "feat: expose workflow template and transaction routes"
```

---

### Task 8: Workflow Template And Transaction Pages

**Why now (reorder rationale):** Every route this page needs already exists as of Task 7. This task is what actually makes the feature usable: a real user can create a template, start a transaction, and watch the checklist advance after this task lands — instead of waiting until task eleven of twelve, as the original bottom-up plan required. The transaction detail page built here intentionally has no packet-PDF link, no "complete transaction" button, and no Drive-sync section yet: Task 10 adds the packet link once it generates packet PDFs, and Task 11 adds the complete button and sync section once it implements transaction completion and sync. Both of those tasks extend the page this task creates; they do not create a new one.

**Files:**
- Create: `forms/workflow-templates.html`
- Create: `forms/workflow-transactions.html`
- Create: `forms/workflow-transaction.html`
- Create: `forms/workflow.logic.browser.js`
- Modify: `local-server.mjs` (static page routes only — the API routes already exist from Task 7)
- Modify: `forms/index.html`
- Create: `tests/workflow-pages.html.test.mjs`
- Create: `tests/navigation.html.test.mjs` (covers `forms/index.html` only here; Task 12 extends it to the other major pages)

**Interfaces:**
- Consumes API routes from Task 7.
- Produces usable MVP pages, reachable from `forms/index.html`.

- [ ] **Step 1: Write failing HTML tests**

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("workflow template page edits document order and the Drive sync toggle", async () => {
  const html = await readFile(new URL("../forms/workflow-templates.html", import.meta.url), "utf8");
  assert.match(html, /ตั้งค่า Workflow Template/);
  assert.match(html, /\/api\/workflow-document-types/);
  assert.match(html, /\/api\/workflow-templates/);
  assert.match(html, /syncGoogleDrive/);
  assert.match(html, /documentSteps/);
  assert.doesNotMatch(html, /syncGoogleSheets/);
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
  // Packet link and complete/sync UI do not exist until Task 10/Task 11.
  assert.doesNotMatch(html, /id="syncDriveButton"/);
  assert.doesNotMatch(html, /id="driveSyncStatus"/);
});
```

Add a new `tests/navigation.html.test.mjs`:

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("home page links to workflow group pages", async () => {
  const html = await readFile(new URL("../forms/index.html", import.meta.url), "utf8");
  assert.match(html, /href="\/workflow-transactions"/);
  assert.match(html, /href="\/workflow-templates"/);
});
```

- [ ] **Step 2: Run HTML tests to verify failure**

Run: `/Users/tar/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/workflow-pages.html.test.mjs tests/navigation.html.test.mjs`

Expected: FAIL because the pages do not exist and `forms/index.html` has no workflow links yet.

- [ ] **Step 3: Build template page**

Use existing topbar/menu styles. UI controls:

- template selector
- template name input
- description textarea
- Google Drive sync checkbox (the only workflow-level sync toggle — there is no Google Sheets sync checkbox; decision D6)
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
- PDF/raw file links grouped by child document (each child document's own PDFs/raw files — not a transaction-level packet, which does not exist until Task 10)

Do not add a packet-PDF link, a "complete transaction" button, or any Drive-sync markup in this task — Task 10 and Task 11 each add their own piece to this same page once their backing logic and routes exist. Adding placeholder markup for them here would just be dead UI a later task has to find and rewrite.

- [ ] **Step 6: Implement browser controller**

`forms/workflow.logic.browser.js` must include:

```js
async function fetchJson(url, options = {}) { /* throw on !ok with Thai-friendly error */ }
function getQueryParam(name) { /* URLSearchParams helper */ }
function renderTemplateEditor(documentTypes, templates) { /* template page */ }
function collectTemplatePayload() { /* ordered document kinds + sync toggle */ }
async function saveTemplate() { /* POST /api/workflow-templates */ }
async function startTransaction() { /* POST /api/workflow-transactions */ }
async function loadTransaction() { /* GET transaction by transactionNo */ }
async function refreshTransaction() { /* POST refresh */ }
async function startDocument(stepId) { /* POST start-document and navigate to returned url */ }
function renderTransaction(transaction) { /* checklist + child-document files -- no packet link, no complete/sync section yet */ }
```

`completeTransaction()`, `syncTransactionDrive()`, and packet-link rendering are added by Task 11 and Task 10 respectively, extending this same file — do not stub them here. `collectTemplatePayload()` only collects the ordered document kinds and the single `syncGoogleDrive` toggle (decision D6) — there is no Sheets toggle field anywhere in this plan.

- [ ] **Step 7: Add the static page routes**

In `local-server.mjs`'s `safeStaticPath()` route map:

```js
"/workflow-templates": "/workflow-templates.html",
"/workflow-templates/": "/workflow-templates.html",
"/workflow-transactions": "/workflow-transactions.html",
"/workflow-transactions/": "/workflow-transactions.html",
"/workflow-transaction": "/workflow-transaction.html",
"/workflow-transaction/": "/workflow-transaction.html",
```

- [ ] **Step 8: Add the nav entry point**

Add to `forms/index.html`'s menu, near the existing accounting/document links:

```html
<a class="menu-item" href="/workflow-transactions">Workflow ธุรกรรมเอกสาร</a>
<a class="menu-item" href="/workflow-templates">ตั้งค่า Workflow Template</a>
```

This is the whole point of the reorder: as soon as this task lands, a user browsing from the home page can create a template, start a transaction, and work the checklist — without waiting for the packet PDF (Task 10), completion/sync (Task 11), or the site-wide navigation sweep (Task 12). Task 12 rolls the same two links out to the other major pages (`expense-request.html`, `expense-requests.html`, `substitute-receipt.html`, `substitute-receipts.html`) as part of final verification; it does not need to touch `forms/index.html` again, since this task already covers it and `tests/navigation.html.test.mjs` already proves it.

- [ ] **Step 9: Run tests**

Run: `/Users/tar/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/workflow-pages.html.test.mjs tests/navigation.html.test.mjs`

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add forms/workflow-templates.html forms/workflow-transactions.html forms/workflow-transaction.html forms/workflow.logic.browser.js forms/index.html local-server.mjs tests/workflow-pages.html.test.mjs tests/navigation.html.test.mjs
git commit -m "feat: add workflow template and transaction pages"
```

---

### Task 9: Pass Workflow Context Into Existing Standalone Forms

**Files:**
- Modify: `forms/expense-request.html`
- Modify: `forms/substitute-receipt.html`
- Modify: related inline browser scripts in those files
- Modify: `tests/expense-request.html.test.mjs`
- Modify: `tests/substitute-receipt.html.test.mjs`
- Consume (already created in Task 4, not modified here): `forms/workflow-return-link.browser.js`
- Consume (created in Task 6, not modified here): `forms/workflow-prefill.logic.js`
- Consume (route already live since Task 7): `GET /api/workflow-transactions/:transactionNo/prefill`

**Interfaces:**
- Consumes query params: `transactionNo`, `workflowTemplateId`, `workflowStepId`, `returnTo`
- Consumes: `sanitizeWorkflowReturnTo(value)` from `forms/workflow-return-link.browser.js` (Task 4)
- Consumes: `applyWorkflowPrefillGroups(context, documentKind, groups)` from `forms/workflow-prefill.logic.js` (Task 6), and `GET .../prefill` (Task 6 logic, already routed in Task 7 — live by the time this task runs, unlike in the original bottom-up ordering where it did not land until the old plan's Task 10)
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

- [ ] **Step 6: Add the cross-document prefill banner**

Decision D8 (`.superpowers/sdd/progress.md`, Task 6). Add the same banner Task 4 adds to the generic workflow-document shell (identical markup, ids, and Thai strings — `#workflowPrefillBanner`, `#workflowPrefillApply` "ใช้ข้อมูลเดิม", `#workflowPrefillDismiss` "กรอกใหม่") to `forms/expense-request.html` and `forms/substitute-receipt.html`. Load `<script src="./workflow-prefill.logic.js"></script>` after `workflow-return-link.browser.js` and before each page's own controller script.

When `workflowContext.transactionNo` and `workflowContext.workflowStepId` are both present, fetch `GET /api/workflow-transactions/${transactionNo}/prefill?documentKind=<expense_request|substitute_receipt>&stepId=${workflowStepId}` on boot. **Unlike Task 4's equivalent banner, this is not a forward reference**: Task 7 wired this route two tasks ago, and Task 7's own end-to-end test (Step 7 there) already proved it returns real, non-empty `availableGroups` for a completed prior-step document — so a real transaction with a completed earlier step makes this banner actually appear the first time a user reaches it. Still handle the edge cases defensively (an unusual step, a network hiccup, or a transaction with no completed prior documents yet): on any fetch error or an empty `availableGroups`, leave the banner hidden. On success with a non-empty `availableGroups`, render one checkbox per available group labeled with its `sources[group]` document number, same as Task 4. Applying calls `window.WorkflowPrefillLogic.applyWorkflowPrefillGroups(context, documentKind, checkedGroups)` and merges the result onto the still-blank fields, marking each with its source document number — fields stay fully editable, never `readonly`/`disabled`, per Global Constraints. Note for `expense_request` specifically (decision D10): `expense_request` receives `lines` like every other kind — each canonical line becomes one `expenseLines` entry (see Task 6) — so the banner for this page offers the same three checkboxes as every other page: `payee`, `purpose`, `lines`. There is no `totals` checkbox anywhere; no kind receives a `totals` group any more.

Add matching assertions:

```js
test("expense request form shows the cross-document prefill banner", async () => {
  const html = await readFile(new URL("../forms/expense-request.html", import.meta.url), "utf8");
  assert.match(html, /workflow-prefill\.logic\.js/);
  assert.match(html, /id="workflowPrefillBanner"/);
  assert.match(html, /ใช้ข้อมูลเดิม/);
  assert.match(html, /กรอกใหม่/);
});

test("substitute receipt form shows the cross-document prefill banner", async () => {
  const html = await readFile(new URL("../forms/substitute-receipt.html", import.meta.url), "utf8");
  assert.match(html, /workflow-prefill\.logic\.js/);
  assert.match(html, /id="workflowPrefillBanner"/);
  assert.match(html, /ใช้ข้อมูลเดิม/);
  assert.match(html, /กรอกใหม่/);
});
```

- [ ] **Step 7: Run tests**

Run: `/Users/tar/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/expense-request.html.test.mjs tests/substitute-receipt.html.test.mjs tests/expense-request.logic.test.mjs tests/substitute-receipt.logic.test.mjs`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add forms/expense-request.html forms/substitute-receipt.html tests/expense-request.html.test.mjs tests/substitute-receipt.html.test.mjs
git commit -m "feat: pass workflow context into document forms"
```

---

### Task 10: Workflow Packet PDF And Aggregated Files

**Why now (reorder rationale):** This task extends work that already exists rather than creating it from scratch: `forms/workflow-transaction.html` and `forms/workflow.logic.browser.js` were created in Task 8, and the `GET /api/workflow-transactions/:transactionNo/files/:section/:fileName` route that will serve the packet PDF this task generates was already registered in Task 7 (calling `getWorkflowTransactionFile()`, Task 5) — at the time, it could only legitimately 404, because nothing had written a file into any transaction's `pdf/` folder yet. This task is what gives that route something real to serve, and adds the UI link that makes the packet discoverable.

**Files:**
- Create: `scripts/generate_workflow_packet_pdf.py`
- Create: `scripts/test_workflow_packet_pdf.py`
- Modify: `scripts/test.sh`
- Modify: `forms/local-server.logic.js`
- Modify: `forms/workflow-transaction.html` and `forms/workflow.logic.browser.js` (extending the page and controller Task 8 created — adding the packet-PDF link, not a new page)
- Test: `tests/workflow-api.test.mjs`
- Test: `tests/workflow-pages.html.test.mjs`

**Interfaces:**
- Produces CLI: `scripts/generate_workflow_packet_pdf.py --payload <json> --output <pdf>`
- Produces: `generateWorkflowPacketPdf({ transaction, childDocuments, outputPath })` server helper
- Extends `renderTransaction(transaction)` (`forms/workflow.logic.browser.js`, Task 8) to render a packet-PDF link once one exists.

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

- [ ] **Step 7: Add the download happy-path test**

Task 7 already registered `GET /api/workflow-transactions/:transactionNo/files/:section/:fileName`, but could only test traversal-rejection and a 404-for-missing-file, since no packet existed yet. Now that Step 5 above makes `refreshWorkflowTransaction()` actually write a packet PDF, add the test that route was always missing:

```js
test("GET .../files/pdf/:fileName downloads the generated packet PDF", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-workflow-api-"));
  const port = 19199;
  const baseUrl = `http://localhost:${port}`;
  const child = spawn(process.execPath, ["local-server.mjs"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, PORT: String(port), SWEET_HOUSE_ROOT_DIR: rootDir },
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    await waitForServer(child);

    const { body: txn } = await requestJsonResponse(baseUrl, "/api/workflow-transactions", {
      method: "POST",
      body: JSON.stringify({
        templateId: "director_expense_cash",
        accountingMonth: "2026-09",
        title: "ทดสอบดาวน์โหลด packet",
      }),
    });
    await requestJsonResponse(baseUrl, `/api/workflow-transactions/${txn.transactionNo}/refresh`, { method: "POST" });

    const download = await fetch(`${baseUrl}/api/workflow-transactions/${txn.transactionNo}/files/pdf/99_${encodeURIComponent("ชุดรวมเอกสาร")}_workflow-transaction.pdf`);
    assert.equal(download.status, 200);
  } finally {
    child.kill();
    await rm(rootDir, { recursive: true, force: true });
  }
});
```

Match the exact filename-encoding convention `local-server.mjs` already uses for other Thai filenames served by name (check how the expense-request/substitute-receipt file routes build their download URLs) rather than inventing a new one here.

- [ ] **Step 8: Add the packet-PDF link to the transaction page**

Extend the transaction detail page Task 8 built (`forms/workflow-transaction.html`) with a packet-PDF link, and extend `renderTransaction()` in `forms/workflow.logic.browser.js` (also Task 8) to populate it from the transaction's `pdfFiles` list once it contains the packet file:

```html
<a id="workflowPacketLink" href="#" hidden>ดาวน์โหลดชุดรวมเอกสาร Workflow</a>
```

`renderTransaction()` sets `workflowPacketLink.href` to the packet file's download URL and un-hides it only when `transaction.pdfFiles` contains an entry named `99_ชุดรวมเอกสาร_workflow-transaction.pdf`; otherwise it stays hidden, matching how every other conditional element on this page already behaves.

Add a matching assertion to `tests/workflow-pages.html.test.mjs`:

```js
test("workflow transaction page includes a packet PDF link", async () => {
  const html = await readFile(new URL("../forms/workflow-transaction.html", import.meta.url), "utf8");
  assert.match(html, /id="workflowPacketLink"/);
});
```

- [ ] **Step 9: Run tests**

Run: `./scripts/test.sh`

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add scripts/generate_workflow_packet_pdf.py scripts/test_workflow_packet_pdf.py scripts/test.sh forms/local-server.logic.js forms/workflow-transaction.html forms/workflow.logic.browser.js tests/workflow-api.test.mjs tests/workflow-pages.html.test.mjs
git commit -m "feat: generate workflow transaction packets"
```

---

### Task 11: Workflow Completion And Sync

**Why now (reorder rationale):** This task now registers its own HTTP routes (`/complete`, `/sync-drive`) directly, rather than deferring to a separate later "HTTP Routes" task the way the original bottom-up plan did — that task no longer exists in this plan. It extends the routing dispatch Task 7 already established for `/api/workflow-transactions/...` paths, and it extends the transaction page Task 8 already built, adding the complete button and Drive-sync section directly to it rather than waiting for a dedicated UI task.

**Files:**
- Modify: `forms/local-server.logic.js`
- Modify: `local-server.mjs` (new `/complete` and `/sync-drive` routes)
- Modify: `forms/workflow-transaction.html` and `forms/workflow.logic.browser.js` (extending the page and controller Task 8 created)
- Test: `tests/workflow-api.test.mjs`
- Test: `tests/workflow-pages.html.test.mjs`

**Interfaces:**
- Produces: `completeWorkflowTransaction({ rootDir, transactionNo, completedBy, now, driveUploader })`
- Produces: `syncWorkflowTransactionToDrive({ rootDir, transactionNo, driveUploader, now })`
- Produces API routes: `POST /api/workflow-transactions/:transactionNo/complete`, `POST /api/workflow-transactions/:transactionNo/sync-drive`
- Extends `renderTransaction(transaction)` (Task 8) with the complete button and Drive-sync section; adds `completeTransaction()` and `syncTransactionDrive()` to `forms/workflow.logic.browser.js` (Task 8).

No task before this one wires transaction-level Drive sync, even though the spec requires `POST /.../complete` and `POST /.../sync-drive`. This task closes that gap, at the logic layer, the HTTP layer, and the UI layer together. Follow the existing standalone-document pattern before writing code: read `approveExpenseRequest()` and `syncExpenseRequestToDrive()` in `forms/local-server.logic.js` (around lines 538 and 1373) — they show the established shape for injecting a stubbable uploader with a default (`driveUploader = uploadFolderToGoogleDrive`), writing `{ syncStatus, ... }` metadata back onto the record, and turning a sync failure into a `sync_failed` status instead of throwing.

There is no workflow-level Sheets sync in this task or anywhere in this plan (decision D6, `.superpowers/sdd/progress.md`, and the deviation note in Global Constraints): do not implement `syncWorkflowTransactionToSheets()`, do not call `buildWorkflowSheetEntry()` (removed from Task 2), and do not add a `sheetsRecorder` parameter to `completeWorkflowTransaction()`. This task keeps Drive sync in full — auto when `syncGoogleDrive` is on, manual button when it is off. Child documents (expense request, substitute receipt) keep writing their own Sheets rows unchanged.

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

test("completeWorkflowTransaction succeeds and auto-syncs Drive when the template toggle is on", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-workflow-"));
  try {
    const txn = await completeSingleStepTransaction(rootDir, { syncGoogleDrive: true });
    let driveCalls = 0;
    const completed = await serverLogic.completeWorkflowTransaction({
      rootDir,
      transactionNo: txn.transactionNo,
      completedBy: "บัญชี",
      driveUploader: async () => { driveCalls += 1; return { driveFolderId: "f1", driveFolderUrl: "https://drive/f1", drivePath: "p", uploadedFileCount: 1 }; },
    });

    assert.equal(completed.status, "completed");
    assert.equal(completed.completedBy, "บัญชี");
    assert.equal(driveCalls, 1);
    assert.equal(completed.driveSync.syncStatus, "synced");
    assert.equal(completed.sheetSync, undefined);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("completeWorkflowTransaction does not auto-sync Drive when the toggle is off, and manual sync works afterward", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-workflow-"));
  try {
    const txn = await completeSingleStepTransaction(rootDir, { syncGoogleDrive: false });
    let driveCalls = 0;
    const stubDrive = async () => { driveCalls += 1; return { driveFolderId: "f1", driveFolderUrl: "https://drive/f1", drivePath: "p", uploadedFileCount: 1 }; };

    const completed = await serverLogic.completeWorkflowTransaction({
      rootDir,
      transactionNo: txn.transactionNo,
      completedBy: "บัญชี",
      driveUploader: stubDrive,
    });
    assert.equal(completed.status, "completed");
    assert.equal(driveCalls, 0);

    const manualDrive = await serverLogic.syncWorkflowTransactionToDrive({ rootDir, transactionNo: txn.transactionNo, driveUploader: stubDrive });
    assert.equal(driveCalls, 1);
    assert.equal(manualDrive.syncStatus, "synced");
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});
```

There must be no `syncWorkflowTransactionToSheets` test, no `sheetsRecorder` argument, and no `sheetSync` assertion anywhere in this task's test block — the two tests above (and the assertion that `completed.sheetSync` is `undefined`) are the complete replacement for the three-test/Sheets version this task previously had.

- [ ] **Step 2: Run tests to verify failure**

Run: `/Users/tar/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/workflow-api.test.mjs`

Expected: FAIL because `completeWorkflowTransaction` and `syncWorkflowTransactionToDrive` do not exist yet.

- [ ] **Step 3: Implement `completeWorkflowTransaction()`**

Load the transaction with `getWorkflowTransaction()`, load its child documents (the same lookup `refreshWorkflowTransaction()` uses), and call `deriveWorkflowProgress()`. If any step's `workflowStatus !== "completed"`, throw a Thai error (e.g. `"ยังไม่เสร็จสิ้นทุกขั้นตอนของ Workflow"`) and make no changes. Otherwise:

- set `status: "completed"`, `completedAt: now()`, `completedBy`
- append a status history entry (same shape as `appendExpenseRequestStatus()`/`appendSubstituteReceiptStatus()`)
- rewrite `data/workflow-transaction.json` and `working-md/workflow-summary.md` (`formatWorkflowSummaryMarkdown()`)
- regenerate the packet PDF via the Task 10 helper
- if `transaction.templateSnapshot.syncGoogleDrive` (the value snapshotted at start time, not a live template lookup) is `true`, call `syncWorkflowTransactionToDrive({ rootDir, transactionNo, driveUploader })` internally and attach the result as `transaction.driveSync`
- when the toggle is `false`, leave `driveSync` as `{ syncStatus: "not_required" }` so the UI can tell "not needed" apart from "not yet synced"
- accept `driveUploader` as an injectable parameter (default below) so both the auto-sync-on and auto-sync-off paths are testable without hitting the network
- return the updated transaction, including `driveSync`. Do not add a `sheetSync` field or a `sheetsRecorder` parameter — there is no workflow-level Sheets sync (decision D6)

- [ ] **Step 4: Implement the manual sync fallback**

`syncWorkflowTransactionToDrive({ rootDir, transactionNo, driveUploader = uploadFolderToGoogleDrive, now = () => new Date().toISOString() })`:

- load the transaction; throw if not found
- require `transaction.status === "completed"` — refuse to sync an incomplete transaction, mirroring the enable condition the UI uses to show this button
- call `driveUploader({ rootDir, folderPath: transaction.folderPath })`, write `{ syncStatus: "synced", driveFolderId, driveFolderUrl, drivePath, uploadedFileCount, syncedAt, updatedAt }` (or `{ syncStatus: "sync_failed", error, updatedAt }` on rejection, without throwing past this function) into `transaction.driveSync`, persist the transaction JSON, and return the same metadata object — this is exactly the `syncExpenseRequestToDrive()` shape applied to a workflow transaction folder instead of a document folder
- callable standalone (manual button press) and also the function `completeWorkflowTransaction()` calls internally for auto-sync — do not fork the logic into two implementations

Do not implement `syncWorkflowTransactionToSheets()` in this step or anywhere else. There is no workflow-level Sheets row (decision D6): child documents (expense request, substitute receipt) already write their own Sheets rows with the real amounts, and `recordMonthlyExpense()` (`forms/google-sheets.logic.js:235`) upserts those rows on `sourceKey`, so this change does not affect that existing behavior at all — it only removes a workflow-level row that would have double-counted the same money.

- [ ] **Step 5: Export functions**

Add `completeWorkflowTransaction` and `syncWorkflowTransactionToDrive` to `module.exports`.

- [ ] **Step 6: Run logic-layer tests**

Run: `/Users/tar/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/workflow-api.test.mjs`

Expected: PASS for the logic-layer tests above; the route/UI tests added below still fail until Steps 7-8 land.

- [ ] **Step 7: Register the routes**

Extend `require("./forms/local-server.logic.js")` destructuring in `local-server.mjs` (already extended once in Task 7) with `completeWorkflowTransaction` and `syncWorkflowTransactionToDrive`. Do not import `syncWorkflowTransactionToSheets` — it does not exist (decision D6). Following the existing `sendJson()` error style and the same `/api/workflow-transactions/:transactionNo/...` path-parsing convention Task 7 established, add:

- `POST /api/workflow-transactions/:transactionNo/complete` — calls `completeWorkflowTransaction`, refuses unless every step is `completed`, auto-syncs Drive per the transaction's snapshotted `syncGoogleDrive` toggle.
- `POST /api/workflow-transactions/:transactionNo/sync-drive` — calls `syncWorkflowTransactionToDrive`, usable any time after completion regardless of the toggle.

There is no `/api/workflow-transactions/:transactionNo/sync-sheets` route (decision D6). Add a route-presence test to `tests/workflow-api.test.mjs`:

```js
test("local server exposes workflow transaction completion and sync routes", async () => {
  const source = await readFile(new URL("../local-server.mjs", import.meta.url), "utf8");
  assert.match(source, /completeWorkflowTransaction/);
  assert.match(source, /syncWorkflowTransactionToDrive/);
  assert.match(source, /\/complete/);
  assert.match(source, /\/sync-drive/);
  assert.doesNotMatch(source, /syncWorkflowTransactionToSheets/);
  assert.doesNotMatch(source, /\/sync-sheets/);
});
```

- [ ] **Step 8: Add the complete button and Drive-sync section to the transaction page**

Extend `forms/workflow-transaction.html` (Task 8) with:

- a "complete transaction" button, enabled only when every step is `completed` and the transaction is not already `completed`; calls `POST /api/workflow-transactions/:transactionNo/complete`
- a sync section driven by the transaction's `driveSync` state and the template snapshot's `syncGoogleDrive` toggle, shown only once the transaction is `completed`. There is no Sheets sync UI at all (decision D6 — no workflow-level Sheets row, no `sheetSync`, no `syncGoogleSheets`):
  - when the toggle is `true`: show `#driveSyncStatus` text reflecting the auto-sync result (e.g. synced / failed / pending) — no button
  - when the toggle is `false`: show `#syncDriveButton`, calling `POST .../sync-drive`, and update `#driveSyncStatus` after the call resolves

Extend `forms/workflow.logic.browser.js` (Task 8) with:

```js
async function completeTransaction() { /* POST .../complete, then re-render */ }
async function syncTransactionDrive() { /* POST .../sync-drive, then re-render */ }
```

and extend `renderTransaction(transaction)` (Task 8) to render the button/section above. There is no `syncTransactionSheets()` function anywhere in this file.

Add matching assertions to `tests/workflow-pages.html.test.mjs`:

```js
test("workflow transaction page shows a manual Drive sync button and auto-sync status, and no Sheets sync UI", async () => {
  const html = await readFile(new URL("../forms/workflow-transaction.html", import.meta.url), "utf8");
  assert.match(html, /id="syncDriveButton"/);
  assert.match(html, /id="driveSyncStatus"/);
  assert.match(html, /sync-drive/);
  assert.match(html, /\/complete/);
  assert.doesNotMatch(html, /id="syncSheetsButton"/);
  assert.doesNotMatch(html, /id="sheetSyncStatus"/);
  assert.doesNotMatch(html, /sync-sheets/);
});
```

- [ ] **Step 9: Run tests**

Run: `/Users/tar/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/workflow-api.test.mjs tests/workflow-pages.html.test.mjs`

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add forms/local-server.logic.js local-server.mjs forms/workflow-transaction.html forms/workflow.logic.browser.js tests/workflow-api.test.mjs tests/workflow-pages.html.test.mjs
git commit -m "feat: complete workflow transactions and sync them to Drive"
```

---

### Task 12: Navigation And Final Verification

**Files:**
- Modify: major existing HTML pages that include the hamburger menu (`forms/expense-request.html`, `forms/expense-requests.html`, `forms/substitute-receipt.html`, `forms/substitute-receipts.html`) — `forms/index.html` already got its links in Task 8 and needs no further change here.
- Modify: `tests/navigation.html.test.mjs` (created in Task 8 with only the `index.html` assertion; extended here to the remaining pages)

**Interfaces:**
- Produces discoverable links to workflow pages from every major page, not just the home page.

- [ ] **Step 1: Extend the nav test**

`tests/navigation.html.test.mjs` already exists (Task 8) and already passes for `forms/index.html`. Extend it to cover the rest of the major pages:

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

This test may replace or sit alongside the narrower `index.html`-only test Task 8 added — either is fine as long as `index.html` keeps being checked somewhere in this file.

- [ ] **Step 2: Run nav test to verify failure**

Run: `/Users/tar/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/navigation.html.test.mjs`

Expected: FAIL for the four pages that don't have the links yet (`index.html` already passes, from Task 8).

- [ ] **Step 3: Add menu links to the remaining pages**

Add the same two links Task 8 already added to `forms/index.html`, to `forms/expense-request.html`, `forms/expense-requests.html`, `forms/substitute-receipt.html`, and `forms/substitute-receipts.html`, near their existing accounting/document links:

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
- Opening the next document shows the cross-document prefill banner with real data from the completed prior document (Task 7/Task 9).
- Packet PDF link appears in the transaction page (Task 10).
- After the last document is completed, the "complete transaction" button becomes enabled; clicking it marks the transaction `completed` (Task 11).
- For a template with a sync toggle on, completion shows an auto-sync status instead of a button; for a toggle off, completion shows a manual sync button that succeeds when clicked (Task 11).
- The workflow links are visible and working from the home page and from the expense-request/substitute-receipt pages.

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

A follow-up architecture/security pass closed three gaps the first revision flagged but left open: `getWorkflowTransactionFile()` now has a real implementation step (Task 5, Step 8) and `getWorkflowDocumentFile()` was added to Task 4 (Step 7) with the same path-traversal guard as `getExpenseRequestFile()`; `returnTo` is now validated through a shared `sanitizeWorkflowReturnTo()` helper (`forms/workflow-return-link.browser.js`, created in Task 4 Step 8, consumed in Task 4's own shell and in the standalone-forms task) instead of being assigned to `href` unchecked; and (at the time of that pass) the workflow-completion task's Sheets-sync step cited the verified upsert behavior of `recordMonthlyExpense()` (`forms/google-sheets.logic.js:235`). Details: `.superpowers/sdd/architecture-gap-closure-report.md`. That Sheets-sync step no longer exists — see the D5/D6 pass below.

A second follow-up pass applied two more product-owner decisions, D5 and D6 (`.superpowers/sdd/progress.md`), across the whole plan, including the already-implemented Task 1 and Task 2 (a separate agent is fixing that landed code to match this revision concurrently):

- **D5 (strict document order):** `deriveWorkflowProgress()` (Task 2, Step 5) now states explicitly that every step after the first incomplete step is `blocked` even when its own child document independently reports `completed` — Task 2's test block gained a dedicated out-of-order regression test. This is enforced server-side, not only in the UI: the `start-document` handler (now Task 7, Step 4, after the fifth pass below moved route registration earlier) refuses with a Thai `sendJson()` error when the requested `stepId` is not the transaction's current unlocked step, with a new integration test. A Global Constraints bullet states the rule once.
- **D6 (no workflow-level Sheets row):** `buildWorkflowSheetEntry()` is gone from Task 2; `syncWorkflowTransactionToSheets()` and its auto/manual behavior are gone from the completion task (now Task 11); the `POST .../sync-sheets` route is gone from every routes task; the Sheets button/status and `syncGoogleSheets` toggle are gone from the pages/UI (now Task 8 for the page shell, Task 11 for the sync UI specifically) and their tests; `syncGoogleSheets` is gone from Task 1's template seed/tests, Task 2's transaction snapshot, and `normalizeWorkflowTemplate()`. `syncGoogleDrive` is the only remaining workflow sync toggle. A Global Constraints bullet and a dedicated deviation note record that this knowingly diverges from the spec's `## Sync Rules` section (which still describes a Sheets summary row) — the plan governs, the spec file was left unedited. `recordMonthlyExpense()` (`forms/google-sheets.logic.js:235`) upserts on `sourceKey`, so child documents' own Sheets rows are unaffected.

(At the time of the D5/D6 pass, "Workflow Completion And Sync" and "HTTP Routes" were Task 8 and Task 9. The third pass below renumbered them to Task 9 and Task 10; the fifth pass (bottom of this section) then eliminated "HTTP Routes" as a standalone task entirely and moved "Workflow Completion And Sync" to Task 11. If you are trying to find where a piece of D5/D6 behavior actually lives today, trust the Task numbers used in the bullets above, not the historical task titles.)

A third follow-up pass added decision D8 (`.superpowers/sdd/progress.md`): cross-document prefill. A new **Task 6, Cross-Document Prefill**, is inserted immediately after Task 5; every task from the former Task 6 onward shifted up by one (former Task 6 → 7, 7 → 8, 8 → 9, 9 → 10, 10 → 11, 11 → 12), and every cross-reference to those tasks anywhere in the plan was rewritten to the new numbers. Task 6 defines one canonical transaction context (at the time, `payee`/`purpose`/`lines`/`totals`/`parties` — see the D10 paragraph below, which removed `totals`) and a `toWorkflowContext()`/`applyWorkflowContext()` adapter pair per document kind (14 functions for 7 kinds, not 42 pairwise mappings), the most-recently-`completed`-wins precedence rule, and the never-copied field list (`documentNo`, `documentDate`, `status`, `statusHistory`, `completedAt`/`completedBy`, signatures, evidence/raw files, plus `goods_receipt` line quantities specifically). `getWorkflowTransactionPrefill()` (the orchestration function, added to `forms/local-server.logic.js` in Task 6) was, at the time of this third pass, deliberately left unwired to HTTP until the plan's single "HTTP Routes" task — the fifth pass below eliminated that task and moved this route wiring to Task 7 instead, much earlier, as part of pulling the whole user-facing slice forward (see that pass for why). The prefill banner UI is added to Task 4 (the lightweight document shell) and to the standalone-forms task (now Task 9, then still numbered Task 7) rather than waiting for a dedicated UI task, since those are the tasks that already own the standalone document forms the banner appears on.

A fourth follow-up pass applied decision D10 (`.superpowers/sdd/progress.md`, user-approved), which rejected part of the D8/Task 6 design above: the product owner rejected `expense_request` receiving a `totals` group as one seeded placeholder line, and instead ruled that `expense_request` participates in the `lines` group like every other kind, mapped line by line in both directions (sourcing: each `expenseLines` entry becomes one canonical line with `quantity` fixed at `"1"` and `unitCost`/`lineTotal` set to the expense line's `amountBeforeVat`; receiving: each canonical line becomes one `expenseLines` entry with `amountBeforeVat` set to the canonical line's `lineTotal` and `vatAmount`/`withholdingTax` fixed at `"0.00"`). Consequence: `totals` is gone from the canonical context and from every group list in the plan — the tickable groups are now exactly `payee`, `purpose`, `lines` everywhere. No task numbering changed for this pass.

A fifth follow-up pass (2026-09-07) reordered the plan so the feature becomes usable much earlier, at the product owner's request, once Tasks 1-6 had already landed and made clear that only routes and pages stood between the committed logic and a real user. Full detail is in `.superpowers/sdd/architecture-reorder-report.md`; the summary:

- **What moved:** the old plan wired every `/api/workflow-*` route in one "HTTP Routes" task and built every workflow page in one "UI" task, both positioned as tasks 10 and 11 of 12 — so nothing was reachable by a user until task ten of twelve, even though the template/transaction pages are the natural entry point to the whole feature. This pass carves the user-facing slice (template CRUD, transaction start/list/detail, prefill, start-document, the three pages, and a home-page nav link) out of those two tasks and moves it to **new Task 7 (Workflow Template And Transaction Routes)** and **new Task 8 (Workflow Template And Transaction Pages)** — immediately after Task 6, which is exactly where the plan already had every piece of backing logic those routes call. The old bottom-up "HTTP Routes" and "UI" tasks no longer exist as whole tasks.
- **Old → new task map:** Tasks 1–6 unchanged. Old Task 7 (Pass Workflow Context Into Existing Standalone Forms) → **Task 9**. Old Task 8 (Workflow Packet PDF And Aggregated Files) → **Task 10**. Old Task 9 (Workflow Completion And Sync) → **Task 11**. Old Task 12 (Navigation And Final Verification) stays **Task 12**. Old Task 10 (HTTP Routes) and old Task 11 (Workflow Template, Transaction List, And Progress UI) are gone as whole tasks; their content is redistributed as described below. Total task count is unchanged at 12.
- **Where old Task 10's routes went:** templates, transactions, refresh, start-document (with its D5/D7 strict-order enforcement), prefill, and the transaction file-download route → **Task 7**. `/complete` and `/sync-drive` → **Task 11**, which now registers its own routes directly instead of deferring to a separate routes task.
- **Where old Task 11's UI went:** the template editor, transaction list, and transaction-detail checklist/file-links shell (everything except the packet link and the complete/sync UI) → **Task 8**. The packet-PDF link → **Task 10**, extending the page Task 8 built. The complete-transaction button and the Drive-sync section/button → **Task 11**, likewise extending Task 8's page.
- **Binding clarification (D5/D7):** the reorder was also the occasion to resolve an ambiguity the old Task 10 left open about whether `start-document` should recompute progress live or trust the last-persisted `currentStepId`. New Task 7, Step 4 states plainly, per decisions D5 and D7: the handler calls `refreshWorkflowTransaction()` first, then compares the requested `stepId` against the freshly derived `currentStepId` — never a stale persisted value — so a child document completed moments earlier unlocks the next step without a separate refresh call.
- **Reality-matching test scope:** because `getWorkflowTransactionFile()` only serves `pdf`, and no packet PDF exists until Task 10, new Task 7's own test for the transaction file-download route only proves traversal-rejection and a legitimate 404 — it does not assert a successful download, since nothing produces that file yet. Task 10 adds the happy-path download test once it actually generates the packet.
- **Prefill banner goes live sooner:** the `forms/workflow-document.html` prefill banner (Task 4) and the `forms/expense-request.html`/`forms/substitute-receipt.html` banners (Task 9) depend on `GET /api/workflow-transactions/:transactionNo/prefill`, which now lands in Task 7 — two tasks after Task 6 instead of five-plus. New Task 7, Step 7 adds an explicit end-to-end test proving the banner's fetch returns real, non-empty `availableGroups` once a prior step has a completed document, and Task 9 no longer describes its own banner fetch as a "forward reference" — the route is already live by the time Task 9 runs.
- **Nothing had no clean home.** Every route, every UI element, and every test from the old Task 10 and Task 11 has an explicit new owner above; nothing was dropped.

## Self-Review

- Spec coverage: Covers template builder, ordered document kinds, transaction ID relation, standalone document reuse, completed state requirement, child document adapters, progress derivation, packet aggregation, sync settings, workflow completion, Drive-only sync (auto + manual fallback; no workflow-level Sheets sync, decision D6), strict document ordering enforced server-side (decisions D5/D7), cross-document prefill with per-group opt-in (decision D8), APIs, UI, and tests. Cross-document prefill is not in the original spec document — it is a pure PM-approved addition layered onto the existing standalone-document-reuse architecture; no spec text conflicts with it (see the D8 deviation note at the end of Task 6).
- Decision coverage: D1 (`goods_receipt` is now a 5th lightweight document kind routed through `/workflow-document`, with an explicit no-touch note on `forms/inventory.logic.js` in Global Constraints, Task 1, and Task 4) — D2 (Task 2's mapping and new failing test cover both `substitute_receipt` hybrid branches; `completeSubstituteReceipt()` from Task 3 is unchanged and still available in all cases) — D3 (Task 11 implements `completeWorkflowTransaction`/`syncWorkflowTransactionToDrive` and now also registers the Drive-only HTTP routes and the manual-button/auto-status UI directly, rather than splitting those across a separate routes task and a separate UI task) — D4 (Task 5 Step 6 now specifies a real `findLightweightWorkflowDocuments()` with the `documentKind`-injection caveat for expense/substitute records; Task 4/Task 10's `scripts/test.sh` edits are additive so `./scripts/test.sh` stays green from Task 4 onward) — D5 (strict document order is unambiguous in Task 2's `deriveWorkflowProgress()` spec and test, and enforced server-side in Task 7's `start-document` handler) — D6 (no workflow-level Sheets row anywhere in the plan; `syncGoogleDrive` is the sole workflow sync toggle; deviation from the spec's `## Sync Rules` section recorded in a dedicated note) — D7 (Task 7's `start-document` handler calls `refreshWorkflowTransaction()` first and compares against the freshly derived `currentStepId`, not a stale persisted value) — D8 (Task 6 implements the canonical prefill context, per-kind adapters, and precedence rule; Task 7 wires the `GET .../prefill` route right after Task 6, instead of after every other task in the plan; Task 4 and Task 9 add the prefill banner UI; the never-copied field list, including `goods_receipt` quantities, is stated once in Global Constraints and enforced structurally by the adapters in Task 6) — D10 (Task 6's field table, `RECEIVABLE_PREFILL_GROUPS`, adapter implementation notes, and adapter tests all implement `expense_request`'s line-by-line `lines` mapping in both directions; `totals` is removed as a group everywhere — the canonical context, Global Constraints, and the Task 4/Task 9 banner sections all state the three-group list `payee`/`purpose`/`lines`).
- Placeholder scan: No TBD/TODO placeholders, including the former `findLightweightWorkflowDocuments() { return []; }` stub. Each task includes concrete files, interfaces, tests, commands, and commit messages.
- Type consistency: Public helper names introduced in earlier tasks are reused with the same names later. `LIGHTWEIGHT_DOCUMENT_KINDS` and `DOCUMENT_PREFIXES` both carry `goods_receipt` as a fifth entry; `DOCUMENT_TYPE_DEFINITIONS`' key order is unchanged from the original plan (only `goods_receipt.route` changed). `PREFILL_GROUPS`, `RECEIVABLE_PREFILL_GROUPS`, and the 14 adapter function names introduced in Task 6 are reused unchanged in Task 4, Task 7, and Task 9.
- Task numbering: Tasks 1–6 are unchanged (Task 6, Cross-Document Prefill, was inserted by the third pass). The fifth pass (2026-09-07) is the current numbering: **Task 7 (Workflow Template And Transaction Routes)** and **Task 8 (Workflow Template And Transaction Pages)** are new, carved out of the routes/UI tasks that used to sit at positions 10-11. Former Task 7 (Pass Workflow Context Into Existing Standalone Forms) is now Task 9. Former Task 8 (Workflow Packet PDF And Aggregated Files) is now Task 10, extended with its own route/UI wiring. Former Task 9 (Workflow Completion And Sync) is now Task 11, likewise extended with its own route/UI wiring. Former Task 10 (HTTP Routes) and former Task 11 (Workflow Template, Transaction List, And Progress UI) no longer exist as whole tasks — every route and UI element they used to own has an explicit new home in Task 7, 8, 10, or 11 (see the fifth-pass paragraph above for the full breakdown). Former Task 12 (Navigation And Final Verification) is unchanged at Task 12. Every cross-reference to a renumbered task anywhere in the plan — including inside the historical D5/D6/D8 paragraphs in Handoff Notes — was checked and updated. Total task count is still 12.
- Gap-closure follow-up (earlier pass): (1) Task 5 gained Step 8, `getWorkflowTransactionFile()` implementation with its containment guard and allowed-`section` rationale (`pdf` only), plus a traversal/legitimate-file test appended to Step 1; Task 4 gained the equivalent Step 7 (`getWorkflowDocumentFile()`, sections `pdf`/`raw`) with its own test. (2) Every page that consumes `returnTo` (`workflow-document.html`, `expense-request.html`, `substitute-receipt.html`) now validates it through one shared `sanitizeWorkflowReturnTo()` helper (new Task 4 Step 8, file `forms/workflow-return-link.browser.js`) before ever assigning it to `href`; the standalone-forms task (now Task 9) loads and uses it, with new HTML-test assertions in both tasks; a Global Constraints bullet states the rule once. (3) The workflow-completion task's (now Task 11) Sheets-sync step cited the verified `recordMonthlyExpense()` upsert-by-`sourceKey` behavior (`forms/google-sheets.logic.js:235`) as fact — this step no longer exists in the current plan at all (decision D6 removed workflow-level Sheets sync outright), but the cited fact remains true and is still referenced where relevant.
- Prefill follow-up (earlier pass, design since revised by D10, route timing since revised by the fifth pass): (1) Task 6 defines `forms/workflow-prefill.logic.js` (pure, dual-export) with 14 per-kind adapter functions, `buildWorkflowPrefillContext()` (most-recently-`completed`-wins precedence, using `normalizeDocumentWorkflowStatus()` from Task 2 to decide what counts as a source), `applyWorkflowPrefillGroups()`, and `getWorkflowTransactionPrefill()` in `forms/local-server.logic.js` (consumes Task 5's `findWorkflowChildDocuments()` and `getWorkflowTransaction()`). (2) `goods_receipt`'s `applyWorkflowContext()` always clears line `quantity` while still copying `description`/`stockSkuId`, with a dedicated test. (3) Route wiring for `GET /api/workflow-transactions/:transactionNo/prefill` now lands in **Task 7** (moved there by the fifth pass, from the single "HTTP Routes" task that no longer exists), immediately after Task 6 rather than after most of the rest of the plan. (4) The prefill banner UI is in Task 4 and Task 9 (not deferred to a dedicated UI task); Task 4's banner is still a genuine forward reference until Task 7 lands (three tasks later), but Task 9's is not — Task 7 already made the route live two tasks earlier, and Task 9 states this explicitly rather than describing it as a forward reference.
- D10 follow-up (earlier pass): the field-shape mismatch between `expense_request` and every other kind is resolved by mapping line-for-line instead of excluding `expense_request` from `lines`: sourcing (`expenseRequestToWorkflowContext()`) turns each `expenseLines` entry into one canonical line (`quantity` fixed at `"1"`, `unitCost`/`lineTotal` set to the expense line's `amountBeforeVat`, `stockSkuId` fixed at `""`); receiving (`applyWorkflowContextToExpenseRequest()`) turns each canonical line into one `expenseLines` entry (`description` verbatim, `amountBeforeVat` = the canonical line's `lineTotal`, `vatAmount`/`withholdingTax` fixed at `"0.00"`, since these six templates are all no-tax-invoice cases). `RECEIVABLE_PREFILL_GROUPS` is now identical for all seven kinds (`payee`/`purpose`/`lines`). `totals` is removed as a group entirely — the canonical context, `PREFILL_GROUPS`, every group list, and the Task 4/Task 9 banner sections now name exactly three groups — because every kind, `expense_request` included, already recomputes its own totals from its own lines on save. Task 6's Step 1 test block gained a dedicated round-trip test proving a source line's `description` survives verbatim and `vatAmount`/`withholdingTax` land at `"0.00"` on the receiving side even when the original expense line had nonzero VAT/withholding.
