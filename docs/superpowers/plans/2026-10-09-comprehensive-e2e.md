# Comprehensive End-to-End Testing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** เพิ่มระบบ Playwright E2E ที่ครอบคลุม implemented user-facing features ทั้งหมด พร้อม isolated fixtures, cloud-runtime regression, CI และ production read-only smoke โดยไม่แตะข้อมูล production

**Architecture:** เพิ่ม Playwright เป็น runner แยกจาก Node/Python suite เดิม ใช้ server subprocess และ temp root ต่อ run, fixture-backed personas, strict mock provider server และ page objects ที่ใช้ stable locators. Phase 1 จะสร้าง safety/runtime foundation และทดสอบ Workflow ทั้ง local และ `CLOUD_RUN=1` ที่ชี้ cloud mock ก่อนจึงเพิ่ม feature journeys ตาม traceability matrix.

**Tech Stack:** Node 24-compatible JavaScript, `@playwright/test` pinned dependency, Playwright Chromium, Node built-in test runner, Python PDF runtime ที่มีอยู่, temporary SQLite roots, local HTTP mock providers, GitHub Actions

**Spec:** `docs/superpowers/specs/2026-10-09-comprehensive-e2e-design.md`

## Global Constraints

- Full E2E ต้องใช้ synthetic fixtures และ isolated temp root เท่านั้น; ห้ามสร้าง/แก้ข้อมูล production.
- `cloud-runtime-mocked` ต้องเปิด `CLOUD_RUN=1` จริง และ mock Supabase REST/RPC/Storage state ต้องอยู่นอก local root เพื่อทดสอบ durable identity/restart.
- E2E child process รับ environment จาก allowlist เท่านั้น และต้อง reject outbound host/method/path ที่ไม่อยู่ใน mock allowlist.
- Production smoke เป็น HTTP-only exact allowlist ไม่เปิด browser ไม่ execute JavaScript ไม่ follow OAuth/LINE callbacks และไม่มี mutation.
- Existing tests remain in `scripts/test.sh`; runtime discovery may become portable but required Node/Python dependencies must fail loudly when missing.
- Every test must assert a business outcome after reload/role boundary where applicable; request-count-only assertions are insufficient.
- New browser locators follow the repository locator convention and avoid brittle CSS chains.
- Failure artifacts are synthetic and redacted; never store cookies, OAuth codes, service keys, file tokens, storage state or real document contents.

## Review Focus

- Cloud-only Workflow allocation/save failure/retry/restart branch: Task 4 must prove durable transaction identity and materialization using a stateful cloud mock.
- Production or inherited credential/network leakage: Task 2 must fail the run before mutation when an environment value or outbound host is outside the allowlist.
- Production smoke callback mutation: Task 8 must use an HTTP client with redirect disabled and exact method/path/query assertions.
- Owner/persona mismatch: Task 3 must cover employee A/B, owner, accounting, admin, pending and inactive users and distinguish HTML, API and file behavior.
- Artifact leakage/flaky parallel state: Task 2 and Task 8 must test redaction, worker isolation, SQLite lifecycle and deterministic cleanup.

---

### Task 1: Portable test runtime and Playwright bootstrap

**Files:**
- Create: `package.json`
- Create: `package-lock.json`
- Create: `playwright.config.mjs`
- Create: `scripts/e2e.sh`
- Modify: `scripts/test.sh`
- Create: `e2e/specs/bootstrap.spec.mjs`
- Create: `tests/e2e-tooling.test.mjs`
- Test: `tests/e2e-tooling.test.mjs`

**Interfaces:**
- Produces `npm run e2e`, `npm run e2e:smoke`, and `scripts/e2e.sh` entry points.
- `playwright.config.mjs` exports a config with projects `chromium`, `mobile-chromium`, and `production-smoke`; local projects consume a runtime-provided fixture URL and never fall back to a hardcoded service/port, while production smoke requires `E2E_BASE_URL`.
- `scripts/e2e.sh` accepts `E2E_PROJECT`, `E2E_BASE_URL`, `E2E_WORKERS`, `E2E_TRACE`, and `E2E_GREP`; it refuses a production URL for full projects.

