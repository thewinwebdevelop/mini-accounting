# Supabase Data Adapter and Incremental Cutover Design

## Goal

Move the existing LINE Mini App from local persistence toward Supabase without a big-bang rewrite, while preserving local compatibility mode, resource authorization, and idempotent migration/retry behavior.

## Scope

This phase adds:

- a server-side data adapter boundary for company, vendors, inventory, and document workflows;
- local, shadow, dual-write, and Supabase-read backend modes;
- stable source keys and row hashes for migration, comparison, and retry safety;
- Supabase-backed document metadata that preserves the current workflow payload shape during the migration;
- document-file references to private Supabase Storage;
- domain-by-domain read cutover with local fallback during rollout;
- tests that prove local compatibility, adapter behavior, authorization preservation, and idempotent writes.

This phase does not remove local files or SQLite data, expose the Supabase service key to the browser, or switch the production project without an explicit migration verification run.

## Constraints and decisions

### Server-only Supabase access

The browser continues to call the application server. The server owns the Supabase service-role client and remains responsible for authorization before every document or file read. Browser code must never receive `SUPABASE_SERVICE_ROLE_KEY`.

### Adapter boundary

Domain handlers call a stable adapter interface instead of choosing SQLite or Supabase directly. The first interface covers:

- company settings and vendors;
- products, stock SKUs, and stock movements;
- document lookup/list/create/update and lifecycle mutations;
- document-file metadata and authorized file reads.

The existing local implementation is wrapped first, so behavior can be tested before the Supabase implementation becomes authoritative.

### Backend modes

The server supports a global default plus per-domain overrides:

- `local`: read and write local persistence;
- `shadow`: read local, perform a comparable Supabase read, and emit a redacted diff without changing the response;
- `dual-write`: read local and write the same idempotent operation to Supabase;
- `supabase-read`: read Supabase and use local only as a controlled fallback for rows not yet migrated or when fallback is explicitly enabled.

The initial production sequence is `local` → `shadow` → `dual-write` → `supabase-read`. Inventory is cut over before documents because its normalized Supabase tables already exist.

### Idempotency and source identity

Every migrated or dual-written row has a deterministic `source_key` derived from the existing local identity. Writes upsert by source key and use a canonical payload hash. Retried requests must not create duplicate rows or duplicate movement records. Migration ledgers remain append-safe and local data is never deleted by the adapter.

## Supabase model

Existing core tables remain the canonical normalized shape for the first inventory cutover:

- `company_settings`;
- `vendors`;
- `inventory_products`;
- `inventory_stock_skus`;
- `inventory_stock_movements`;
- `migration_records`.

Document workflow data needs a server-side cloud representation. Add:

### `documents`

- `source_key` unique;
- `document_kind`;
- `document_no` where applicable;
- `owner_user_id` nullable foreign key to `app_users`;
- `status` and relevant indexed workflow fields;
- `payload jsonb` containing the current domain payload during the transition;
- `source_hash`;
- created/updated timestamps.

Legacy rows without an owner remain nullable and retain the current authorization rule: employees cannot access them; owner, accounting, and admin can access them for migration and operations.

### `document_files`

- document source reference;
- stable file `source_key`;
- private Storage bucket and object path;
- SHA-256, byte size, content type, and original filename;
- migration/verification timestamps.

The existing `storage_migration_records` ledger remains the source of truth for file transfer idempotency. Local files remain available as rollback/fallback copies until the Storage read cutover is verified.

## Read and write behavior

### Reads

1. Authenticate the LINE session.
2. Apply the existing resource authorization policy.
3. Read through the selected adapter.
4. In shadow mode, compare canonical fields and hashes but return the local result.
5. In Supabase-read mode, use a controlled local fallback only for an explicitly known migration gap or unavailable cloud row; do not bypass authorization.

### Writes

1. Validate and normalize the request once in the domain layer.
2. Bind the authenticated owner and lifecycle actor on the server.
3. Write local and/or Supabase according to the selected mode.
4. Verify the Supabase response by source key and hash.
5. Return success only when the authoritative write for that mode has completed.

For dual-write failures, the server returns a retryable error and records enough context for reconciliation. It must not silently report success when the cloud write is unknown.

## Rollout

1. Introduce adapter contracts and wrap the current local persistence.
2. Add Supabase document schema and adapter with fake-provider tests.
3. Run deterministic dry-run migration and compare row counts/hashes.
4. Enable shadow reads for inventory and document queries.
5. Enable dual-write while local remains the response source.
6. Cut over inventory reads to Supabase and monitor fallback/diff metrics.
7. Cut over document reads and lifecycle writes after ownership and status comparisons pass.
8. Switch authorized document-file reads to private Storage using the verified object manifest.
9. Keep local fallback during an observation window; only then consider disabling local writes.

## Failure and security handling

- Missing Supabase configuration fails closed when a cloud mode is selected and does not affect disabled/local mode.
- Supabase errors are redacted and never expose service credentials or raw provider responses to clients.
- Authorization runs before both local and Supabase reads, including fallback paths and file downloads.
- Legacy unowned documents are not automatically assigned to the first user who opens them.
- A partial dual-write is reconciled by deterministic source key and hash, not by creating a second record.

## Verification criteria

- The existing local test suite remains green in disabled/local mode.
- Adapter unit tests cover each backend mode, retries, hash mismatch, provider failure, and fallback rules.
- Migration dry-run is deterministic and has no network side effects.
- Re-running migration or dual-write produces no duplicates.
- Shadow comparisons report zero unexplained differences before read cutover.
- Employee ownership and privileged-role behavior is identical on local and Supabase paths.
- Storage reads require authorization and verify the expected object manifest.
- Production cutover is blocked unless migrations, backups, dry-run counts, and verification checks are recorded.
