# User Profile and New-Document Autofill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ให้ผู้ใช้ LINE บันทึกชื่อ, นามสกุล และตำแหน่งจาก master กลาง แล้วเติมข้อมูลเป็นค่าเริ่มต้นเฉพาะตอนสร้างเอกสารใหม่ โดยข้อมูลในเอกสารเป็น snapshot อิสระจาก profile ภายหลัง

**Architecture:** แยก identity (`app_users`) ออกจาก profile (`app_user_profiles`) และแยก company-position master (`company_positions`) ออกจาก role/permission tables. API ทุกตัวใช้ user id จาก signed session; browser helper โหลด profile/positions แล้วเติมเฉพาะฟอร์มใหม่และช่องว่าง. เอกสารยังเก็บ `requesterName`/`requesterRole` เป็นค่าที่บันทึกจริง ไม่เก็บ reference ที่ทำให้เอกสารเก่าย้อนเปลี่ยนตาม master.

**Tech Stack:** Node.js built-in HTTP server, CommonJS browser-compatible logic modules, Supabase REST API, PostgreSQL migrations, classic browser scripts, Node `node:test`.

**Spec:** `docs/superpowers/specs/2026-09-29-user-profile-autofill-design.md`

## Global Constraints

- ใช้ `firstName`, `lastName`, `companyPositionId` เป็นข้อมูล profile; ห้ามนำข้อมูลเหล่านี้ไปเขียนทับ LINE `display_name`.
- `company_positions` เป็น master กลาง; seed เดิม `owner / เจ้าของบริษัท` และ `marketing / marketing` แบบ idempotent.
- `company_position_id` ใน profile อ้างอิง master; `requesterRole` ในเอกสารเป็น label snapshot.
- PATCH profile รับเฉพาะ `firstName`, `lastName`, `companyPositionId` และใช้ `request.auth.userId` เป็น target เสมอ.
- Autofill ทำเฉพาะเอกสารใหม่และ field ที่ยังว่าง; draft/reopened/existing documents ห้ามถูก profile เขียนทับ.
- ห้ามเพิ่ม role หรือ permission จาก feature นี้; e-sign schema เป็น future extension และยังไม่เปิด workflow e-sign.
- ห้ามเก็บ private key หรือ signing secret ใน database; future e-sign เก็บ provider/KMS reference และ signer snapshot.
- ทุก task ต้องเขียน test ก่อน production code, ดู test fail ด้วยสาเหตุที่คาดไว้, ทำให้ผ่าน, แล้วรัน test suite ที่เกี่ยวข้อง.

## Review Focus

- Existing profile row อ้างถึง position ที่ถูกปิดใช้งาน: หน้า profile ต้องอ่าน label เดิมได้ แต่ dropdown ใหม่ต้องไม่เลือก position inactive — covered in Task 1 and Task 2.
- Profile API ได้ body ที่พยายามส่ง `userId`, role หรือ field อื่น: ต้องแก้เฉพาะ user จาก session และไม่ mass-assign — covered in Task 2.
- Profile มี first/last name ว่างบางส่วน: document name ต้อง trim/join โดยไม่เกิดช่องว่างเกินหรือค่า `undefined` — covered in Task 1 and Task 5.
- Existing form/document มี `requesterRole` ที่ไม่ได้มาจาก master หรือมีค่าที่ผู้ใช้พิมพ์แล้ว: options ใหม่ต้องไม่ทำให้ข้อมูลเดิมหาย และ autofill ต้องไม่ทับค่า — covered in Task 4 and Task 5.
- Profile API/master API ใช้งานไม่ได้ระหว่างเปิดฟอร์ม: ฟอร์มต้องยังเปิดและให้ผู้ใช้กรอกเองได้ — covered in Task 5.

---

### Task 1: Profile, position, and future-extension domain logic

**Files:**
- Create: `supabase/migrations/202609290001_user_profile_and_positions.sql`
- Create: `forms/user-profile.logic.js`
- Create: `forms/company-position.logic.js`
- Test: `tests/user-profile.logic.test.mjs`
- Test: `tests/company-position.logic.test.mjs`

**Interfaces:**
- Produces `normalizeProfileInput(input)`, `mapProfileRow(row)`, `formatProfileName(profile)`, `mapCompanyPositionRow(row)`, and `sortCompanyPositions(rows)` for the API/browser tasks.
- Produces the database tables `app_user_profiles` and `company_positions` used by later tasks.
- Does not alter `app_roles`, `app_user_roles`, or the current authorization matrix.

