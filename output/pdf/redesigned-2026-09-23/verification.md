# PDF redesign verification

Updated all six PDF generator/style modules. Preserved calculations, populated business fields, signatures, document selection and raw attachment handling. Added bundled Sarabun Regular/SemiBold with OFL license.

- Generated 10 document examples (13 pages including the audit packet's embedded reimbursement form).
- Rendered and visually reviewed the final pages with Poppler.
- Checked that final PDFs have text and no characters outside their page boundaries.
- Existing Python PDF tests: 27 passed, including VAT, withholding, mixed/legacy tax states, large totals, and standalone audit-packet annexing.
- Compared old and new generators with identical sample input: all 10 document types retained 257 checked source values and labels (including line items, amounts, notes, references, and signature roles).
- Stress checks: 60 workflow lines, 60 substitute-receipt lines, 50 expense lines with 20 evidence entries, tall image evidence, and a missing attachment. Generated successfully; content remained within page boundaries.
- Verified final amounts through 9,999,999,999.99 stay on one line.
- Integration tests (local-server.logic and workflow-api): 138 passed, 1 pre-existing failure. The regression for signable approval labels passes.

Known pre-existing integration failure: `saveSubstituteReceiptSubmission writes PDF packet, raw evidence, and workflow data` in `tests/local-server.logic.test.mjs`. It supplies `additionalNote`, while the current form payload normalizer retains `paymentNote`. The failure was reproduced in a separate temporary copy of unchanged HEAD `9eddacb`, with the same missing-note assertion. PDF rendering still supports both fields when provided.

These artifacts contain sample data. The new templates apply when the application generates PDFs; existing saved business PDFs were not rewritten.

## Checklist pagination update

Expense reimbursement totals and signatures precede a forced page break. The evidence checklist always begins on a fresh page with its own header. Verified empty, two-line, and 50-line expenses; all line items remain before the checklist. Rebuilt the reimbursement PDF, audit packet, combined sample PDF, and gallery.

## VAT sample update

Added VAT-aware sample values to the five lightweight document PDFs: purchase order, payment voucher, cash-spend declaration, payee acknowledgement, and goods receipt. Verified the combined 13-page sample PDF contains the VAT breakdown on each updated document while the reimbursement checklist still starts on its own page.

## Standalone audit packet

When a lightweight standalone document has uploaded evidence, the application keeps `01_<document-kind>.pdf` clean and creates `02_ชุดรวมเอกสาร_audit-packet.pdf` beside it. The audit packet contains the form, an evidence index, and the uploaded evidence annexes; documents without evidence keep only the clean form PDF. Raw originals remain available in the `raw/` folder.