- [ ] **Step 1: Write the failing tooling tests**

  Add tests that assert the scripts discover `node`/Python from PATH or explicit configured paths, fail when required runtime dependencies are absent, reject `E2E_BASE_URL` for full E2E, and select the correct Playwright project from `E2E_PROJECT`.

- [ ] **Step 2: Run the tests to verify they fail**

  Run: `node --test tests/e2e-tooling.test.mjs`

  Expected: FAIL because the package/config/portable runtime contract does not exist.

- [ ] **Step 3: Implement the runner bootstrap**

  Pin `@playwright/test`, add the Playwright config and scripts, and make `scripts/test.sh` locate the bundled Node runtime when present or a compatible PATH Node otherwise while preserving every existing test target. Local Playwright projects must read only a runtime-provided `E2E_LOCAL_BASE_URL`/fixture hook and must not contain a hardcoded localhost service fallback; Task 2 will provide the actual server fixture. Do not silently skip the Python PDF suite when the required test runtime is missing.

- [ ] **Step 4: Run focused tooling tests**

  Run: `node --test tests/e2e-tooling.test.mjs`

  Expected: PASS with checks for project selection, runtime discovery and production URL refusal.

- [ ] **Step 5: Add a bootstrap spec and verify a no-op E2E run**

  Add `e2e/specs/bootstrap.spec.mjs` with a non-mutating assertion that the configured project and test run identity are present; it must not require the app fixture or external provider.

  Run: `npm ci` then `npx playwright install --with-deps chromium` where the environment permits it, followed by `./scripts/e2e.sh --list`.

  Expected: the runner lists the bootstrap spec and configured projects without starting a production target; local browser execution remains deferred until Task 2 supplies the fixture URL.

- [ ] **Step 6: Commit**

  ```bash
  git add package.json package-lock.json playwright.config.mjs scripts/e2e.sh scripts/test.sh e2e/specs/bootstrap.spec.mjs tests/e2e-tooling.test.mjs
  git commit -m "test: bootstrap portable playwright e2e runner"
  ```

### Task 2: Isolated fixtures, mock providers and redaction guards

**Files:**
- Create: `e2e/fixtures/app-server.fixture.mjs`
- Create: `e2e/fixtures/auth.fixture.mjs`
- Create: `e2e/fixtures/data-seed.mjs`
- Create: `e2e/fixtures/mock-providers.mjs`
- Create: `e2e/fixtures/cloud-runtime-mock.mjs`
- Create: `e2e/support/assertions.mjs`
- Create: `e2e/support/selectors.mjs`
- Create: `e2e/support/redaction.mjs`
- Modify: `forms/line-bot.logic.js`, `forms/line-ocr.logic.js`, `forms/google-drive.logic.js`, `forms/google-sheets.logic.js`, `forms/shopee-client.logic.js`, `forms/supabase.logic.js`, `forms/supabase-storage.logic.js`
- Create: `tests/e2e-fixtures.test.mjs`
- Test: `tests/e2e-fixtures.test.mjs`

**Interfaces:**
- `createE2EEnvironment({ profile = "local", workerIndex = 0 }) -> Promise<{ runId, baseUrl, rootDir, mock, stop, users }>`.
- `createAppServer({ env, rootDir, mockBaseUrl }) -> Promise<{ baseUrl, child, stop }>`; server startup must emit a run marker and fail if it exits early.
- `createTestSession({ userId, role, ownerUserId, secret, now }) -> string` returns the signed session cookie value used by Playwright context fixtures.
- `createFixtureData({ rootDir, runId }) -> Promise<SeedManifest>` creates employee-a/b, owner, accounting, admin, pending/inactive users, vendors, inventory, documents and templates.
- `createMockProviders({ profile, runId }) -> Promise<{ baseUrls, state, requests, stop }>` rejects unexpected host/method/path/body and exposes programmable provider state.
- `redactE2ELog(value) -> string` removes cookie, Authorization, OAuth code, file token, service-key-like strings and business file bytes before artifact write.

- [ ] **Step 1: Write failing fixture safety tests**

  Cover fresh temp roots, unique run IDs, allowlisted environment only, rejection of inherited production secrets, rejection of an unexpected outbound host, cleanup after failure, session creation for every persona, and redacted log/artifact output.

