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

Production currently lacks migrations `202611100001` through `202611100004` and `202611160001`, all required by the new runtime. The migrations were verified against the isolated local Supabase instance, but have not been applied to production and the application has not been deployed.

The linked Supabase project has no physical backups available. The local application files were backed up to `/Users/tar/sweet-house-backups/sweet-house-backup-20261117-112945-af548d`. A remote schema dump could not be produced because the Supabase CLI database connection rejected the available login role; the database password is not configured in the deployment secrets. Do not deploy this runtime until the production migration path is available and the migrations are applied successfully.
