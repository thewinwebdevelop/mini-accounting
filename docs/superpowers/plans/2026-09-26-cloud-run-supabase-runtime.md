# Cloud Run + Supabase Runtime Plan

## 1. Runtime contract

- [x] Add Cloud Run detection and a `/tmp` compatibility root.
- [x] Bind Cloud Run to `0.0.0.0` and keep local binding unchanged.
- [x] Add `/healthz` and tests for the health response and binding behavior.

## 2. Durable file path

- [x] Add a Supabase Storage synchronizer for all files under a saved document
  folder.
- [x] Record uploaded files in the existing storage ledger used by the file
  adapter.
- [x] Call the synchronizer before a cloud document write succeeds.
- [x] Resolve document file routes from cloud metadata when the local filesystem
  is empty, and test a storage-backed read.
- [x] Hydrate missing documents from Supabase before lifecycle mutations and
  sync their updated status/files back to Supabase.

## 3. Container and deployment

- [x] Add a Node container definition and a focused `.dockerignore`.
- [x] Document local container verification and `gcloud run deploy` with Secret
  Manager-compatible environment variables.
- [x] Document the Supabase migration and private bucket prerequisites.

## 4. Verification

- [x] Run focused unit tests first, then the full Node test suite.
- [ ] Build the container when Docker is available (Docker daemon is not running
  on this workstation).
- [x] Review the diff for accidental secrets or tracked `.env` files.