- [ ] **Step 2: Run tests to verify they fail**

  Run: `node --test tests/e2e-fixtures.test.mjs`

  Expected: FAIL because fixture modules and guards do not exist.

- [ ] **Step 3: Implement local fixture profile**

  Start `local-server.mjs` as a child process with a temp `SWEET_HOUSE_ROOT_DIR`, `SWEET_HOUSE_AUTH_MODE=line`, test-only session secret, deterministic `APP_PUBLIC_ORIGIN`, and no inherited production credentials. Seed data before the browser receives the base URL. Stop child processes and remove only the owned temp root in a `finally` path.

- [ ] **Step 4: Implement strict mock provider server**

  Provide stateful endpoints for LINE token/content, Google Drive/Sheets/OAuth, Shopee, OCR and Supabase REST/RPC/Storage. Add explicit injectable endpoint/base-URL options to the provider modules listed above so the server subprocess calls mock URLs rather than hardcoded third-party hosts. Every request records a redacted log and rejects unexpected host/method/path/body. Add a response script for “persisted success then dropped response” and controlled timeout/error cases.

- [ ] **Step 5: Implement cloud-runtime mock profile**

  Configure `CLOUD_RUN=1`, `DATA_BACKEND_DOCUMENTS=supabase-read`, mock Supabase URL/key, and mock storage/provider URLs. Keep cloud documents/number reservations in mock state outside `rootDir`; expose `restartApp()` that starts a new local runtime against the same mock state and a new empty local root.

- [ ] **Step 6: Run focused fixture tests**

  Run: `node --test tests/e2e-fixtures.test.mjs`

  Expected: PASS with no real provider request and no leaked secret in logs/artifacts.

- [ ] **Step 7: Commit**

  ```bash
  git add e2e/fixtures e2e/support tests/e2e-fixtures.test.mjs
  git commit -m "test: add isolated e2e fixtures and provider mocks"
  ```

### Task 3: Authentication, navigation and security E2E

**Files:**
- Create: `e2e/pages/login.page.mjs`
- Create: `e2e/pages/navigation.page.mjs`
- Create: `e2e/specs/auth-navigation.spec.mjs`
- Create: `e2e/specs/security-regression.spec.mjs`
- Test: `e2e/specs/auth-navigation.spec.mjs`, `e2e/specs/security-regression.spec.mjs`

**Interfaces:**
- Page objects expose user actions such as `loginAs(user)`, `logout()`, `open(path)`, `assertMenuFor(role)` and `assertProtectedRouteDenied(path)`.
- Specs consume Task 2’s `localApp`, `authenticatedPage`, `anonymousPage`, `seed`, and `mock` fixtures.

- [ ] **Step 1: Write failing browser specs**

  Add tests for LIFF bootstrap mock → session → safe internal return, pending/inactive denial, logout behavior, role-specific navigation, employee-a/b file/list/detail/mutation boundaries, owner/accounting/admin permissions, tampered session, unsafe return path, traversal and expired file token.

- [ ] **Step 2: Run the specs to verify they fail**

  Run: `./scripts/e2e.sh --project chromium --grep "auth|security"`

  Expected: FAIL because the real browser fixtures/page objects/specs do not exist.

- [ ] **Step 3: Implement page objects and specs**

  Use stable semantic/data locators. Keep expected behavior separate for HTML shell, protected API and file routes; do not assume all protected HTML pages redirect. Assert response/status, visible error, and persisted state where relevant.

- [ ] **Step 4: Run focused E2E**

  Run: `./scripts/e2e.sh --project chromium --grep "auth|security"`

  Expected: PASS with fixture logs showing only mock provider requests.

- [ ] **Step 5: Commit**

  ```bash
  git add e2e/pages/login.page.mjs e2e/pages/navigation.page.mjs e2e/specs/auth-navigation.spec.mjs e2e/specs/security-regression.spec.mjs
  git commit -m "test: cover auth navigation and resource security e2e"
  ```

### Task 4: Workflow and cloud-runtime regression E2E

**Files:**
- Create: `e2e/pages/workflow.page.mjs`
- Create: `e2e/specs/workflow.spec.mjs`
- Create: `e2e/specs/workflow-cloud.spec.mjs`
- Test: `e2e/specs/workflow.spec.mjs`, `e2e/specs/workflow-cloud.spec.mjs`

