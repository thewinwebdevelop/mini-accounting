# Substitute Receipt And Stock Purchase Design

## Goal

Add a substitute receipt workflow for purchases without seller-issued receipts. The workflow must generate a PDF substitute receipt, keep uploaded evidence in raw storage, include readable evidence in the PDF audit packet, and create inventory purchase-in movements automatically when the receipt is for stock.

## Scope

This slice builds the first working version:

- Substitute receipt form and browser controller.
- Submitted substitute receipt save endpoint.
- Local document folder storage with `data/`, `raw/`, `working-md/`, and `pdf/`.
- PDF generation for the substitute receipt and the audit packet with raw evidence annexes.
- Stock purchase lines linked to existing Stock SKUs.
- Automatic `purchase_in` movement creation for stock purchase receipts.
- Navigation links from existing pages.

The slice does not include Google Drive sync, searchable substitute receipt list, Sale SKU mapping, Shopee/TikTok import, or accounting reports. Those remain next tasks in `docs/feature-checklist.md`.

## Data Model

Substitute receipt records are file-backed in the same style as expense submissions.

- Folder: `documents/YYYY/MM/ใบรับรองแทนใบเสร็จ/SR-YYYY-MM-0001_<safe-title>/`
- Data: `data/substitute-receipt.json`
- Working markdown: `working-md/substitute-receipt.md`
- Raw evidence: `raw/`
- PDFs: `pdf/01_ใบรับรองแทนใบเสร็จรับเงิน.pdf` and `pdf/02_ชุดรวมส่งตรวจ_ใบรับรองแทนใบเสร็จ.pdf`

The document number prefix is `SR` to keep it separate from existing `REQ` reimbursement numbers.

## Evidence

Evidence groups:

- `paymentSlip`: slip, bank statement, or payment proof.
- `purchaseOrder`: chat, order page, quotation, or purchase confirmation.
- `goodsReceived`: product receiving photos or warehouse evidence.
- `otherEvidence`: other supporting documents.

Uploads are stored as raw files with stable names derived from evidence group and sequence. The PDF packet includes the substitute receipt summary, the signed substitute receipt, and annex pages for raw evidence. PDFs are appended directly when possible; images are rendered into annex pages; unsupported file types are referenced by filename.

## Stock Purchase Automation

The form has a `receiptType` field. For `stock_purchase`, each stock line must include:

- `stockSkuId`
- `sku`
- `description`
- `quantity`
- `unitCost`

On submit, the server validates active Stock SKUs, saves the document, then creates one `stock_movements` row per stock line:

- `movement_type`: `purchase_in`
- `movement_date`: receipt date
- `quantity`: line quantity
- `unit_cost`: line unit cost
- `reference_type`: `substitute_receipt`
- `reference_no`: substitute receipt number
- `note`: line description

The stock movement function remains in the inventory module. The substitute receipt module calls it through a clear interface so future receipt edits can add reversal/update logic without mixing PDF storage code into inventory code.

For this first slice, submitted substitute receipts are immutable. Editing a submitted stock receipt will be handled later with reversal movements to preserve an audit trail.

## Validation

Required for every substitute receipt:

- Accounting month.
- Receipt date.
- Payee/vendor name.
- Business purpose.
- At least one valid line.
- At least one payment proof or purchase evidence file.

Additional required for `stock_purchase`:

- Every line must select a Stock SKU.
- Quantity must be greater than 0.
- Unit cost must be greater than 0.

## User Experience

Add `/substitute-receipt` as a focused form page. The first screen is the working form, not a landing page. It includes:

- Document basics.
- Vendor/payment information.
- Receipt type selector.
- Stock purchase lines with Stock SKU dropdown and cost fields.
- Evidence upload cards.
- Live total summary.
- Save/submit button.

Add menu links from the app navigation under the accounting document group.

## Testing

Use the bundled Node runtime through `./scripts/test.sh`. Test coverage must include:

- Substitute receipt payload validation and totals.
- Stable raw file names and markdown output.
- Server save behavior creates data, raw files, and PDFs.
- Stock purchase receipt creates inventory purchase-in movements with the substitute receipt number reference.
- API smoke coverage for form data submission.
- HTML tests for the new form and navigation links.

