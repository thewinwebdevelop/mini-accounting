# Comprehensive End-to-End Testing Design

**Date:** 2026-10-09  
**Status:** Design approved for planning  
**Owner:** Sweet House Accounting

## 1. Goal

สร้างระบบ browser E2E ที่ตรวจเส้นทางการใช้งานจริงของทุก feature หลักใน Sweet House Accounting ตั้งแต่ authentication, navigation, document lifecycle, inventory, platform orders, LINE intake, Shopee, Google integrations และ Workflow โดยตรวจผลลัพธ์ปลายทางจริงหลัง reload และป้องกัน regression ที่หลุดจาก unit/API/browser-contract tests โดยไม่เขียนข้อมูลทดสอบลง production.

ขอบเขต “ทุก feature” ในเอกสารนี้หมายถึง implemented user-facing features ที่มีหน้า/API/ผลลัพธ์ให้ผู้ใช้ทดสอบได้ในปัจจุบัน ส่วน policy-only documents และรายการที่ยังอยู่ในสถานะ unchecked/future เช่น Shopee/TikTok fee summary จะไม่ถูกนับเป็น browser E2E จนกว่าจะมี implementation จริง

ความสำเร็จวัดจาก:

- ทุกหน้าและ feature ที่อยู่ใน `docs/feature-checklist.md` มีอย่างน้อยหนึ่ง happy path E2E และกรณี failure/security ที่สำคัญตาม risk
- document kinds ทั้งหมดถูกทดสอบด้วยข้อมูลจริงใน browser flow ไม่ใช่เพียง assert ว่ามีปุ่มหรือ request ถูกส่ง
- Workflow มี regression ที่พิสูจน์ว่า transaction ใหม่ไม่เปิด transaction เก่า, double-click ไม่สร้างซ้ำ, retry ใช้ identity เดิม และ state อยู่ถูกต้องหลัง reload
- Full E2E รันซ้ำได้บน isolated data root โดยไม่พึ่งข้อมูลหรือ credential จริงของ production
- มี production smoke ที่เป็น read-only เท่านั้น และแยกจาก full E2E อย่างชัดเจน

## 2. Scope and non-goals

### In scope

- Browser-level interaction ผ่าน Playwright กับหน้า HTML จริง, classic browser scripts จริง และ local HTTP server จริง
- Server API, SQLite/Supabase-shaped data adapter, file/PDF routes และ lifecycle state ที่เกิดจากการใช้งานหน้าเว็บ
- Test personas: employee/requester, accounting/approver, administrator และ unauthenticated visitor
- External integrations ผ่าน deterministic mock providers ที่จำลอง success, duplicate, timeout, malformed response และ retry
- Traceability matrix ระหว่าง feature, test spec และ test data
- Local command, CI command, artifacts และ read-only production smoke command

### Out of scope

- การสร้างเอกสารทดสอบจริงบน production
- การทดสอบความถูกต้องของ LINE, Google, Shopee หรือ OCR provider ภายนอกจริงแบบ end-to-end ถึง third-party service; contract/API tests ที่มีอยู่ยังเป็นเจ้าของ provider behavior
- Load/performance testing, penetration testing เต็มรูปแบบ และ visual pixel-perfect testing
- การแทนที่ unit, logic, API หรือ existing browser-contract tests; E2E จะเติมช่องว่างระหว่าง browser กับ server

## 3. Test environments and safety

### 3.1 Full E2E environment

Full E2E ใช้ local server ที่เปิดจาก subprocess ด้วย environment เฉพาะชุดทดสอบ:

- `SWEET_HOUSE_ROOT_DIR` ชี้ไป temp directory ที่สร้างใหม่ต่อ run
- ใช้ local SQLite/data adapter โดย seed fixture ผ่าน helper ที่ deterministic
- `SWEET_HOUSE_AUTH_MODE=line` เพื่อทดสอบ protected route จริง และสร้าง signed session สำหรับ test personas ด้วย test-only secret ที่อยู่เฉพาะ process
- `APP_PUBLIC_ORIGIN` เป็น localhost origin ของ run นั้น
- ปิดการเชื่อมต่อ Google, LINE Messaging, Shopee และ OCR จริง; ทุก outbound call ต้องชี้ mock provider และ fail ถ้าออกนอก allowlist
- ทุก test มี unique run id และล้าง temp root/server/mock state เมื่อจบ แม้ test fail

