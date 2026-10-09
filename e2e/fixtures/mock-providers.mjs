import { createServer } from "node:http";
import { once } from "node:events";
import { redactE2ELog } from "../support/redaction.mjs";

const ALLOWED = new Map([
  ["supabase", new Set(["GET /rest/v1/fixture_probe", "GET /rest/v1/", "POST /rest/v1/", "PATCH /rest/v1/", "POST /rest/v1/rpc/", "GET /storage/v1/object/", "POST /storage/v1/object/"])],
  ["line", new Set(["GET /v2/bot/message/", "POST /v2/bot/message/reply", "POST /oauth2/v2.1/verify"])],
  ["google", new Set(["GET /drive/v3/files", "POST /drive/v3/files", "POST /upload/drive/v3/files", "POST /token", "GET /v4/spreadsheets/", "POST /v4/spreadsheets/"])],
  ["shopee", new Set(["GET /api/v2/", "POST /api/v2/"])],
  ["ocr", new Set(["POST /"])],
]);

function allowed(profile, method, pathname) {
  const rules = ALLOWED.get(profile) || new Set();
  return [...rules].some(rule => {
    const [ruleMethod, rulePath] = rule.split(" ");
    return ruleMethod === method && (rulePath.endsWith("/") ? pathname.startsWith(rulePath) : pathname === rulePath);
  });
}

export async function createMockProviders({ profile = "local", runId = "run", state: suppliedState = null } = {}) {
  const requests = [];
  const state = suppliedState || { runId, documents: new Map(), reservations: new Map(), responseScript: [] };
  const servers = [];
  const baseUrls = {};
  for (const provider of ["supabase", "line", "google", "shopee", "ocr"]) {
    const server = createServer(async (request, response) => {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = Buffer.concat(chunks);
      const method = request.method || "GET";
      const pathname = new URL(request.url || "/", "http://mock").pathname;
      const record = { provider, host: request.headers.host, method, path: pathname, body: redactE2ELog(body.toString("utf8")), mock: true };
      requests.push(record);
      if (!allowed(provider, method, pathname)) {
        response.writeHead(404, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "unexpected mock request", provider, method, path: pathname }));
        return;
      }
      const scripted = state.responseScript.shift();
      if (scripted?.type === "timeout") return;
      const status = scripted?.status || 200;
      response.writeHead(status, { "content-type": "application/json" });
      if (provider === "line" && pathname.includes("/content")) return response.end(Buffer.from("fixture-bytes"));
      response.end(JSON.stringify(scripted?.body || (provider === "ocr" ? { fields: {}, confidence: 0.5 } : { ok: true, runId })));
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    baseUrls[provider] = `http://127.0.0.1:${server.address().port}`;
    servers.push(server);
  }
  let stopped = false;
  return {
    profile, baseUrls, state, requests,
    scriptResponse(response) { state.responseScript.push(response); },
    stop: async () => {
      if (stopped) return;
      stopped = true;
      await Promise.all(servers.map(server => new Promise(resolve => server.close(resolve))));
    },
  };
}
