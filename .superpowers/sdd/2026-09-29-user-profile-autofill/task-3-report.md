# Task 3 report: profile page and site navigation

## Delivered

- Added `/user-profile` and `/user-profile/` static routes.
- Added the authenticated profile page and browser controller.
- Loads `/api/auth/profile` and `/api/company-positions`, displays the selected inactive position for review, and submits only `firstName`, `lastName`, and `companyPositionId` with `PATCH`.
- Added clear status/error feedback and accessible form status messaging.
- Added the existing LINE session gate to the profile page: the authenticated shell stays hidden until `/api/auth/me` succeeds, and an unauthenticated visit returns to `/line-auth?returnTo=/user-profile` before profile APIs are requested.
- Added the matching server-side guard for `/user-profile` and `/user-profile/`, redirecting unauthenticated LINE-mode visits before the static HTML is served.
- Added the `ข้อมูลส่วนตัว` link to every existing main-menu page, including the compact Shopee pages and the new profile page.
- Did not implement document autofill, existing-form position replacement, role permissions, or e-sign behavior.

## TDD and verification

- RED observed with the new page/controller absent and the navigation link missing.
- Focused tests: `tests/user-profile.html.test.mjs`, `tests/navigation.html.test.mjs`, `tests/navigation-menu.html.test.mjs`, `tests/line-auth.browser.test.mjs`, and `tests/line-auth-api.test.mjs` — 20 passed, including the unauthenticated `/user-profile` redirect.
- Full project verification: `./scripts/test.sh` — 948 Node tests passed, plus 40 Python PDF tests and 4 shipping-label tests passed.
- `git diff --check` passed.

## Scope

Changes are limited to the Task 3 page, browser controller, static route, main-menu HTML, navigation/page tests, and this report.
