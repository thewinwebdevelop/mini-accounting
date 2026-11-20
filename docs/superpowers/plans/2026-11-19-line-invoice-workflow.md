# LINE Invoice Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Select an existing workflow through LINE, review invoice extraction in a separate form, then create sequential documents with automatic or manual completion.

**Architecture:** Add durable batch/job storage around existing private LINE intake and native document lifecycle services. Confirmed data becomes a shared prefill baseline. Sequential execution reconciles native state before retrying any mutation, while the manual path creates only the first draft.

**Tech Stack:** Existing Node.js CommonJS logic modules/ESM server, vanilla HTML/browser JavaScript, local SQLite using the repository's existing SQLite facilities, Supabase Postgres/private storage, Playwright, Python PDF tooling already in the repository. Node 22+ per E2E runner.

**Spec:** `docs/superpowers/specs/2026-11-19-line-invoice-workflow-design.md`

## Global Constraints

- Preserve existing workflow templates, lifecycle validation, actor authorization and sequential unlocking; never assign `completed` directly.
- Exact labels: `ยืนยันและทำทุกขั้นตอนอัตโนมัติ` and `ยืนยันและดำเนินการเอง`.
- Manual creates the first eligible draft only; later forms prefill without completing themselves.
- One primary invoice per transaction, multiple pages and supporting evidence allowed; unknown values remain missing.
- Retain the existing 20 MiB/file default. Initial builder-selected limits: 20 files/batch and 100 pages/PDF, environment-configurable, reject rather than truncate.
- Initial scope is direct OA chat. Keep legacy intake working and private. Never synthesize another actor's signature.
- Cloud jobs are durable; no memory-only jobs or detached promises. No live deployment, Rich Menu publication or production writes in this implementation.
- Document completion does not implicitly close/lock the transaction.
- E2E must reload actual saved document pages and cover local nested and cloud flattened records. Preserve unrelated untracked files.

## Review Focus

- Concurrent confirmations/crash between native save and checkpoint must recover the same document and stock movement (Tasks 1, 4, 7).
- Reordered/deactivated templates and stale Quick Replies must not select a different workflow (Tasks 2, 5).
- Payment evidence, duplicate files, multipage PDFs and missing zero-valued fields must not inflate purchases (Task 3).
- Manual edits and flattened cloud records must survive prefill/reload without reverting to OCR (Tasks 5, 6, 7).
- Role revocation, copied review links and webhook replay must never execute unauthorized lifecycle actions (Tasks 2, 4, 5, 7).

## File boundaries and contracts

Create focused modules `forms/line-workflow-store.logic.js` (durable state), `forms/line-workflow-chat.logic.js` (conversation reducer/replies), `forms/line-workflow-review.logic.js` (normalization/validation), `forms/line-workflow-execution.logic.js` (orchestration), `forms/line-workflow-native.logic.js` (authorized native services) and `forms/line-workflow-worker.logic.js` (leased jobs). Keep `local-server.mjs` responsible for HTTP/auth wiring; reuse its existing adapter configuration, extracting shared service code where needed instead of copying handlers.

Shared shapes: `Batch={id,channelId,lineUserId,conversationId,ownerUserId,state,revision,templateChoices,templateSnapshot,evidenceIds,primaryEvidenceId,extractedContext,confirmedContext,mode,transactionNo,steps,error}`; `mode='automatic'|'manual'`; `Step={stepId,documentKind,documentNo,lastAction,status,error}`. `actor` is server-resolved authentication, never a request-body actor. Timestamps are injected in logic tests. Store owns persistence revisions and opaque IDs.

## Task 1: Durable batches, operation identities and leased jobs

**Files:** Create `forms/line-workflow-store.logic.js`, `supabase/migrations/202611190001_line_workflow_batches.sql`, `tests/line-workflow-store.logic.test.mjs`, `e2e/supabase/line-workflow.test.mjs`. Reuse SQLite conventions from `forms/inventory-db.logic.js` and Supabase helpers.

**Interfaces:** `createLineWorkflowStore({rootDir,env})` returns `begin({scope,eventId})`, `getForActor(id,actor)`, `update({id,expectedRevision,patch})`, `acceptEvent({scope,eventId,messageId})`, `confirm({id,expectedRevision,mode,context,actor})`, `claimJob({workerId,now,leaseMs})`, `checkpoint({jobId,leaseToken,operationKey,result})`, `finishJob({jobId,leaseToken,result})`, `failJob({jobId,leaseToken,error,retryAt})`. Confirm returns `{batch,jobId,idempotent}`; checkpoints include reserved transaction/document identity before mutation. Scope is channel+conversation+LINE user.

