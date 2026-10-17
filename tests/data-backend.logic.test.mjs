import test from "node:test";
import assert from "node:assert/strict";

import {
  BACKEND_MODES,
  canonicalHash,
  isCloudBackendMode,
  resolveDataBackendMode,
  stableSourceKey,
} from "../forms/data-backend.logic.js";

test("local is the safe default and domain overrides take precedence", () => {
  assert.equal(resolveDataBackendMode({}), "local");
  assert.equal(resolveDataBackendMode({ DATA_BACKEND: "shadow" }), "shadow");
  assert.equal(resolveDataBackendMode({ DATA_BACKEND: "shadow", DATA_BACKEND_INVENTORY: "dual-write" }, "inventory"), "dual-write");
  assert.equal(resolveDataBackendMode({ DATA_BACKEND: "shadow", DATA_BACKEND_DOCUMENTS: "supabase-read" }, "documents"), "supabase-read");
});

test("invalid backend mode fails with a stable configuration error", () => {
  assert.throws(() => resolveDataBackendMode({ DATA_BACKEND: "anything" }), error => {
    assert.equal(error.code, "DATA_BACKEND_INVALID");
    return true;
  });
  assert.deepEqual([...BACKEND_MODES], ["local", "shadow", "dual-write", "supabase-read"]);
});

test("stable source keys and hashes are deterministic", () => {
  assert.equal(stableSourceKey("inventory_product", 7), "inventory_product:7");
  assert.equal(stableSourceKey("document", "EXP-2026-01-0001"), "document:EXP-2026-01-0001");
  assert.equal(canonicalHash({ b: 2, a: 1 }), canonicalHash({ a: 1, b: 2 }));
  assert.notEqual(canonicalHash({ a: 1 }), canonicalHash({ a: 2 }));
});

test("cloud modes are explicitly identifiable", () => {
  assert.equal(isCloudBackendMode("local"), false);
  assert.equal(isCloudBackendMode("shadow"), true);
  assert.equal(isCloudBackendMode("dual-write"), true);
  assert.equal(isCloudBackendMode("supabase-read"), true);
});
