# Task 7 report

Implemented browser E2E coverage for LINE intake, Shopee integration, and admin settings.

## Coverage

- LINE signed webhook intake, signature rejection, provider content download, OCR review/edit, unsupported media, oversized media, confirm/cancel, evidence persistence, and confirm idempotence.
- Shopee connection state, mocked order sync/upsert, manual Stock SKU mapping edit/clear, shipment preparation, arrange, tracking, shipping documents, custom labels, 401 token refresh, and transient provider failure/retry.
- Company-settings normalization and Google Drive configuration updates with callback-origin rendering and secret-preserving edits.
- Provider request logs and persisted API records are asserted alongside browser outcomes.

## Verification

- Focused Chromium: 6 passed.
- Relevant Node tests: 25 passed.
- Round 1 focused Chromium: 7 passed; auth smoke: 3 passed; runner list: 38 tests.
- Runtime used: Node 22 via `npx node@22`; the system Node 16 cannot run the pinned Playwright/SQLite stack.
- Shopee label verification required an isolated temporary Python venv with `pypdf` and `reportlab`; no repository data was changed.

## Round 1 fixes

- `scripts/e2e.sh` now discovers and exports the bundled Python runtime through both `SWEET_HOUSE_PYTHON_BIN` and `SWEET_HOUSE_PYTHON`; fixture child processes inherit it.
- LINE coverage now asserts signed probe handling, OCR payload/result, evidence bytes, and cancel-without-draft persistence.
- Shopee coverage now asserts repeat-sync upsert identity, rendered auth initiation, mapping-clear persistence after reload, and partial arrange state per package.
- Settings coverage now checks the exact configured callback origin and extracts the generated PDF to verify the updated company marker.
- Mock response scripts select the first matching provider/endpoint, preventing unrelated queued responses from making provider journeys flaky.

## Scope note

The existing user changes and `data/` directory were left untouched. The E2E fixture was extended only with synthetic LINE/Shopee credentials and a mock LINE review URL required to exercise the provider-backed journeys.
