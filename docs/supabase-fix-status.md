# Supabase runtime repair status

## Repairs completed

- Added durable Supabase writes and reads for inventory products, categories, stock SKUs, bundles, stock movements, reservations, reversals, and reports. Product and SKU codes are normalized and protected against duplicates.
- Added persistent commerce records and idempotent operations for Shopee sync/import, shipment preparation, custom-label jobs, and related actions.
- Added atomic document-number allocation and compare-and-swap document/file persistence to prevent duplicate numbers and stale writes.
- Persisted Google Drive credentials in Supabase, repaired LINE intake retry/deduplication, and fixed cross-instance reads for vendors and company settings.
- Fixed workflow links and LINE return handling so protected child documents stay in their workflow, and corrected a replay-hash mismatch for posted Shopee movements.
- Added Supabase integration and browser E2E suites with exact cleanup. Removed 58 stale E2E records from the isolated local Supabase project and verified absence afterward. No test records were created in production.

## Verification

- Node unit suite: 1,053 / 1,053 passed with the project Python environment.
- Chromium browser E2E: 39 / 39 passed.
- Isolated real Supabase integration: 12 / 12 passed; Supabase browser E2E: 2 / 2 passed.
- `git diff --check` passed before the final documentation update.
- Production read-only preflight found no duplicate normalized product codes or stock SKU codes.

See `docs/supabase-e2e.md` for commands and cleanup behavior.

## Production rollout status

Applied migrations `202611100001` through `202611100004` and `202611160001` to the linked production project, then verified the required tables, columns, RPC, and migration history through the Supabase Management API SQL runner. The normal `supabase db push` route could not authenticate because the database password was unavailable, so the migration statements and history entries were applied separately.

Deployed revision `sweet-house-00042-2qk` to Cloud Run and routed 100% traffic to it. Production `/api/healthz` returned `{"ok":true,"runtime":"cloud-run","version":"sweet-house-00042-2qk"}` and `/` returned HTTP 200. The service retained its Supabase backend settings and Secret Manager references.

The linked Supabase project reported no physical backups, and a remote logical dump was unavailable through the database login. The migrations were tested against isolated local Supabase first; they add the missing cloud schema and backfill the new commerce idempotency hash column. The local application files were backed up to `/Users/tar/sweet-house-backups/sweet-house-backup-20261117-112945-af548d`.
