# Supabase Storage Migration Design

## Goal

Move the existing document files and inventory product images into a private Supabase Storage bucket without deleting or changing the local source files, so the later LINE Mini App deployment can serve durable cloud files.

## Scope

This phase adds the storage contract and a repeatable migration command. It includes:

- a private `sweet-house-files` bucket configuration;
- a server-only Supabase Storage REST client using the existing service-role boundary;
- deterministic discovery of document files under `documents/` and inventory images under `data/inventory-images/`;
- dry-run and apply modes with source SHA-256, byte-size, content type, and object-path reporting;
- idempotent migration records and post-upload byte/hash verification;
- path, symlink, file-type, and provider-error safeguards.

It does not yet change document/inventory read handlers, delete local files, rewrite business workflows, or expose Storage directly to the browser. Those changes require the resource-authorization and Supabase data-adapter phases.

## Architecture

The migration command scans the local root and produces a manifest whose source keys are stable relative paths. The server uploads each object through the Supabase Storage REST API with the service-role key, verifies the uploaded object by downloading it back, and records the successful source hash in `storage_migration_records`. Re-running the command skips records whose source hash and metadata still match; changed bytes are uploaded again only after the previous record is replaced safely.

Object paths preserve the source namespace:

```text
documents/<existing relative path>
inventory-images/<existing relative path>
```

The bucket remains private. Application file routes continue to enforce document/resource authorization and can later choose local or Storage reads behind a feature flag without changing stored document numbers or payload file names.

## Data contract

`storage_migration_records` stores `migration_name`, `source_key`, bucket, object path, SHA-256, byte size, content type, and migration timestamp. The `(migration_name, source_key)` key makes retries idempotent, while `(bucket_name, object_path)` prevents two sources from claiming the same cloud object.

The migration name is `local-file-storage-20260925`. A source key is `file:<relative POSIX path>`. Only regular files under the two approved roots are eligible. Symlinks and paths escaping the data root fail closed.

## Security and failure handling

- The bucket is private and the service-role key is never sent to browser code or included in JSON output.
- Caller-provided headers cannot override `apikey` or `Authorization` on Storage requests.
- Object paths are normalized to POSIX relative paths and reject `..`, absolute paths, backslashes, and NUL bytes.
- Dry-run opens no SQLite schema and performs no local writes or Supabase requests.
- Apply never deletes local files. A source is recorded only after upload and download/hash verification succeed.
- Provider errors expose stable local error codes without echoing response bodies or credentials.
- A changed source file is treated as a new content version and re-uploaded; the source is not marked complete with a stale hash.

## Testing and success criteria

Tests cover content-type mapping, deterministic manifest ordering, symlink/path rejection, dry-run read-only behavior, server-header protection, upload verification, provider-error redaction, idempotent retries, and changed-file re-upload.

Success means an operator can run a dry-run, review counts and object paths, then run apply against a configured private bucket and safely repeat it without duplicate migration records or silent data loss.
