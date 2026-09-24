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
  -> User selects pickup address and pickup time slot
  -> Confirm arrange shipment
  -> Call Shopee ship_order
  -> Poll tracking number when the logistics provider has not returned it yet
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
- User-confirmed arrange shipment for one selected order/package at a time in the first slice.
- Tracking-number refresh with retry state.
- Manual SKU mapping per order line, with optional saved mapping for future orders.
- Custom HTML/print label containing recipient, address, shipping data, order number, item quantity, and mapped Stock SKU.
- Sync, arrange-shipment, tracking, mapping, and print audit records.

### Non-goals

- Push inventory quantity to Shopee.
- Create `sale_out` movements or reserve stock as part of printing.
- Shopee fee, revenue, tax, or accounting reports.
- Automatic cancellation, return, or refund reversal.
- Full multi-package or batch shipment operation in the first slice.
- Downloading or modifying Shopee's native shipping document. The first label is a separate custom label.

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

## Shopee API Flow

1. Authorization redirects the seller to Shopee and receives the callback with shop credentials/tokens.
2. The server refreshes an expiring access token before private API calls.
3. Order sync calls order-list using an update-time window or cursor, then calls order-detail for new/changed orders.
4. The UI only enables arrange shipment when the latest order/package data is eligible.
5. `get_shipping_parameter` is called before showing pickup choices. The user selects the returned address and time slot.
6. On explicit confirmation, `ship_order` is called with the selected pickup/drop-off data.
7. For integrated logistics, the system polls `get_tracking_number` with bounded retry/backoff because Tracking may be empty immediately after shipment arrangement.
8. The final order state and Tracking number are shown in the label preview.

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

The first implementation uses a print-optimized HTML view. It includes order number, recipient, address, phone when available, carrier, Tracking number, product/variation name, quantity, and Stock SKU or expanded bundle components.

The label is separate from Shopee's native shipping document. Native shipping-document download can be added later.

## Error Handling

- Never retry `ship_order` blindly after an uncertain network response. Re-fetch order/package state first and check whether shipment was already arranged.
- Disable arrange shipment when the order is canceled, already arranged, not logistics-ready, or an unsupported fulfillment type.
- Show Shopee's error code/message in a human-readable UI while keeping raw diagnostics in the action log.
- If Tracking is empty after a successful arrange call, show `tracking_pending` and retry on a bounded schedule.
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

## Verification

- Unit tests for request signing, token refresh, response normalization, order upsert, and idempotency.
- Fixture tests for `READY_TO_SHIP`, already-arranged, canceled, unsupported fulfillment, missing Tracking, and API error responses.
- Tests that shipping parameters render returned pickup addresses and slots without inventing options.
- Tests that arrange-shipment confirmation creates exactly one action and does not duplicate after retry.
- Tests for manual mapping, saved mapping reuse, bundle preview, unmapped blocking, and label rendering.
- API/UI tests for the existing CSV import path to confirm it still works.
- Use sandbox/test credentials before enabling production arrange shipment.

## Acceptance Criteria

- A seller can authorize one Shopee shop and see a connected status.
- A sync run imports new or changed orders without duplicates.
- A `READY_TO_SHIP` order can show valid pickup choices and be arranged from this app after confirmation.
- Tracking is stored when Shopee returns it, including delayed-return handling.
- A user can manually map every line to Sale SKU/Stock SKU and print a label with the mapped Stock SKU.
- No inventory quantity or accounting movement changes as a side effect of this MVP.
