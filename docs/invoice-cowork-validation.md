# Invoice cowork validation — 2026-11-20

Implementation is in this project checkout. It has not been deployed or enabled in production. No production records, stock, LINE messages, or real invoice samples were used.

## Verified behavior

- Import authenticated extracted JSON plus original evidence into an active existing workflow; review/edit/reload before confirmation.
- Manual confirmation creates the first draft; automatic confirmation completes three native steps in order. Reopening the actual saved expense request preserves the corrected vendor and original evidence.
- Replaying the import returns the same batch. A changed payload with the same request ID conflicts. An identical retry survives template removal; confirmation still checks current template validity.
- Other app users cannot read batch/evidence. Legacy LINE intake GET/confirm/cancel also reject assistant evidence, including sessions without LINE identity.
- Assistant source never invokes OCR or sends LINE push. Invalid JSON and corrupt media remain on the import page with an actionable error.
- Total originals are limited to 20 MiB and extraction JSON to 2 MiB. Large base64 strings use bounded, canonical decoding instead of a repeating regex that can overflow the JavaScript stack.

## Commands and results

Node runtime: `/Users/tar/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node` (v24.22.3).

| Command | Result |
| --- | --- |
| `npm run e2e -- --workers 2` | 51 passed, 0 failed; final full desktop run after ownership/retry fixes |
| `npm run e2e -- --grep 'assistant invoice\|invoice workflow\|LINE intake' --workers 2` | 12 passed, 0 failed |
| `npm run e2e -- --project mobile-chromium --grep 'assistant invoice\|invoice workflow' --workers 2` | 9 passed, 0 failed |
| `npm run e2e -- --project mobile-chromium --grep 'assistant invoice' --workers 1` | 3 passed, 0 failed; rerun after final upload-limit/base64 adjustment |
| `NODE24 --test tests/line-workflow*.test.mjs` | 26 passed, 0 failed; includes 4 assistant import cases after final adjustment |
| `NODE24 --test tests/line-*.test.mjs tests/workflow*.test.mjs tests/authorization.logic.test.mjs tests/local-server.logic.test.mjs tests/document-data.adapter.test.mjs tests/inventory*.test.mjs tests/stock-line.logic.test.mjs` | 562 passed, 0 failed; broad regression before final upload-limit adjustment and its additional unit case |
| `git diff --check` | Passed |

`NODE24` above means the absolute Node runtime path. Commands opening local servers ran with the required sandbox permission. An initial sandboxed regression run stalled because local server operations were restricted; its processes were terminated and the broad command was rerun successfully with permission. Test-first failures demonstrated the missing import entrypoint, legacy evidence bypass, missing retry after template removal, and oversized base64 handling before their fixes. These are resolved failures, not remaining failures.

## Manual browser walkthrough

Used an isolated app and Playwright browser, choosing successive actions from the observed UI. Selected the existing director transfer workflow, attached synthetic JSON/image, imported, changed vendor to `Manual Reviewed Vendor`, saved, reloaded, then clicked automatic confirmation. Observed completed REQ/SR/PV and a parent showing 3/3 completed. Opened the saved REQ with its real document/transaction/step parameters, reloaded, and observed the corrected vendor, 100.00 base, 7.00 VAT, 107.00 total, and original file link.

- [Import page](../output/manual-test/assistant-invoice/import.png)
- [Reviewed form](../output/manual-test/assistant-invoice/review.png)
- [Creation result](../output/manual-test/assistant-invoice/result.png)
- [Existing workflow](../output/manual-test/assistant-invoice/workflow.png)
- [Saved document](../output/manual-test/assistant-invoice/document.png)

These checks verify transport, review, persistence and native lifecycle. They do not measure extraction accuracy on real invoices. Real cloud state/storage migration validation still requires an isolated Supabase environment; mocked cloud cases in the desktop suite do not establish live Supabase compatibility. The guide is repository Markdown reached through root `AGENTS.md`, not a globally installed skill.
