# Substitute Receipt Stock Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build substitute receipt submission with PDF evidence packets and automatic inventory purchase-in movements for stock purchases.

**Architecture:** Add a focused substitute receipt logic module, reuse the existing local-server multipart upload and PDF annex approach, and call the inventory module for stock movements. Keep submitted documents immutable in this slice to preserve stock audit correctness.

**Tech Stack:** Node.js CommonJS logic modules, existing local HTTP server, SQLite inventory module through `node:sqlite`, Python ReportLab/pypdf PDF generator, Node `node:test`.

**Spec:** `docs/superpowers/specs/2026-09-04-substitute-receipt-stock-design.md`

## Global Constraints

- Use bundled Node 24 runtime through `./scripts/test.sh`.
- Keep raw evidence as files; store document metadata in JSON.
- Use `SR-YYYY-MM-0001` document numbers for substitute receipts.
- Generate both a standalone substitute receipt PDF and an audit packet PDF with annexed evidence.
- For stock purchases, create `purchase_in` stock movements referencing the substitute receipt number.
- Keep submitted substitute receipts immutable in this first slice.

---

### Task 1: Substitute Receipt Business Logic

**Files:**
- Create: `forms/substitute-receipt.logic.js`
- Test: `tests/substitute-receipt.logic.test.mjs`

**Interfaces:**
- Produces: `buildSubstituteReceiptPayload(data): SubstituteReceiptPayload`
- Produces: `validateSubstituteReceipt(data): string[]`
- Produces: `buildSubstituteReceiptRawFileName(evidenceKey, originalName, index): string`
- Produces: `formatSubstituteReceiptMarkdown(payload): string`

- [ ] Write failing tests for payload totals, evidence naming, stock line validation, and markdown.
- [ ] Run focused test and confirm it fails because the module does not exist.
- [ ] Implement the logic module with no filesystem writes.
- [ ] Run focused test and confirm it passes.
- [ ] Commit as `Add substitute receipt business logic`.

### Task 2: Server Save Flow And PDF Generator

**Files:**
- Modify: `forms/local-server.logic.js`
- Modify: `scripts/generate_expense_pdfs.py`
- Test: `tests/local-server.logic.test.mjs`

**Interfaces:**
- Consumes: Task 1 substitute receipt payload functions.
- Consumes: `createPurchaseInMovement(rootDir, data)` from `forms/inventory.logic.js`.
- Produces: `getNextSubstituteReceiptInfo(rootDir, accountingMonth): { sequence, receiptNo }`
- Produces: `saveSubstituteReceiptSubmission({ rootDir, payload, uploads }): Promise<{ receiptNo, folderPath, absoluteFolderPath, pdfFiles, rawFiles, stockMovements }>`

- [ ] Write failing tests for saving substitute receipts with raw files and PDF metadata.
- [ ] Write failing tests for stock purchase receipts creating inventory movements.
- [ ] Run focused tests and confirm they fail because save functions do not exist.
- [ ] Add PDF generator support for `documentKind: "substitute_receipt"`.
- [ ] Add server save flow with folder creation, raw file writes, JSON, markdown, PDF generation, and stock movement creation.
- [ ] Run focused tests and confirm they pass.
- [ ] Commit as `Add substitute receipt save flow`.

### Task 3: HTTP API And Form UI

**Files:**
- Modify: `local-server.mjs`
- Create: `forms/substitute-receipt.html`
- Create: `forms/substitute-receipt.logic.browser.js`
- Test: `tests/substitute-receipt-api.test.mjs`
- Test: `tests/substitute-receipt.html.test.mjs`

**Interfaces:**
- Consumes: `saveSubstituteReceiptSubmission` and `getNextSubstituteReceiptInfo`.
- Consumes: `/api/inventory/stock-skus` for Stock SKU dropdown.
- Produces: `GET /api/substitute-receipts/next`
- Produces: `POST /api/substitute-receipts`
- Produces: static route `/substitute-receipt`

- [ ] Write failing API tests for next number and multipart submit.
- [ ] Write failing HTML tests for form controls and script inclusion.
- [ ] Run focused tests and confirm they fail because routes/page do not exist.
- [ ] Implement server routes.
- [ ] Build the form page and browser controller.
- [ ] Run focused tests and confirm they pass.
- [ ] Commit as `Add substitute receipt form`.

### Task 4: Navigation, Checklist, And Final Verification

**Files:**
- Modify: `forms/index.html`
- Modify: `forms/expense-request.html`
- Modify: `forms/expense-requests.html`
- Modify: `forms/company-settings.html`
- Modify: `forms/google-drive.html`
- Modify: `forms/inventory.html`
- Modify: `forms/inventory-settings.html`
- Modify: `docs/feature-checklist.md`
- Test: existing HTML navigation tests

**Interfaces:**
- Consumes: `/substitute-receipt` from Task 3.
- Produces: menu access and updated task checklist.

- [ ] Write failing navigation tests expecting `/substitute-receipt`.
- [ ] Run focused tests and confirm they fail.
- [ ] Add menu links and update checklist status.
- [ ] Run `./scripts/test.sh`.
- [ ] Smoke test `/substitute-receipt` and a stock purchase submission through the server.
- [ ] Commit as `Add substitute receipt navigation`.

