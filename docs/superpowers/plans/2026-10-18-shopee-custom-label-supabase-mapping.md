# Shopee Custom Label Supabase Mapping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** ย้าย reusable Manual SKU bundle mapping ของ Shopee Custom Label ไปเก็บใน Supabase Database สำหรับ production โดยคง SQLite เป็น backend ของ local/test ที่ไม่มี Supabase

**Architecture:** เพิ่ม Supabase repository methods สำหรับอ่านและ bulk-upsert mapping ตามคู่ normalized product/option key. Custom-label logic จะรับ `mappingLoader` และ `mappingSaver` ผ่าน options; local ใช้ implementation SQLite เดิม ส่วน Cloud Run injects Supabase repository และไม่เขียน mapping table ลง SQLite. Job snapshot และ PDF artifacts จะคง flow เดิม

**Tech Stack:** Node.js ESM/CommonJS modules, Supabase REST API, PostgreSQL migration SQL, SQLite for local/test, Node test runner

**Spec:** `docs/superpowers/specs/2026-10-18-shopee-custom-label-supabase-mapping-design.md`

## Global Constraints

- Production persistence modes remain `supabase-read`; do not add a local fallback for custom-label mappings in Cloud Run.
- Supabase service-role credentials remain server-only; no Supabase calls or credentials from browser code.
- Preserve normalized matching by product name and option name, including the existing Thai PDF normalization.
- Preview must not update reusable mappings; Save must persist the full bundle including every SKU and quantity.
- Existing local SQLite tests and existing custom-label PDF behavior must remain passing.

## Review Focus

- A bundle containing multiple SKUs and duplicate SKU quantities must round-trip through Supabase without losing order or quantities; cover in repository upsert test.
- A product/option key containing Thai text, punctuation, spaces, or `::` must be read and upserted safely; cover in repository query/response test.
- Supabase returning an incomplete or mismatched row must fail verification rather than report success; cover in repository error test.
- Preview must not persist a reusable mapping while Save must persist it; cover in custom-label flow tests.
- Cloud Run must not write reusable mapping rows to `/tmp` when Supabase is configured; cover in integration wiring test or explicit option assertion.

---

### Task 1: Add the Supabase mapping migration

**Files:**
- Create: `supabase/migrations/202610180001_shopee_custom_label_mappings.sql`
- Test: `tests/supabase-custom-label-mapping.migration.test.mjs`

**Interfaces:**
- Produces PostgreSQL table `public.shopee_custom_label_mappings` with unique `(product_name_key, option_name_key)` and JSONB `bundle`.

- [ ] **Step 1: Write the failing migration assertions**

  Add tests that read the migration SQL and assert the table, key columns, JSONB bundle, unique constraint, RLS enablement, and revokes for `anon` and `authenticated`.

- [ ] **Step 2: Run the migration test to verify it fails**

  Run: `node --test tests/supabase-custom-label-mapping.migration.test.mjs`

  Expected: FAIL because the migration file does not exist.

- [ ] **Step 3: Implement the migration**

  Create the table using the schema in the approved spec, enable RLS, and revoke direct client table privileges.

- [ ] **Step 4: Run the migration test to verify it passes**

  Run: `node --test tests/supabase-custom-label-mapping.migration.test.mjs`

  Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add supabase/migrations/202610180001_shopee_custom_label_mappings.sql tests/supabase-custom-label-mapping.migration.test.mjs
  git commit -m "feat: add Supabase Shopee custom label mappings"
  ```

### Task 2: Add Supabase repository operations for mappings

**Files:**
- Modify: `forms/supabase-data.logic.js`
- Test: `tests/supabase-data.logic.test.mjs`

**Interfaces:**
- Produces `listShopeeCustomLabelMappings(keys)` returning `{ [mappingKey]: bundle[] }`.
- Produces `upsertShopeeCustomLabelMappings(mappings)` accepting normalized mapping objects with `productName`, `optionName`, and `bundle`, and returning the verified saved mappings.

- [ ] **Step 1: Write failing repository tests**

  Test that list requests mapping rows and returns bundles keyed as `product::option`; test bulk upsert sends `on_conflict=product_name_key,option_name_key`, preserves multi-SKU bundles, and uses `return=representation`; test mismatched response raises `SUPABASE_DATA_VERIFY_FAILED`.

- [ ] **Step 2: Run the repository tests to verify they fail**

  Run: `node --test tests/supabase-data.logic.test.mjs`

  Expected: FAIL because the repository methods do not exist.

- [ ] **Step 3: Implement mapping row conversion and repository methods**

  Add private mapping helpers alongside the existing Supabase record mappers. Use the existing `supabaseRequest` client and normalize/filter returned rows by the exact requested key. Bulk upsert all normalized rows in one request and verify every returned row matches its key and bundle.

- [ ] **Step 4: Run the repository tests to verify they pass**

  Run: `node --test tests/supabase-data.logic.test.mjs`

  Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add forms/supabase-data.logic.js tests/supabase-data.logic.test.mjs
  git commit -m "feat: add Supabase custom label mapping repository"
  ```

