# Shopee Custom Label From Uploaded PDF Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a standalone Shopee custom-label workflow that parses uploaded text-based Shopee PDFs, maps each product line to a reusable manual-SKU bundle, previews original/generated pages side by side, and saves a new PDF without using Shopee API.

**Architecture:** Keep this workflow isolated from the existing API shipment flow. Node business logic owns jobs, mappings, validation, and file lifecycle; a Python helper owns PDF text/coordinate extraction and safe lower-section overlay. A new vanilla browser page talks to dedicated routes and reuses existing inventory SKU data for autocomplete.

**Tech Stack:** Existing local HTTP server, Node.js built-ins (`node:sqlite`, `node:test`, `child_process`), SQLite, Python `pdfplumber`, `pypdf`, `reportlab`, existing vanilla HTML/CSS, Poppler for render verification.

**Spec:** `docs/superpowers/specs/2026-10-17-shopee-custom-label-upload-design.md`

## Global Constraints

- This workflow is independent of Shopee API, OAuth, sync orders, and `platform_orders`.
- MVP supports text-based Shopee PDFs and explicitly rejects scanned/image-only PDFs; no OCR.
- One PDF page represents one order; source PDF is never overwritten.
- Manual bundle quantities are per one Shopee item, then multiplied by the Shopee line quantity.
- Duplicate manual SKUs are aggregated in first-seen order in the generated label.
- Source delivery area, recipient, barcode, QR, tracking, and page dimensions must be preserved.
- Save stores both reusable mapping templates and the exact mapping snapshot used by the saved output PDF.
- Existing API Shopee workflow, CSV import, and inventory behavior must remain unchanged.

## Review Focus

- Thai private-use tone glyphs in the provided Chromium/pdfcpu fixture normalize to searchable product/option text; pin this in the parser fixture test.
- A product line can wrap over multiple visual rows and a page can contain multiple product lines; pin coordinate-based grouping in the parser test.
- Bundle quantities multiply by source line quantity and duplicate SKUs merge across lines; pin this in the Node logic test.
- Overlay must not cover the upper delivery/barcode/QR area and must keep every source page's size; pin this in the Python render test.
- Preview must not persist mapping templates, while Save must persist mappings, snapshot, and output path atomically; pin this in the job persistence test.

## File Map

- Create: `forms/shopee-custom-label.logic.js` — custom-label job, mapping, validation, aggregation, and Python orchestration.
- Create: `forms/shopee-custom-label.html` — standalone upload/editor/preview page.
- Create: `forms/shopee-custom-label.logic.browser.js` — page state, bundle editor, side-by-side PDF page preview, preview/save actions.
- Create: `scripts/shopee_custom_label_pdf.py` — PDF extraction and lower-product-block rendering CLI.
- Modify: `forms/inventory-db.logic.js` — schema version and custom-label job/mapping tables.
- Modify: `local-server.mjs` — route map, API handlers, safe file serving, and business-logic import.
- Modify: `forms/shopee-workflow.css` — focused styles for page navigator, item editor, bundle rows, and preview panes.
- Create: `tests/shopee-custom-label.logic.test.mjs` — mapping semantics and persistence tests.
- Create: `tests/shopee-custom-label-pdf.test.py` — parser/render tests using a committed copy of the provided fixture plus a synthetic multi-line fixture.
- Create: `tests/shopee-custom-label-api.test.mjs` — multipart upload, preview/save, and file access tests.
- Create: `tests/shopee-custom-label.html.test.mjs` — static page contract tests.
- Create: `tests/fixtures/shopee-custom-label-sample.pdf` — the provided 19-page fixture, copied without modification for deterministic parser tests.

### Task 1: Add schema and pure bundle/mapping logic

**Files:**
- Modify: `forms/inventory-db.logic.js`
- Create: `forms/shopee-custom-label.logic.js`
- Test: `tests/shopee-custom-label.logic.test.mjs`

