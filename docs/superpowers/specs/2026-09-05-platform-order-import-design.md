# Platform Order Import And Stock Deduction Design

## Goal

Build the first platform-order workflow for Sweet House Accounting so Shopee/TikTok sales can be imported, matched to Sale SKU / Bundle SKU mappings, reviewed, and posted to inventory as `sale_out` stock movements. This phase focuses on correct stock deduction and duplicate-safe posting. Platform fee summaries and monthly revenue accounting reports remain later phases.

## Scope

This phase adds a local order-import module with:

- A `/platform-orders` page for uploading CSV/TSV order files and reviewing imported batches.
- Storage for import batches, platform orders, and order lines.
- Matching order lines to existing `sale_skus.sale_sku` mappings, scoped by platform when provided.
- Issue reporting for missing mappings, invalid quantities, duplicate lines, and insufficient stock.
- A `Post to inventory` action that creates `sale_out` movements from bundle components.
- Idempotency so repeated imports or repeated posting do not deduct stock twice.

## Non-Goals

This phase does not:

- Connect directly to Shopee or TikTok APIs.
- Calculate Shopee/TikTok fees, commissions, shipping subsidies, or platform receivables.
- Produce revenue ledger rows or tax reports.
- Support returns, cancellations after posting, or stock reversal workflows.
- Change the Sale SKU / Bundle SKU data model beyond reading the existing mapping.

## Data Model

Add these tables in `sweet-house.sqlite`:

### `platform_order_imports`

Stores one uploaded file/batch.

- `id`
- `import_no`, unique, for display and references.
- `platform`, one of `shopee`, `tiktok`, or `manual`.
- `file_name`
- `status`: `imported`, `ready`, `has_issues`, or `posted`.
- `row_count`
- `matched_line_count`
- `issue_count`
- `posted_at`
- `created_at`
- `updated_at`

### `platform_orders`

Stores distinct platform orders within a batch.

- `id`
- `import_id`
- `platform`
- `order_no`
- `order_date`
- `order_status`
- `buyer_name`
- `created_at`
- Unique key: `platform`, `order_no`.

### `platform_order_lines`

Stores sellable order rows from the uploaded file.

- `id`
- `import_id`
- `order_id`
- `line_no`
- `sale_sku`
- `display_name`
- `quantity`
- `sale_sku_id`
- `match_status`: `matched`, `missing_sale_sku`, `invalid_quantity`, `insufficient_stock`, or `skipped_status`.
- `issue_message`
- `posted_at`
- `created_at`
- Unique key: `order_id`, `line_no`, `sale_sku`.

The existing `stock_movements.reference_type` and `reference_no` fields are used for posted sales. For each component deduction:

- `movement_type`: `sale_out`
- `reference_type`: `platform_order`
- `reference_no`: `{platform}:{order_no}:{line_no}:{sale_sku}`
- `note`: import number and component source

Before creating a `sale_out`, the posting logic checks for an existing movement with the same reference fields and stock SKU. This makes posting idempotent.

## Import File Shape

The parser accepts CSV or TSV. It normalizes common column aliases instead of requiring one exact platform export format.

Required normalized fields:

- `platform`, optional when the UI platform selector supplies it.
- `orderNo`
- `saleSku`
- `quantity`

Optional normalized fields:

- `lineNo`; if missing, use the row number within that order.
- `orderDate`
- `orderStatus`
- `displayName`
- `buyerName`

Examples of supported aliases:

- `orderNo`: `order_no`, `order id`, `order number`, `หมายเลขคำสั่งซื้อ`
- `saleSku`: `sale_sku`, `seller sku`, `sku`, `รหัสสินค้า`
- `quantity`: `quantity`, `qty`, `จำนวน`
- `orderStatus`: `status`, `order status`, `สถานะ`

Rows with `orderStatus` containing cancelled/refunded wording are stored with `skipped_status` and are not posted in this phase. Skipped rows do not block posting other lines in the batch. Rows without a status are treated as postable.

## Matching And Stock Deduction

For each imported line:

1. Normalize platform, order number, line number, Sale SKU, and quantity.
2. Match `saleSku` against `sale_skus.sale_sku`.
3. If multiple active Sale SKU mappings have the same code across platforms, prefer the selected/imported platform. If still ambiguous, mark the line as missing mapping.
4. Expand the Sale SKU components from `bundle_components`.
5. Required stock deduction per Stock SKU is `line.quantity * component.quantity`.
6. Check current inventory balance before posting. If any component would go negative, mark the postable line `insufficient_stock` and block posting for that batch.
7. When all postable lines are matched and have enough stock, batch status becomes `ready`.
8. `Post to inventory` writes one `sale_out` movement per component and marks the batch `posted`.

## User Experience

### `/platform-orders`

The page has:

- Upload panel with platform selector, file input, and import button.
- Recent import batches table with status, row count, matched lines, issues, and posted state.
- Import detail panel for the selected batch:
  - Summary metrics.
  - Lines grouped by order number.
  - Issue badges for missing mappings, invalid quantities, skipped cancelled/refunded rows, and insufficient stock.
  - Component preview showing which Stock SKUs will be deducted for matched Sale SKUs.
  - `Post to inventory` button enabled only when the batch is `ready`.

The page links to `/sale-skus` when a line has a missing mapping so the user can create/fix the Sale SKU bundle, then re-import or refresh matching.

### Navigation

Add `Platform Orders` under the inventory menu section, after `Sale SKU / Bundle SKU`.

## API

Add these endpoints:

- `GET /api/platform-orders/imports`
  - Lists recent import batches.
- `GET /api/platform-orders/imports/:id`
  - Returns one batch, its orders, lines, issues, and component preview.
- `POST /api/platform-orders/imports`
  - Multipart upload. Fields: `platform`, `file`.
- `POST /api/platform-orders/imports/:id/post`
  - Posts matched lines to inventory. Safe to retry.

## Error Handling

- Invalid files return a clear JSON error and do not create a partial batch.
- Row-level issues are stored in the line table instead of aborting the entire import.
- Posting is blocked when any postable line has missing mapping, invalid quantity, or insufficient stock. Lines marked `skipped_status` are shown for audit but ignored by posting.
- Posting is safe to retry; existing movement references are detected and skipped.
- Duplicate imported lines update the latest non-posted line data where possible and do not create duplicate stock deductions.

## Tests

Add tests for:

- Schema creation and migration for the platform order tables.
- CSV/TSV parsing with alias normalization.
- Importing rows and matching them to Sale SKU / Bundle SKU mappings.
- Missing mapping and invalid quantity issue states.
- Insufficient stock blocking.
- Posting creates `sale_out` movements for simple and bundle Sale SKUs.
- Posting is idempotent.
- API upload/detail/post routes.
- `/platform-orders` HTML markers and navigation menu link.

## Rollout

Implement behind the new `/platform-orders` page. Existing inventory, substitute receipt, and dashboard flows continue to work unchanged. The first implementation should keep the parser conservative and transparent: if a column cannot be normalized, show the issue rather than guessing silently.

## Next Suggested Task

After this phase, build the Shopee/TikTok fee summary and then monthly revenue/platform-fee/tax-ready accounting reports.