- [ ] Add tests asserting two concurrent confirms produce one job; repeat same confirmation returns same identity; stale revision/mode conflict is 409; cross-user access is 403; expired leases are recoverable and old lease tokens cannot checkpoint; one active batch per scope.
- [ ] Run `node --test tests/line-workflow-store.logic.test.mjs`; confirm new-contract failures.
- [ ] Implement local SQLite transactions and equivalent Postgres RPC transactions/uniqueness constraints for batches, events, jobs and operation keys. Restrict cloud tables/RPCs to server access; no broad client policies. Event claims distinguish pending/retryable/completed so a download failure does not permanently suppress retry.
- [ ] Run the unit command and `node --test e2e/supabase/line-workflow.test.mjs` with the repository's isolated Supabase harness; assert persistence across reopen and equivalent concurrency behavior. Record environment blockers accurately.
- [ ] Commit only this task's files after checks.

## Task 2: LINE conversation and workflow Quick Replies

**Files:** Create `forms/line-workflow-chat.logic.js`, `tests/line-workflow-chat.logic.test.mjs`; modify `forms/line-bot.logic.js`, `local-server.mjs`, `.env.example`; create `tests/line-workflow-api.test.mjs` and `e2e/specs/line-workflow.spec.mjs` with fixtures in `e2e/fixtures/app-server.fixture.mjs`.

**Interfaces:** `reduceLineWorkflowEvent({event,batch,templates}) -> {command,reply,patch}` is pure. Commands: start/select/attach/finish/resume/cancel/legacy/ignore. `buildWorkflowChoices({batch,page}) -> LINE message` uses 10 templates/page, max 13 quick replies with navigation/cancel, stable numbered snapshot and postback revision. Start text is `สร้างเอกสารด้วยใบกำกับภาษี`; postback prefix is `invoice-workflow:`. Server feature flag `LINE_WORKFLOW_ENABLED=false` defaults off.

- [ ] Test signed text/postback selection, numeric snapshot selection, >13 templates, shortened labels/full text names, stale/deactivated choices, out-of-range numbers, cancel/resume, group isolation, flag-off legacy behavior and failed-download redelivery. E2E verifies real webhook reply requests captured by the fake LINE provider.
- [ ] Run `node --test tests/line-workflow-chat.logic.test.mjs tests/line-workflow-api.test.mjs`; confirm failures before code.
- [ ] Implement reducer and webhook routing before media-only filtering. Persist event claims and batch attachment identity through Task 1; acknowledge only accepted durable work. Retain legacy path for files without sessions, with optional attach-existing-intake action guarded by ownership. Finish freezes revision and queues scan. Reopening collection invalidates review revision.
- [ ] Run the unit command plus `npm run e2e -- --project chromium e2e/specs/line-workflow.spec.mjs`; require passing selection/cancellation/retry cases.
- [ ] Commit task files.

## Task 3: Invoice extraction and reviewed context

**Files:** Modify `forms/line-ocr.logic.js`; create `forms/line-workflow-review.logic.js`, `tests/line-workflow-review.logic.test.mjs`; extend `tests/line-ocr.logic.test.mjs` and new E2E fixtures.

**Interfaces:** `normalizeInvoiceExtraction(raw) -> {fields,lines,sources,warnings,pageCount}`; `buildReviewedWorkflowContext({batch,edits,template}) -> context`; `validateReviewedWorkflowContext({context,template,mode}) -> {errors,warnings,effects}`. Each line retains source evidence/page, quantity/unit price/net/VAT and optional SKU; use current prefill canonical groups through adapters rather than parallel document schemas. Preserve scalar OCR response compatibility.

- [ ] Test real small image/PDF fixtures, multipage sources, corrupt/encrypted/over-limit PDFs, missing provider, provider timeout, incomplete pages, explicit zero versus unknown, conflicting seller/amount fields, duplicate invoice/evidence and non-invoice payment slip. Assert evidence is never independently summed into invoice totals.
- [ ] Run `node --test tests/line-ocr.logic.test.mjs tests/line-workflow-review.logic.test.mjs`; confirm new failures.
- [ ] Extend provider request/response validation and enforce content/page/file limits before processing. Add bounded PDF inspection using existing Python PDF environment. Require explicit primary invoice selection when ambiguous, preserve corrected values independently from extraction, and validate selected mode with native validators. Automatic validates all required step inputs; manual validates first-step requirements and marks later missing inputs pending.
- [ ] Run unit command; extend E2E scan cases to display real source links, extraction warnings and recoverable provider failures.
- [ ] Commit task files.

## Task 4: Native sequential execution and recovery

**Files:** Create `forms/line-workflow-native.logic.js`, `forms/line-workflow-execution.logic.js`, `forms/line-workflow-worker.logic.js`, `tests/line-workflow-execution.logic.test.mjs`, `tests/line-workflow-worker.logic.test.mjs`; modify `forms/local-server.logic.js`, `forms/document-data.adapter.js` only as required for recoverable creation; wire in `local-server.mjs`.

