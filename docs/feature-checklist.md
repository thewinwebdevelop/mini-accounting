# Sweet House Accounting Feature Checklist

## Done

- [x] Inventory foundation: product master, Stock SKU, color, size, default cost, purchase-in movement, stock card, and inventory balances.
  - Next suggested task: add configurable inventory categories.
- [x] Configurable inventory categories: product category master, dropdown on inventory product form, and inventory category settings page.
  - Next suggested task: build substitute receipt documents with evidence packet and stock purchase-in automation.
- [x] Substitute receipt documents: create a form, save submitted documents, generate substitute receipt PDF, include evidence in the same audit packet, and store raw evidence files.
  - Next suggested task after completion: add submitted substitute receipt list/search and Google Drive sync.
- [x] Stock purchase automation from substitute receipts: when the document type is stock purchase, select Stock SKUs and create purchase-in movements using the substitute receipt number as reference.
  - Next suggested task after completion: add Sale SKU / Bundle SKU mapping.
- [x] Substitute receipt state workflow: draft, pending approval, approved, and received states with separate stock receiving.
  - Next suggested task after completion: Google Drive sync for substitute receipt packets.
- [x] Google Drive sync for substitute receipt packets.
  - Next suggested task after completion: approve-to-Google-Sheets monthly expense ledger.
- [x] Approve-to-Google-Sheets monthly expense ledger: approved expense requests and substitute receipts record or update monthly Google Sheet rows with retry status.
  - Next suggested task after completion: Sale SKU / Bundle SKU mapping.
- [x] Sale SKU / Bundle SKU mapping for Shopee/TikTok listings and sets.
  - Next suggested task after completion: substitute receipt vendor presets.
- [x] Substitute receipt vendor presets: vendor/payee master settings page, selectable preset in substitute receipt form, and manual entry fallback.
  - Next suggested task after completion: mobile-friendly substitute receipt line item editing.
- [x] Substitute receipt mobile line item UX: collapse/expand each added line on mobile like the expense request form.
  - Next suggested task after completion: split hamburger document sections.
- [x] Hamburger menu document grouping: separate substitute receipt links into their own menu section instead of grouping them under expense requests.
  - Next suggested task after completion: inventory dashboard.
- [x] Inventory dashboard: total inventory value, current stock PDF export for tax/accounting evidence, and latest stock-in report with at least 10 rows plus see-more detail.
  - Next suggested task after completion: full stock list.
- [x] Full stock list: search/filter, parent-only vs all-SKU mode, grouped parent/child sections with collapsed children by default.
  - Next suggested task after completion: product detail workspace.
- [x] Product detail workspace: open parent product detail, edit parent and child SKUs, and view related stock in/out history in an easy scanning layout.
  - Next suggested task after completion: product image uploads.
- [x] Product image uploads: optional image upload for parent products and child Stock SKUs.
  - Next suggested task after completion: create product flow from stock list.
- [x] Add new product flow from stock list: menu/button opens the existing create parent/child product workflow from the list experience.
  - Next suggested task after completion: import platform orders and deduct stock.
- [x] Import platform orders and deduct stock from Sale SKU / Bundle SKU mappings.
  - Next suggested task after completion: Shopee/TikTok fee summary.

## Current

- [ ] Shopee/TikTok fee summary.

## Requested Next


## Later

- [ ] Monthly stock purchase report for accounting review.
  - Next suggested task after completion: Sale SKU / Bundle SKU mapping.

## Upcoming
