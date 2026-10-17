# Shopee Arrange Shipment And Custom Label Design

วันที่: 2026-09-25
โปรเจกต์: หจก.สวีทเฮาส์ local accounting web app

## Goal

เพิ่ม workflow สำหรับร้าน Shopee หนึ่งร้าน ให้ผู้ใช้เชื่อมต่อร้าน, ดึงคำสั่งซื้ออัตโนมัติ, กดนัดรับสินค้าจากระบบของเรา, รอ Tracking number, map รายการขายกับ Stock SKU ด้วยตนเอง และสร้าง Custom Label ที่แสดง Stock SKU ก่อนพิมพ์

เฟสนี้เป็น order-to-label workflow เท่านั้น ยังไม่ทำ stock sync กลับ Shopee, การตัด stock จริง, ค่าธรรมเนียม หรือรายงานบัญชี

## User Flow

```text
Connect Shopee shop
  -> Sync orders periodically or by Sync now
  -> Show eligible READY_TO_SHIP orders
  -> Prepare shipment: fetch shipping parameters
  -> Group eligible packages by compatible logistics/location constraints
  -> User selects pickup address and pickup time slot for each group
  -> Confirm arrange shipment for the selected batch
  -> Call Shopee mass_ship_order
  -> Poll tracking numbers when the logistics provider has not returned them yet
  -> Create and download Shopee shipping documents in batch
  -> Overlay mapped Stock SKU on each original Shopee label
  -> User maps each order line to Sale SKU/Stock SKU
  -> Render and print custom label
```

The system must not attempt to observe a click inside Seller Centre. It detects the order state through the Shopee API and performs the arrange-shipment action itself after the user confirms it in this app.

## Scope

### Included

- Shopee OAuth/authorization flow for one shop.
- Server-side Partner ID/Partner Key configuration and token refresh.
- Signed calls to Shopee order and logistics APIs.
- Periodic order sync plus an explicit `Sync now` action.
- Idempotent upsert of orders and order lines.
- Filtering for orders that can be prepared for shipment.
- Shipping-parameter lookup for pickup/drop-off requirements and available slots.
- User-confirmed batch arrange shipment for compatible selected packages.
- Tracking-number refresh with retry state.
- Manual SKU mapping per order line, with optional saved mapping for future orders.
- Batch retrieval of Shopee shipping-document PDFs after Tracking is available.
- PDF overlay that preserves the original Shopee recipient/sender/barcode/tracking design and adds mapped Stock SKU in a non-overlapping box.
- Batch PDF merge and print output.
- Sync, arrange-shipment, tracking, mapping, and print audit records.

### Non-goals

- Push inventory quantity to Shopee.
- Create `sale_out` movements or reserve stock as part of printing.
- Shopee fee, revenue, tax, or accounting reports.
- Automatic cancellation, return, or refund reversal.
- Cross-group batch shipment when packages have incompatible logistics channel or product-location constraints.
- Rebuilding Shopee's label layout from scratch. The original Shopee document is the source of truth for the first label implementation.

## Existing Data Reuse

Reuse the existing inventory tables and platform-order flow:

- `sale_skus` and `bundle_components` for reusable mappings.
- `stock_skus` for printed warehouse identifiers.
- `platform_order_imports`, `platform_orders`, and `platform_order_lines` as the canonical order records.
- Existing `/platform-orders` route and order-review UI as the starting surface.

Extend platform orders without breaking the existing CSV import path. API-sourced rows must be marked with `source = shopee_api` or an equivalent source field and must remain compatible with manual imports.

## Data Model Changes

### `shopee_connections`

- `id`
- `shop_id` unique
- `shop_name`
- `partner_id` or a reference to server configuration
- secured `access_token`
- secured `refresh_token`
- `token_expires_at`
- `status`: `connected`, `expired`, `revoked`, `error`
- `last_sync_at`
- `created_at`, `updated_at`

Secrets must not be rendered into HTML or returned by ordinary API responses.

### `platform_orders` additions

