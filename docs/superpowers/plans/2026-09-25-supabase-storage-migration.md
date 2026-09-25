# Supabase Storage Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a private Supabase Storage migration path for document files and inventory images while preserving the local source of truth.

**Architecture:** Keep file generation and current file routes local during this phase. Add a small server-only Storage REST boundary, a SQL migration for the private bucket and migration ledger, and a CLI that scans approved local roots, uploads with verification, and records idempotent results.

**Tech Stack:** Node.js built-ins, Supabase Storage REST API, Supabase PostgreSQL, `node:test`, existing local filesystem.

**Spec:** `docs/superpowers/specs/2026-09-25-supabase-storage-migration-design.md`

## Global Constraints

- Local files are never deleted or overwritten by the migration.
- The bucket is private; the browser never receives the service-role key.
- Dry-run performs no Supabase requests and no local writes.
- No source is marked migrated until upload and byte/hash verification both succeed.
- Existing file URLs, document numbers, lifecycle statuses, and Google integrations remain unchanged in this phase.

## Review Focus

- A symlink or traversal path under an approved root must fail closed instead of being uploaded.
- A caller-supplied `Authorization` or `apikey` header must never override the server service-role key.
- A provider returning a successful status with different bytes must fail verification and not create a migration record.
- A changed local file must not be skipped because an older migration record exists.
- A dry-run must not bootstrap or mutate SQLite schema state.

---

### Task 1: Storage schema and server-only client

**Files:**
- Create: `supabase/migrations/20260925_003_storage.sql`
- Create: `forms/supabase-storage.logic.js`
- Create: `tests/supabase-storage.logic.test.mjs`
- Modify: `.env.example`

**Interfaces:**
- Consumes `assertSupabaseConfiguration` from `forms/supabase.logic.js`.
- Produces `createSupabaseStorageClient`, `storageRequest`, `uploadStorageObject`, and `downloadStorageObject`.

- [ ] **Step 1: Write the failing tests**

Add tests for a private bucket contract, upload headers, caller-header override protection, provider error redaction, and downloaded byte verification.

- [ ] **Step 2: Run the focused tests and verify they fail**

Run:

```bash
/Users/tar/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/supabase-storage.logic.test.mjs
```

Expected: FAIL because the Storage client module does not exist.

- [ ] **Step 3: Implement the minimal Storage client and SQL**

Use `POST /storage/v1/object/<bucket>/<objectPath>` for uploads and `GET /storage/v1/object/<bucket>/<objectPath>` for verification/download. Force `apikey` and `Authorization` after merging optional headers. Add `storage_migration_records` with RLS enabled and revoke `anon`/`authenticated`. Add a private bucket row in `storage.buckets` with a bounded file size and approved document/image MIME types.

- [ ] **Step 4: Run focused tests**

Run the same `node --test` command and expect all Storage client tests to pass.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260925_003_storage.sql forms/supabase-storage.logic.js tests/supabase-storage.logic.test.mjs .env.example
git commit -m "feat: add private supabase storage boundary"
```

### Task 2: Deterministic local file manifest

**Files:**
- Create: `scripts/migrate-local-files-to-supabase.mjs`
- Create: `tests/migrate-local-files-to-supabase.test.mjs`

**Interfaces:**
- Consumes `getSupabaseStoragePath`/Storage helpers from Task 1.
- Produces `collectStorageManifest({ rootDir })`, `planStorageMigration({ rootDir, now })`, and `applyStorageMigration({ rootDir, client, request, now })`.

- [ ] **Step 1: Write the failing manifest tests**

Cover deterministic ordering for files under `documents/` and `data/inventory-images/`, source SHA-256 and content type, and rejection of symlinks/traversal.

- [ ] **Step 2: Run tests to verify the expected failure**

```bash
/Users/tar/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/migrate-local-files-to-supabase.test.mjs
```

Expected: FAIL because the manifest collector does not exist.

- [ ] **Step 3: Implement the read-only manifest collector**

Walk only the two approved directories with `readdir(..., { withFileTypes: true })`. Reject symlinks and non-file entries that claim to be regular files. Normalize paths relative to `rootDir` using POSIX separators, derive object paths under `documents/` or `inventory-images/`, hash bytes with SHA-256, and map known extensions to safe MIME types.

- [ ] **Step 4: Run manifest tests**

Run the focused command and expect all manifest tests to pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/migrate-local-files-to-supabase.mjs tests/migrate-local-files-to-supabase.test.mjs
git commit -m "feat: build deterministic local storage manifest"
```

### Task 3: Dry-run/apply migration and verification

**Files:**
- Modify: `scripts/migrate-local-files-to-supabase.mjs`
- Modify: `tests/migrate-local-files-to-supabase.test.mjs`
- Modify: `docs/supabase-migration-runbook.md`
- Modify: `docs/feature-checklist.md`

**Interfaces:**
- Consumes the manifest and Storage client from Tasks 1–2.
- Produces a CLI with default dry-run mode and `--apply` for explicit writes.

- [ ] **Step 1: Write failing migration tests**

Cover dry-run with zero writes, first apply uploading and recording one row, repeat apply skipping the unchanged row, changed-file re-upload, and a mismatched verification response that leaves no record.

- [ ] **Step 2: Run tests to verify they fail**

Run the focused migration test file and expect failures for the missing apply/verification behavior.

- [ ] **Step 3: Implement idempotent apply**

For each manifest row, query `storage_migration_records` by migration/source key. Skip only when stored hash, size, content type, bucket, and object path match. Upload with `upsert: true`, download the object, compare byte length and SHA-256, then insert or update the ledger row. Record failed runs through the existing `migration_runs` table without exposing provider bodies.

- [ ] **Step 4: Add CLI output and runbook**

Use `SWEET_HOUSE_ROOT_DIR`, `SUPABASE_STORAGE_BUCKET` (default `sweet-house-files`), `SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY`. Print JSON counts and per-source errors with paths relative to the data root. Document applying migration `20260925_003_storage.sql`, backup requirements, dry-run, apply, and verification.

- [ ] **Step 5: Run focused and full tests**

Run:

```bash
/Users/tar/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/supabase-storage.logic.test.mjs tests/migrate-local-files-to-supabase.test.mjs
./scripts/test.sh
```

Expected: focused tests and the full existing suite pass with zero failures.

- [ ] **Step 6: Commit**

```bash
git add scripts/migrate-local-files-to-supabase.mjs tests/migrate-local-files-to-supabase.test.mjs docs/supabase-migration-runbook.md docs/feature-checklist.md
git commit -m "feat: add idempotent local file storage migration"
```