**Interfaces:**
- `normalizeMappingKey(productName: string, optionName: string) -> { productName: string, optionName: string, key: string }`
- `validateBundle(bundle: unknown) -> Array<{ sku: string, quantity: number }>`
- `aggregateManualSkus(lines: Array<{ quantity: number, bundle: Array<{ sku: string, quantity: number }> }>) -> Array<{ sku: string, quantity: number }>`
- `loadCustomLabelMappings(rootDir: string, keys: string[]) -> Record<string, Array<{ sku: string, quantity: number }>>`
- `createCustomLabelJob(rootDir: string, payload: object, options?: object) -> object`
- `getCustomLabelJob(rootDir: string, jobId: number) -> object`
- `saveCustomLabelMappings(rootDir: string, jobId: number, mappings: object, options?: object) -> object`

- [ ] **Step 1: Write failing tests for normalization and bundle semantics.** Cover U+F70A/U+F70B/U+F70C conversion, `(cid:0)` removal, Unicode whitespace normalization, rejection of empty/non-positive bundle rows, multiplication by line quantity, duplicate SKU aggregation, and first-seen order.
- [ ] **Step 2: Run the focused test to verify it fails.** Run `node --test tests/shopee-custom-label.logic.test.mjs`; expect missing-module or missing-export failures.
- [ ] **Step 3: Add schema version 9 and tables.** Add `shopee_custom_label_jobs` and `shopee_custom_label_mappings` with the columns, statuses, foreign-key/index/unique rules from the spec; leave existing table semantics untouched.
- [ ] **Step 4: Implement pure normalization/validation/aggregation functions.** Keep the functions deterministic and side-effect free so browser-independent tests do not require a database.
- [ ] **Step 5: Implement job/mapping persistence.** Store parsed payload and saved mapping snapshot as JSON, upsert mapping templates on `(product_name_key, option_name_key)`, expose `loadCustomLabelMappings` for autofill, and make Save idempotent for the same job.
- [ ] **Step 6: Run the focused test to verify it passes.** Run `node --test tests/shopee-custom-label.logic.test.mjs`; expect all tests to pass.
- [ ] **Step 7: Run regression inventory tests.** Run `node --test tests/inventory-db.logic.test.mjs tests/inventory.logic.test.mjs tests/platform-orders.logic.test.mjs`; expect no regressions.
- [ ] **Step 8: Commit the task.** `git add forms/inventory-db.logic.js forms/shopee-custom-label.logic.js tests/shopee-custom-label.logic.test.mjs && git commit -m "feat: add Shopee custom label job and bundle mappings"`

### Task 2: Implement PDF parser and renderer against the real fixture

**Files:**
- Create: `scripts/shopee_custom_label_pdf.py`
- Create: `tests/fixtures/shopee-custom-label-sample.pdf`
- Create: `tests/shopee-custom-label-pdf.test.py`

**Interfaces:**
- `normalize_text(value: str) -> str`
- `parse_pdf(input_path: Path) -> dict`
- `render_custom_label(input_path: Path, output_path: Path, page_payloads: list[dict]) -> None`
- CLI: `shopee_custom_label_pdf.py parse --input INPUT.pdf --output PARSED.json`
- CLI: `shopee_custom_label_pdf.py render --input INPUT.pdf --output OUTPUT.pdf --payload PAYLOAD.json`

