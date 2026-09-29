# Task 3 report: profile page and site navigation

## Delivered

- Added `/user-profile` and `/user-profile/` static routes.
- Added the authenticated profile page and browser controller.
- Loads `/api/auth/profile` and `/api/company-positions`, displays the selected inactive position for review, and submits only `firstName`, `lastName`, and `companyPositionId` with `PATCH`.
- Added clear status/error feedback and accessible form status messaging.
- Added the `ข้อมูลส่วนตัว` link to every existing main-menu page, including the compact Shopee pages and the new profile page.
- Did not implement document autofill, existing-form position replacement, role permissions, or e-sign behavior.

## TDD and verification

- RED observed with the new page/controller absent and the navigation link missing.
- Focused tests: `tests/user-profile.html.test.mjs`, `tests/navigation.html.test.mjs`, and `tests/navigation-menu.html.test.mjs` — 11 passed.
- Full project verification: `./scripts/test.sh` — 925 Node tests passed, plus 40 Python PDF tests and 4 shipping-label tests passed.
- `git diff --check` passed.

## Scope

Changes are limited to the Task 3 page, browser controller, static route, main-menu HTML, navigation/page tests, and this report.
