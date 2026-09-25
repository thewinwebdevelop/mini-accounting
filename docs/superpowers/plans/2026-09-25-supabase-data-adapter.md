# Supabase Data Adapter and Incremental Cutover Implementation Plan

> **For agentic workers:** Use `superpowers:executing-plans` and complete each task in order. Every task is test-first, independently verifiable, and should be committed before moving to the next task.

**Goal:** Add a Supabase-backed data adapter and safe dual-read/dual-write path for inventory and document workflows while preserving local mode, LINE resource authorization, and rollback capability.

**Architecture:** Keep the current Node HTTP server and domain logic as the application boundary. Wrap the existing local persistence behind a stable adapter, add a server-only Supabase adapter, and select behavior with global/per-domain backend modes. Use deterministic source keys and hashes for idempotent migration, shadow comparison, and reconciliation.

**Tech Stack:** Node.js built-ins, Supabase PostgreSQL REST/Storage, existing SQLite/JSON persistence, `node:test`, vanilla browser-compatible server modules.

**Spec:** `docs/superpowers/specs/2026-09-25-supabase-data-adapter-design.md`

## Global constraints

- `SWEET_HOUSE_AUTH_MODE=disabled` and `DATA_BACKEND=local` remain safe compatibility defaults.
- Supabase service-role credentials are server-only and never appear in browser code, responses, or logs.
- Authorization runs before adapter reads, writes, fallbacks, and file downloads.
- Existing document numbers, payloads, statuses, PDF generation, Drive/Sheets behavior, and local files remain compatible.
- Every cloud write is idempotent by deterministic `source_key`; no migration step deletes local data.
- A cloud mode with missing configuration fails closed; local mode does not require cloud configuration.
- The real Supabase project is not contacted by tests or development commands unless explicitly configured for a migration run.

## Review focus

- Mode selection cannot silently fall back from a failed authoritative Supabase write.
- Shadow diffs are redacted and deterministic, without leaking document payloads or secrets.
- Existing owner/role checks are applied identically on local and Supabase paths.
- Retrying a dual-write or migration does not duplicate documents, stock movements, or files.
- Storage fallback is allowed only for an explicit migration gap and never bypasses authorization.

### Task 1: Add backend configuration and canonical adapter contracts

**Files:**
- Create: `forms/data-backend.logic.js`
- Create: `forms/data-adapter.logic.js`
- Create: `tests/data-backend.logic.test.mjs`
- Create: `tests/data-adapter.logic.test.mjs`
- Modify: `.env.example`, `docs/supabase-migration-runbook.md`

**Interfaces:**
- `resolveDataBackendMode(env, domain)` returns `local`, `shadow`, `dual-write`, or `supabase-read`.
- `createDataAdapter({ local, cloud, mode, domain, logger })` exposes normalized read/write dispatch and safe fallback rules.
- `stableSourceKey(kind, id)` and `canonicalHash(value)` provide deterministic identity/comparison primitives.

- [x] Write failing unit tests for defaults, invalid modes, per-domain overrides, missing cloud configuration, stable key/hash ordering, shadow comparison redaction, and authoritative-write failure.
- [x] Run the focused tests and verify the new modules are missing.
- [x] Implement pure configuration/dispatch helpers with no filesystem or network side effects.
- [x] Run focused tests and verify local mode never calls the cloud adapter while shadow/dual modes follow the contract.
- [x] Update `.env.example` and runbook with `DATA_BACKEND`, `DATA_BACKEND_INVENTORY`, and `DATA_BACKEND_DOCUMENTS`.
- [x] Commit with `feat: add data backend adapter contract`.

### Task 2: Add Supabase document schema and normalized repositories

**Files:**
- Create: `supabase/migrations/20260925_004_documents.sql`
- Create: `forms/supabase-data.logic.js`
- Create: `forms/document-cloud.logic.js`
- Create: `tests/supabase-data.logic.test.mjs`
- Create: `tests/document-cloud.logic.test.mjs`

**Interfaces:**
- `createSupabaseDataRepository({ client, now })` exposes company/vendor/inventory reads and idempotent inventory writes.
- `createDocumentCloudRepository({ client, now })` exposes document list/get/upsert and file-reference operations.
- `toCloudDocumentRecord`/`fromCloudDocumentRecord` preserve existing payload fields and owner/status semantics.

- [x] Write failing schema-text and fake-REST tests for document rows, file references, source-key uniqueness, owner persistence, and redacted provider failures.
- [x] Run focused tests and confirm missing schema/repository failures.
- [x] Add RLS-protected `documents` and `document_files` tables with service-role-only first-phase access, indexes for kind/number/owner/status, and migration ledger linkage.
- [x] Implement normalized REST repository operations using `supabaseRequest`, with source-key upsert and response verification by hash.
- [x] Run focused tests and verify retries update the same logical row.
- [x] Commit with `feat: add supabase document and data repositories`.