**Interfaces:**
- `WorkflowTransactionsPage.createTransaction({ template, month, title, clicks = 1 }) -> Promise<{ transactionNo, url }>`.
- `WorkflowTransactionPage.assertIdentity({ transactionNo, title, ownerUserId })`, `startCurrentStep()`, `refresh()`, `complete()`, `cancel(confirmText)` and `childDocument(kind)`.
- `WorkflowTemplatePage.editSteps(steps)` and `save()` assert ordered persisted steps and receipt type.

- [ ] **Step 1: Write failing local browser specs**

  Cover template edit/reload, two transaction creates in one month, double-click while POST is pending, detail URL identity, strict step order, prefill into child form, child completion refresh, transaction complete/cancel/retry/idempotence, packet/file links and cross-transaction isolation after reload.

- [ ] **Step 2: Run local specs to verify they fail**

  Run: `./scripts/e2e.sh --project chromium --grep "workflow"`

  Expected: FAIL because page objects/specs do not exist.

- [ ] **Step 3: Implement local Workflow journeys**

  Use a controlled fetch barrier for the pending POST test and business assertions after navigation/reload; do not make request count the only assertion.

- [ ] **Step 4: Write failing cloud-runtime specs**

  In `cloud-runtime-mocked`, cover allocation with request key, cloud save failure after reservation, retry with same key, new key allocation, app restart with empty local root, cloud materialization and a concurrent second transaction. Assert mock persisted rows and the exact transaction/folder returned to the browser.

- [ ] **Step 5: Run cloud specs to verify they fail**

  Run: `./scripts/e2e.sh --project cloud-runtime-mocked --grep "workflow cloud"`

  Expected: FAIL until the cloud profile and page assertions are wired.

- [ ] **Step 6: Implement and run both profiles**

  Run: `./scripts/e2e.sh --project chromium --grep "workflow"` and `./scripts/e2e.sh --project cloud-runtime-mocked --grep "workflow cloud"`.

  Expected: PASS; restart test proves the new record is materialized, not an older record with a reused number.

- [ ] **Step 7: Commit**

  ```bash
  git add e2e/pages/workflow.page.mjs e2e/specs/workflow.spec.mjs e2e/specs/workflow-cloud.spec.mjs
  git commit -m "test: cover workflow isolation and cloud retry e2e"
  ```

### Task 5: Expense, vendor, substitute receipt and lightweight document E2E

**Files:**
- Create: `e2e/pages/expense-request.page.mjs`
- Create: `e2e/pages/substitute-receipt.page.mjs`
- Create: `e2e/pages/vendor-master.page.mjs`
- Create: `e2e/pages/workflow-document.page.mjs`
- Create: `e2e/specs/expense-request.spec.mjs`
- Create: `e2e/specs/vendor-master.spec.mjs`
- Create: `e2e/specs/substitute-receipt.spec.mjs`
- Create: `e2e/specs/lightweight-documents.spec.mjs`
- Create: `e2e/specs/mobile-documents.spec.mjs`
- Test: the five specs above

**Interfaces:**
- Page objects expose create/save/reload/submit/approve/reject/complete, evidence upload, vendor selection, line mode selection and document file assertions.
- `lightweight-documents.spec.mjs` parameterizes exactly `purchase_order`, `payment_voucher`, `cash_spend_declaration`, `payee_acknowledgement`, and `goods_receipt`.

- [ ] **Step 1: Write failing browser specs**

  Cover expense draft/resume, manual-vs-Stock-SKU lines, VAT/withholding, evidence/PDF/audit packet, lifecycle and retry; vendor duplicate confirmation/deactivate/reactivate/snapshot; both substitute receipt modes and receive-stock idempotence; all five lightweight kinds; and mobile viewport collapse/menu/action behavior.

- [ ] **Step 2: Run focused specs to verify they fail**

  Run: `./scripts/e2e.sh --project chromium --grep "expense|vendor|substitute|lightweight"` and `./scripts/e2e.sh --project mobile-chromium --grep "mobile"`.

  Expected: FAIL because these browser journeys are not implemented.

