import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { redactE2ELog } from "../support/redaction.mjs";

const ALLOWLIST = Object.freeze([
  { path: "/", methods: ["GET", "HEAD"], statuses: [200] },
  { path: "/healthz", methods: ["GET", "HEAD"], statuses: [200] },
  { path: "/api/healthz", methods: ["GET", "HEAD"], statuses: [200] },
  { path: "/line-auth", methods: ["GET", "HEAD"], statuses: [200] },
  { path: "/mobile-menu.css", methods: ["GET", "HEAD"], statuses: [200] },
  { path: "/line-auth.browser.js", methods: ["GET", "HEAD"], statuses: [200] },
  { path: "/workflow-documents", methods: ["GET", "HEAD"], statuses: [401, 403] },
]);

function assertBaseUrl(baseUrl) {
  const parsed = new URL(baseUrl);
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error("production smoke base URL must be a bare HTTP(S) origin");
  }
  return parsed;
}

async function check(fetchImpl, origin, route, method) {
  const url = new URL(route.path, origin);
  const response = await fetchImpl(url, {
    method,
    redirect: "error",
    headers: { accept: "text/html, application/json" },
  });
  if (response.status >= 300 && response.status < 400) throw new Error(`redirect refused for ${method} ${route.path}`);
  if (!route.statuses.includes(response.status)) {
    throw new Error(`unexpected status ${response.status} for ${method} ${route.path}; expected ${route.statuses.join(", ")}`);
  }
  return { path: route.path, method, status: response.status };
}

export async function runProductionSmoke({ baseUrl, fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== "function") throw new Error("production smoke requires an HTTP fetch implementation");
  const origin = assertBaseUrl(baseUrl);
  const checks = [];
  for (const route of ALLOWLIST) {
    for (const method of route.methods) checks.push(await check(fetchImpl, origin, route, method));
  }
  return { ok: true, baseUrl: origin.origin, checks, allowlist: ALLOWLIST.map(({ path: pathname, methods }) => ({ path: pathname, methods })) };
}

export async function writeRedactedArtifacts({ reportDir, events = [] } = {}) {
  if (!reportDir) throw new Error("reportDir is required");
  await mkdir(reportDir, { recursive: true });
  const redactedEvents = events.map(event => {
    const redacted = redactE2ELog(event);
    try { return JSON.parse(redacted); } catch { return redacted; }
  });
  const report = { generatedAt: new Date().toISOString(), events: redactedEvents };
  await writeFile(path.join(reportDir, "e2e-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(path.join(reportDir, "e2e-report.log"), `${redactedEvents.map(event => redactE2ELog(event)).join("\n")}\n`, "utf8");
}

// The smoke project is deliberately request-only. Node tests import this module without
// registering a Playwright test; Playwright invokes the same function through APIRequestContext.
if (process.env.E2E_PRODUCTION_SMOKE_RUNNER === "1") {
  const { test } = await import("@playwright/test");
  test("production health smoke is anonymous, read-only and allowlisted", async ({ request, baseURL }) => {
    const report = await runProductionSmoke({
      baseUrl: baseURL,
      fetchImpl: (url, options = {}) => request.fetch(String(url), {
        method: options.method,
        headers: options.headers,
        maxRedirects: 0,
      }),
    });
    if (!report.ok) throw new Error("production smoke failed");
  });
}