### Task 3: Wrap local persistence and integrate inventory adapter modes

**Files:**
- Create: `forms/local-data.adapter.js`
- Modify: `forms/inventory.logic.js`, `forms/local-server.logic.js`, `local-server.mjs`
- Test: `tests/data-adapter.integration.test.mjs`, existing inventory/API tests

**Interfaces:**
- `createLocalDataAdapter({ rootDir })` maps existing company/vendor/inventory/document operations to the adapter contract.
- Inventory route handlers consume the selected adapter without changing response JSON.

- [x] Write failing integration tests for local mode, shadow mode, dual-write success/failure, and Supabase-read fallback using fake local/cloud repositories.
- [x] Run focused integration tests to establish the missing adapter integration.
- [x] Implement the local wrapper and inject backend selection at the server boundary; do not rewrite existing SQLite domain operations.
- [x] Route inventory reads/writes through the adapter while preserving existing mapping, validation, and authorization behavior.
- [x] Run inventory, auth, and server API suites; verify `DATA_BACKEND=local` is byte-compatible with existing responses.
- [x] Commit with `feat: route inventory through data adapter`.

### Task 4: Integrate document workflows and ownership into cloud shadow/dual-write

**Files:**
- Modify: `forms/local-data.adapter.js`, `forms/document-cloud.logic.js`, `forms/local-server.logic.js`, `local-server.mjs`
- Test: `tests/data-adapter.integration.test.mjs`, `tests/line-resource-authorization.test.mjs`, relevant lifecycle suites

**Interfaces:**
- Expense, substitute-receipt, and lightweight workflow saves mirror the normalized document record after local validation and server-side owner binding.
- Lists/gets can shadow or read cloud records while preserving the existing API payload shape.

- [x] Add failing tests for owner preservation, legacy unowned records, document create/update dual-write, lifecycle actor stamps, and cloud failure retry behavior.
- [x] Implement document serialization with `payload jsonb`, stable `document_kind/document_no`, owner ID, status, accounting month, and source hash.
- [x] Add cloud shadow comparison for list/get results with redacted diff logging.
- [x] Keep local as the response source in dual-write; return a retryable error when the authoritative cloud write is unknown.
- [x] Run the combined auth/workflow suite and full local suite.
- [x] Commit with `feat: dual-write authorized document workflows`.

### Task 5: Add authorized Storage read cutover and reconciliation tooling

**Files:**
- Create: `forms/storage-file.adapter.js`
- Modify: `forms/local-server.logic.js`, `local-server.mjs`, `forms/supabase-storage.logic.js`
- Create: `tests/storage-file.adapter.test.mjs`
- Modify: `docs/supabase-migration-runbook.md`

**Interfaces:**
- `resolveMigratedObject({ sourceKey, manifest, bucket })` returns a validated private object reference.
- `createFileAdapter({ local, storage, mode })` supports local, shadow-verify, and Storage-read with explicit local fallback for unmigrated files.

- [x] Write failing tests for manifest lookup, path validation, authorization-before-download, changed-file hash mismatch, and local fallback only for known gaps.
- [x] Implement file reference lookup from `storage_migration_records`/document files and download verification through the server-only Storage client.
- [x] Replace authorized document file reads with the file adapter while preserving content type and download headers.
- [x] Ensure employee cross-owner and legacy access remains denied before either local or Storage I/O.
- [x] Run focused file/auth tests and existing document file tests.
- [x] Commit with `feat: cut over authorized document files to storage adapter`.

### Task 6: Add cutover checks and operational documentation

**Files:**
- Create: `scripts/compare-local-supabase.mjs`
- Create: `tests/compare-local-supabase.test.mjs`
- Modify: `scripts/migrate-local-to-supabase.mjs`, `.env.example`, `docs/feature-checklist.md`, `docs/supabase-migration-runbook.md`

**Interfaces:**
- `compareLocalAndSupabase({ rootDir, local, cloud })` returns deterministic counts, missing keys, hash mismatches, and a redacted report.
- Migration/compare commands remain dry-run by default and never delete local data.

- [x] Write failing tests for deterministic reports, missing/mismatched rows, exit status, and no-write dry-run behavior.
- [x] Implement the compare command and document backup, dry-run, dual-write, observation, rollback, and final cutover procedures.
- [x] Mark only completed migration/cutover checklist items; leave production project verification unchecked until actually run.
- [x] Run focused tests, then `./scripts/test.sh`.
- [x] Commit with `chore: add supabase cutover verification tooling`.

## Final verification

Run:

```bash
./scripts/test.sh
git diff --check
git status --short
```

The branch is complete only when the full suite is green, the worktree is clean except for intentional committed changes, and the runbook clearly states that the real Supabase project still requires a reviewed backup/dry-run/apply/verification sequence.