### Task 3: Add mapping loader/saver injection to custom-label logic

**Files:**
- Modify: `forms/shopee-custom-label.logic.js`
- Test: `tests/shopee-custom-label.logic.test.mjs`

**Interfaces:**
- `parseCustomLabelUpload(rootDir, file, { mappingLoader })` awaits the injected loader for parsed mapping keys and uses the SQLite loader only when no loader is supplied.
- `saveCustomLabel(rootDir, jobId, mappings, { mappingSaver })` invokes the injected saver for normalized mappings before completing the save, while the default path keeps the existing SQLite behavior.
- The local job snapshot update remains available without writing reusable mappings to SQLite when `mappingSaver` is supplied.

- [ ] **Step 1: Write failing logic tests**

  Add tests using the existing sample PDF and temporary root that inject a mapping loader and assert its bundle appears in the parsed job autofill. Add a save test with an injected saver and assert it receives normalized multi-SKU mappings; assert the SQLite reusable mapping table remains empty in that injected path. Keep the existing default SQLite persistence test.

- [ ] **Step 2: Run the logic tests to verify they fail**

  Run: `node --test tests/shopee-custom-label.logic.test.mjs`

  Expected: FAIL because upload/save do not accept or invoke the injected dependencies.

- [ ] **Step 3: Implement the smallest dependency seam**

  Make the parser await `mappingLoader` when provided. Split the job snapshot update from the SQLite reusable-mapping upsert so the injected saver path can update `savedMappings` without inserting into `shopee_custom_label_mappings`. Preserve the default local path exactly.

- [ ] **Step 4: Run the logic tests to verify they pass**

  Run: `node --test tests/shopee-custom-label.logic.test.mjs`

  Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add forms/shopee-custom-label.logic.js tests/shopee-custom-label.logic.test.mjs
  git commit -m "feat: inject durable custom label mapping persistence"
  ```

### Task 4: Wire Cloud Run custom-label routes to Supabase mappings

**Files:**
- Modify: `local-server.mjs`
- Test: `tests/shopee-custom-label-api.test.mjs` or a focused new route-wiring test
- Modify: `docs/cloud-run-supabase-deployment.md` if the migration checklist needs the new migration called out

**Interfaces:**
- Cloud Run creates a `customLabelDataRepository` using the existing Supabase admin client.
- Upload passes `mappingLoader: keys => customLabelDataRepository.listShopeeCustomLabelMappings(keys)`.
- Save passes `mappingSaver: mappings => customLabelDataRepository.upsertShopeeCustomLabelMappings(mappings)`.
- Local mode omits both options and continues using SQLite.

- [ ] **Step 1: Write failing route/integration assertions**

  Extend the custom-label API test seam so the Cloud Run wiring can be exercised with a fake Supabase client, or add a focused static wiring test that asserts Cloud Run constructs the repository and passes both dependencies while local mode does not. Assert Preview does not call the saver and Save does.

- [ ] **Step 2: Run the wiring test to verify it fails**

  Run the focused test command and confirm it fails before wiring is added.

- [ ] **Step 3: Wire the repository into the upload and transform handlers**

  Instantiate the repository only for `cloudRun`, pass the loader into upload parsing, and pass the saver into Save. Do not pass a saver to Preview. Ensure repository failures become the existing custom-label operation error response.

- [ ] **Step 4: Run the API and wiring tests to verify they pass**

  Run: `node --test tests/shopee-custom-label-api.test.mjs tests/shopee-custom-label.logic.test.mjs tests/supabase-data.logic.test.mjs tests/supabase-custom-label-mapping.migration.test.mjs`

  Expected: PASS, including the existing local API behavior.

- [ ] **Step 5: Commit**

  ```bash
  git add local-server.mjs docs/cloud-run-supabase-deployment.md tests/shopee-custom-label-api.test.mjs
  git commit -m "feat: use Supabase mappings for Cloud Run custom labels"
  ```

### Task 5: Verify the full change and prepare deployment

**Files:**
- Modify: only files required by verification findings

- [ ] **Step 1: Run syntax and formatting checks**

  Run: `node --check local-server.mjs` and `git diff --check`.

- [ ] **Step 2: Run the full Node test suite**

  Run the repository's full test command from `package.json` (or `node --test` with the configured test files if no script exists).

  Expected: all tests pass; any unrelated pre-existing failure must be reported by name.

- [ ] **Step 3: Review the final diff**

  Confirm production mapping calls use Supabase, local fallback is only used outside Cloud Run, no browser code contains service credentials, and migration order is documented.

- [ ] **Step 4: Commit any verification-only fixes**

  Use a focused commit only if verification found a real issue; do not alter unrelated files.

- [ ] **Step 5: Deploy only after verification**

  Build/push the image, run the Supabase migration, deploy Cloud Run, and verify health plus the active revision. Do not claim mapping migration is complete until the Supabase migration has been applied successfully.