### 3.1.1 Cloud-runtime mocked profile

Phase 1 ต้องมี environment profile ชื่อ `cloud-runtime-mocked` ซึ่งเปิด `CLOUD_RUN=1` จริง แต่ชี้ Supabase REST/RPC/Storage และ provider endpoints ทั้งหมดไปยัง mock server ที่เก็บ state แบบ durable แยกจาก local root เพื่อทดสอบ branch ที่ production ใช้จริง:

- mock cloud จองเลขจาก `allocate_workflow_transaction_number` แล้วจำลอง cloud document save ล้มเหลว
- retry ด้วย `idempotencyKey` เดิมต้องได้ transaction number เดิมและเขียน document สำเร็จ
- request key ใหม่ต้องได้เลขใหม่
- restart app ด้วย local root ว่าง แต่ mock cloud state เดิมต้อง materialize transaction เดิมได้ และต้องไม่เปิด record เก่าแทน record ใหม่
- ทุกกรณีตรวจ request log และ persisted cloud state ไม่ใช่ตรวจเพียงจำนวนครั้งที่ browser ยิง POST

การเลือก local adapter เป็นค่าเริ่มต้นทำให้ test สร้างและลบข้อมูลได้อย่างปลอดภัย แต่ cloud-runtime profile ต้องครอบคลุม `supabase-read`, `dual-write` และ production-specific `CLOUD_RUN=1` branch โดยไม่ใช้ production database.

### 3.1.2 Isolation guard contract

E2E child process รับ environment จาก allowlist ที่สร้างโดย fixture เท่านั้น ไม่สืบทอด `SUPABASE_SERVICE_ROLE_KEY`, Google/LINE/Shopee secrets, production `DATA_BACKEND` หรือ `E2E_BASE_URL` โดยอัตโนมัติ ทุก run ต้องมี `E2E_RUN_ID`, temp-root marker และ mock base URLs ที่ตรวจได้ก่อน server start. Mock server และ application fetch layer ต้อง reject host/method/path ที่ไม่อยู่ใน allowlist พร้อมบันทึก redacted violation log; test ต้องพิสูจน์ว่า violation ทำให้ run fail ก่อนมี business mutation.

### 3.2 Production smoke environment

Production smoke รับ `E2E_BASE_URL` และทำ HTTP-only requests เฉพาะ exact method/path/query ที่อนุญาต โดยไม่เปิด browser และไม่ execute JavaScript:

- `/`, `/api/healthz`, static asset ที่สำคัญ
- unauthenticated request ต้องถูก redirect/ปฏิเสธตาม LINE auth policy
- ห้าม follow redirect ไปยัง OAuth/LINE callback และห้ามเรียก Google/Shopee callback ทุกกรณี
- ไม่มี POST/PUT/PATCH/DELETE, ไม่มีการสร้าง transaction/document, ไม่มีการ upload file และห้ามส่ง credential/cookie จริง
- ไม่รวมใน full E2E และไม่ทำให้ deployment fail จากข้อมูล production ที่เปลี่ยนตามเวลา ยกเว้น health หรือ auth contract ผิด

## 4. Tooling and structure

เพิ่ม Playwright test runner และแยกจาก Node built-in test suite เดิม:

```text
e2e/
  fixtures/
    app-server.fixture.mjs
    auth.fixture.mjs
    data-seed.mjs
    mock-providers.mjs
  pages/
    login.page.mjs
    navigation.page.mjs
    expense-request.page.mjs
    substitute-receipt.page.mjs
    workflow.page.mjs
    inventory.page.mjs
    platform-orders.page.mjs
    shopee.page.mjs
    line-intake.page.mjs
  specs/
    auth-navigation.spec.mjs
    expense-request.spec.mjs
    substitute-receipt.spec.mjs
    workflow.spec.mjs
    lightweight-documents.spec.mjs
    inventory.spec.mjs
    platform-orders.spec.mjs
    line-intake.spec.mjs
    shopee.spec.mjs
    security-regression.spec.mjs
  support/
    assertions.mjs
    selectors.mjs
playwright.config.mjs
scripts/e2e.sh
docs/e2e-testing.md
```

Page objects encapsulate user actions and stable selectors. Assertions remain in specs or shared semantic assertions so a page object cannot hide a failed business outcome. Existing locator conventions are followed for new selectors; do not use brittle CSS paths or visible text when a stable semantic/data locator is available.

