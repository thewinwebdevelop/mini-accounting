import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { createMockProviders } from "./mock-providers.mjs";
import { createFixtureData } from "./data-seed.mjs";
import { assertHealth } from "../support/assertions.mjs";

const repoDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const NODE_ENV_ALLOWLIST = new Set(["PATH", "NODE_PATH", "LANG", "LC_ALL", "TZ"]);
const PRODUCTION_KEYS = ["SUPABASE_SERVICE_ROLE_KEY", "GOOGLE_DRIVE_TOKEN_JSON", "GOOGLE_DRIVE_CONFIG_JSON", "LINE_CHANNEL_ACCESS_TOKEN", "LINE_CHANNEL_SECRET", "LINE_OCR_API_KEY", "SHOPEE_PARTNER_KEY"];

function assertNoProductionSecrets(env = process.env) {
  const inherited = PRODUCTION_KEYS.filter(key => String(env[key] || "").trim());
  if (inherited.length) throw new Error(`production credentials are forbidden in E2E fixture: ${inherited.join(", ")}`);
}

async function createAppServer({ env, rootDir, mockBaseUrl }) {
  const child = spawn(process.execPath, [path.join(repoDir, "local-server.mjs")], {
    cwd: repoDir,
    env: { ...env, SWEET_HOUSE_ROOT_DIR: rootDir, PORT: "0", SWEET_HOUSE_ALLOW_NETWORK: "", SUPABASE_URL: mockBaseUrl, SUPABASE_SERVICE_ROLE_KEY: "e2e-service-key", SUPABASE_STORAGE_BUCKET: "sweet-house-files", NODE_OPTIONS: `${env.NODE_OPTIONS || ""} --import=${path.join(repoDir, "e2e/fixtures/outbound-guard.mjs")}`, E2E_ALLOWED_HOSTS: [mockBaseUrl, ...Object.values(env).filter(value => typeof value === "string" && value.startsWith("http://127.0.0.1:"))].map(value => new URL(value).host).join(","), E2E_OUTBOUND_GUARD_LOG: path.join(rootDir, "e2e-outbound-blocked.log") },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", chunk => { output += chunk.toString(); });
  child.stderr.on("data", chunk => { output += chunk.toString(); });
  const started = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`fixture server startup timed out\n${output}`)), 8000);
    const check = () => {
      const match = output.match(/http:\/\/localhost:(\d+)\//);
      if (match) { clearTimeout(timer); resolve(`http://127.0.0.1:${match[1]}/`); }
    };
    child.stdout.on("data", check);
    child.stderr.on("data", check);
    child.once("exit", code => { clearTimeout(timer); reject(new Error(`fixture server exited early (${code})\n${output}`)); });
  });
  const baseUrl = await started;
  let stopped = false;
  return { baseUrl, child, output: () => output, stop: async () => {
    if (stopped) return;
    stopped = true;
    if (!child.killed) child.kill("SIGTERM");
    await once(child, "exit").catch(() => {});
  } };
}

export async function createE2EEnvironment({ profile = "local", workerIndex = 0, providerState = null } = {}) {
  assertNoProductionSecrets();
  const runId = `e2e-${Date.now().toString(36)}-${process.pid}-${workerIndex}-${Math.random().toString(36).slice(2, 8)}`;
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "sweet-house-e2e-"));
  let mock;
  const rootEnv = {
    PATH: process.env.PATH,
    NODE_PATH: process.env.NODE_PATH,
    LANG: process.env.LANG,
    LC_ALL: process.env.LC_ALL,
    TZ: process.env.TZ || "UTC",
    NODE_ENV: "test",
    SWEET_HOUSE_AUTH_MODE: "line",
    SWEET_HOUSE_SESSION_SECRET: "e2e-test-session-secret-012345678901234567890123",
    APP_PUBLIC_ORIGIN: "http://127.0.0.1",
    E2E_RUN_ID: runId,
    CLOUD_RUN: profile === "cloud-runtime-mocked" ? "1" : "",
    DATA_BACKEND_DOCUMENTS: profile === "cloud-runtime-mocked" ? "supabase-read" : "local",
    LINE_OCR_PROVIDER: "http",
    LINE_OCR_API_KEY: "e2e-ocr-key",
    LINE_CHANNEL_ID: "e2e-line-channel",
    LINE_LIFF_ID: "e2e-liff-id",
  };
  let app;
  try {
    mock = await createMockProviders({ profile, runId, state: providerState });
    Object.assign(rootEnv, {
      LINE_VERIFY_URL: `${mock.baseUrls.line}/oauth2/v2.1/verify`,
      LINE_CONTENT_BASE_URL: mock.baseUrls.line,
      LINE_REPLY_URL: `${mock.baseUrls.line}/v2/bot/message/reply`,
      LINE_OCR_API_URL: mock.baseUrls.ocr,
      SHOPEE_API_BASE_URL: mock.baseUrls.shopee,
      GOOGLE_API_BASE_URL: mock.baseUrls.google,
      GOOGLE_SHEETS_API_BASE_URL: mock.baseUrls.google,
      GOOGLE_OAUTH_TOKEN_URL: `${mock.baseUrls.google}/token`,
    });
    await createFixtureData({ rootDir, runId });
    app = await createAppServer({ env: rootEnv, rootDir, mockBaseUrl: mock.baseUrls.supabase });
    await assertHealth(app.baseUrl, runId);
  } catch (error) {
    if (app) await app.stop();
    if (mock) await mock.stop();
    await rm(rootDir, { recursive: true, force: true });
    throw error;
  }
  const stop = async () => {
    await app.stop();
    await mock.stop();
    await rm(rootDir, { recursive: true, force: true });
  };
  return { runId, baseUrl: app.baseUrl, rootDir, mock, stop, users: (await createFixtureData({ rootDir, runId })).users, app };
}

export { createAppServer, assertNoProductionSecrets };
