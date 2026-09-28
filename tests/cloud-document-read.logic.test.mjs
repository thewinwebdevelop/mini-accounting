import assert from "node:assert/strict";
import test from "node:test";

import { createCloudDocumentReader } from "../forms/cloud-document-read.logic.js";

test("cloud document reader materializes a document before retrying a fresh-runtime local read", async () => {
  const calls = [];
  let availableLocally = false;
  const reader = createCloudDocumentReader({
    cloudRun: true,
    documentDataAdapter: {
      get: async (request) => {
        calls.push(["get", request.documentKind, request.documentNo]);
        return {
          documentKind: request.documentKind,
          documentNo: request.documentNo,
          folderPath: "documents/2026/09/เบิกจ่าย/REQ-2026-09-0001_test",
        };
      },
    },
    documentFileSynchronizer: {
      materialize: async ({ record }) => {
        calls.push(["materialize", record.documentNo]);
        availableLocally = true;
      },
    },
    rebuildIndex: async () => calls.push(["rebuild-index"]),
  });

  const result = await reader.ensure({
    documentKind: "expense_request",
    documentNo: "REQ-2026-09-0001",
    localLoad: async () => {
      if (!availableLocally) throw new Error("Expense request not found");
      return { requestNo: "REQ-2026-09-0001", status: "draft" };
    },
  });

  assert.deepEqual(result, { requestNo: "REQ-2026-09-0001", status: "draft" });
  assert.deepEqual(calls, [
    ["get", "expense_request", "REQ-2026-09-0001"],
    ["materialize", "REQ-2026-09-0001"],
    ["rebuild-index"],
  ]);
});

test("cloud document reader keeps the original error when cloud runtime is disabled", async () => {
  const reader = createCloudDocumentReader({ cloudRun: false });
  await assert.rejects(
    () => reader.ensure({
      documentKind: "expense_request",
      documentNo: "REQ-2026-09-0001",
      localLoad: async () => { throw new Error("Expense request not found"); },
    }),
    { message: "Expense request not found" },
  );
});
