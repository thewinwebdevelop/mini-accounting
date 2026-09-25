# Supabase Migration Runbook

## Safety rule

Do not run `--apply` against the production project until a backup of the local documents, config, and SQLite database exists and the dry-run counts have been reviewed. The migration never deletes local data.

## Backup

```bash
SWEET_HOUSE_ROOT_DIR="/Users/tar/Documents/หจกสวีทเฮาส์" ./scripts/backup.sh
```

## Configure

Copy `.env.example` to the deployment environment and set `SUPABASE_URL` and the server-only `SUPABASE_SERVICE_ROLE_KEY`. Apply migrations `supabase/migrations/20260925_001_line_auth.sql` and `supabase/migrations/20260925_002_core_data.sql` in order.

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

## Verify

Compare the migration output counts with the local dry-run counts and query the Supabase tables by `source_key`. Confirm that product, SKU, and stock movement source IDs are complete before switching the application data backend.

## Cutover

The current branch only establishes the migration contract and core data slice. A later cutover task must add a dual-read/dual-write or frozen-write switch, migrate document JSON/PDF/raw evidence to Supabase Storage, verify every domain, and only then set `DATA_BACKEND=supabase`.
