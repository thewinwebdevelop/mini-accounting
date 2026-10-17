# Repository Agent Instructions

## E2E testing is required

Every new feature, bug fix, behavior change, UI change, API change, or integration change must include or update an end-to-end (E2E) test that covers the user-visible behavior and the relevant success and failure paths.

Unit and integration tests do not replace the required E2E coverage. Before considering work complete, run the relevant E2E project(s), run the applicable regression tests, and report the exact commands and results. Do not claim completion without verification evidence.

If E2E coverage is genuinely impossible for a change, document the reason, the compensating test coverage, and the remaining risk in the final summary.

Keep E2E tests isolated, deterministic, repeatable, and safe to run without production credentials or production writes.