- [ ] **Step 1: Write the failing profile-domain tests**

  Add tests named `normalizes first and last names and validates required fields`, `rejects overlong profile fields`, `maps profile rows without exposing provider-owned fields as editable`, and `formats a profile name from partial values`.

  Assert that `normalizeProfileInput({ firstName: "  ชื่อ ", lastName: " นามสกุล ", companyPositionId: "p-1" })` returns trimmed camelCase values, rejects blank first/last names and lengths over 100/120, and `formatProfileName` returns a trimmed single-space join when both names exist and the nonblank side when only one exists.

- [ ] **Step 2: Run the profile tests to verify RED**

  Run: `/Users/tar/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/user-profile.logic.test.mjs`

  Expected: FAIL because the new module/functions do not exist.

- [ ] **Step 3: Write the failing position-domain tests**

  Add tests named `maps and sorts active position records deterministically`, `does not silently include inactive positions in new options`, and `preserves an inactive selected position for read display`.

  Assert that mapping converts `id/code/label/status/sort_order` to the browser shape, active options sort by `sortOrder` then label, and an inactive selected row remains representable for profile display without entering the new-position option list.

- [ ] **Step 4: Run the position tests to verify RED**

  Run: `/Users/tar/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/company-position.logic.test.mjs`

  Expected: FAIL because the new module/functions do not exist.

- [ ] **Step 5: Add the database migration**

  Create `company_positions` first with stable `code`, label, active/inactive status, sort order, timestamps, check constraints, and indexes needed for active ordered reads; seed `owner` and `marketing` idempotently. Then create `app_user_profiles` with one row per `app_users` user and nullable `company_position_id` referencing `company_positions(id)`. Keep RLS/revoke conventions consistent with `20260925_001_line_auth.sql`.

- [ ] **Step 6: Implement the pure domain functions**

  Implement the exact interfaces from the Interfaces block. Keep profile normalization independent of Supabase and keep position sorting/filtering independent of HTTP. Use explicit allowlists so provider fields, role fields, and timestamps cannot enter a profile patch.

- [ ] **Step 7: Run both focused tests to verify GREEN**

  Run: `/Users/tar/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/user-profile.logic.test.mjs tests/company-position.logic.test.mjs`

  Expected: PASS with all new domain tests green.

- [ ] **Step 8: Commit**

  ```bash
  git add supabase/migrations/202609290001_user_profile_and_positions.sql forms/user-profile.logic.js forms/company-position.logic.js tests/user-profile.logic.test.mjs tests/company-position.logic.test.mjs
  git commit -m "feat: add user profile and company position master"
  ```

### Task 2: Profile and position API routes

**Files:**
- Create: `forms/user-profile.server.logic.js`
- Modify: `forms/line-auth.logic.js`
- Modify: `local-server.mjs`
- Test: `tests/user-profile-api.test.mjs`
- Test: `tests/line-auth.logic.test.mjs`

**Interfaces:**
- Consumes Task 1's `normalizeProfileInput`, `mapProfileRow`, `mapCompanyPositionRow`, and database tables.
- Produces `GET /api/auth/profile`, `PATCH /api/auth/profile`, and `GET /api/company-positions`.
- `GET /api/auth/profile` returns `{ profile: { firstName, lastName, companyPositionId, companyPositionLabel, displayName, pictureUrl } }`.
- `PATCH /api/auth/profile` accepts only `{ firstName, lastName, companyPositionId }` and returns the same profile shape.
- `GET /api/company-positions` returns `{ positions: [...] }` containing active positions only; `GET /api/auth/profile` separately returns the selected inactive position label when a legacy profile points to one.

- [ ] **Step 1: Write failing pure server-logic tests**

  Add tests named `reads a profile by session user id`, `updates only the allowlisted profile fields`, `rejects a blank or inactive company position`, and `returns a stable profile with the selected position label`.

  Use a request recorder around `supabaseRequest` and assert that reads target `app_user_profiles` joined to `company_positions`, writes target only `user_id=eq.session-user`, and never include body-supplied `userId`, role, status, or provider fields.