- `source`
- `external_order_id` / `order_sn`
- `shop_id`
- `external_updated_at`
- `shipping_status`
- `tracking_number`
- `shipping_carrier`
- `package_number`
- `shipment_arranged_at`
- `last_synced_at`
- `raw_payload_json` or a protected raw-payload reference
- `shipping_document_path`
- `shipping_document_status`

The unique identity for a Shopee order is `platform + shop_id + order_sn`. If Shopee exposes multiple packages for an order, package identity must be stored separately before enabling multi-package shipment.

### `platform_order_lines` additions

- `external_item_id`
- `external_model_id`
- `external_model_sku`
- `mapping_status`: `unmapped`, `mapped`, `needs_review`
- `mapping_source`: `manual`, `saved_rule`, `platform_sku`
- `mapped_sale_sku_id`
- `issue_message`

For bundles, use the existing Sale SKU and `bundle_components` relationship.

### `shopee_sync_runs`

- `id`, `shop_id`
- `started_at`, `finished_at`
- `cursor` or time-window watermark
- `orders_found`, `orders_upserted`, `orders_failed`
- `status`, `error_message`

### `shipment_actions`

- `id`, `platform_order_id`
- `action_type`: `shipping_parameters`, `arrange_shipment`, `tracking_refresh`
- request idempotency key
- request payload without secrets
- response status/code
- `status`: `pending`, `succeeded`, `retrying`, `failed`
- `last_error`, `created_at`, `updated_at`

### `order_label_prints`

- `id`, `platform_order_id`, `template_name`
- `printed_at`, `print_count`

### `shipment_batches`

- `id`, `shop_id`
- `logistics_channel_id`, `product_location_id`
- selected pickup address/time identifiers
- `status`: `prepared`, `confirmed`, `arranging`, `arranged`, `tracking_pending`, `documents_pending`, `ready_to_print`, `partially_failed`, `failed`
- `created_at`, `updated_at`

### `shipment_batch_orders`

- `batch_id`, `platform_order_id`
- `package_number`
- `status`, `error_message`
- `tracking_number`

### `shipping_document_jobs`

- `id`, `batch_id`
- Shopee job/task identifier
- requested document type
- `status`: `created`, `processing`, `ready`, `failed`
- downloaded file path
- `created_at`, `updated_at`

## Shopee API Flow

1. Authorization redirects the seller to Shopee and receives the callback with shop credentials/tokens.
2. The server refreshes an expiring access token before private API calls.
3. Order sync calls order-list using an update-time window or cursor, then calls order-detail for new/changed orders.
4. The UI only enables arrange shipment when the latest order/package data is eligible.
5. Selected packages are grouped by compatible `logistics_channel_id` and `product_location_id`; each group becomes one shipment batch.
6. `get_mass_shipping_parameter` is called before showing pickup choices. The user selects the returned address and time slot for each group.
7. On explicit confirmation, `mass_ship_order` is called for the selected batch. If the market or logistics channel does not support mass shipment, the UI falls back to individual `ship_order` calls with the same confirmation and idempotency rules.
8. For integrated logistics, the system polls `get_mass_tracking_number` with bounded retry/backoff because Tracking may be empty immediately after shipment arrangement.
9. After Tracking is available, the system creates a shipping-document task for the selected packages, polls the result until `READY`, then downloads the original Shopee PDF.
10. The PDF overlay renderer adds mapped Stock SKU to a configured safe area per logistics channel without covering recipient, sender, barcode, QR code, or Tracking number.
11. The final overlaid PDFs are merged in batch order and shown in the print preview.

The implementation must use the current Shopee API documentation and validate permission availability for the target Thailand shop before production rollout. Package-level readiness fields should be preferred when available; an order-level status alone must not be assumed to prove that every package is ready.

## UI Design

### Shopee settings

- Connect/authorize shop.
- Connection status and last sync time.
- `Sync now` button.
- Recent sync and API errors.

### Platform orders

- Filters: ready to ship, shipment action pending, tracking pending, mapping required, ready to print, printed.
- Order row shows order number, status, carrier, tracking, item count, mapping state, and shipment action state.
- `Prepare shipment` fetches and displays available shipping choices.
- `Confirm arrange shipment` is a separate confirmation for the external action.
- `Refresh tracking` is available while tracking is pending.
- SKU mapping editor shows each external item/model, quantity, current mapping, and Stock SKU/component preview.
- `Create custom label` is enabled only after every printable line has a valid mapping.

