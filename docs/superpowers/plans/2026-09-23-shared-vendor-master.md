# Shared Vendor Master Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let every supported document form select a saved vendor or enter a new vendor, optionally save it as a reusable master, and preserve a document-local snapshot.

**Architecture:** Add a shared vendor service and `/api/vendors` contract, then adapt the existing substitute-receipt vendor routes to it. Add one reusable browser picker/controller pattern to each form while preserving each form's existing field names and payloads; document saves persist `vendorId` plus `vendorSnapshot` without mutating the master.

**Tech Stack:** Node.js local server, existing JSON/file persistence, classic browser scripts, HTML forms, Node test runner, existing HTTP fixture helpers.

**Spec:** `docs/superpowers/specs/2026-09-23-shared-vendor-master-design.md`

## Global Constraints

- The vendor master is shared across all seven document kinds.
- `name` is required; `taxId` is optional and must never become a required validation field.
- Selecting a vendor copies a snapshot into the document; editing a document never edits the master.
- Inactive vendors cannot be selected for new documents, but old snapshots remain readable.
- Duplicate creation requires an explicit confirmation bound to the candidate and matching IDs.
- Existing substitute-receipt vendor routes and old document payloads remain compatible.
- Vendor and document APIs must not expose absolute filesystem paths or private storage keys.

## Review Focus

- A vendor with no tax ID can be saved, selected, and reused; the test belongs to Task 1.
- A duplicate candidate must stop before creation and only create after explicit confirmation; the test belongs to Task 1.
- Deactivating a vendor blocks new selection while an existing document snapshot still renders; the tests belong to Tasks 1 and 4.
- Editing a selected vendor inside a document must not mutate the master; the test belongs to Task 4.
- Vendor API failure must leave entered document fields intact and still permit document-only save; the test belongs to Task 5.

### Task 1: Shared vendor domain and persistence

**Files:**
- Create: `forms/vendor.logic.js`
- Modify: `forms/local-server.logic.js` (vendor storage, validation, and service exports)
- Test: `tests/vendor.logic.test.mjs`

**Interfaces:**
- Produces `normalizeVendorInput(input)`, `vendorSnapshotFromRecord(record)`, `findVendorMatches(candidate, vendors)`, and `assertVendorSelection(vendor, { allowInactive })`.
- Produces persistence functions `listVendors({ includeInactive })`, `getVendorById(id)`, `createVendor(input, { confirmDuplicate, expectedMatchIds })`, and `updateVendor(id, patch)`.

- [ ] **Step 1: Write failing unit tests** for trimming fields, optional `taxId`, stable snapshot projection, duplicate matching by normalized tax ID/name, confirmation-required creation, inactive selection rejection, and snapshot isolation.
- [ ] **Step 2: Run** `node --test tests/vendor.logic.test.mjs`; verify the new functions fail before implementation.
- [ ] **Step 3: Implement** the canonical vendor schema and persistence using the repository's existing JSON/file storage boundary; never require `taxId` and never return private paths.
- [ ] **Step 4: Run** the focused test file and verify all domain tests pass.
- [ ] **Step 5: Commit** only `forms/vendor.logic.js`, `forms/local-server.logic.js`, and `tests/vendor.logic.test.mjs` with `feat: add shared vendor domain`.

### Task 2: Vendor HTTP API and SR compatibility adapter

**Files:**
- Modify: `forms/local-server.logic.js` (routes)
- Modify: `forms/substitute-receipt-vendors.logic.js` (adapter mapping)
- Test: `tests/vendors-api.test.mjs`, `tests/substitute-receipt-vendors-api.test.mjs`

**Interfaces:**
- Consumes Task 1 service functions.
- Produces `GET /api/vendors`, `GET /api/vendors/:id`, `GET /api/vendors/matches`, `POST /api/vendors`, and `PATCH /api/vendors/:id`.
- Existing `/api/substitute-receipt-vendors` routes continue returning their current response shape through the shared service.

- [ ] **Step 1: Write failing HTTP tests** for active-only listing, `includeInactive=1`, create without `taxId`, duplicate response and confirmed retry, update/deactivate, malformed IDs, and inactive selection rejection.
- [ ] **Step 2: Run** `node --test tests/vendors-api.test.mjs tests/substitute-receipt-vendors-api.test.mjs`; verify failures identify missing routes or contract mismatches.
- [ ] **Step 3: Implement** route validation, duplicate confirmation binding, and compatibility mapping. Ensure stale `expectedMatchIds` or changed candidate data cannot bypass the duplicate check.
- [ ] **Step 4: Run** the focused API tests and verify existing SR vendor tests remain green.
- [ ] **Step 5: Commit** route and API tests with `feat: expose shared vendor api`.

### Task 3: Document snapshot persistence and field mapping