- [ ] **Step 2: Run pure server-logic tests to verify RED**

  Run: `/Users/tar/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/user-profile-api.test.mjs`

  Expected: FAIL because the server logic module does not exist.

- [ ] **Step 3: Implement profile/position server logic**

  Implement `getAppUserProfile`, `updateAppUserProfile`, and `listCompanyPositions` in `forms/user-profile.server.logic.js`. Ensure an absent profile row reads as blank values, an inactive selected position can still be displayed, and new PATCH values must reference an active position. Use Supabase admin access only; never accept a target user id from JSON.

- [ ] **Step 4: Extend LINE user mapping**

  Update `rowToAppUser`/LINE user reads only as needed to keep the profile endpoint compatible with existing auth rows. Do not put editable profile fields into provider-owned LINE fields or change the role selection behavior.

- [ ] **Step 5: Write failing HTTP route tests**

  Add an upstream fake response for profile and position REST endpoints, then test `GET /api/auth/profile`, `PATCH /api/auth/profile`, and `GET /api/company-positions` through the real server. Cover missing session (`401`), invalid payload (`400`), provider failure (`503`), and a body containing an attacker `userId` that must not redirect the update.

- [ ] **Step 6: Run HTTP tests to verify RED, then wire routes**

  Run the focused API test before wiring and confirm the expected missing-route failure. Add the imports, handlers, route registration, and error mapping in `local-server.mjs`. Keep `/api/auth/profile` and `/api/company-positions` behind the existing LINE auth guard.

- [ ] **Step 7: Run API tests to verify GREEN**

  Run: `/Users/tar/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/user-profile-api.test.mjs tests/line-auth.logic.test.mjs tests/line-auth-api.test.mjs`

  Expected: PASS with existing LINE login/authorization tests unchanged and all profile routes covered.

- [ ] **Step 8: Commit**

  ```bash
  git add forms/user-profile.server.logic.js forms/line-auth.logic.js local-server.mjs tests/user-profile-api.test.mjs tests/line-auth.logic.test.mjs
  git commit -m "feat: expose authenticated user profile APIs"
  ```

### Task 3: Profile page and site navigation

**Files:**
- Create: `forms/user-profile.html`
- Create: `forms/user-profile.logic.browser.js`
- Modify: all existing main-menu HTML pages under `forms/*.html`
- Modify: `local-server.mjs` static route map
- Test: `tests/user-profile.html.test.mjs`
- Modify: `tests/navigation.html.test.mjs`

**Interfaces:**
- Consumes Task 2's `/api/auth/profile` and `/api/company-positions` routes.
- Produces `/user-profile`, a page with first name, last name, and position dropdown fields.
- The page may display LINE `displayName`/picture read-only but may edit only profile fields.

- [ ] **Step 1: Write failing page and navigation tests**

  Add tests that require the profile page to contain `firstName`, `lastName`, `companyPositionId`, `/api/auth/profile`, `/api/company-positions`, and a save action. Extend navigation assertions so every page with the main menu links to `/user-profile` with the label `ข้อมูลส่วนตัว`.

- [ ] **Step 2: Run the HTML tests to verify RED**

  Run: `/Users/tar/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/user-profile.html.test.mjs tests/navigation.html.test.mjs`

  Expected: FAIL because the page and menu link do not exist.

- [ ] **Step 3: Implement the profile page/controller**

  Follow the existing company-settings page layout. Load profile and positions, preserve a selected inactive position for display, submit only the allowlisted fields with `PATCH`, and keep the page usable with a clear error when the API is unavailable.

- [ ] **Step 4: Add the static route and shared menu link**

  Register `/user-profile` and `/user-profile/` in `safeStaticPath`. Add one `ข้อมูลส่วนตัว` link to the `ระบบ` menu group on every existing page that has the main menu, including the new profile page.

- [ ] **Step 5: Run the HTML tests to verify GREEN**

  Run: `/Users/tar/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/user-profile.html.test.mjs tests/navigation.html.test.mjs`

  Expected: PASS with every main-menu page containing the new link.

- [ ] **Step 6: Commit**

  ```bash
  git add forms/user-profile.html forms/user-profile.logic.browser.js forms/*.html local-server.mjs tests/user-profile.html.test.mjs tests/navigation.html.test.mjs
  git commit -m "feat: add user profile page and navigation"
  ```

### Task 4: Centralize company-position dropdowns

