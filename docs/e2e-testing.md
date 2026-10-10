# End-to-end testing

## Install

Use the pinned Node 22 and Python 3 runtimes, then install the lockfile and browser:

```sh
npm ci
npx playwright install --with-deps chromium
```

The fixture suite creates a fresh temporary root, synthetic users and strict local provider mocks for every worker. It rejects inherited production credentials and unexpected outbound hosts. It does not test against `data/` or any production provider.

## Local profiles

Full local E2E creates its own isolated app environment through `e2e/fixtures/playwright.fixture.mjs`:

```sh
./scripts/e2e.sh --project chromium
./scripts/e2e.sh --project mobile-chromium
./scripts/e2e.sh --project cloud-runtime-mocked
```

`E2E_WORKERS`, `E2E_TRACE`, and `E2E_GREP` are optional. The cloud profile keeps mocked Supabase state across app restart and exercises allocation/retry behavior. Mobile uses the Pixel 7 viewport. Browser failures are written under `test-results/`; CI uploads only the redacted report.

## Read-only production smoke

Smoke is a direct Node `fetch` entrypoint, not a Playwright project. It sends anonymous `GET` and `HEAD` requests to the exact allowlist `/`, `/healthz`, `/api/healthz`, `/line-auth`, `/mobile-menu.css`, `/line-auth.browser.js`, and `/workflow-documents`; redirects, callbacks, mutations, query variants, cookies and non-allowlisted paths fail the run.

```sh
E2E_BASE_URL="https://staging.example" ./scripts/e2e.sh --project production-smoke
```

The smoke job is manual in CI and receives no service-role key, OAuth credential, session cookie or write credential. Do not run the full browser E2E against production. Full E2E must use the isolated fixture; use production smoke only for reachability and anonymous auth gating.

## Artifacts and redaction

`writeRedactedArtifacts` emits `e2e-report.json` and `e2e-report.log`. Redaction removes cookies, authorization/service-key-like values, OAuth codes, file tokens, storage state, fixture document content and business/file bytes. Storage state and raw traces are never uploaded. CI creates the redacted directory only on failure.

## Feature traceability

| Feature/outcome | Persona | Spec | Persisted/security assertion |
| --- | --- | --- | --- |
| Auth and shared navigation | anonymous, employee | `auth-navigation.spec.mjs` | signed session, role menus, logout |
| Workflow transactions and child documents | employee, accounting | `workflow.spec.mjs`, `workflow-cloud.spec.mjs` | isolation, retry, completion, cancellation |
| Expense and lightweight documents | employee, accounting | `expense-request.spec.mjs`, `lightweight-documents.spec.mjs` | lifecycle, files, PDF and line mode |
| Substitute receipts and vendors | employee, accounting, admin | `substitute-receipt.spec.mjs`, `vendor-master.spec.mjs` | evidence, stock receive, snapshots |
| Inventory and platform orders | employee, accounting, admin | `inventory.spec.mjs`, `platform-orders.spec.mjs` | stock movements, mappings, deductions |
| LINE intake and Shopee | anonymous, employee, accounting, admin | `line-intake.spec.mjs`, `shopee.spec.mjs` | provider logs, retries and persisted records |
| Mobile document UI | employee | `mobile-documents.spec.mjs` | mobile controls and lifecycle |
| Resource/file security | employee A/B, owner | `security-regression.spec.mjs` | cross-owner, traversal and token expiry rejection |
| Production health | anonymous | `production-smoke.spec.mjs` | exact read-only allowlist and auth gate |

The matrix maps the implemented journeys from `docs/feature-checklist.md`; a visible assertion is paired with provider or persisted-state evidence wherever the journey mutates fixture state.