**Interfaces:** `createLineWorkflowNativeServices({rootDir,documentDataAdapter,inventoryDataAdapter,resolveActor,resolveCompanySettings,...existingDependencies})` exposes `ensureTransaction({batch,operationKey})`, `ensureStepDocument({batch,step,context,operationKey})`, `getStepState({batch,step})`, `runAction({batch,step,action,operationKey})`, `refresh({batch})`. `executeLineWorkflowBatch({batchId,store,native,lease}) -> {state,transactionNo,steps}`. `runLineWorkflowWorkerOnce({store,native,scan,workerId})` handles one claimed job and returns processed/idle. Native actions are existing submit/approve/receive/complete operations.

- [ ] Add table-driven tests for every current template and document kind, first-draft-only manual execution, approved/received prerequisites, real actor identity, denied/revoked permissions, missing external signature and explicit transaction-close remaining untouched.
- [ ] Add fault injection after reservation, native save, approval, stock receipt and completion but before checkpoint. Restart worker and assert identical transaction/document numbers, one stock movement set, preserved actor/history, and no later step before prior completion. Test competing workers and revoked leases.
- [ ] Run `node --test tests/line-workflow-execution.logic.test.mjs tests/line-workflow-worker.logic.test.mjs`; confirm failures.
- [ ] Extract/reuse authorized service operations, including cloud hydration/persistence and numbering allocation. Add stable operation-key reservations and durable native/cloud reconciliation; a lease alone is insufficient. Fence commits or use idempotent native operations so a worker losing its lease cannot duplicate effects. Re-resolve the actor and permissions for each mutation. Pin confirmed template snapshot for transaction creation, avoiding accidental reread of edited template.
- [ ] Implement resumable sequential orchestration and worker. Builder choice: Cloud Scheduler invokes OIDC-authenticated `POST /api/internal/line-workflow/run` each minute; each invocation processes bounded work within request lifetime. Validate configured audience/service identity, never ordinary session bypass or client secret. Local tests call the worker explicitly; document optional supervised local worker CLI. Persist results before LINE delivery and retry notification separately without rerunning documents.
- [ ] Run new tests plus `node --test tests/authorization.logic.test.mjs tests/local-server.logic.test.mjs tests/document-data.adapter.test.mjs tests/inventory.logic.test.mjs tests/inventory-db.logic.test.mjs`. Investigate shared-contract regressions before proceeding.
- [ ] Commit task files.

## Task 5: Authenticated review form and confirmation APIs

**Files:** Create `forms/line-workflow-review.html`, `forms/line-workflow-review.browser.js`, `tests/line-workflow-review.browser.test.mjs`, `e2e/pages/line-workflow-review.page.mjs`; modify `local-server.mjs`, `tests/line-workflow-api.test.mjs`, `e2e/specs/line-workflow.spec.mjs`.

**Interfaces:** `GET /api/line-workflow-batches/:id` returns public batch/context/errors/effects/progress with authorized evidence links; `PATCH .../:id/review` accepts `{expectedRevision,edits,primaryEvidenceId}`; `POST .../:id/confirm` accepts `{expectedRevision,mode}` using persisted reviewed data; `POST .../:id/resume` requeues reconciled failed work; page entry `/line-workflow-review?batchId=...`. Same confirm revision/mode returns existing result; stale revisions fail with 409. No client actor/owner overrides.

- [ ] Test corrections persist after page reload, both exact button labels, source previews/links, line editing and stock mapping, visible automatic effects, mode-specific validation, template changes requiring rereview, copied URLs, unlinked identities and unauthorized automatic mode. Confirm response references a durable job, not premature completion.
- [ ] Run `node --test tests/line-workflow-api.test.mjs tests/line-workflow-review.browser.test.mjs`; confirm failures.
- [ ] Build responsive form using existing app authentication/navigation patterns. Render untrusted extraction as text, never HTML. Save revisions before confirmation, poll job progress with retry state, link actual failed document and workflow. Keep original single-intake form/routes unchanged.
- [ ] Run unit tests and `npm run e2e -- --project mobile-chromium e2e/specs/line-workflow.spec.mjs`; reload corrected form and actual first document and assert values/evidence persisted.
- [ ] Commit task files.

## Task 6: Confirmed data for manual next-step prefill

**Files:** Modify `forms/workflow-prefill.logic.js`, `forms/local-server.logic.js` (`getWorkflowTransactionPrefill`), `local-server.mjs` cloud prefill route, `forms/workflow-prefill-banner.browser.js` and document loaders only where needed; extend `tests/workflow-prefill.logic.test.mjs`, `tests/workflow-api.test.mjs`, `e2e/specs/line-workflow.spec.mjs`.