**Files:**
- Create: `forms/company-position.browser.js`
- Modify: `forms/expense-request.html`
- Modify: `forms/substitute-receipt.html`
- Modify: `forms/expense-request.html` inline controller
- Modify: `forms/substitute-receipt.logic.browser.js`
- Test: `tests/company-position.html.test.mjs`

**Interfaces:**
- Consumes Task 2's `GET /api/company-positions`.
- Produces `SweetHouseCompanyPositions.loadInto(select, { selectedValue })`, which loads active positions into an existing searchable select while preserving a selected legacy/inactive label when necessary.
- Existing document payloads continue storing `requesterRole` as the selected label snapshot.

- [ ] **Step 1: Write failing dropdown tests**

  Add tests that assert the expense-request page no longer contains the hardcoded `เจ้าของบริษัท`/`marketing` option list, both requester-role controls use the shared loader, and the shared loader preserves a pre-existing value not present in the active master list.

- [ ] **Step 2: Run the dropdown tests to verify RED**

  Run: `/Users/tar/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/company-position.html.test.mjs`

  Expected: FAIL because the shared loader and page wiring do not exist.

- [ ] **Step 3: Implement the shared position loader**

  Fetch `/api/company-positions`, create `option.value === option.textContent === position.label` for document snapshot compatibility, mark the selected label, and leave the select usable when the fetch fails. Reinitialize the existing searchable-select behavior using the project’s current browser helper pattern.

- [ ] **Step 4: Replace hardcoded/requester role controls**

  Remove the static options from expense-request and change the substitute-receipt requester-role control to the same master-backed select. Load options during new-form initialization and restore stored labels without rewriting existing payloads.

- [ ] **Step 5: Run focused tests to verify GREEN**

  Run: `/Users/tar/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/company-position.html.test.mjs tests/expense-request.html.test.mjs tests/substitute-receipt.html.test.mjs`

  Expected: PASS; existing document field names and payload snapshots remain compatible.

- [ ] **Step 6: Commit**

  ```bash
  git add forms/company-position.browser.js forms/expense-request.html forms/substitute-receipt.html forms/substitute-receipt.logic.browser.js tests/company-position.html.test.mjs
  git commit -m "feat: load requester positions from the master"
  ```

### Task 5: New-document profile autofill

**Files:**
- Create: `forms/user-profile-autofill.browser.js`
- Modify: `forms/expense-request.html`
- Modify: `forms/substitute-receipt.logic.browser.js`
- Modify: `forms/workflow-document.logic.browser.js`
- Test: `tests/user-profile-autofill.logic.test.mjs`
- Modify: `tests/expense-request.html.test.mjs`
- Modify: `tests/substitute-receipt.html.test.mjs`
- Modify: `tests/workflow-document.html.test.mjs`

**Interfaces:**
- Consumes Task 2's profile API and Task 4's position loader.
- Produces a browser-compatible helper with `formatProfileName(profile)` and `autofillNewDocument({ form, isNewDocument, nameField, positionField, profile })` behavior.
- The helper must be a no-op for existing document/draft/reopen state and must never overwrite a nonblank field.

- [ ] **Step 1: Write failing pure autofill tests**

  Add tests named `joins first and last name for a new document`, `does not overwrite typed requester fields`, `does not autofill an existing document`, and `handles unavailable/partial profile values without undefined text`.

  Assert that only blank fields change, position uses the profile’s resolved label, and a profile API failure leaves the form usable.

- [ ] **Step 2: Run the autofill tests to verify RED**

  Run: `/Users/tar/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/user-profile-autofill.logic.test.mjs`

  Expected: FAIL because the helper does not exist.

- [ ] **Step 3: Implement the shared autofill helper**

  Keep profile fetching, name joining, blank-field checks, and document-state gating in one small classic-script-compatible module. Do not couple it to any document save endpoint. Return a resolved status/error rather than throwing into the form initialization path.

- [ ] **Step 4: Integrate each new-document path**

  Call the helper only after the existing page has determined that it is creating a brand-new document and before the user begins editing. Do not call it in draft loaders, submitted-document loaders, workflow resume paths, or existing-document paths. Integrate expense-request, substitute-receipt, and workflow-document requester name behavior; workflow-document has no requester role field.

