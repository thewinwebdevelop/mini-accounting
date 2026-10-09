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

การเลือก local adapter เป็นค่าเริ่มต้นทำให้ test สร้างและลบข้อมูลได้อย่างปลอดภัย แต่จะมี cloud-adapter compatibility suite แยกที่ใช้ Supabase-shaped fixtures และ mock REST responses เพื่อให้ branch `supabase-read`/`dual-write` ถูกตรวจโดยไม่ใช้ production database.

### 3.2 Production smoke environment

Production smoke รับ `E2E_BASE_URL` และทำเฉพาะ GET/HEAD หรือ request ที่ไม่มี side effect:

- `/`, `/api/healthz`, static asset ที่สำคัญ
- unauthenticated request ต้องถูก redirect/ปฏิเสธตาม LINE auth policy
- ไม่มี POST/PUT/PATCH/DELETE, ไม่มีการสร้าง transaction/document, ไม่มีการ upload file
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

Playwright browsers are pinned by the project dependency and installed through a documented setup command. CI configuration lives under `.github/workflows/`. `scripts/test.sh` remains unchanged for the existing 910+ unit/API/Python suite; `scripts/e2e.sh` runs only E2E and accepts `E2E_PROJECT`, `E2E_BASE_URL`, `E2E_WORKERS`, and `E2E_TRACE`.

## 5. Personas and fixture data

The fixture factory creates isolated users and records with stable IDs:

- `employee`: owns new documents, can edit own draft/pending records, cannot approve or read another employee's private files
- `accounting`: can review/approve/complete records and access authorized shared records
- `admin`: can manage settings, vendors, templates, inventory masters and integration configuration
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
- Google Drive and Sheets success/failure/retry state is visible and idempotent
- duplicate submit, stale update, malformed totals, inactive vendor and path traversal are rejected

### Substitute receipts

- create general-expense and stock-purchase receipts, with manual vendor and saved vendor preset
- add/edit/collapse lines, upload multiple evidence files, save/reload, submit, approve, reject, complete
- stock purchase receive action creates inventory movement once, repeated action is a no-op, and cancellation/reversal preserves audit evidence
- PDF packet, raw evidence links, Drive sync and monthly Sheets status are verified
- receipt type remains locked by workflow context where declared and cannot be forged by the browser

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

### Settings, storage and operational paths

- company settings save normalized values and affect generated documents/PDFs
- Google Drive OAuth configuration preserves existing secrets and uses configured callback origin
- file access tokens are scoped and expire independently of the session
- private cloud file/materialization behavior is validated against flattened and legacy records
- health endpoint and Cloud Run runtime contract are checked in production smoke

## 7. External provider mocks

The mock provider module exposes strict request logs and programmable responses:

- LINE token verification, content download and webhook signature expectations
- Google Drive folder/file upload, OAuth token exchange and Google Sheets append/update/conflict
- Shopee authorization, refresh, order/detail, shipment, tracking and label download
- OCR response with confidence, empty reviewable output, malformed payload and provider error
- Supabase REST responses for document/inventory reads/writes and durable Workflow number allocation

Mocks reject unexpected URLs, methods, credentials or request bodies. Each failure-path test asserts both user-visible behavior and that no unauthorized follow-up mutation occurred.

## 8. CI, artifacts and reporting

- Add a CI workflow that runs existing tests first, then Playwright Chromium E2E on a clean checkout with the isolated server fixture
- Upload HTML report, trace, screenshot and server/mock logs only on failure; retain a short JUnit result for CI annotations
- Default workers are conservative to avoid SQLite contention; tests that intentionally exercise races use explicit controlled concurrency
- A production smoke job is manual or post-deploy, read-only, and uses `E2E_BASE_URL`; it never receives service-role keys or write credentials
- Test names include the feature and business outcome, not implementation details

## 9. Acceptance criteria

1. `./scripts/test.sh` remains green.
2. `./scripts/e2e.sh` can create an isolated environment, run the full matrix, emit a report, and clean up on success or failure.
3. Every matrix section above has at least one implemented E2E spec; parameterized document kinds cover all five lightweight kinds and both substitute-receipt modes.
4. Workflow regression tests reproduce the original production bug and cover double-click, retry, reload and cross-transaction isolation.
5. E2E tests fail if an outbound call escapes the mock allowlist or if a test accidentally points at production.
6. Production smoke proves the deployed app is reachable and auth-gated without creating or mutating business data.
7. Documentation explains local setup, fixture limitations, CI invocation, report locations and the explicit prohibition on full E2E against production.

## 10. Rollout

Implement in four independently verifiable phases:

1. Runner/fixtures, authentication/navigation and Workflow regression.
2. Expense, substitute receipt and all lightweight document journeys.
3. Inventory, platform orders, LINE intake and Shopee journeys.
4. CI, reports, production read-only smoke and documentation hardening.

Each phase adds failing tests first, runs the focused E2E project, then runs the full existing suite before moving to the next phase.