Playwright browsers are pinned by the project dependency and installed through a documented setup command. CI configuration lives under `.github/workflows/`. Runtime discovery in `scripts/test.sh` may be made portable while preserving its existing test list; CI must fail when required Node, Python PDF, or Playwright dependencies are missing. `scripts/e2e.sh` runs only E2E and accepts `E2E_PROJECT`, `E2E_BASE_URL`, `E2E_WORKERS`, and `E2E_TRACE`.

## 5. Personas and fixture data

The fixture factory creates isolated users and records with stable IDs:

- `employee-a`: owns new documents, can edit own draft/pending records, cannot approve or read another employee's private files
- `employee-b`: separate owner used for cross-user list/detail/file/mutation isolation
- `owner`: explicit owner role where the authorization matrix distinguishes it from ordinary employees
- `accounting`: can review/approve/complete records and access authorized shared records
- `admin`: can manage settings, vendors, templates, inventory masters and integration configuration
- `pending-user` and `inactive-user`: verify denied or limited login behavior
- `anonymous`: has no session and can access only explicitly public routes

Seed data includes one active/inactive vendor pair, product with two Stock SKUs, category, Sale SKU bundle, pending platform order, one record per document kind, workflow templates with every supported step type, and evidence/PDF fixtures. Each test that mutates data uses a unique namespace or a fresh fixture so ordering and retries do not leak state.

## 6. Comprehensive feature matrix

### Authentication and navigation

- LINE auth page loads the LIFF bootstrap, posts a test token to the session route, stores an HttpOnly session, and redirects to the internal return path
- employee, accounting and admin see the correct navigation/menu sections
- anonymous users cannot access protected pages or domain APIs; logout invalidates the session
- root, document lists, settings, inventory, platform, Shopee and LINE intake routes load their real HTML and scripts
- unsafe `returnTo`, tampered session and direct protected-file requests fail safely

### Expense requests

- create standalone request, select active vendor, enter line items/VAT/withholding, upload evidence, save draft, reload and resume
- submit, approve, reject-to-draft and complete using the correct role; verify status history, owner, generated PDF, audit packet and file links
- edit pending/approved records according to lifecycle rules without losing evidence or server-owned identity
- switch manual/Stock SKU mode per line and reload to verify the selected mode, SKU and editable values persist
- Google Drive and Sheets success/failure/retry state is visible and idempotent
- duplicate submit, stale update, malformed totals, inactive vendor and path traversal are rejected

### Substitute receipts

- create general-expense and stock-purchase receipts, with manual vendor and saved vendor preset
- add/edit/collapse lines, upload multiple evidence files, save/reload, submit, approve, reject, complete
- stock purchase receive action creates inventory movement once, repeated action is a no-op, and cancellation/reversal preserves audit evidence
- PDF packet, raw evidence links, Drive sync and monthly Sheets status are verified
- receipt type remains locked by workflow context where declared and cannot be forged by the browser

### Vendor master

- create a vendor, detect duplicate by normalized name/tax ID, require the bound duplicate confirmation, edit the full record, deactivate it and reactivate it
- verify inactive vendors are rejected for new documents but old document snapshots remain readable
- verify vendor master changes are reflected in the shared picker across expense requests, substitute receipts and lightweight documents

### Lightweight workflow documents

Parameterize the same browser journey over all five kinds: `purchase_order`, `payment_voucher`, `cash_spend_declaration`, `payee_acknowledgement`, `goods_receipt`.

- start from standalone and Workflow context
- create/edit with vendor, manual lines and active Stock SKU lines, VAT modes and evidence
- save draft, submit, approve, reject and complete with role/lifecycle checks
- verify generated document PDF, raw files, document list filters, file routes and Drive sync status
- verify a completed record cannot be resurrected, client totals/identity are ignored where server-owned, and simultaneous actions serialize

### Workflow transactions and templates

- list and edit templates, preserve ordered steps and receipt type, create a new template and reload it
- start two transactions with the same month and different request keys; assert distinct transaction numbers, distinct folders, correct titles/owners and correct detail URLs
- dispatch two browser clicks while the first POST is pending; assert one request and one transaction
- retry the same create request after a simulated cloud-write failure; assert the same transaction number is reused and no stale transaction is opened
- start documents strictly in step order, carry workflow context/prefill into child forms, and refresh progress after child completion
- complete/cancel transaction, verify packet, Drive/Sheets controls, cancellation confirmation, pending retry and idempotence
- reload detail/list pages and verify the transaction's own child documents/files never cross with another transaction