- [ ] **Step 5: Run focused browser/HTML tests to verify GREEN**

  Run: `/Users/tar/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/user-profile-autofill.logic.test.mjs tests/expense-request.html.test.mjs tests/substitute-receipt.html.test.mjs tests/workflow-document.html.test.mjs`

  Expected: PASS with new-document autofill assertions and existing draft/reopen tests green.

- [ ] **Step 6: Commit**

  ```bash
  git add forms/user-profile-autofill.browser.js forms/expense-request.html forms/substitute-receipt.logic.browser.js forms/workflow-document.logic.browser.js tests/user-profile-autofill.logic.test.mjs tests/expense-request.html.test.mjs tests/substitute-receipt.html.test.mjs tests/workflow-document.html.test.mjs
  git commit -m "feat: autofill requester details on new documents"
  ```

### Task 6: LINE intake profile fallback and snapshot verification

**Files:**
- Modify: `forms/user-profile.server.logic.js`
- Modify: `local-server.mjs`
- Modify: `tests/line-intake-confirmation-api.test.mjs`
- Test: `tests/user-profile-snapshot.test.mjs`

**Interfaces:**
- Consumes Task 2’s `getAppUserProfile` and `formatProfileName`.
- Keeps existing body precedence: submitted `requesterName`/`requesterRole` win; profile fills only missing values.
- Produces no mutation of documents already saved when the profile is updated later.

- [ ] **Step 1: Write failing LINE intake and snapshot tests**

  Add a confirmation test where profile has first/last name and position, the intake body omits requester fields, and the created expense payload contains the joined name and position label. Add a second test proving explicit body fields win over profile values.

  Add the snapshot regression test now: create a new document from a profile, update the profile through the profile logic, reload the stored document, and assert its requester name/role remain the original values.

- [ ] **Step 2: Run the LINE intake tests to verify RED**

  Run: `/Users/tar/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/line-intake-confirmation-api.test.mjs`

  Expected: FAIL because confirmation currently falls back only to session display name/blank role.

- [ ] **Step 3: Implement the server fallback**

  Load the profile for the authenticated user while confirming the intake, pass it into the payload builder, and apply it only to missing fields. Preserve owner binding from the signed session and keep explicit body values authoritative.

- [ ] **Step 4: Run tests to verify GREEN**

  Run: `/Users/tar/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/line-intake-confirmation-api.test.mjs tests/user-profile-snapshot.test.mjs tests/user-profile-api.test.mjs`

  Expected: PASS with body precedence, owner binding, and snapshot behavior covered.

- [ ] **Step 5: Commit**

  ```bash
  git add forms/user-profile.server.logic.js local-server.mjs tests/line-intake-confirmation-api.test.mjs tests/user-profile-snapshot.test.mjs
  git commit -m "feat: use user profile for LINE document fallback"
  ```

### Task 7: Full verification and branch review

**Files:**
- Modify: only files required by verification findings
- Test: existing full suite via `scripts/test.sh`

**Interfaces:**
- Consumes all previous task outputs.
- Produces a verified branch with no new failure attributable to this feature.

- [ ] **Step 1: Run the focused feature suite**

  Run: `/Users/tar/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/user-profile.logic.test.mjs tests/company-position.logic.test.mjs tests/user-profile-api.test.mjs tests/user-profile.html.test.mjs tests/company-position.html.test.mjs tests/user-profile-autofill.logic.test.mjs tests/user-profile-snapshot.test.mjs tests/line-intake-confirmation-api.test.mjs`

  Expected: PASS.

- [ ] **Step 2: Run the full project suite**

  Run: `bash scripts/test.sh > /private/tmp/user-profile-autofill-final.log 2>&1`

  Expected: all feature tests pass. The baseline already showed a pre-existing `backup.test.mjs` failure (`backup script writes outside the repository by default`) and the baseline run was interrupted after that known failure; record any unchanged baseline failure separately rather than attributing it to this branch.

- [ ] **Step 3: Review the branch diff and migration consistency**

  Run: `git diff --check`, `git status --short`, and inspect the final diff for stale hardcoded position options, profile fields leaking into role tables, and any document rewrite path that resolves a position label after save.

- [ ] **Step 4: Commit any verification-only fixes**

  If a focused regression test finds a real feature defect, add the failing test first, fix the smallest production surface, rerun the focused and full suites, then commit with a targeted message. Do not change unrelated baseline behavior.
