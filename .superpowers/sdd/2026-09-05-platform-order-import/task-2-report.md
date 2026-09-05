# Task 2 Report: Import Matching Service

## What Changed

- Added `importPlatformOrders(rootDir, { platform, fileName, fileBuffer }, options)`.
- Added `listPlatformOrderImports(rootDir)`.
- Added `getPlatformOrderImport(rootDir, importId)`.
- Implemented platform import batch creation with `POI-YYYYMMDD-####` import numbers.
- Persisted parsed order rows into `platform_order_imports`, `platform_orders`, and `platform_order_lines`.
- Matched platform order lines to active `sale_skus` and loaded `bundle_components`.
- Computed required component quantities from line quantity and current stock on hand.
- Classified line match states:
  - `matched`
  - `missing_sale_sku`
  - `invalid_quantity`
  - `insufficient_stock`
  - `skipped_status`
- Computed import summary counts:
  - `rowCount`
  - `matchedLineCount`
  - `issueCount`, excluding `skipped_status`
- Set import status to `ready` only when all postable lines are matched, otherwise `has_issues`.
- Returned detail payloads with import, orders, lines, postable state, and line components.

## TDD RED Evidence

Command:

```bash
/Users/tar/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/platform-orders.logic.test.mjs --test-name-pattern "importPlatformOrders"
```

Expected failure captured before production implementation:

```text
fail 3
TypeError: importPlatformOrders is not a function
```

This was the expected missing-export failure from the task brief.

## TDD GREEN Evidence

Command:

```bash
/Users/tar/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/platform-orders.logic.test.mjs
```

Result:

```text
tests 7
pass 7
fail 0
```

Full suite command:

```bash
/Users/tar/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/*.mjs
```

Result:

```text
tests 105
pass 105
fail 0
```

## Files Changed

- `forms/platform-orders.logic.js`
- `tests/platform-orders.logic.test.mjs`
- `.superpowers/sdd/2026-09-05-platform-order-import/task-2-report.md`

## Self-Review

- Confirmed the implementation does not post inventory movements; it only computes stock sufficiency from existing `stock_movements`.
- Confirmed issue counting excludes `skipped_status`.
- Confirmed line details expose components with `requiredQuantity` and `quantityOnHand`.
- Confirmed import list returns mapped summaries.
- Confirmed detail loading works from persisted rows via `getPlatformOrderImport`.
- Confirmed no unrelated files were modified before committing.

## Concerns

- The command `/Users/tar/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests` is not valid for this repo/runtime because it attempts to load `tests` as a module. I reran the broad suite successfully with `tests/*.mjs`.

---

# Fix Round 1/5

## Review Findings Addressed

- Fixed batch-level stock sufficiency so multiple imported lines reserve from the same in-memory stock balance during classification.
- Fixed partial numeric quantity parsing so values like `2abc` and `1.5` become `invalid_quantity` instead of silently importing as `2` or `1`.
- Fixed posted order re-import behavior by detecting posted line conflicts before reassigning an existing `platform_orders` row to a new import.

## Tests Added

- `importPlatformOrders reserves component stock across all lines in the same import`
- `importPlatformOrders rejects partial numeric quantities as invalid_quantity`
- `importPlatformOrders rejects re-imports that conflict with posted order lines`

## RED Evidence

Command:

```bash
/Users/tar/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/platform-orders.logic.test.mjs --test-name-pattern "reserves component stock|partial numeric|posted order lines"
```

Expected failures before implementation:

```text
fail 3
reserves component stock: actual "ready", expected "has_issues"
partial numeric quantities: actual "ready", expected "has_issues"
posted order lines: Missing expected exception
```

## GREEN Evidence

Focused review-regression command:

```bash
/Users/tar/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/platform-orders.logic.test.mjs --test-name-pattern "reserves component stock|partial numeric|posted order lines"
```

Result:

```text
tests 10
pass 10
fail 0
```

Covering import command:

```bash
/Users/tar/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/platform-orders.logic.test.mjs
```

Result:

```text
tests 10
pass 10
fail 0
```

Related inventory command:

```bash
/Users/tar/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/inventory.logic.test.mjs tests/inventory-db.logic.test.mjs
```

Result:

```text
tests 19
pass 19
fail 0
```

Broad regression command:

```bash
/Users/tar/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/*.mjs
```

Result:

```text
tests 108
pass 108
fail 0
```

## Files Changed

- `forms/platform-orders.logic.js`
- `tests/platform-orders.logic.test.mjs`
- `.superpowers/sdd/2026-09-05-platform-order-import/task-2-report.md`

## Self-Review

- Posted-order conflict detection runs before order upsert, so an existing posted order is not moved to a new import.
- Stock reservation only decrements for lines that remain `matched`; insufficient lines do not consume the in-memory reserve.
- Strict quantity parsing accepts positive integer text after trimming and removing thousands separators, while malformed partial numbers become zero and are stored as `invalid_quantity`.

## Concerns

- None for this fix round.
