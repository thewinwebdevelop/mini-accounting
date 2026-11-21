# LINE invoice workflow validation — 2026-11-20

All writes below used isolated temporary roots and fake LINE/OCR/Google providers. No production documents, stock or external messages were created.

## Automated checks

Execution used the cached Node 24 runtime at `/Users/tar/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node`; the shell's default Node 16 cannot run the repository tests.

Commands:

```sh
node --test tests/line-*.test.mjs tests/workflow*.test.mjs tests/authorization.logic.test.mjs tests/local-server.logic.test.mjs tests/document-data.adapter.test.mjs tests/inventory*.test.mjs tests/stock-line.logic.test.mjs
npm run e2e -- --workers 2
npm run e2e -- --project mobile-chromium --grep 'invoice workflow'
npm run e2e -- --project cloud-runtime-mocked --workers 2
git diff --check
```

Final results:

| Check | Result |
|---|---|
| Node regression command above | 558 passed, 0 failed |
| Chromium full suite (`--workers 2`) | 48 passed, 0 failed |
| Mobile invoice workflow suite | 6 passed, 0 failed |
| Mocked cloud runtime suite | 4 passed, 0 failed |
| Additional final cloud-routing/review validation (`node --test tests/line-workflow-cloud-store.test.mjs tests/line-workflow-review.logic.test.mjs`) | 6 passed, 0 failed |
| `git diff --check` | Clean |
| Real Supabase | Not run; required isolated configuration unavailable |

Earlier full-suite failures were investigated: the new stock test assumed a first template that another worker-scoped test had edited, the fake cloud provider lacked the new state table, and an existing refresh page helper read details before its POST completed. Test fixtures now use an explicit stock template and state/CAS endpoints, and the refresh helper awaits the explicit response. All original product assertions remain enabled.

Coverage includes both completion modes; corrected OCR persistence/reload; actual nested/local and flattened/cloud record loaders; original PDF evidence access; cross-user denial; employee auto-approval denial; repeat/conflicting confirmations; invalid media returning retryable webhook failure; concurrent attachments; primary-invoice rescan; four-step stock lifecycle with no duplicate receiving on repeated execution; manual first-step completion and auto-filled next-step draft/evidence save/reload.

Logic/native coverage includes cloud state CAS contention, expired lease fencing, stale scan results after cancellation/restart/review/confirmation, worker token validation, processing without a browser, and a native second-step approval persistence failure followed by resume with unchanged transaction/document identities and exactly two completed children.

An independent reviewer found and verified fixes for monetary inconsistency, per-action cloud version checks, concurrent upload loss, primary-source switching, Python runtime setup, durable worker recovery, scan races and manual evidence authorization. The final focused review of manual prefill/evidence changes reported no critical or important issues.

## Manual browser exercise

The native Chrome computer-use connection failed after reconnect/reset attempts. An interactive Playwright browser was used instead, with actions chosen from observed UI state and screenshots rather than a prewritten test assertion sequence.

1. Opened an isolated local login and invoice review form with fake OCR output.
2. Corrected vendor and business purpose, saved, reloaded and observed the corrected values.
3. Selected automatic completion; observed three completed documents (REQ, SR, PV), opened the workflow and saw all steps complete. Opened the actual REQ form and observed the corrected vendor/purpose.
4. Created a second isolated batch, selected manual completion and observed exactly one draft with later steps blocked.
5. Opened that draft, submitted, approved and completed it through the existing UI. Observed the next step unlock while the following step remained blocked.
6. Restarted the local test app on the final code with the same isolated persisted data. Opened the next SR step; observed vendor/purpose filled automatically and the original-evidence attachment notice. Saved and reloaded SR-2026-11-0002 and observed the corrected vendor retained.

Artifacts:

- [Automatic completion result](../output/manual-test/line-invoice-workflow/automatic-result.png)
- [Completed workflow](../output/manual-test/line-invoice-workflow/automatic-workflow.png)
- [Actual generated document form](../output/manual-test/line-invoice-workflow/created-document.png)
- [Manual-mode first draft](../output/manual-test/line-invoice-workflow/manual-result.png)
- [Manual next step unlocked](../output/manual-test/line-invoice-workflow/manual-next-step.png)
- [Next step prefilled](../output/manual-test/line-invoice-workflow/manual-next-prefilled.png)
- [Next step saved and reloaded](../output/manual-test/line-invoice-workflow/manual-next-saved.png)

The source image in the interactive exercise is a synthetic image; OCR fields are supplied by the fake provider. This validates application flow and persistence, not real OCR accuracy or live LINE delivery.

## External validation still required before rollout

`npm run e2e:supabase` could not start because `E2E_SUPABASE_CONFIG` is unset. `docker info` also reports that the Docker daemon is unavailable. The new conditional real-Supabase concurrency test is skipped without that isolated configuration; cloud CAS unit tests and existing mocked cloud browser regressions are separate evidence, not a substitute for applying/testing the SQL migration on real Supabase.

Production still needs the migration, HTTP OCR provider credentials/layout validation, the OIDC scheduler configuration, feature flag enablement, deployment and Rich Menu publication described in [configuration](line-invoice-workflow.md). None of these external rollout actions were performed.
