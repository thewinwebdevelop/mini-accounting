# Invoice cowork production rollout — 2026-11-20

## Current deployment

- Application code commit: `1597fc2`.
- Project/service/region: `mini-accounting-509820` / `sweet-house` / `asia-southeast1`.
- Production revision: `sweet-house-00052-wol`, 100% traffic.
- Previous production revision: `sweet-house-00050-p92` (retained for rollback).
- Image digest: `sha256:084bc955abb6697fa7dd6b8daed1947cdc5aa830f4a70fa97f583c5b535f4750`.
- [Import page](https://sweet-house-znczpe4qoq-as.a.run.app/assistant-invoice-import).
- `LINE_WORKFLOW_ENABLED=1`; existing LINE authentication and persistence settings retained.
- Request timeout: 660 seconds, exceeding the 10-minute execution lease.

Deployment used a clean archive of tracked commit `1597fc2`; local untracked data, config and test output were not included. Candidate revisions received no main traffic until validation passed. Revision 51 built the image; revision 52 corrected the worker OIDC audience to the Cloud Run service origin before promotion.

## Database and recovery worker

Applied only `supabase/migrations/202611190001_line_workflow_batches.sql` to Supabase project `rltufgxdlcfnykvqbqwg` using `supabase db query --linked --project-ref ... --file ...`, wrapped in BEGIN/COMMIT plus PostgREST schema notification. This was a targeted SQL application, not a bulk `db push`; it did not register migration history. The migration is additive and repeatable and does not modify existing financial tables or rows.

Verified RLS enabled, anon/authenticated unable to select state, anon unable to execute CAS, and service_role able to select/update and execute CAS. Verified backend credentials can read the singleton state and call RPC with an impossible expected version (-1), which returns false without changing data.

Cloud Scheduler API enabled. Created dedicated account `sweet-house-invoice-worker@mini-accounting-509820.iam.gserviceaccount.com` with `roles/run.invoker` scoped to this service. No database/admin role was assigned to that account.

Scheduler job `sweet-house-invoice-workflow` in `asia-southeast1` runs every minute, timezone Asia/Bangkok, POSTing `/api/internal/line-workflow/run` with OIDC. Audience is `https://sweet-house-znczpe4qoq-as.a.run.app` and email matches `LINE_WORKFLOW_WORKER_EMAIL`. Attempt deadline 600s, retry count 3. Existing user session is still required for user-facing APIs; the worker identity does not grant a user session.

## Verification

- `npm run e2e -- --workers 2`: 51 passed, 0 failed before rollout.
- Node 24 `--test tests/line-workflow*.test.mjs`: 26 passed, 0 failed before rollout.
- Candidate and main URL: 11 HTTP checks passed each — `/api/healthz`, root, LINE auth, import HTML/script, review HTML, existing workflow page; unauthenticated template/document/import APIs denied; unsigned worker request denied.
- Production health response identifies `sweet-house-00052-wol`.
- Scheduler manual and scheduled invocations succeeded. Cloud Run request logs: worker HTTP 200 at `2026-11-20T07:55:00Z`, `07:55:12Z`, `07:56:03Z`. Earlier 401s were intentional unsigned checks.
- No actual invoice imports, document creation/completion, stock writes or LINE messages were performed during production verification. Existing mock/manual evidence remains in [the development validation record](invoice-cowork-validation.md).

The root `/healthz` path returns Google Frontend HTML 404 on both old production and candidate; `/api/healthz` returns application health successfully. Deployment checks use `/api/healthz`. The existing generic smoke helper expecting root `/healthz` was not counted as passing. This is an observed existing platform/path behavior, not a new application regression.

A real authenticated invoice-to-document run still requires a signed-in LINE browser session and a specific invoice. Production HTTP validation establishes availability/auth gates, not extraction accuracy or completion of a real invoice. No OCR provider was added; assistant imports use the supplied extraction JSON. The pre-existing LINE OCR setting remains `manual`.

## Rollback

If required, pause the new worker and route to the recorded previous revision. These commands are documentation, not actions already taken:

```sh
gcloud scheduler jobs pause sweet-house-invoice-workflow --location asia-southeast1 --project mini-accounting-509820
gcloud run services update-traffic sweet-house --region asia-southeast1 --project mini-accounting-509820 --to-revisions sweet-house-00050-p92=100
```

Recheck `/api/healthz` and protected APIs after rollback. Retain the additive state table so imported batches/checkpoints are not lost; do not drop it or delete financial documents as part of rollback. For subsequent deployment, inspect live traffic/configuration and pending jobs rather than assuming this record is still current.
