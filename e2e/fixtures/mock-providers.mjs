import { createServer } from "node:http";
import { once } from "node:events";
import { redactE2ELog } from "../support/redaction.mjs";

const ENDPOINTS = {
  supabase: [
    ["GET", "/rest/v1/fixture_probe", "none"], ["GET", "/rest/v1/e2e_documents", "none"], ["POST", "/rest/v1/e2e_documents", "none"],
    ["GET", "/rest/v1/e2e_reservations", "none"], ["POST", "/rest/v1/e2e_reservations", "none"],
    ["GET", "/rest/v1/app_users", "app-users"], ["POST", "/rest/v1/app_users", "app-users"],
    ["POST", "/rest/v1/rpc/allocate_workflow_transaction_number", "none"], ["POST", "/rest/v1/documents", "on_conflict=source_key"], ["GET", "/rest/v1/documents", "query"],
    ["POST", "/rest/v1/document_files", "on_conflict=source_key"], ["GET", "/rest/v1/document_files", "query"], ["POST", "/rest/v1/storage_migration_records", "migration-conflict"],
    ["GET", "/rest/v1/company_settings", "query"], ["GET", "/rest/v1/vendors", "query"], ["GET", "/rest/v1/inventory_products", "query"],
    ["GET", "/rest/v1/inventory_stock_skus", "query"], ["GET", "/rest/v1/inventory_stock_movements", "query"],
    ["GET", /^\/storage\/v1\/object\/[a-z0-9._-]+\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]+$/, "none"], ["POST", /^\/storage\/v1\/object\/[a-z0-9._-]+\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]+$/, "none"],
  ],
  line: [["GET", /^\/v2\/bot\/message\/[^/]+\/content$/, "none"], ["POST", "/v2/bot/message/reply", "none"], ["POST", "/oauth2/v2.1/verify", "none"]],
  google: [["GET", "/drive/v3/files", "drive"], ["POST", "/drive/v3/files", "drive-create"], ["POST", "/upload/drive/v3/files", "upload-init"], ["PATCH", /^\/upload\/drive\/v3\/files\/[^/]+$/, "upload-init"], ["PUT", /^\/upload-session\/[^/]+$/, "upload-body"], ["POST", "/token", "none"], ["GET", /^\/v4\/spreadsheets\/[^/]+$/, "sheets"], ["POST", /^\/v4\/spreadsheets\/[^/]+:batchUpdate$/, "sheets"], ["GET", /^\/v4\/spreadsheets\/[^/]+\/values\/[^/]+$/, "sheets-values"], ["PUT", /^\/v4\/spreadsheets\/[^/]+\/values\/[^/]+$/, "sheets-values"], ["POST", /^\/v4\/spreadsheets\/[^/]+\/values\/[^/]+:append$/, "sheets-values"]],
  shopee: [["GET", "/api/v2/shop/auth_partner", "shopee-auth"], ["GET", "/api/v2/order/get_order_list", "shopee-order-list"], ["GET", "/api/v2/order/get_order_detail", "shopee-order-detail"], ["POST", "/api/v2/auth/token/get", "shopee-token"], ["POST", "/api/v2/auth/access_token/get", "shopee-refresh"], ["POST", "/api/v2/logistics/get_mass_tracking_number", "shopee-tracking"], ["POST", "/api/v2/logistics/create_shipping_document_job", "shopee-create-job"], ["POST", "/api/v2/logistics/get_shipping_document_job_status", "shopee-job-status"], ["POST", "/api/v2/logistics/download_shipping_document_job", "shopee-job-download"], ["POST", "/api/v2/logistics/get_mass_shipping_parameter", "shopee-shipping-params"], ["POST", "/api/v2/logistics/mass_ship_order", "shopee-mass-ship"]],
  ocr: [["POST", "/", "none"]],
};

