# Shared Vendor Master for Document Forms

## Purpose

Allow every document form to select a saved vendor or enter a new vendor manually. A selected vendor is copied into the document as a snapshot, so later edits to the document do not change the saved vendor. A manually entered vendor can optionally be saved as a reusable master record.

The feature applies to all seven document kinds: `expense_request`, `substitute_receipt`, `purchase_order`, `payment_voucher`, `cash_spend_declaration`, `payee_acknowledgement`, and `goods_receipt`.

## Decisions and constraints

- The vendor master is shared across every document kind.
- `name` is required for a vendor record; `taxId` is optional.
- Selecting a vendor copies its values into the document and records the source `vendorId` when available.
- Editing vendor fields inside a document changes only that document snapshot.
- A vendor marked inactive cannot be selected for new documents, but its snapshot remains visible on existing documents.
- When a new vendor resembles an existing record, the UI warns and asks whether to save a duplicate. The user may explicitly confirm creation.
- Saving a new vendor from a document is optional; users may use a vendor only for that document.
- Existing substitute-receipt vendor settings remain readable and writable through their current route during migration. The shared service must preserve their fields and behavior.
- No existing document payload or old draft is rewritten solely because this feature is introduced.

## Vendor master model

The canonical record has a stable `id`, `status` (`active` or `inactive`), timestamps, and these fields:

| Field | Required | Purpose |
| --- | --- | --- |
| `name` | yes | Vendor/payee display name |
| `taxId` | no | Tax ID or personal ID |
| `address` | no | Billing or contact address |
| `contactName` | no | Contact person |
| `phone` | no | Contact phone |
| `email` | no | Contact email |
| `bankName` | no | Receiving bank |
| `accountNo` | no | Receiving account |
| `paymentChannel` | no | Payment method |
| `paymentReference` | no | Account or payment reference |
| `defaultBusinessPurpose` | no | Optional default purpose for forms that support it |
| `note` | no | Internal note |

Values are trimmed and stored as strings. `taxId` is not normalized into a required numeric format; duplicate matching uses a normalized comparison while preserving the entered display value.

## API and service boundary

Introduce a shared vendor service and API:

- `GET /api/vendors` lists active vendors by default. `includeInactive=1` is available to the settings page.
- `POST /api/vendors` creates a vendor. The request may include `confirmDuplicate: true` after the server reports matching records.
- `PATCH /api/vendors/:id` edits vendor master fields or changes active/inactive status.
- `GET /api/vendors/:id` returns one vendor for settings and form hydration.
- `GET /api/vendors/matches` accepts the normalized candidate fields and returns possible duplicates without creating anything.

The server owns validation, normalization, duplicate matching, and status transitions. Duplicate responses must identify the matching vendor IDs and the fields that matched without exposing filesystem paths or internal storage details.

The current substitute-receipt vendor endpoints become compatibility adapters over the shared service. Existing clients continue to receive the current field names and response shape while new forms use the shared `/api/vendors` contract.

## Document snapshot contract

Each supported document payload keeps its existing field names for rendering and Sheets/PDF compatibility. It additionally stores:

```json
{
  "vendorId": "vendor-...",
  "vendorSnapshot": {
    "name": "...",
    "taxId": "...",
    "address": "...",
    "contactName": "...",
    "phone": "...",
    "email": "...",
    "bankName": "...",
    "accountNo": "...",
    "paymentChannel": "...",
    "paymentReference": "...",
    "defaultBusinessPurpose": "..."
  }
}
```

The form maps the snapshot into its existing fields (`payeeName`, `payeeTaxId`, `paymentBankName`, and so on). On save, the snapshot is rebuilt from the submitted document values, so editing a document never reads changed values back into the master. Existing documents without a snapshot continue to use their existing fields unchanged.

## Form behavior

Every supported form gets the same vendor picker pattern:

1. An accessible searchable select lists active vendors by name and optional tax ID.
2. Selecting a vendor fills the fields supported by that form.
3. The user may edit any filled field before saving the document.
4. “กรอกผู้ขายใหม่” clears the selection and enables manual entry.
5. “บันทึกเป็นผู้ขายประจำ” is available for manual entry and is off by default.
6. If enabled, the form first calls the duplicate check. A match shows the matching records and asks for explicit confirmation before creating a new master record.
7. A failed vendor lookup or save leaves the document fields intact and shows a Thai error; it must not block saving a document-only vendor.

Field mapping is additive: forms that do not currently have address, bank, or contact fields show only their existing fields, while the master retains the full superset for use by forms that support them.

## Security and data integrity

- Vendor IDs are treated as opaque server-owned identifiers; the client cannot select an inactive vendor by changing HTML values.
- The server revalidates the selected vendor and creates the snapshot from the submitted values at document save time.
- Updating or deactivating a vendor never mutates document snapshots.
- Duplicate confirmation is bound to the candidate data and matching IDs returned by the server; stale or altered confirmations are rejected and require a new check.
- Error responses contain user-facing reasons only and no absolute paths or private storage keys.
- Existing authorization and local-server boundaries remain the enforcement point for vendor settings and document writes.

## Migration and compatibility

Existing substitute-receipt vendor records are read through the shared service without changing their IDs or visible values. A lazy migration may attach a shared vendor ID when a user next selects or edits a record, but migration is not required for old documents to render. Old documents retain their original fields and are never rewritten automatically.

## Testing and acceptance

- Unit tests cover normalization, optional `taxId`, duplicate matching, explicit duplicate confirmation, inactive selection rejection, and snapshot isolation.
- API tests cover list/create/update/deactivate, duplicate responses, compatibility routes, and malformed vendor IDs.
- Form tests cover picker hydration for all seven document kinds, manual entry, optional master save, duplicate confirmation, and preserving document data when vendor APIs fail.
- Regression tests prove existing SR vendor settings, Sheets payloads, PDFs, workflow prefill, and old documents remain compatible.
- Browser verification covers selecting a saved vendor, editing only the current document, creating a new preset, and using an inactive vendor snapshot on an existing document.