### Inventory

- create/edit product, category, parent SKU and child Stock SKU; validate duplicate/inactive SKU rules
- upload product and Stock SKU images, reload detail/list, verify secure image links
- record purchase-in, inspect balance, stock card, dashboard value, latest stock-in report and PDF export
- list filters, parent-only/all-SKU mode, grouped children, collapsed defaults and product detail history
- reverse/cancel stock effects safely and verify no duplicate movement

### Sale SKU and platform orders

- create/edit Sale SKU bundle mappings and validate unique components
- import valid CSV/TSV, normalize aliases, skip cancelled rows, surface duplicate/missing mapping/invalid quantity/insufficient stock issues
- preserve pending reservations, supersede an older unposted import, post a ready import, deduct bundle components, and verify idempotent repeat
- verify platform order list, mapping controls and safe error rendering
- edit and clear manual Stock SKU mappings, reload mapping state, and send selected mapped orders into shipment flow

### LINE intake and webhook

- verify webhook signature, accept provider probe, reject tampered/unsupported/oversized media
- receive image/PDF metadata, review extracted fields, edit accounting values, confirm once, save original evidence and create expense draft
- retry/fail OCR and provider download without inventing values; cancel intake and verify state transitions
- verify LIFF endpoint/return path handling and protected file access

### Shopee integration

- connection page shows auth/sync state; authorization state is single-use and expiry-safe
- sync changed orders and details, upsert without duplicates, preserve mapping state
- prepare compatible shipment groups, isolate partial arrange failures, refresh tracking, create shipping document only when ready, download/overlay labels
- provider timeout/401/retry and canceled-order branches are deterministic through mocks

### Mobile UI journeys

- run Chromium at the supported mobile viewport and verify hamburger navigation, line-item collapse/expand/edit, sticky action areas and evidence controls for expense, substitute receipt and lightweight documents

### Settings, storage and operational paths

- company settings save normalized values and affect generated documents/PDFs
- Google Drive OAuth configuration preserves existing secrets and uses configured callback origin
- file access tokens are scoped and expire independently of the session
- private cloud file/materialization behavior is validated against flattened and legacy records
- health endpoint and Cloud Run runtime contract are checked in production smoke

## 7. Traceability matrix

The implementation plan must preserve this minimum mapping and extend it for any implemented route discovered during phase work. A row is complete only when the named journey asserts a persisted or security outcome after the relevant reload/role boundary.

| Feature/route | Journey outcome | Persona | Planned spec | Phase |
|---|---|---|---|---|
| `/line-auth`, root gate | signed session, safe return path, logout | anonymous, employee-a/b | `auth-navigation.spec.mjs` | 1 |
| shared navigation | role-specific menus and all implemented page routes load | employee, accounting, admin | `auth-navigation.spec.mjs` | 1 |
| `/workflow-transactions` | two creates stay isolated; double-click creates one; retry reuses identity | employee-a | `workflow.spec.mjs` | 1 |
| workflow cloud runtime | allocation/save failure/retry/restart materializes the right transaction | employee-a | `workflow-cloud.spec.mjs` | 1 |
| `/workflow-templates` | ordered steps/receipt type persist after edit and reload | admin | `workflow.spec.mjs` | 1 |
| workflow child documents | strict order, prefill, completion and cancellation persist | employee-a, accounting | `workflow.spec.mjs` | 1 |
| expense request | draft → submit → approve/reject → complete with files/PDF | employee-a, accounting | `expense-request.spec.mjs` | 2 |
| expense line mode | manual/Stock SKU selection survives reload and server validation | employee-a | `expense-request.spec.mjs` | 2 |
| substitute receipt | general/stock modes, evidence, receive-stock and lifecycle are idempotent | employee-a, accounting | `substitute-receipt.spec.mjs` | 2 |
| vendor master/picker | duplicate confirmation, deactivate/reactivate, old snapshot readability | admin, employee-a | `vendor-master.spec.mjs` | 2 |
| five lightweight kinds | create/edit/lifecycle/PDF/file path parameterized by kind | employee-a, accounting | `lightweight-documents.spec.mjs` | 2 |
| mobile document UI | collapse/edit/menu/action controls work at mobile viewport | employee-a | `mobile-documents.spec.mjs` | 2 |
| inventory masters | product/category/SKU create/edit/image and duplicate rules persist | admin | `inventory.spec.mjs` | 3 |
| inventory movement | purchase-in, balance, stock card, report, PDF and reversal agree | employee-a, accounting | `inventory.spec.mjs` | 3 |
| Sale SKU/platform orders | mapping/import/issues/post/deduction/retry persist | admin, accounting | `platform-orders.spec.mjs` | 3 |
| LINE intake/webhook | signature/media/OCR review/confirm/cancel creates one draft | anonymous, employee-a | `line-intake.spec.mjs` | 3 |
| Shopee | auth/sync/mapping/shipment/tracking/labels handle retries and partial success | admin, accounting | `shopee.spec.mjs` | 3 |
| security/file access | cross-owner reads/mutations, forged identity, traversal and token expiry fail | employee-a/b, owner | `security-regression.spec.mjs` | 1–3 |
| production health | only allowed HTTP GET/HEAD paths are checked; no callbacks/mutations | anonymous | `production-smoke.spec.mjs` | 4 |