function matchEndpoint(provider, method, pathname, search) {
  for (const [allowedMethod, route, queryRule] of ENDPOINTS[provider] || []) {
    if (allowedMethod !== method || (route instanceof RegExp ? !route.test(pathname) : route !== pathname)) continue;
    if (queryRule === "none" && search) continue;
    if (queryRule === "on_conflict=source_key" && search !== "?on_conflict=source_key") continue;
    if (queryRule === "migration-conflict" && search !== "?on_conflict=migration_name%2Csource_key" && search !== "?on_conflict=migration_name,source_key") continue;
    if (queryRule.startsWith("shopee-") && !validShopeeQuery(queryRule, search)) continue;
    if (["drive", "drive-create", "upload", "upload-init", "sheets", "sheets-values", "query", "migration-conflict"].includes(queryRule)) {
      if (queryRule === "migration-conflict" && search !== "?on_conflict=migration_name%2Csource_key" && search !== "?on_conflict=migration_name,source_key") continue;
      if (queryRule !== "migration-conflict") {
        const keys = [...new URLSearchParams(search).keys()];
        const allowed = queryRule === "drive" ? ["fields", "pageSize", "q"] : queryRule === "drive-create" ? ["fields"] : ["upload", "upload-init"].includes(queryRule) ? ["fields", "uploadType"] : queryRule === "sheets" ? ["fields"] : queryRule === "sheets-values" ? ["valueInputOption", "insertDataOption"] : ["source_key", "document_source_key", "limit", "owner_user_id", "status", "document_kind", "accounting_month", "order", "or"];
        if (keys.some(key => !allowed.includes(key))) continue;
      }
    }
    return { queryRule };
  }
  return null;
}

function validShopeeQuery(rule, search) {
  const params = new URLSearchParams(search);
  const keys = [...params.keys()];
  const common = rule === "shopee-auth" ? ["partner_id", "timestamp", "sign"] : ["partner_id", "timestamp", "sign", "access_token", "shop_id"];
  const operation = rule === "shopee-auth" ? ["redirect", "state"] : rule === "shopee-order-list" ? ["time_range_field", "time_from", "time_to", "page_size", "cursor"] : rule === "shopee-order-detail" ? ["order_sn_list"] : [];
  if (keys.some(key => !common.includes(key) && !operation.includes(key))) return false;
  if (!["partner_id", "timestamp", "sign"].every(key => params.get(key))) return false;
  if (rule === "shopee-auth" && !params.get("redirect")) return false;
  if (["shopee-order-list", "shopee-order-detail"].includes(rule) && !["access_token", "shop_id"].every(key => params.get(key))) return false;
  if (rule === "shopee-order-list" && !["time_range_field", "time_from", "time_to", "page_size"].every(key => params.get(key))) return false;
  if (rule === "shopee-order-detail" && !params.get("order_sn_list")) return false;
  return true;
}

