import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  mapCompanyPositionRow,
  sortCompanyPositions,
} = require("../forms/company-position.logic.js");

test("maps and sorts active position records deterministically", () => {
  const rows = [
    { id: "p-2", code: "zeta", label: "Zeta", status: "active", sort_order: 2 },
    { id: "p-1", code: "alpha", label: "Alpha", status: "active", sort_order: 1 },
    { id: "p-3", code: "beta", label: "Beta", status: "active", sort_order: 1 },
  ];

  assert.deepEqual(sortCompanyPositions(rows), [
    { id: "p-1", code: "alpha", label: "Alpha", status: "active", sortOrder: 1 },
    { id: "p-3", code: "beta", label: "Beta", status: "active", sortOrder: 1 },
    { id: "p-2", code: "zeta", label: "Zeta", status: "active", sortOrder: 2 },
  ]);
  assert.deepEqual(
    mapCompanyPositionRow({ id: "p-1", code: "alpha", label: "Alpha", status: "active", sort_order: 1 }),
    { id: "p-1", code: "alpha", label: "Alpha", status: "active", sortOrder: 1 },
  );
});

test("does not silently include inactive positions in new options", () => {
  const options = sortCompanyPositions([
    { id: "p-1", code: "active", label: "Active", status: "active", sort_order: 1 },
    { id: "p-2", code: "old", label: "Old", status: "inactive", sort_order: 0 },
  ]);

  assert.deepEqual(options.map(position => position.id), ["p-1"]);
});

test("preserves an inactive selected position for read display", () => {
  assert.deepEqual(
    mapCompanyPositionRow({ id: "p-old", code: "old", label: "Old position", status: "inactive", sort_order: 4 }),
    { id: "p-old", code: "old", label: "Old position", status: "inactive", sortOrder: 4 },
  );
});
