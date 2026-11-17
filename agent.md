# Repository Agent Instructions

## E2E testing is required

Every new feature, bug fix, behavior change, UI change, API change, or integration change must include or update an end-to-end (E2E) test that covers the user-visible behavior and the relevant success and failure paths.

Unit and integration tests do not replace the required E2E coverage. Before considering work complete, run the relevant E2E project(s), run the applicable regression tests, and report the exact commands and results. Do not claim completion without verification evidence.

If E2E coverage is genuinely impossible for a change, document the reason, the compensating test coverage, and the remaining risk in the final summary.

Keep E2E tests isolated, deterministic, repeatable, and safe to run without production credentials or production writes.

## Verify persisted data through the user interface

- When a feature saves data and later reloads or reopens it, the E2E test must reload the page and assert the saved values are visible in the actual form or detail view. Checking only the API response or an in-memory object is not sufficient.
- For document flows backed by Supabase, cover both supported response shapes: local records may contain a nested `payload`, while Supabase reads may flatten payload fields onto the record root. Tests should exercise the flattened shape for every browser loader that consumes persisted records.
- Test the URL entry point users actually use, including document identity and workflow query parameters when present. Assert document identity, representative business fields, line items, status, and evidence/file links as relevant to that feature.
- After changing a shared adapter, document loader, or persistence contract, inspect all browser consumers of that contract and run their relevant E2E flows, not only the feature that motivated the change.
- A broad E2E run with failures is not a passing suite. Report exact pass/fail counts and failure locations; investigate whether failures expose product behavior or test synchronization problems before calling the feature verified.
- Production checks must be read-only unless the task explicitly needs test writes. Never use production records for destructive lifecycle actions during verification.