### Custom label

The first implementation uses the original downloaded Shopee shipping-document PDF as the background and adds a print-safe Stock SKU overlay. It includes the original order number, recipient, address, phone when available, carrier, Tracking number, barcode/QR code, product/variation information, and the added Stock SKU or expanded bundle components.

The overlay position is configurable per logistics channel and must be verified against a real PDF fixture before production printing. A fallback custom HTML label remains available only when Shopee cannot provide a shipping document for a package.

## Error Handling

- Never retry `ship_order` blindly after an uncertain network response. Re-fetch order/package state first and check whether shipment was already arranged.
- Disable arrange shipment when the order is canceled, already arranged, not logistics-ready, or an unsupported fulfillment type.
- Show Shopee's error code/message in a human-readable UI while keeping raw diagnostics in the action log.
- If Tracking is empty after a successful arrange call, show `tracking_pending` and retry on a bounded schedule.
- Batch retries must operate per package. A successful package must never be arranged again because another package in the same batch failed.
- If shipping-document creation or download fails, preserve the arranged shipment and allow document retry without calling arrange shipment again.
- If a mapping is missing, keep the order imported and block only label creation for that order.
- Sync retries must be idempotent and must not duplicate orders or lines.
- Do not log Partner Key, access tokens, refresh tokens, or full unredacted customer data.

## API Endpoints In This App

- `GET /api/shopee/connection`
- `POST /api/shopee/authorize`
- `GET /api/shopee/callback`
- `POST /api/shopee/sync`
- `GET /api/platform-orders`
- `GET /api/platform-orders/:id`
- `POST /api/platform-orders/:id/shipping-parameters`
- `POST /api/platform-orders/:id/arrange-shipment`
- `POST /api/platform-orders/:id/refresh-tracking`
- `POST /api/platform-orders/:id/sku-mapping`
- `GET /api/platform-orders/:id/label`
- `POST /api/platform-orders/:id/label-print`
- `POST /api/shopee/shipment-batches/prepare`
- `POST /api/shopee/shipment-batches/:id/arrange`
- `POST /api/shopee/shipment-batches/:id/refresh-tracking`
- `POST /api/shopee/shipment-batches/:id/create-documents`
- `POST /api/shopee/shipment-batches/:id/overlay-labels`
- `GET /api/shopee/shipment-batches/:id/print-preview`

## Verification

- Unit tests for request signing, token refresh, response normalization, order upsert, and idempotency.
- Fixture tests for `READY_TO_SHIP`, already-arranged, canceled, unsupported fulfillment, missing Tracking, and API error responses.
- Batch grouping tests for compatible and incompatible logistics/location combinations.
- Batch arrange tests for partial success, per-package retry, and no duplicate arrange calls.
- Shipping-document job tests for create, poll-to-ready, download, and retry without re-arranging shipment.
- PDF overlay tests for preserving the original page size and placing Stock SKU without covering protected label regions.
- Tests that shipping parameters render returned pickup addresses and slots without inventing options.
- Tests that arrange-shipment confirmation creates exactly one action and does not duplicate after retry.
- Tests for manual mapping, saved mapping reuse, bundle preview, unmapped blocking, and label rendering.
- API/UI tests for the existing CSV import path to confirm it still works.
- Use sandbox/test credentials before enabling production arrange shipment.

## Acceptance Criteria

- A seller can authorize one Shopee shop and see a connected status.
- A sync run imports new or changed orders without duplicates.
- A `READY_TO_SHIP` order can show valid pickup choices and be arranged from this app after confirmation.
- Multiple compatible orders can be arranged as one batch, with partial failures isolated per package.
- Tracking is stored when Shopee returns it, including delayed-return handling.
- A user can manually map every line to Sale SKU/Stock SKU and print the original Shopee label with the mapped Stock SKU overlaid.
- Shipping-document download and PDF overlay can be retried without repeating shipment arrangement.
- No inventory quantity or accounting movement changes as a side effect of this MVP.
