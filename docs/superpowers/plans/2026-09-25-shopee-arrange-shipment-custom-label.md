# Shopee Arrange Shipment And Custom Label Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect one Shopee shop, sync eligible orders, arrange compatible shipment batches, download Shopee shipping PDFs, overlay manually mapped Stock SKU, and print the merged batch.

**Architecture:** Add a provider-neutral Shopee client and keep Shopee payloads behind normalization functions. Reuse `platform_orders` and existing Sale SKU/Bundle SKU data, adding shipment batches and document jobs for idempotent external actions. Use a small Python PDF helper with the bundled `pypdf`/`reportlab` runtime for overlaying SKU text onto the downloaded Shopee PDF without rebuilding the carrier label.

**Tech Stack:** Node.js built-ins (`node:sqlite`, `fetch`, `crypto`), existing local HTTP server and browser forms, Python `pypdf`/`reportlab` for PDF overlay, Node test runner, Python unittest.

**Spec:** `docs/superpowers/specs/2026-09-25-shopee-arrange-shipment-custom-label-design.md`

## Global Constraints

- One Shopee shop and one package per order in the first slice.
- No inventory quantity changes, `sale_out`, or accounting effects from this workflow.
- Never retry an uncertain arrange-shipment request without re-fetching current shipment state.
- Do not log Partner Key, access tokens, refresh tokens, or unredacted customer data.
- Preserve the existing CSV import path and existing `/platform-orders` behavior.
- Use the original Shopee shipping-document PDF as the label background; overlay only in a configured safe area.

## Review Focus

- Token expiry and refresh during an order or shipment request: test that a 401 refreshes once and retries without exposing secrets (Task 2).
- Duplicate/uncertain batch arrange responses: test that already-arranged packages are not submitted again (Task 4).
- Mixed logistics channels and partial batch failure: test grouping and per-package status isolation (Task 4).
- Delayed Tracking and shipping-document readiness: test bounded polling and retry without repeating arrange shipment (Tasks 4 and 5).
- PDF pages with different sizes/rotations: test that overlay preserves page dimensions and does not write into protected barcode regions (Task 5).

## File Map

- Create `forms/shopee-client.logic.js`: request signing, HTTP transport boundary, and normalized Shopee responses.
- Create `forms/shopee-auth.logic.js`: connection persistence and token refresh orchestration.
- Create `forms/shopee-orders.logic.js`: order sync and order-payload normalization.
- Create `forms/shopee-shipment.logic.js`: eligibility, batch grouping, shipping parameters, arrange, Tracking, and document jobs.
- Create `scripts/overlay_shipping_label.py`: safe PDF overlay and batch merge helper.
- Modify `forms/inventory-db.logic.js`: schema additions and migrations.
- Modify `forms/platform-orders.logic.js`: API-order upsert, mapping, batch/label queries.
- Modify `local-server.mjs`: Shopee and shipment endpoints.
- Modify `forms/platform-orders.html` and `forms/platform-orders.logic.browser.js`: settings, batch selection, mapping, shipment confirmation, and print preview.
- Create `tests/shopee-client.logic.test.mjs`, `tests/shopee-orders.logic.test.mjs`, `tests/shopee-shipment.logic.test.mjs`, `tests/shipping-label-overlay.test.py`.
- Modify `tests/platform-orders.logic.test.mjs`, `tests/platform-orders.html.test.mjs` for compatibility and new UI markers.

### Task 1: Add schema and normalized order/shipment records

**Files:**
- Modify: `forms/inventory-db.logic.js`
- Modify: `forms/platform-orders.logic.js`
- Test: `tests/shopee-orders.logic.test.mjs`

**Interfaces:**
- Produces `ensureInventorySchema()` tables for `shopee_connections`, `shopee_sync_runs`, `shipment_batches`, `shipment_batch_orders`, `shipment_actions`, and `shipping_document_jobs`.
- Produces `upsertShopeeOrder(rootDir, payload, options)` and `getShopeeOrder(rootDir, orderKey)`.

