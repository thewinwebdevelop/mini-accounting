# Plan: LINE OCR Confirmation and Expense Draft

## Task 1 — OCR contract

- Add RED tests for manual result, HTTP request shape, safe normalization, invalid provider output, and byte limits.
- Implement `forms/line-ocr.logic.js` with manual and configured HTTP adapters.

## Task 2 — Persist scan state and read originals

- Add RED tests for local/Supabase `updateScan` and `readOriginal` operations.
- Extend `forms/line-intake.logic.js` and migration `005` with OCR metadata and original-byte reads.

## Task 3 — Server scan and confirmation API

- Add RED HTTP tests for review-triggered OCR, ownership, validation, draft creation, original evidence, and idempotent confirm.
- Wire server routes and the existing expense draft/document adapter without writing Sheets.

## Task 4 — Mini App review form

- Add editable OCR field form, confidence/warning display, and confirm action.
- Verify unauthenticated redirect and safe rendering of provider text.

## Task 5 — Verification

- Run targeted tests, `git diff --check`, and the full `./scripts/test.sh` suite.
- Update deployment checklist with OCR endpoint and Supabase migration settings.