- [ ] **Step 1: Copy the user-provided PDF to the fixture path without modifying its bytes.** Record that the fixture is 19 pages, A4, text-based, and contains the Thai private-use glyphs observed during inspection.
- [ ] **Step 2: Write failing parser tests.** Assert 19 pages, one order per page, known order IDs from pages 1 and 19, normalized visible Thai text on page 1, item quantity `1`, and a synthetic page/fixture case with wrapped name/option text and two rows.
- [ ] **Step 3: Run the Python parser tests to verify they fail.** Run `/Users/tar/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 tests/shopee-custom-label-pdf.test.py -v`; expect the script or parser entry points to be missing.
- [ ] **Step 4: Implement `normalize_text`.** Normalize private-use tone glyphs, remove `(cid:0)` markers, collapse whitespace, and apply NFC without altering meaningful Thai or SKU characters.
- [ ] **Step 5: Implement coordinate-based parsing.** Use `pdfplumber.extract_words` and page dimensions to find order numbers and the lower table header, assign words to name/option/quantity x ranges, group wrapped text by y bands, and return `{ pages: [{ pageNumber, orderNo, status, items: [{ productName, optionName, quantity, mappingKey }] }] }`.
- [ ] **Step 6: Implement lower-block rendering.** Use source page dimensions, whiteout only the product block below the delivery separator, draw `Manual SKU`/`จำนวน` rows from aggregated payload, redraw the order number footer, and reject overflow rather than clipping. Preserve all upper content and page rotations.
- [ ] **Step 7: Add render assertions and visual fixture checks.** Assert output page sizes and extracted manual SKU/quantity text; render first page and a long-text page with Poppler for later visual inspection.
- [ ] **Step 8: Run the Python tests to verify they pass.** Run `/Users/tar/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 tests/shopee-custom-label-pdf.test.py -v`; expect parser, normalization, multi-row, overlay, size, and overflow tests to pass.
- [ ] **Step 9: Commit the task.** `git add scripts/shopee_custom_label_pdf.py tests/fixtures/shopee-custom-label-sample.pdf tests/shopee-custom-label-pdf.test.py && git commit -m "feat: parse and render uploaded Shopee label PDFs"`

### Task 3: Connect business logic to local-server APIs and safe PDF files

**Files:**
- Modify: `forms/shopee-custom-label.logic.js`
- Modify: `local-server.mjs`
- Test: `tests/shopee-custom-label-api.test.mjs`

**Interfaces:**
- `parseCustomLabelUpload(rootDir: string, file: { originalName: string, type: string, buffer: Buffer }, options?: object) -> Promise<object>`
- `previewCustomLabel(rootDir: string, jobId: number, mappings: object, options?: object) -> Promise<object>`
- `saveCustomLabel(rootDir: string, jobId: number, mappings: object, options?: object) -> Promise<object>`
- `getCustomLabelFile(rootDir: string, jobId: number, kind: "source" | "preview" | "output") -> { path: string, fileName: string }`

- [ ] **Step 1: Write failing API tests.** Start the local server on a temporary root and cover multipart upload, parsed response, source file access, preview generation, preview-not-persisting-template behavior, Save persistence, output access, invalid PDF, and `needs_review`/incomplete bundle rejection.
- [ ] **Step 2: Run the API tests to verify they fail.** Run `node --test tests/shopee-custom-label-api.test.mjs`; expect missing routes/handlers.
- [ ] **Step 3: Implement Python process orchestration.** In `shopee-custom-label.logic.js`, call the bundled Python runtime with explicit arguments, parse JSON output, store source/parsed job files under `data/shopee-custom-labels/`, load saved mapping templates by parsed mapping keys for autofill, and expose only relative/public metadata.
- [ ] **Step 4: Implement preview validation and rendering.** Validate a complete mapping snapshot, aggregate per page, create a temporary preview PDF, update job status to `previewed`, and do not upsert reusable mapping templates.
- [ ] **Step 5: Implement Save transaction.** Validate again, upsert mapping templates, write the exact snapshot into `parsed_payload_json`, render the final PDF to a stable output path, and update status/output path atomically with rollback-safe ordering.
- [ ] **Step 6: Add server handlers and routes.** Add `/shopee-custom-label`, `POST /api/shopee/custom-labels`, `GET /api/shopee/custom-labels/:id`, preview/save routes, and source/preview/output PDF routes with path traversal checks and existing `sendOperationError` conventions.
- [ ] **Step 7: Run API and server regression tests.** Run `node --test tests/shopee-custom-label-api.test.mjs tests/local-server.logic.test.mjs tests/local-server-binding.test.mjs`; expect all to pass.
- [ ] **Step 8: Commit the task.** `git add forms/shopee-custom-label.logic.js local-server.mjs tests/shopee-custom-label-api.test.mjs && git commit -m "feat: expose uploaded Shopee custom label APIs"`

### Task 4: Build the standalone browser workflow

**Files:**
- Create: `forms/shopee-custom-label.html`
- Create: `forms/shopee-custom-label.logic.browser.js`
- Modify: `forms/shopee-workflow.css`
- Test: `tests/shopee-custom-label.html.test.mjs`

