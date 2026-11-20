# LINE invoice workflow

Users send `สร้างเอกสารด้วยใบกำกับภาษี` (or tap a Rich Menu message action containing that text). The bot reads active workflow templates from the existing runtime catalog and offers Quick Replies and numbered choices. Images/PDFs collected in the conversation become private evidence. `ส่งครบแล้ว` opens the authenticated review link.

The review form shows the primary source and editable extraction. Multiple pages of one invoice are supported; use one primary invoice per transaction and keep other files as supporting evidence. Changing the primary invoice rescans it and resets the previous extracted/edited context. Unknown values stay blank; confirm explicit VAT, including zero. Amounts must agree with quantity × unit price. Select existing stock products and receiving date for stock workflows.

- **ยืนยันและทำทุกขั้นตอนอัตโนมัติ** creates and completes documents sequentially through existing submit/approve/receive/complete functions. It requires the corresponding role permissions and validated required fields. One actor is recorded; no other person's signature is manufactured.
- **ยืนยันและดำเนินการเอง** creates only the first draft. Later steps remain blocked until native completion, then receive shared reviewed data through existing prefill. Existing document edits take precedence.

Failure retains transaction/document identities and checkpoints. Open the review link to inspect progress/resume. Completion sends a LINE push containing the review link; notification retries use a stable LINE retry key and do not rerun document operations. Completing every child does not close/lock the parent transaction automatically.

## Configuration

Default: `LINE_WORKFLOW_ENABLED=0`.

1. Apply `supabase/migrations/202611190001_line_workflow_batches.sql` before enabling Cloud Run. State and RPC are service-role-only, with version-based compare-and-swap. Local development uses a separate SQLite state file under the configured runtime root. This first version uses one versioned state row; plan retention/partitioning before high-volume rollout.
2. Configure existing LINE channel ID/secret/access token and public `APP_PUBLIC_ORIGIN`. Configure the existing HTTP OCR adapter (`LINE_OCR_PROVIDER=http`, `LINE_OCR_API_URL`, `LINE_OCR_API_KEY`). With the manual provider the form explicitly asks for manual entry; automatic OCR is not claimed.
3. OCR response: `{fields:{accountingMonth,expenseDate,vendorName,taxId,documentNo,description,amountBeforeVat,vatAmount,withholdingTax},lines?:[{description,quantity,unitCost,amountBeforeVat,vatAmount,withholdingTax}],confidence,warnings}`. Scalar legacy responses still work. Provider must process all pages or return clear partial-read warnings. Validate real invoice layouts with redacted samples before rollout.
4. Defaults: 20 MiB/file, 20 files/batch, 100 pages/PDF. Configure `LINE_INTAKE_MAX_BYTES`, `LINE_WORKFLOW_MAX_FILES`, `LINE_WORKFLOW_MAX_PDF_PAGES`. Reject invalid/encrypted/over-limit files; never silently truncate pages. Docker includes Python/Pillow/pypdf. Set `SWEET_HOUSE_PYTHON` or `SWEET_HOUSE_PYTHON_BIN` for another runtime.
5. Configure Cloud Scheduler to POST `/api/internal/line-workflow/run` every minute, with an OIDC token from a dedicated service account. Set `LINE_WORKFLOW_WORKER_AUDIENCE` to that token's exact audience and `LINE_WORKFLOW_WORKER_EMAIL` to that service-account email. The endpoint checks signature against Google's certificates, issuer, audience, verified email and expiry. It does not accept a user session as worker identity. Each invocation handles one durable scan, execution or notification job, including expired-lease recovery. Increase tick frequency/parallel invocations for throughput; atomic claims prevent workers taking the same lease. Keep the Cloud Run request timeout above the configured 10-minute execution lease; a native operation must finish inside its lease.
6. Enable the flag after configuration and isolated validation. Rich Menu action example: `{"type":"message","label":"สร้างเอกสารจากใบกำกับภาษี","text":"สร้างเอกสารด้วยใบกำกับภาษี"}`. This change does not publish the menu, run production migrations or deploy cloud infrastructure.

The browser also drives the durable execution request after confirmation for prompt feedback. Scheduler recovery handles closed tabs/runtime interruptions. Browser/manual testing uses isolated roots and fake LINE/OCR providers; it does not send real messages or write production stock/documents.

## Verification

See [validation record](line-invoice-workflow-validation.md) for exact commands, results and manual screenshots. Real Supabase migration/runtime verification requires a running isolated Supabase environment via `E2E_SUPABASE_CONFIG`; it must never target production.