- [ ] **Step 3: Implement page objects and parameterized journeys**

  Assert persisted status, number, owner, file URL, PDF response/body markers, inventory movement or vendor snapshot after reload. Use a separate accounting context for approval actions and employee-a context for creation.

- [ ] **Step 4: Run focused E2E**

  Run the same Chromium and mobile commands.

  Expected: PASS for both substitute modes, all five lightweight kinds and mobile viewport journeys.

- [ ] **Step 5: Commit**

  ```bash
  git add e2e/pages/expense-request.page.mjs e2e/pages/substitute-receipt.page.mjs e2e/pages/vendor-master.page.mjs e2e/pages/workflow-document.page.mjs e2e/specs/expense-request.spec.mjs e2e/specs/vendor-master.spec.mjs e2e/specs/substitute-receipt.spec.mjs e2e/specs/lightweight-documents.spec.mjs e2e/specs/mobile-documents.spec.mjs
  git commit -m "test: cover document and vendor journeys e2e"
  ```

### Task 6: Inventory and platform-order E2E

**Files:**
- Create: `e2e/pages/inventory.page.mjs`
- Create: `e2e/pages/platform-orders.page.mjs`
- Create: `e2e/specs/inventory.spec.mjs`
- Create: `e2e/specs/platform-orders.spec.mjs`
- Test: `e2e/specs/inventory.spec.mjs`, `e2e/specs/platform-orders.spec.mjs`

**Interfaces:**
- Inventory page object covers product/category/parent SKU/child SKU/image/purchase-in/list/detail/stock card/dashboard/report/PDF actions.
- Platform page object covers Sale SKU bundle edit, file upload/import review, row mapping, post and shipment handoff.

- [ ] **Step 1: Write failing specs**

  Assert persisted master records, duplicate/inactive validation, image links, purchase-in balances, stock card/report/PDF outcomes, reversals, filters/grouping, bundle mapping, import issue categories, reservations, post/deduction and idempotent repeat.

- [ ] **Step 2: Run focused specs to verify they fail**

  Run: `./scripts/e2e.sh --project chromium --grep "inventory|platform|stock|bundle"`

  Expected: FAIL until the page objects/specs exist.

- [ ] **Step 3: Implement and run focused specs**

  Run the same command; expected PASS with seeded fixture state isolated per test.

- [ ] **Step 4: Commit**

  ```bash
  git add e2e/pages/inventory.page.mjs e2e/pages/platform-orders.page.mjs e2e/specs/inventory.spec.mjs e2e/specs/platform-orders.spec.mjs
  git commit -m "test: cover inventory and platform order journeys e2e"
  ```

### Task 7: LINE intake and Shopee E2E

**Files:**
- Create: `e2e/pages/line-intake.page.mjs`
- Create: `e2e/pages/shopee.page.mjs`
- Create: `e2e/pages/settings.page.mjs`
- Create: `e2e/specs/line-intake.spec.mjs`
- Create: `e2e/specs/shopee.spec.mjs`
- Create: `e2e/specs/settings.spec.mjs`
- Test: `e2e/specs/line-intake.spec.mjs`, `e2e/specs/shopee.spec.mjs`, `e2e/specs/settings.spec.mjs`

**Interfaces:**
- LINE page object covers intake review/edit/confirm/cancel and evidence assertions.
- Shopee page object covers connection/auth/sync/mapping/shipment/tracking/label actions.

- [ ] **Step 1: Write failing specs**

  Cover LINE probe/signature/media-size/type/OCR/content-download/confirm/cancel and one-draft idempotence; cover Shopee auth state, order sync/upsert, manual mapping edit/clear, shipment grouping/partial arrange/tracking/labels and provider timeout/401 retry; cover company settings normalization/PDF effect and Google Drive config/callback-origin/secret-preserving edits.

- [ ] **Step 2: Run focused specs to verify they fail**

  Run: `./scripts/e2e.sh --project chromium --grep "line intake|shopee"`

  Expected: FAIL until page objects/specs are implemented.

- [ ] **Step 3: Implement and run focused specs**

  All external calls must terminate at Task 2 mock providers; assert provider request logs and final persisted records, not only visible status text.