function parseJson(body) { try { return JSON.parse(body.toString("utf8")); } catch { return null; } }
function exactKeys(value, allowed, required) { const keys = Object.keys(value); return required.every(key => keys.includes(key)) && keys.every(key => allowed.includes(key)); }
function exactForm(body, allowed, required) { const keys = [...new URLSearchParams(body.toString("utf8")).keys()]; return required.every(key => keys.includes(key)) && keys.every(key => allowed.includes(key)); }
function validBody(provider, method, pathname, body, endpoint, headers = {}) {
  if (method === "GET" || method === "HEAD") return body.length === 0;
  if (!body.length || (provider === "supabase" && pathname.startsWith("/storage/v1/object/"))) return Boolean(body.length);
  if (provider === "line" && pathname.endsWith("/verify")) return exactForm(body, ["id_token", "client_id"], ["id_token", "client_id"]);
  if (provider === "google" && pathname === "/token") return exactForm(body, ["client_id", "client_secret", "code", "grant_type", "redirect_uri", "refresh_token"], ["grant_type"]);
  if (provider === "google" && pathname.startsWith("/upload/drive/v3/files")) return exactKeys(valueOrEmpty(body), ["name", "parents"], ["name"]);
  if (provider === "google" && pathname.startsWith("/upload-session/")) {
    const contentType = String(headers["content-type"] || "").split(";", 1)[0].toLowerCase();
    return body.length > 0 && /^(application\/pdf|image\/(?:png|jpeg|jpg|webp))$/.test(contentType) && Number(headers["content-length"]) === body.length;
  }
  const value = parseJson(body);
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  if (provider === "line" && pathname.endsWith("/reply")) return exactKeys(value, ["replyToken", "messages"], ["replyToken", "messages"]);
  if (provider === "ocr") return exactKeys(value, ["fileName", "contentType", "base64"], ["fileName", "contentType", "base64"]);
  if (provider === "supabase" && pathname.endsWith("allocate_workflow_transaction_number")) return exactKeys(value, ["p_accounting_month", "p_request_key"], ["p_accounting_month", "p_request_key"]);
  if (provider === "supabase" && pathname.endsWith("e2e_documents")) return exactKeys(value, ["documentNo", "title"], ["documentNo"]);
  if (provider === "supabase" && pathname.endsWith("e2e_reservations")) return exactKeys(value, ["requestKey", "transactionNo"], ["requestKey", "transactionNo"]);
  if (provider === "supabase" && pathname === "/rest/v1/app_users") return Object.keys(value).every(key => ["line_user_id", "display_name", "picture_url", "last_login_at", "updated_at"].includes(key));
  if (provider === "supabase" && pathname === "/rest/v1/documents") return Object.keys(value).every(key => ["source_key", "document_kind", "document_no", "owner_user_id", "status", "accounting_month", "folder_path", "payload", "source_hash", "created_at", "updated_at"].includes(key));
  if (provider === "supabase" && pathname === "/rest/v1/document_files") return Object.keys(value).every(key => ["source_key", "document_source_key", "bucket_name", "object_path", "source_sha256", "byte_size", "content_type", "original_name", "migrated_at"].includes(key));
  if (provider === "supabase" && pathname === "/rest/v1/storage_migration_records") return Object.keys(value).every(key => ["migration_name", "source_key", "bucket_name", "object_path", "source_sha256", "byte_size", "content_type", "migrated_at"].includes(key));
  if (provider === "google" && pathname === "/drive/v3/files") return endpoint.queryRule === "drive-create" ? exactKeys(value, ["name", "mimeType", "parents"], ["name", "mimeType"]) : exactKeys(value, ["name", "mimeType", "parents"], []);
  if (provider === "google" && pathname.startsWith("/v4/spreadsheets/")) return pathname.includes(":batchUpdate") ? exactKeys(value, ["requests"], ["requests"]) : exactKeys(value, ["values"], ["values"]);
  if (provider === "shopee") return shopeeBodyValid(pathname, value);
  return false;
}
function valueOrEmpty(body) { return parseJson(body) || {}; }
function shopeeBodyValid(pathname, value) {
  const allowed = pathname.endsWith("auth/token/get") ? ["partner_id", "code", "shop_id"]
    : pathname.endsWith("auth/access_token/get") ? ["partner_id", "shop_id", "refresh_token"]
      : pathname.endsWith("get_mass_tracking_number") ? ["package_list"]
        : pathname.endsWith("create_shipping_document_job") ? ["package_list", "document_type"]
          : pathname.endsWith("get_shipping_document_job_status") || pathname.endsWith("download_shipping_document_job") ? ["job_id"]
            : pathname.endsWith("get_mass_shipping_parameter") ? ["package_list"]
              : pathname.endsWith("mass_ship_order") ? ["package_list", "pickup"] : [];
  const required = pathname.endsWith("auth/token/get") ? ["partner_id", "code", "shop_id"] : pathname.endsWith("auth/access_token/get") ? ["partner_id", "shop_id", "refresh_token"] : [];
  return exactKeys(value, allowed, required);
}
function json(response, status, value) { response.writeHead(status, { "content-type": "application/json" }); response.end(JSON.stringify(value)); }

