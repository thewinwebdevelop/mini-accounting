# Supabase Migration Runbook

## Safety rule

Do not run `--apply` against the production project until a backup of the local documents, config, and SQLite database exists and the dry-run counts have been reviewed. The migration never deletes local data.

## Backup

```bash
SWEET_HOUSE_ROOT_DIR="/Users/tar/Documents/หจกสวีทเฮาส์" ./scripts/backup.sh
```

## Configure

Copy `.env.example` to the deployment environment and set `SUPABASE_URL` and the server-only `SUPABASE_SERVICE_ROLE_KEY`. The storage migration creates the private standard bucket `sweet-house-files`; leave `SUPABASE_STORAGE_BUCKET` at that default unless a matching private custom bucket has already been created. Apply migrations `supabase/migrations/20260925_001_line_auth.sql`, `supabase/migrations/20260925_002_core_data.sql`, and `supabase/migrations/20260925_003_storage.sql` in order.

## Dry run

```bash
SWEET_HOUSE_ROOT_DIR="/path/to/data-root" \
SUPABASE_URL="https://your-project.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="..." \
/Users/tar/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
scripts/migrate-local-to-supabase.mjs
```

Review `counts` and the source keys. The command performs no Supabase writes in dry-run mode.

## Apply

Stop local writes, create a fresh backup, then run the same command with `--apply`. The process upserts by `source_key`, verifies each row, records `migration_records`, and marks the run failed if any row cannot be verified. Re-running is safe for already recorded source keys.

## File storage dry run

The file migration is separate from the core-data migration and defaults to dry-run. It scans document JSON/PDF/raw files under `documents/` and product/SKU images under `data/inventory-images/`; it does not modify local files or contact Supabase in dry-run mode.

```bash
SWEET_HOUSE_ROOT_DIR="/path/to/data-root" \
/Users/tar/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
scripts/migrate-local-files-to-supabase.mjs
```

Review `counts`, `sourceKey`, `objectPath`, SHA-256, and byte sizes. Create a backup immediately before apply and stop local writes while the apply runs.

## File storage apply

```bash
SWEET_HOUSE_ROOT_DIR="/path/to/data-root" \
SUPABASE_URL="https://your-project.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="..." \
SUPABASE_STORAGE_BUCKET="sweet-house-files" \
/Users/tar/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
scripts/migrate-local-files-to-supabase.mjs --apply
```

The command uploads to the private bucket, downloads each object back for byte/hash verification, then records the source in `storage_migration_records`. It never deletes local files. A repeated run skips an unchanged source and re-uploads a changed source.

## Verify

Compare the migration output counts with the local dry-run counts and query the Supabase tables by `source_key`. Confirm that product, SKU, and stock movement source IDs are complete before switching the application data backend.

## LINE resource authorization

When `SWEET_HOUSE_AUTH_MODE=line`, new expense requests, substitute receipts, and lightweight workflow documents are stamped with the authenticated Supabase app-user ID in `ownerUserId`. Edits preserve the stored owner; client-supplied owner or audit actor fields are ignored. Employees can read and submit only their own documents. Approval, completion, stock receiving, Drive/Sheets sync, and settings require the corresponding privileged role. Legacy numbered records without `ownerUserId` remain available only to owner/accounting/admin users until an ownership backfill is reviewed.

The server returns `403` with code `AUTH_FORBIDDEN` for denied resource and lifecycle actions, including file downloads. Keep `SWEET_HOUSE_AUTH_MODE=disabled` only for local compatibility/testing; it intentionally preserves the previous unauthenticated behavior and does not enforce ownership.

## Cutover

The application data adapter supports `local`, `shadow`, `dual-write`, and `supabase-read`. Keep the global default at `DATA_BACKEND=local` until the target project has passed backup, dry-run, apply, row/hash comparison, and authorization checks. Use `DATA_BACKEND_INVENTORY` and `DATA_BACKEND_DOCUMENTS` to cut over domains independently. Shadow mode returns local results while recording redacted differences; dual-write returns a retryable error when the cloud write is not verified. A later production step may set `DATA_BACKEND=supabase-read` only after the observation window is clean.

The current branch establishes the adapter contract and migration boundary. The real target project still requires a reviewed file migration, document-data migration, authorized Storage-read verification, and LINE Developing/Review/Published production checks before any cloud mode is enabled in deployment.
