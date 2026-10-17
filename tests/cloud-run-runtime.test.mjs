import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCloudRuntimeEnv,
  assertCloudRuntimeConfig,
  isCloudRunEnvironment,
  resolveListenHost,
  resolveRuntimeRoot,
} from "../forms/cloud-run.logic.js";

test("Cloud Run runtime uses a temporary writable root and all-interface binding", () => {
  const env = { K_SERVICE: "sweet-house", PORT: "8080" };
  assert.equal(isCloudRunEnvironment(env), true);
  assert.equal(resolveRuntimeRoot({ env, appDir: "/app" }), "/tmp/sweet-house");
  assert.equal(resolveListenHost(env), "0.0.0.0");
});

test("local runtime keeps the explicit root and loopback binding", () => {
  const env = { SWEET_HOUSE_ROOT_DIR: "/work/data" };
  assert.equal(isCloudRunEnvironment(env), false);
  assert.equal(resolveRuntimeRoot({ env, appDir: "/app" }), "/work/data");
  assert.equal(resolveListenHost(env), "127.0.0.1");
});

test("Cloud Run fills safe Supabase-backed defaults without overriding explicit values", () => {
  const result = buildCloudRuntimeEnv({ K_SERVICE: "sweet-house", DATA_BACKEND_DOCUMENTS: "shadow" });
  assert.equal(result.DATA_BACKEND, "supabase-read");
  assert.equal(result.DATA_BACKEND_DOCUMENTS, "shadow");
  assert.equal(result.DATA_BACKEND_INVENTORY, "supabase-read");
  assert.equal(result.DATA_BACKEND_FILES, "supabase-read");
  assert.equal(result.LINE_INTAKE_BACKEND, "supabase");
  assert.equal(result.SWEET_HOUSE_AUTH_MODE, "line");
});

test("Cloud Run rejects ephemeral persistence modes and local fallback", () => {
  assert.throws(
    () => assertCloudRuntimeConfig({
      K_SERVICE: "sweet-house",
      DATA_BACKEND: "dual-write",
      DATA_BACKEND_DOCUMENTS: "supabase-read",
      DATA_BACKEND_INVENTORY: "supabase-read",
      DATA_BACKEND_FILES: "supabase-read",
      LINE_INTAKE_BACKEND: "supabase",
      SWEET_HOUSE_AUTH_MODE: "line",
      DATA_BACKEND_FALLBACK: "local",
    }),
    error => error.code === "CLOUD_RUN_PERSISTENCE_CONFIG_INVALID",
  );
  assert.doesNotThrow(() => assertCloudRuntimeConfig(buildCloudRuntimeEnv({ K_SERVICE: "sweet-house" })));
});