## 8. External provider mocks

The mock provider module exposes strict request logs and programmable responses:

- LINE token verification, content download and webhook signature expectations
- Google Drive folder/file upload, OAuth token exchange and Google Sheets append/update/conflict
- Shopee authorization, refresh, order/detail, shipment, tracking and label download
- OCR response with confidence, empty reviewable output, malformed payload and provider error
- Supabase REST responses for document/inventory reads/writes and durable Workflow number allocation

Mocks reject unexpected URLs, methods, credentials or request bodies. Provider URL overrides must be injected into the server subprocess, not only intercepted in the browser. Each failure-path test asserts both user-visible behavior and that no unauthorized follow-up mutation occurred. Mock state must support upstream success followed by dropped response so retry/idempotency is exercised against persisted state, not canned responses.

## 9. CI, artifacts and reporting

- Add a CI workflow in Phase 1 that runs portable existing tests first, then Playwright Chromium E2E on a clean checkout with the isolated server fixture
- Upload only redacted HTML report, trace, screenshot and server/mock logs on failure; never upload storage state, cookies, OAuth codes, service keys, file tokens or real document contents
- Full E2E uses synthetic fixtures only; production smoke artifacts contain status/assertions only and have trace disabled
- Default workers are conservative to avoid SQLite contention; tests that intentionally exercise races use explicit controlled concurrency
- A production smoke job is manual or post-deploy, read-only, and uses `E2E_BASE_URL`; it never receives service-role keys or write credentials
- Test names include the feature and business outcome, not implementation details

## 10. Acceptance criteria

1. `./scripts/test.sh` remains green on this machine and on a clean CI runner with the same Node/Python version floor; missing required dependencies fail the job instead of silently skipping tests.
2. `./scripts/e2e.sh` can create an isolated environment, run the full matrix, emit a report, and clean up on success or failure.
3. A committed traceability matrix maps every implemented user-facing route/feature to a journey, persona, persisted outcome, spec file and rollout phase; a feature is not complete merely because its section has one spec.
4. Parameterized document kinds cover all five lightweight kinds and both substitute-receipt modes, including vendor master, manual/Stock SKU mode and mobile viewport journeys.
5. Cloud-runtime regression tests reproduce the original production bug and cover double-click, retry after cloud write failure, restart/materialization, reload and cross-transaction isolation.
6. E2E tests fail if an outbound call escapes the mock allowlist, if a required environment/credential is inherited, or if a full suite points at production.
7. Production smoke is HTTP-only, does not follow OAuth/LINE callbacks, and proves reachability/auth gating without creating or mutating business data.
8. Failure artifacts are redacted and contain no session cookie, OAuth code, service key, file token, storage state or real business document content.
9. Documentation explains local setup, fixture limitations, CI invocation, report locations and the explicit prohibition on full E2E against production.

## 11. Rollout

Implement in four independently verifiable phases:

1. Runner/fixtures, safety guards, portable runtime, CI baseline, authentication/navigation and cloud-runtime Workflow regression.
2. Expense, vendor master, substitute receipt and all lightweight document journeys, including mobile coverage.
3. Inventory, platform orders, LINE intake and Shopee journeys.
4. Production HTTP-only smoke, redacted reports, traceability audit and documentation hardening.

Each phase adds failing tests first, runs the focused E2E project, then runs the full existing suite before moving to the next phase.