export async function createMockProviders({ profile = "local", runId = "run", state: suppliedState = null } = {}) {
  const requests = [];
  const state = suppliedState || { runId, documents: new Map(), reservations: new Map(), responseScript: [], sequences: new Map(), appUsers: new Map() };
  if (!state.sequences) state.sequences = new Map();
  if (!state.uploadSessions) state.uploadSessions = new Map();
  if (!state.appUsers) state.appUsers = new Map();
  if (!state.appUsers.size) {
    const personas = [
      ["employee-a", "employee-a", "Employee A", "active", "employee"],
      ["employee-b", "employee-b", "Employee B", "active", "employee"],
      ["owner-1", "owner-1", "Owner", "active", "owner"],
      ["accounting-1", "accounting-1", "Accounting", "active", "accounting"],
      ["admin-1", "admin-1", "Admin", "active", "admin"],
      ["pending-1", "pending-1", "Pending", "pending", ""],
      ["inactive-1", "inactive-1", "Inactive", "inactive", ""],
    ];
    for (const [id, lineUserId, displayName, status, role] of personas) state.appUsers.set(lineUserId, { id, line_user_id: `U${lineUserId.replaceAll("-", "")}`, display_name: displayName, picture_url: "", status, app_user_roles: role ? { role_code: role } : null });
  }
  const servers = [];
  const baseUrls = {};
  try {
    for (const provider of ["supabase", "line", "google", "shopee", "ocr"]) {
      let expectedHost = "";
      const server = createServer(async (request, response) => {
        const chunks = []; for await (const chunk of request) chunks.push(chunk);
        const body = Buffer.concat(chunks); const parsed = new URL(request.url || "/", "http://mock"); const method = request.method || "GET";
        const endpoint = matchEndpoint(provider, method, parsed.pathname, parsed.search);
        const record = { provider, host: request.headers.host, method, path: parsed.pathname, query: parsed.search, body: redactE2ELog(body.toString("utf8")), mock: false, verified: false };
        requests.push(record);
        if (request.headers.host !== expectedHost) return json(response, 400, { error: "unexpected mock host" });
        record.mock = true;
        record.verified = true;
        if (!endpoint) return json(response, 404, { error: "unexpected mock endpoint", provider, method, path: parsed.pathname, query: parsed.search });
        if (!validBody(provider, method, parsed.pathname, body, endpoint, request.headers)) return json(response, 400, { error: "unexpected mock request body" });
        const candidate = state.responseScript[0];
        const scripted = candidate && (!candidate.endpoint || parsed.pathname.includes(candidate.endpoint)) ? state.responseScript.shift() : null;
        if (provider === "line" && parsed.pathname.endsWith("/verify")) {
          const token = new URLSearchParams(body.toString("utf8")).get("id_token") || "";
          const lineUserId = token.replace(/^fixture-token-/, "") || "employee-a";
          const row = state.appUsers.get(lineUserId) || [...state.appUsers.values()].find(candidate => candidate.id === lineUserId || candidate.id === `${lineUserId}-1`) || state.appUsers.get("employee-a");
          return json(response, 200, { iss: "https://access.line.me", aud: "e2e-line-channel", sub: row.line_user_id, name: row.display_name, exp: Math.floor(Date.now() / 1000) + 3600, iat: Math.floor(Date.now() / 1000) });
        }
        if (provider === "supabase" && parsed.pathname === "/rest/v1/app_users") {
          const value = parseJson(body);
          if (method === "POST" && value?.line_user_id) {
            const existingKey = state.appUsers.has(value.line_user_id) ? value.line_user_id : [...state.appUsers.entries()].find(([, candidate]) => candidate.line_user_id === value.line_user_id)?.[0];
            const existing = existingKey ? state.appUsers.get(existingKey) : { id: value.line_user_id, line_user_id: value.line_user_id, status: "pending", app_user_roles: null };
            const key = existingKey || value.line_user_id;
            state.appUsers.set(key, { ...existing, display_name: value.display_name || existing.display_name || "", picture_url: value.picture_url || existing.picture_url || "" });
            return json(response, 201, [state.appUsers.get(key)]);
          }
          const lineUserId = new URLSearchParams(parsed.search).get("line_user_id")?.replace(/^eq\./, "");
          const row = lineUserId && (state.appUsers.get(lineUserId) || [...state.appUsers.values()].find(candidate => candidate.line_user_id === lineUserId));
          return json(response, 200, row ? [row] : []);
        }
        if (provider === "google" && endpoint.queryRule === "upload-init") {
          const uploadId = `upload-${state.uploadSessions.size + 1}`;
          state.uploadSessions.set(uploadId, { body: parseJson(body), fileId: parsed.pathname.split("/").at(-1) });
          response.writeHead(200, { location: `${baseUrls.google}/upload-session/${uploadId}` });
          response.end();
          return;
        }
        if (provider === "google" && endpoint.queryRule === "upload-body") {
          const uploadId = parsed.pathname.split("/").at(-1);
          if (!state.uploadSessions.has(uploadId)) return json(response, 404, { error: "upload session not found" });
          return json(response, 200, { id: uploadId, name: state.uploadSessions.get(uploadId).body?.name || "fixture-upload", webViewLink: `https://drive.google.com/file/d/${uploadId}` });
        }
        if (provider === "supabase" && parsed.pathname === "/rest/v1/rpc/allocate_workflow_transaction_number") {
          const value = parseJson(body); const key = String(value.p_request_key || ""); let reservation = state.reservations.get(key);
          if (!reservation) { const sequence = (state.sequences.get(value.p_accounting_month) || 0) + 1; state.sequences.set(value.p_accounting_month, sequence); reservation = { requestKey: key, accountingMonth: value.p_accounting_month, sequence, transactionNo: `TXN-${value.p_accounting_month}-${String(sequence).padStart(4, "0")}` }; state.reservations.set(key, reservation); }
          const result = { sequence: reservation.sequence, transaction_no: reservation.transactionNo, existing: Boolean(state.documents.get(`document:workflow_transaction:${reservation.transactionNo}`)) };
          if (scripted?.type === "drop-after-persist") return response.destroy();
          return json(response, 200, [result]);
        }
        if (provider === "supabase" && parsed.pathname === "/rest/v1/documents") {
          if (method === "POST") { const value = parseJson(body); state.documents.set(value.source_key, value); if (scripted?.type === "drop-after-persist") return response.destroy(); return json(response, 201, [value]); }
          const wanted = new URLSearchParams(parsed.search).get("source_key")?.replace(/^eq\./, ""); return json(response, 200, [...state.documents.values()].filter(item => !wanted || item.source_key === wanted));
        }
        if (provider === "supabase" && parsed.pathname === "/rest/v1/e2e_documents") { if (method === "POST") { const value = parseJson(body); state.documents.set(String(value.documentNo), value); return json(response, 201, value); } return json(response, 200, [...state.documents.values()]); }
        if (provider === "supabase" && parsed.pathname === "/rest/v1/e2e_reservations") { if (method === "POST") { const value = parseJson(body); state.reservations.set(String(value.requestKey), value); return json(response, 201, value); } return json(response, 200, [...state.reservations.values()]); }
        if (scripted?.type === "timeout") return;
        if (scripted?.type === "drop") return response.destroy();
        if (provider === "line" && parsed.pathname.endsWith("/content")) { response.writeHead(200, { "content-type": scripted?.contentType || "image/jpeg" }); return response.end(Buffer.from(scripted?.bytes || "fixture-bytes")); }
        return json(response, scripted?.status || 200, scripted?.body || (provider === "ocr" ? { fields: {}, confidence: 0.5 } : { ok: true, runId }));
      });
      server.listen(0, "127.0.0.1"); await once(server, "listening"); baseUrls[provider] = `http://127.0.0.1:${server.address().port}`; expectedHost = `127.0.0.1:${server.address().port}`; servers.push(server);
    }
  } catch (error) { await Promise.all(servers.map(server => new Promise(resolve => server.close(resolve)))); throw error; }
  let stopped = false;
  return { profile, baseUrls, state, requests, scriptResponse(response) { state.responseScript.push(response); }, stop: async () => { if (stopped) return; stopped = true; await Promise.all(servers.map(server => new Promise(resolve => server.close(resolve)))); } };
}