- [ ] Write failing tests for schema creation, unique `(platform, shop_id, order_sn)`, API order upsert, and repeated upsert updating rather than duplicating.
- [ ] Run `./scripts/test.sh` targeted with `node --test tests/shopee-orders.logic.test.mjs` and confirm the new exports/tables are missing.
- [ ] Add migrations and indexes without changing existing table semantics or CSV import behavior.
- [ ] Implement normalized order/line persistence including `item_id`, `model_id`, package, shipping, and raw payload fields.
- [ ] Run the targeted tests and then the existing `tests/platform-orders.logic.test.mjs` suite.
- [ ] Commit with `feat: add Shopee order and shipment persistence`.

### Task 2: Implement Shopee authorization, signing, and order sync

**Files:**
- Create: `forms/shopee-client.logic.js`
- Create: `forms/shopee-auth.logic.js`
- Create: `forms/shopee-orders.logic.js`
- Modify: `local-server.mjs`
- Test: `tests/shopee-client.logic.test.mjs`
- Test: `tests/shopee-orders.logic.test.mjs`

**Interfaces:**
- `createShopeeClient({ partnerId, partnerKey, fetchImpl, baseUrl, now })` exposes `buildAuthorizationUrl()`, `request()`, and `refreshAccessToken()`.
- `syncShopeeOrders(rootDir, { connectionId, client, now })` returns `{ syncRun, imported, updated, failed }`.

- [ ] Write failing tests for HMAC signing, authorization URL parameters, 401 refresh-and-retry, response normalization, time-window cursoring, and duplicate-safe order sync.
- [ ] Run `node --test tests/shopee-client.logic.test.mjs tests/shopee-orders.logic.test.mjs` and confirm failure for missing client/sync modules.
- [ ] Implement signing and transport with dependency-injected `fetchImpl`; keep credentials server-side.
- [ ] Implement authorization callback persistence and token refresh with one retry only.
- [ ] Implement order list/detail calls and map Shopee fields to the canonical order tables.
- [ ] Add `GET /api/shopee/connection`, `POST /api/shopee/authorize`, `GET /api/shopee/callback`, and `POST /api/shopee/sync` routes.
- [ ] Run targeted tests and existing server startup/API tests.
- [ ] Commit with `feat: connect Shopee authorization and order sync`.

### Task 3: Add batch shipment preparation and arrange action

**Files:**
- Create: `forms/shopee-shipment.logic.js`
- Modify: `forms/platform-orders.logic.js`
- Modify: `local-server.mjs`
- Test: `tests/shopee-shipment.logic.test.mjs`

**Interfaces:**
- `groupEligibleShopeePackages(orders)` returns deterministic groups keyed by logistics channel and product location.
- `prepareShipmentBatch(rootDir, orderIds, { client, now })` returns batch groups and returned pickup choices.
- `arrangeShipmentBatch(rootDir, batchId, selection, { client, now })` returns per-package results and never resubmits a succeeded/arranged package.

- [ ] Write failing tests for READY_TO_SHIP eligibility, canceled/already-arranged rejection, compatible grouping, mixed-group split, shipping parameter normalization, partial batch success, and uncertain-response re-fetch.
- [ ] Run `node --test tests/shopee-shipment.logic.test.mjs` and confirm missing implementation failures.
- [ ] Implement grouping and batch persistence; store one `shipment_action` per external operation.
- [ ] Implement mass shipping parameter lookup and returned address/time-slot validation.
- [ ] Implement `mass_ship_order` with individual `ship_order` fallback when the provider rejects batch support.
- [ ] Add `POST /api/shopee/shipment-batches/prepare` and `POST /api/shopee/shipment-batches/:id/arrange`.
- [ ] Run targeted shipment tests and existing platform-order tests.
- [ ] Commit with `feat: arrange Shopee shipment batches`.

### Task 4: Add Tracking and shipping-document jobs

**Files:**
- Modify: `forms/shopee-shipment.logic.js`
- Modify: `local-server.mjs`
- Test: `tests/shopee-shipment.logic.test.mjs`

**Interfaces:**
- `refreshBatchTracking(rootDir, batchId, { client, now })` updates each package independently.
- `createShippingDocumentJob(rootDir, batchId, { client, now })` creates and persists a Shopee document task only after Tracking is available.
- `pollShippingDocumentJob(rootDir, jobId, { client, now })` returns `pending`, `ready`, or `failed`.

