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

test("document file comparison ignores migration timestamps", () => {
  assert.equal(compareRecordSets(
    [{
      source_key: "document_file:documents/a.pdf",
      document_source_key: "document:purchase_order:PO-1",
      object_path: "documents/a.pdf",
      source_sha256: "hash",
      byte_size: 10,
      content_type: "application/pdf",
      original_name: "a.pdf",
      migrated_at: "2026-09-25T00:00:00.000Z",
    }],
    [{
      source_key: "document_file:documents/a.pdf",
      document_source_key: "document:purchase_order:PO-1",
      object_path: "documents/a.pdf",
      source_sha256: "hash",
      byte_size: 10,
      content_type: "application/pdf",
      original_name: "a.pdf",
      migrated_at: "2026-09-25T01:00:00.000Z",
    }],
  ).ok, true);
});
