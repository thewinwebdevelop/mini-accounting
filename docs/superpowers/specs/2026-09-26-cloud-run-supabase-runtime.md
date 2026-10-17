# Cloud Run + Supabase Runtime Support

## Goal

Make the LINE Mini App backend safe to run as a stateless Google Cloud Run
service while using Supabase as the durable database and private file store.

## Decisions

- Cloud Run is detected by `K_SERVICE=...`; `CLOUD_RUN=1` is also supported
  for local container emulation.
- Cloud Run binds to `0.0.0.0` and uses the injected `PORT` value. Local
  development keeps the existing loopback-only default.
- Cloud Run writes temporary compatibility files under `/tmp/sweet-house`.
  Durable document metadata is written to Supabase and newly generated
  document files are uploaded to the private Supabase Storage bucket before a
  cloud document write is considered successful.
- Lifecycle mutations (`submit`, `approve`, `receive-stock`, and `complete`)
  hydrate a missing local document from Supabase before running the existing
  PDF/document logic, then sync the resulting payload and files back to the
  cloud repository. This keeps a cold start or a different Cloud Run instance
  from losing the document context.
- Cloud Run defaults the LINE intake backend, document backend, inventory
  backend, and file backend to Supabase-backed modes when those variables are
  not explicitly set. Explicit environment values still win.
- `/healthz` is a public, low-information endpoint for Cloud Run probes. It
  does not expose secrets or database contents.
- The Supabase service/secret key remains server-only and is supplied through
  Cloud Run environment variables or Secret Manager; it is never bundled into
  the frontend.

## Scope and non-goals

This change makes the LINE intake, document save, document file delivery, and
Supabase-backed inventory paths Cloud Run compatible. Legacy filesystem reads
remain available through `/tmp` for compatibility during a request. Existing
Google Drive sync still requires its OAuth configuration and is not converted
into a Cloud Run background worker by this change.

## Runtime contract

Required Cloud Run configuration:

- `PORT` is injected by Cloud Run.
- `APP_PUBLIC_ORIGIN` is the deployed HTTPS origin.
- `SWEET_HOUSE_AUTH_MODE=line` and `SWEET_HOUSE_SESSION_SECRET` are required
  for the protected application routes.
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and optionally
  `SUPABASE_STORAGE_BUCKET` are server-side settings.
- LINE channel and LIFF/Mini App settings remain separate from Supabase.
