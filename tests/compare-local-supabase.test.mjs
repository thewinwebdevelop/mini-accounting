import assert from "node:assert/strict";
import test from "node:test";
import { compareRecordSets } from "../scripts/compare-local-supabase.mjs";

test("compare report is deterministic and finds missing, extra, and mismatched source keys", () => {
  const report = compareRecordSets(
    [
      { source_key: "product:1", source_payload: { name: "one" } },
      { source_key: "product:2", source_payload: { name: "two" } },
    ],
    [
      { source_key: "product:1", source_payload: { name: "changed" } },
      { source_key: "product:3", source_payload: { name: "three" } },
    ],
  );
  assert.deepEqual(report, {
    localCount: 2,
    cloudCount: 2,
    missing: ["product:2"],
    extra: ["product:3"],
    mismatches: ["product:1"],
    ok: false,
  });
});

test("matching source payloads pass regardless of object key order", () => {
  assert.equal(compareRecordSets(
    [{ sourceKey: "vendor:1", sourcePayload: { b: 2, a: 1 } }],
    [{ source_key: "vendor:1", source_payload: { a: 1, b: 2 } }],
  ).ok, true);
});