**Files:**
- Modify: `forms/expense-request.logic.js`, `forms/substitute-receipt.logic.js`, `forms/workflow-document.logic.js`
- Modify: `forms/local-server.logic.js` document save/load paths
- Modify: `forms/workflow-prefill.logic.js`
- Test: `tests/vendor-snapshot.logic.test.mjs`, existing document lifecycle tests

**Interfaces:**
- Produces `buildVendorSnapshot(payload)` and per-kind mapping helpers that retain current fields while adding `vendorId` and `vendorSnapshot`.
- Existing documents without snapshot fields remain valid and render from their current payload fields.

- [ ] **Step 1: Write failing tests** for save/load round trips for all seven kinds, selected-vendor snapshot creation, manual edits remaining document-local, old payload compatibility, and workflow prefill retaining current payee behavior.
- [ ] **Step 2: Run** the focused snapshot and existing lifecycle tests to confirm the new assertions fail.
- [ ] **Step 3: Implement** additive snapshot persistence and per-form mapping. Rebuild the snapshot from submitted document values on every save; never write edits back to the vendor master.
- [ ] **Step 4: Run** focused tests and verify Sheets/PDF payload builders still receive their existing field names.
- [ ] **Step 5: Commit** the document persistence changes and tests with `feat: persist vendor snapshots on documents`.

### Task 4: Shared vendor picker on document forms

**Files:**
- Modify: `forms/expense-request.html`, `forms/expense-request.logic.browser.js`
- Modify: `forms/substitute-receipt.html`, `forms/substitute-receipt.logic.browser.js`
- Modify: `forms/workflow-document.html`, `forms/workflow-document.logic.browser.js`
- Modify: `forms/workflow-documents.html`, `forms/workflow-documents.logic.browser.js` only where shared display needs vendor data
- Test: `tests/vendor-picker.html.test.mjs`, existing form tests

**Interfaces:**
- Consumes `/api/vendors` and `/api/vendors/matches` from Task 2.
- Produces a reusable browser helper with `loadVendorOptions`, `applyVendorToForm`, `clearVendorSelection`, and `saveVendorPresetIfRequested`.

- [ ] **Step 1: Write failing DOM tests** for picker rendering, selecting an active vendor, manual-entry reset, optional “บันทึกเป็นผู้ขายประจำ”, duplicate confirmation, and preserving fields when the vendor API fails.
- [ ] **Step 2: Run** `node --test tests/vendor-picker.html.test.mjs`; verify the picker behavior is absent or failing.
- [ ] **Step 3: Implement** the common picker pattern with accessible labels, active-vendor filtering, per-form field mapping, and document-only fallback when vendor APIs fail.
- [ ] **Step 4: Run** the focused picker and existing expense/SR/workflow page tests; verify selecting a vendor fills fields without auto-submitting.
- [ ] **Step 5: Commit** the shared picker and form changes with `feat: add vendor picker to document forms`.

### Task 5: Settings UI and duplicate/inactive workflows

**Files:**
- Modify: `forms/substitute-receipt-vendors.html`, `forms/substitute-receipt-vendors.logic.browser.js`
- Create: `forms/vendors.html`, `forms/vendors.logic.browser.js` only if the existing settings page cannot represent the shared fields without breaking compatibility
- Test: `tests/vendors.html.test.mjs`, existing settings page tests

**Interfaces:**
- Consumes the shared API from Task 2.
- Produces a settings view for the full vendor field set, active/inactive status, and explicit duplicate confirmation.

- [ ] **Step 1: Write failing tests** for creating a vendor without tax ID, editing/deactivating a vendor, displaying duplicate matches, and preserving existing SR settings behavior.
- [ ] **Step 2: Run** focused settings tests and verify failures.
- [ ] **Step 3: Implement** the settings UI, reusing the existing route/page where possible; do not create a second master store.
- [ ] **Step 4: Run** settings and navigation tests and verify inactive records remain visible only in the settings view.
- [ ] **Step 5: Commit** with `feat: manage shared vendor presets`.

### Task 6: End-to-end regression and browser verification

**Files:**
- Modify: `tests/navigation.html.test.mjs`, `tests/workflow-pages.html.test.mjs`, and relevant HTTP suites
- Create: `tests/vendor-e2e.test.mjs`

- [ ] **Step 1: Write failing end-to-end tests** covering each document kind's vendor picker, a document-only manual vendor, a saved preset reused by a second kind, inactive vendor rejection for new documents, and old snapshot rendering.
- [ ] **Step 2: Run** the focused end-to-end tests and confirm failures before wiring the final fixtures.
- [ ] **Step 3: Implement fixture setup and any contract adjustments required by the test findings; do not weaken existing assertions.
- [ ] **Step 4: Run** the focused suites, then `./scripts/test.sh`; record Node/Python totals.
- [ ] **Step 5: Start the local server and manually verify: select saved vendor, edit only the current document, save a new preset, confirm duplicate warning, and open an old document after deactivation. Record the observed flows.
- [ ] **Step 6: Commit tests and final documentation with `test: verify shared vendor master flows`.