- [ ] Write failing tests for delayed mass Tracking, bounded retry state, document creation after Tracking, poll-to-ready, and retrying document download without re-arranging shipment.
- [ ] Run the targeted tests and confirm missing Tracking/document behavior.
- [ ] Implement mass Tracking refresh and individual package status updates.
- [ ] Implement create/poll/download shipping-document calls and secure local file storage.
- [ ] Add `POST /api/shopee/shipment-batches/:id/refresh-tracking`, `POST /api/shopee/shipment-batches/:id/create-documents`, and protected document download handling.
- [ ] Run targeted tests and all order/shipment tests.
- [ ] Commit with `feat: retrieve Shopee tracking and shipping documents`.

### Task 5: Overlay mapped Stock SKU and merge batch PDFs

**Files:**
- Create: `scripts/overlay_shipping_label.py`
- Create: `tests/shipping-label-overlay.test.py`
- Modify: `forms/shopee-shipment.logic.js`
- Modify: `local-server.mjs`

**Interfaces:**
- CLI: `overlay_shipping_label.py --input INPUT.pdf --output OUTPUT.pdf --overlay-json JSON`.
- Overlay JSON contains `page`, `x`, `y`, `width`, `height`, `text_lines`, `font_size`, and `protected_regions`.
- `renderBatchLabels(rootDir, batchId, mappings)` returns the merged output path and per-order output metadata.

- [ ] Write failing Python tests for page-size preservation, UTF-8 Thai text, protected-region collision rejection, and multi-page/batch merge order.
- [ ] Run `python3 -m unittest tests/shipping-label-overlay.test.py -v` and confirm the helper is missing.
- [ ] Implement the helper with bundled `pypdf` and `reportlab`; reject overlays that intersect protected barcode/QR/tracking regions.
- [ ] Implement deterministic per-channel overlay coordinates and merge output pages in selected order.
- [ ] Add `POST /api/shopee/shipment-batches/:id/overlay-labels` and `GET /api/shopee/shipment-batches/:id/print-preview`.
- [ ] Run PDF tests and inspect rendered fixture output with Poppler/PDF tools.
- [ ] Commit with `feat: overlay Stock SKU on Shopee shipping labels`.

### Task 6: Add batch UI, mapping, and print workflow

**Files:**
- Modify: `forms/platform-orders.html`
- Modify: `forms/platform-orders.logic.browser.js`
- Modify: `tests/platform-orders.html.test.mjs`

**Interfaces:**
- UI calls the shipment endpoints from Tasks 2–5 and never handles Shopee secrets.
- Mapping submissions use `POST /api/platform-orders/:id/sku-mapping` and update the line state without posting inventory movements.

- [ ] Write failing HTML tests for connect/sync controls, multi-select order rows, mapping editor, pickup-slot confirmation, batch status, PDF preview, and print controls.
- [ ] Run `node --test tests/platform-orders.html.test.mjs` and confirm the new markers are absent.
- [ ] Add settings and batch action panels while preserving CSV import and existing post controls.
- [ ] Add manual mapping UI with Sale SKU/Stock SKU component preview and saved mapping indicator.
- [ ] Add confirmation modal that shows selected order count, groups, pickup slot, and warnings before external arrange shipment.
- [ ] Add tracking/document status refresh and print preview for the merged overlaid PDF.
- [ ] Run HTML tests and a local server smoke test.
- [ ] Commit with `feat: add Shopee batch shipment label UI`.

### Task 7: End-to-end verification and hardening

**Files:**
- Modify: `tests/shopee-orders.logic.test.mjs`
- Modify: `tests/shopee-shipment.logic.test.mjs`
- Modify: `tests/platform-orders.logic.test.mjs`
- Modify: `docs/feature-checklist.md`

- [ ] Add fixture-backed end-to-end coverage from sync through manual mapping, batch arrange, Tracking refresh, shipping-document download, overlay, and print metadata.
- [ ] Run `./scripts/test.sh` and record all results.
- [ ] Run `git diff --check` and scan logs/tests for secrets or unredacted customer payloads.
- [ ] Render the shipping-label fixture and inspect page dimensions, barcode visibility, and Stock SKU legibility.
- [ ] Run a fresh self-review against the spec and fix any Critical/Important findings with a new RED→GREEN test cycle.
- [ ] Commit with `test: verify Shopee batch label workflow`.
