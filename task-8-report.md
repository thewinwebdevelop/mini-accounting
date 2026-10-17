# Task 8 report

Implemented production smoke safeguards, redacted artifact output, CI coverage, and E2E documentation.

## Delivered

- Added `e2e/specs/production-smoke.spec.mjs` with `runProductionSmoke` and `writeRedactedArtifacts`.
- Smoke checks exact anonymous GET/HEAD routes only: root, health, auth, two static assets, and the anonymous auth-gated documents route. Redirects, unexpected statuses, callbacks, mutations, cookies, and query variants are rejected; Playwright trace is disabled.
- Extended structured redaction to remove sensitive field values including cookies, authorization, OAuth/file tokens, storage state, fixture document content, and business bytes.
- Added `.github/workflows/e2e.yml` for pinned Node/Python dependencies, fixture tests, Chromium/mobile/cloud E2E, redacted failure artifacts, and a manual smoke-only job with no write credentials.
- Added `docs/e2e-testing.md` with commands, profiles, limitations, artifact policy, traceability matrix, and the prohibition on full E2E against production.
- Added `tests/e2e-artifacts.test.mjs` covering the smoke allowlist, redirect/mutation rejection, and redaction.

## Verification

- `npx --yes node@22 --test tests/e2e-artifacts.test.mjs`: 3 passed.
- `npx --yes node@22 --test tests/e2e-artifacts.test.mjs tests/e2e-tooling.test.mjs tests/e2e-fixtures.test.mjs`: 32 passed.
- `E2E_BASE_URL=https://example.invalid ./scripts/e2e.sh --project production-smoke --list`: lists the single request-only smoke test.
- `git diff --check`: passed.

## Concerns

- Full Chromium/mobile/cloud E2E and the complete `scripts/test.sh` suite were not rerun in this task because the checkout already contains unrelated user changes, an untracked `data/` directory, and generated `test-results/`; those were preserved untouched. The local default Node is v16, while the pinned Playwright/test workflow requires Node 22.
- No deployment or production smoke request was performed.

## Round 1 fixes

- Production smoke now runs directly through Node global `fetch`; `scripts/e2e.sh --project production-smoke` does not inspect or invoke Playwright, and the smoke module has no Playwright import.
- CI enables `E2E_AUTO_FIXTURE=1`; the runner starts an owned temporary fixture, exports `E2E_LOCAL_BASE_URL` and `E2E_RUN_ID`, verifies its health marker, and cleans it up after full Chromium/mobile runs.
- Redaction coverage now includes nested arrays/objects, storage state, trace-like structures, structured file bytes, and sensitive nested fields.

Round 1 verification: 23 focused artifact/tooling tests passed; bundled Node 22 Chromium bootstrap passed 2 tests; smoke `--list` reported the direct Node HTTP runner.