- [ ] **Step 4: Commit**

  ```bash
  git add e2e/pages/line-intake.page.mjs e2e/pages/shopee.page.mjs e2e/pages/settings.page.mjs e2e/specs/line-intake.spec.mjs e2e/specs/shopee.spec.mjs e2e/specs/settings.spec.mjs
  git commit -m "test: cover line intake and shopee journeys e2e"
  ```

### Task 8: Production smoke, artifact redaction, CI and documentation

**Files:**
- Create: `e2e/specs/production-smoke.spec.mjs`
- Create: `.github/workflows/e2e.yml`
- Create: `docs/e2e-testing.md`
- Modify: `playwright.config.mjs`
- Modify: `scripts/e2e.sh`
- Modify: `e2e/support/redaction.mjs`
- Test: `e2e/specs/production-smoke.spec.mjs`, `tests/e2e-artifacts.test.mjs`

**Interfaces:**
- `runProductionSmoke({ baseUrl, fetchImpl }) -> Promise<SmokeReport>` uses exact GET/HEAD allowlist, no redirect following and no browser.
- `writeRedactedArtifacts({ reportDir, events }) -> Promise<void>` writes only redacted trace/log/report data.
- CI accepts `E2E_BASE_URL` only for the smoke job; full E2E always creates its own local environment.

- [ ] **Step 1: Write failing smoke/artifact tests**

  Assert smoke refuses callbacks, non-GET methods, redirects and mutation paths; verify root/health/static/auth responses; assert redaction removes cookies, OAuth codes, service-key-like values, file tokens and real fixture document text.

- [ ] **Step 2: Run tests to verify they fail**

  Run: `node --test tests/e2e-artifacts.test.mjs` and `E2E_BASE_URL=https://example.invalid ./scripts/e2e.sh --project production-smoke`

  Expected: FAIL because smoke runner and artifact guard do not exist.

- [ ] **Step 3: Implement HTTP-only smoke and redacted artifacts**

  Do not launch Playwright for production smoke. Disable redirects, send no auth cookie, inspect only configured exact routes, and make any unexpected response/method/path fail. Disable trace for smoke and redact before report upload.

- [ ] **Step 4: Add CI workflow**

  Run portable existing tests, install pinned Node/Python/Playwright dependencies, run fixture safety tests, then full Chromium E2E with conservative workers. Upload failure artifacts only after redaction. Add a separately gated/manual smoke job with no write credentials.

- [ ] **Step 5: Write documentation and traceability check**

  `docs/e2e-testing.md` must document install, local full E2E, cloud-runtime profile, mobile project, smoke invocation, fixture limitations, CI artifacts, feature matrix mapping and the prohibition on full E2E against production.

- [ ] **Step 6: Run final verification**

  Run: `npm ci`; `./scripts/test.sh`; `./scripts/e2e.sh --project chromium`; `./scripts/e2e.sh --project mobile-chromium`; `./scripts/e2e.sh --project cloud-runtime-mocked`; `E2E_BASE_URL="$E2E_BASE_URL" ./scripts/e2e.sh --project production-smoke`.

  Expected: existing suite and all E2E projects pass; smoke performs only allowlisted read-only requests; artifacts contain no sensitive values.

- [ ] **Step 7: Commit**

  ```bash
  git add e2e/specs/production-smoke.spec.mjs .github/workflows/e2e.yml docs/e2e-testing.md playwright.config.mjs scripts/e2e.sh e2e/support/redaction.mjs tests/e2e-artifacts.test.mjs
  git commit -m "test: add ci and production smoke safeguards"
  ```

## Final verification checklist

- [ ] `git diff --check` passes and user-owned `data/` remains untouched.
- [ ] `./scripts/test.sh` passes on local and clean CI runtime.
- [ ] All traceability matrix rows have a corresponding spec and persisted/security assertion.
- [ ] `./scripts/e2e.sh --project cloud-runtime-mocked` proves durable Workflow allocation/retry/restart.
- [ ] Full E2E refuses production URL and unexpected outbound destinations.
- [ ] Production smoke is HTTP-only and leaves no business mutation.
- [ ] CI failure artifacts are redacted before upload.
- [ ] Final review checks all phase commits and no external production deployment is performed as part of test implementation.