**Interfaces:**
- Page controls use stable IDs: `shopeeCustomLabelFile`, `uploadShopeeCustomLabelButton`, `shopeeCustomLabelPages`, `shopeeCustomLabelItems`, `previewShopeeCustomLabelButton`, `saveShopeeCustomLabelButton`, `shopeeCustomLabelOriginalFrame`, `shopeeCustomLabelPreviewFrame`, and `shopeeCustomLabelStatus`.
- Bundle rows use `data-custom-label-bundle`, `data-custom-label-sku`, `data-custom-label-quantity`, and `data-custom-label-remove`.

- [ ] **Step 1: Write failing HTML contract tests.** Assert the route page includes upload, page navigator, item editor, add/remove bundle controls, original/generated PDF frames, Preview/Save buttons, and the new browser script.
- [ ] **Step 2: Run the HTML tests to verify they fail.** Run `node --test tests/shopee-custom-label.html.test.mjs`; expect the page file to be missing.
- [ ] **Step 3: Implement the page structure.** Match existing Shopee workflow navigation/styles, provide accessible labels/status messages, and keep the original and generated PDF panes visibly separate.
- [ ] **Step 4: Implement browser state and upload.** Submit `FormData` to the upload route, render page statuses, select a page, and update both PDF frame URLs with the same `#page=n`.
- [ ] **Step 5: Implement item/bundle editing.** Render parsed/corrected product fields, autofill saved bundles, add/remove unlimited SKU rows, offer inventory suggestions, permit raw SKU text, and validate positive quantities before Preview/Save.
- [ ] **Step 6: Implement Preview and Save actions.** Send the complete mapping snapshot, refresh the generated frame after Preview, disable Save until no page/item is incomplete, and expose output Download/Print controls after Save.
- [ ] **Step 7: Run browser/static and existing page tests.** Run `node --test tests/shopee-custom-label.html.test.mjs tests/shopee-pages.html.test.mjs tests/navigation.html.test.mjs`; expect all to pass.
- [ ] **Step 8: Commit the task.** `git add forms/shopee-custom-label.html forms/shopee-custom-label.logic.browser.js forms/shopee-workflow.css tests/shopee-custom-label.html.test.mjs && git commit -m "feat: add uploaded Shopee custom label page"`

### Task 5: End-to-end verification and visual QA

**Files:**
- Modify: `tests/shopee-custom-label-api.test.mjs` if integration gaps are found.
- Modify: `tests/shopee-custom-label-pdf.test.py` if visual/fixture gaps are found.
- Modify: `docs/superpowers/plans/2026-10-17-shopee-custom-label-upload.md` to check completed tasks.

- [ ] **Step 1: Run targeted Node and Python suites.** Run `node --test tests/shopee-custom-label.logic.test.mjs tests/shopee-custom-label-api.test.mjs tests/shopee-custom-label.html.test.mjs` and `/Users/tar/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 tests/shopee-custom-label-pdf.test.py -v`; fix only issues in this feature.
- [ ] **Step 2: Run full project verification.** Run `./scripts/test.sh`; expect the existing test suite and the new suites to pass.
- [ ] **Step 3: Run `git diff --check` and inspect generated output.** Render the sample output at Poppler resolution and inspect page 1, a page with long product text, and a synthetic multi-SKU page for barcode/QR preservation, no clipped text, and readable manual SKU rows.
- [ ] **Step 4: Verify source immutability and safe file paths.** Compare the uploaded source hash before/after Preview/Save and exercise a path traversal-shaped job/file request; expect the source unchanged and the request rejected/not found.
- [ ] **Step 5: Mark the plan and commit the verification result.** `git add docs/superpowers/plans/2026-10-17-shopee-custom-label-upload.md && git commit -m "test: verify uploaded Shopee custom label workflow"`

## Handoff

After this plan is approved, execute it task-by-task using `superpowers:executing-plans` in this session or `superpowers:subagent-driven-development` with fresh review between tasks. Do not start product-code implementation before the execution method is selected.