**Interfaces:** Add `mergeConfirmedWorkflowContext({baseline,siblingContext}) -> context` to prefill module, with explicit supplied values from actual documents overriding confirmed baseline. Attach provenance for baseline groups without inventing a source document. Resolve baseline from authorized batch linked by transaction identity; transactions without a batch retain old behavior.

- [ ] Test manual first draft, blocked later steps, manual completion unlocking next form, prefilled corrected values and evidence, explicit zero and cleared values, existing target edits winning on reload, and sibling changes overriding baseline. Test every supported document loader with local nested and cloud flattened response shapes.
- [ ] Run `node --test tests/workflow-prefill.logic.test.mjs tests/workflow-api.test.mjs`; confirm new failures.
- [ ] Implement merge and integrate into existing prefill APIs/UI entry points. Never create documents on GET, automatically complete in manual mode, or overwrite saved target data. Evidence is linked/copied through authorized native storage conventions.
- [ ] Run unit tests plus `npm run e2e -- --project chromium e2e/specs/line-workflow.spec.mjs e2e/specs/workflow.spec.mjs`; reopen actual document URLs with transaction/step parameters and assert identity, fields, lines, status and evidence links.
- [ ] Commit task files.

## Task 7: Cloud parity, rollout documentation and final verification

**Files:** Extend `e2e/specs/workflow-cloud.spec.mjs`, `e2e/specs/line-workflow.spec.mjs`, `e2e/supabase/line-workflow.test.mjs`, mock fixtures and `.env.example`; create `docs/line-invoice-workflow.md` with feature flag, OCR contract, migration, limits, authenticated worker/scheduler configuration and Rich Menu action payload.

- [ ] Add cloud flattened-record reopen assertions and real local/Supabase persistence contract checks. Exercise both modes, duplicate/concurrent confirm, unauthorized actor, failed later step/resume, stock effects and failed LINE notification. Include scheduler identity denial and expired lease recovery. Test flag off restores legacy behavior.
- [ ] Run `node --test tests/line-*.test.mjs tests/workflow*.test.mjs tests/authorization.logic.test.mjs tests/local-server.logic.test.mjs tests/document-data.adapter.test.mjs tests/inventory*.test.mjs tests/stock-line.logic.test.mjs` and require zero failures; report actual counts.
- [ ] Run `npm run e2e -- --project chromium e2e/specs/line-intake.spec.mjs e2e/specs/line-workflow.spec.mjs e2e/specs/workflow.spec.mjs e2e/specs/inventory.spec.mjs`.
- [ ] Run `npm run e2e -- --project mobile-chromium e2e/specs/line-workflow.spec.mjs` and `npm run e2e -- --project cloud-runtime-mocked e2e/specs/workflow-cloud.spec.mjs`.
- [ ] Run `npm run e2e:supabase` with isolated services; no production credentials. If unavailable, state exactly what is unverified and do not claim cloud success.
- [ ] Run `git diff --check`; inspect final diff and request independent code review under the relevant skill. Resolve substantive findings and rerun affected checks. Document configured-but-unavailable real OCR/LINE integration honestly.
- [ ] Commit only feature files and report commands/counts, remaining deployment configuration and links. No live Rich Menu update, production migration or deployment in this plan.

## Self-review and handoff

Coverage: Tasks 1/4 durable retries; Task 2 chat; Task 3 extraction/evidence; Task 5 reviewed confirmation; Task 6 manual continuation; Task 7 native/cloud/browser regression and rollout. Review Focus cases are assigned above. All new store/native calls share the contracts in Tasks 1/4; workers receive authenticated actor resolution, never serialized permissions as enduring authority.

Recommended execution: native implementation in this session, because tasks share persistence and native lifecycle interfaces and benefit from one implementation context. Independent final review remains required. Await user review of this plan and execution-method selection per writing-plans skill. No product implementation or passing-test claim accompanies this plan.

## Delivery record — 2026-11-20

The user approved native execution and additionally requested a manual browser exercise. Tasks 1–6 are implemented. Task 7 code review, isolated browser exercise and automated checks are recorded in `docs/line-invoice-workflow-validation.md`; real Supabase validation remains environment-dependent and has not been claimed. Per-step checkbox history above is the original plan, not an assertion that unavailable external checks ran.

Implementation rulings: initial cloud state uses a server-only versioned JSON row/CAS and a shared pure reducer with local SQLite; deployment documentation records its initial-volume limitation. Cloud Scheduler drives durable jobs through an OIDC-authenticated endpoint. A failure injection test runs native lifecycle operations and resumes the same document identities. Manual next steps auto-apply reviewed context only for never-saved forms and copy original evidence on first save.
