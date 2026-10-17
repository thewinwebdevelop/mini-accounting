import test from "node:test";
import assert from "node:assert/strict";

import { createDataAdapter } from "../forms/data-adapter.logic.js";

function repositories() {
  const calls = [];
  const local = {
    list: async () => { calls.push("local:list"); return [{ sourceKey: "document:1", value: "same" }]; },
    save: async (value) => { calls.push(["local:save", value]); return { ...value, persisted: "local" }; },
  };
  const cloud = {
    list: async () => { calls.push("cloud:list"); return [{ sourceKey: "document:1", value: "same" }]; },
    save: async (value) => { calls.push(["cloud:save", value]); return { ...value, persisted: "cloud" }; },
  };
  return { calls, local, cloud };
}

test("local mode never calls cloud and returns local results", async () => {
  const repos = repositories();
  const adapter = createDataAdapter({ ...repos, mode: "local", domain: "documents" });
  assert.deepEqual(await adapter.read("list"), [{ sourceKey: "document:1", value: "same" }]);
  assert.deepEqual(await adapter.write("save", { sourceKey: "document:1" }), { sourceKey: "document:1", persisted: "local" });
  assert.deepEqual(repos.calls, ["local:list", ["local:save", { sourceKey: "document:1" }]]);
});

test("shadow mode returns local data and emits only a safe diff", async () => {
  const repos = repositories();
  const logs = [];
  const adapter = createDataAdapter({ ...repos, mode: "shadow", domain: "documents", logger: event => logs.push(event) });
  await adapter.read("list");
  assert.deepEqual(repos.calls, ["local:list", "cloud:list"]);
  assert.deepEqual(logs, []);

  repos.cloud.list = async () => [{ sourceKey: "document:1", value: "different", secret: "must-not-log" }];
  await adapter.read("list");
  assert.equal(logs.length, 1);
  assert.equal(logs[0].type, "data-shadow-diff");
  assert.equal(logs[0].domain, "documents");
  assert.match(logs[0].summary, /hash mismatch/);
  assert.doesNotMatch(JSON.stringify(logs[0]), /must-not-log/);
});

test("dual-write requires cloud success and exposes a retryable safe error", async () => {
  const repos = repositories();
  const adapter = createDataAdapter({ ...repos, mode: "dual-write", domain: "inventory" });
  assert.deepEqual(await adapter.write("save", { sourceKey: "inventory_product:1" }), {
    sourceKey: "inventory_product:1",
    persisted: "local",
  });
  repos.cloud.save = async () => { throw Object.assign(new Error("provider secret"), { code: "SUPABASE_REQUEST_FAILED" }); };
  await assert.rejects(
    () => adapter.write("save", { sourceKey: "inventory_product:1" }),
    error => {
      assert.equal(error.code, "DATA_CLOUD_WRITE_FAILED");
      assert.equal(error.retryable, true);
      assert.doesNotMatch(error.message, /provider secret/);
      return true;
    },
  );
});

test("supabase-read uses cloud and can fall back only when enabled", async () => {
  const repos = repositories();
  const adapter = createDataAdapter({ ...repos, mode: "supabase-read", domain: "inventory", fallbackOnCloudError: true });
  repos.cloud.list = async () => { repos.calls.push("cloud:list"); throw Object.assign(new Error("offline"), { code: "SUPABASE_REQUEST_FAILED" }); };
  assert.deepEqual(await adapter.read("list"), [{ sourceKey: "document:1", value: "same" }]);
  assert.deepEqual(repos.calls, ["cloud:list", "local:list"]);
});
