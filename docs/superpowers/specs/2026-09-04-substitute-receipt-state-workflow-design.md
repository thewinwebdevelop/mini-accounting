# Substitute Receipt State Workflow Design

## Goal

Separate the substitute receipt document lifecycle from inventory receiving. A stock purchase can be paid or approved before the goods arrive, so the system must not always create stock movements at document submission time.

## State Model

Substitute receipts use an explicit `status` field:

- `draft`: editable working copy. No real `SR` number is consumed. No stock movement is created.
- `pending_approval`: submitted for review. An `SR-YYYY-MM-0001` number is assigned, PDFs are generated, and raw evidence is stored. No stock movement is created.
- `approved`: accounting/admin approval is complete. The document is still not stock on hand.
- `received`: goods are received into inventory. Stock movements have been created and reference the `SR` number.
- `cancelled`: a draft or pending document is cancelled before approval or receipt.
- `voided`: an approved/submitted document is voided for audit reasons. If stock was already received, voiding requires reversal/adjustment movements instead of deleting the original movement.

The first implementation should support `draft`, `pending_approval`, `approved`, `received`, and `cancelled`. `voided` can be reserved in the data model and implemented when reversal flows are built.

## State Transitions

Allowed transitions:

- `draft -> pending_approval`: submit document for review.
- `pending_approval -> draft`: return for edits before approval.
- `pending_approval -> approved`: approve document.
- `approved -> received`: receive stock into inventory.
- `draft -> cancelled`: cancel incomplete work.
- `pending_approval -> cancelled`: cancel before approval.
- `approved -> cancelled`: allowed only when no stock movement exists.
- `received -> voided`: future flow only; requires reversal or adjustment movement.

Disallowed transitions:

- Direct `draft -> received`.
- Direct `pending_approval -> received`.
- Editing stock lines after `approved` or `received`.
- Deleting stock movements created from a receipt.

## Edit Rules

While `draft`, every field is editable:

- Document basics.
- Vendor/payment details.
- Receipt type.
- Stock SKU lines, quantity, and unit cost.
- Evidence files.

While `pending_approval`, edits are allowed only if the document is returned to `draft`; this keeps reviewed PDFs and approval state understandable.

While `approved`, non-stock fields may be edited with a revision record and regenerated PDFs:

- Title.
- Vendor/payment details.
- Business purpose.
- Additional evidence files.

For `stock_purchase`, these fields are locked after approval:

- `receiptType`
- `stockSkuId`
- `quantity`
- `unitCost`
- line deletion/addition

While `received`, stock lines and receipt type stay locked. Non-stock field edits may still regenerate PDFs, but the system must keep an audit record showing who changed what and when.

## Inventory Receiving

Inventory receiving is a separate action on an approved stock purchase receipt.

On `approved -> received`, create one `purchase_in` movement per stock line:

- `movement_type`: `purchase_in`
- `movement_date`: user-selected received date
- `quantity`: approved line quantity
- `unit_cost`: approved line unit cost
- `reference_type`: `substitute_receipt`
- `reference_no`: receipt number
- `note`: line description

The operation must be idempotent. If receipt movements already exist for the `SR` number, the receive action must not create duplicates.

Partial receiving is not required in the first implementation. The data model should leave room for it later by keeping receive metadata separate from the document lines.

## Storage

Drafts should be stored under:

- `drafts/YYYY/MM/substitute-receipts/<draftId>/data/draft.json`
- `drafts/YYYY/MM/substitute-receipts/<draftId>/raw/`

Submitted receipts should stay under:

- `documents/YYYY/MM/ใบรับรองแทนใบเสร็จ/SR-YYYY-MM-0001_<safe-title>/data/substitute-receipt.json`
- `documents/YYYY/MM/ใบรับรองแทนใบเสร็จ/SR-YYYY-MM-0001_<safe-title>/raw/`
- `documents/YYYY/MM/ใบรับรองแทนใบเสร็จ/SR-YYYY-MM-0001_<safe-title>/pdf/`

Submitted JSON should include:

- `status`
- `statusHistory`
- `stockReceipt`
- `revisions`

`stockReceipt` should include:

- `receivedAt`
- `receivedDate`
- `receivedBy`
- `movementIds`

## API

Add or extend endpoints:

- `POST /api/substitute-receipt-drafts`: create/update draft.
- `GET /api/substitute-receipt-drafts/:draftId`: load draft.
- `GET /api/substitute-receipts`: list submitted receipts and drafts.
- `GET /api/substitute-receipts/:receiptNo`: load submitted receipt.
- `POST /api/substitute-receipts`: submit draft or payload into `pending_approval`.
- `POST /api/substitute-receipts/:receiptNo/approve`: transition to `approved`.
- `POST /api/substitute-receipts/:receiptNo/receive-stock`: transition to `received` and create stock movements.
- `POST /api/substitute-receipts/:receiptNo/return-to-draft`: transition `pending_approval -> draft`.
- `POST /api/substitute-receipts/:receiptNo/cancel`: cancel when allowed.

## User Experience

The substitute receipt form becomes state-aware:

- Draft button: saves without consuming an `SR` number.
- Submit button: creates `pending_approval`, generates PDFs, and stores raw files.
- Approved documents show a `รับสินค้าเข้าคลัง` action only for `stock_purchase`.
- Received documents show stock receipt metadata and movement references.
- Locked stock lines should appear readable but disabled after approval.

The list/search page should show:

- Status.
- Receipt number or draft ID.
- Vendor.
- Accounting month.
- Total amount.
- Raw/PDF links.
- Available next action.

## Migration

Existing substitute receipts that already created stock movements should be treated as `received`.

During list/load:

- If saved JSON has no `status`, infer `received` when related stock movements exist.
- Otherwise infer `pending_approval` for submitted receipts without movements.

The migration can be lazy at read time for the first implementation; no destructive rewrite is required.

## Testing

Coverage should include:

- Draft saves do not consume `SR` numbers and do not create stock movements.
- Submit creates `pending_approval`, PDFs, and raw files without receiving stock.
- Approve changes status to `approved`.
- Receive stock creates purchase-in movements once and changes status to `received`.
- Re-running receive does not duplicate movements.
- Approved/received stock purchase receipts reject stock line edits.
- Existing submitted receipts without `status` are inferred safely.
