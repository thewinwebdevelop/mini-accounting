import { createServer } from "node:http";
import { once } from "node:events";
import { redactE2ELog } from "../support/redaction.mjs";

const ENDPOINTS = {
  supabase: [
    ["GET", "/rest/v1/fixture_probe", "none"], ["GET", "/rest/v1/e2e_documents", "none"], ["POST", "/rest/v1/e2e_documents", "none"],
    ["GET", "/rest/v1/e2e_reservations", "none"], ["POST", "/rest/v1/e2e_reservations", "none"],
    ["POST", "/rest/v1/rpc/allocate_workflow_transaction_number", "none"], ["POST", "/rest/v1/documents", "on_conflict=source_key"], ["GET", "/rest/v1/documents", "query"],
    ["POST", "/rest/v1/document_files", "on_conflict=source_key"], ["GET", "/rest/v1/document_files", "query"], ["POST", "/rest/v1/storage_migration_records", "migration-conflict"],
    ["GET", "/rest/v1/company_settings", "query"], ["GET", "/rest/v1/vendors", "query"], ["GET", "/rest/v1/inventory_products", "query"],
    ["GET", "/rest/v1/inventory_stock_skus", "query"], ["GET", "/rest/v1/inventory_stock_movements", "query"],
    ["GET", /^\/storage\/v1\/object\/[a-z0-9._-]+\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]+$/, "none"],
    ["POST", /^\/storage\/v1\/object\/[a-z0-9._-]+\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]+$/, "none"],
  ],
  line: [["GET", /^\/v2\/bot\/message\/[^/]+\/content$/, "none"], ["POST", "/v2/bot/message/reply", "none"], ["POST", "/oauth2/v2.1/verify", "none"]],
  google: [["GET", "/drive/v3/files", "drive"], ["POST", "/drive/v3/files", "drive-create"], ["POST", "/upload/drive/v3/files", "upload"], ["POST", /^\/upload\/drive\/v3\/files\/[^/]+$/, "upload"], ["POST", "/token", "none"], ["GET", /^\/v4\/spreadsheets\/[^/]+$/, "sheets"], ["POST", /^\/v4\/spreadsheets\/[^/]+:batchUpdate$/, "sheets"], ["GET", /^\/v4\/spreadsheets\/[^/]+\/values\/[^/]+$/, "sheets-values"], ["PUT", /^\/v4\/spreadsheets\/[^/]+\/values\/[^/]+$/, "sheets-values"], ["POST", /^\/v4\/spreadsheets\/[^/]+\/values\/[^/]+:append$/, "sheets-values"]],
  shopee: ["order/get_order_list", "order/get_order_detail", "auth/token/get", "auth/access_token/get", "shop/auth_partner", "logistics/get_mass_tracking_number", "logistics/create_shipping_document_job", "logistics/get_shipping_document_job_status", "logistics/download_shipping_document_job", "logistics/get_mass_shipping_parameter", "logistics/mass_ship_order"].map(path => ["POST", `/api/v2/${path}`, "query"]),
  ocr: [["POST", "/", "none"]],
};

function matchEndpoint(provider, method, pathname, search) {
  for (const [allowedMethod, route, queryRule] of ENDPOINTS[provider] || []) {
    if (allowedMethod !== method || (route instanceof RegExp ? !route.test(pathname) : route !== pathname)) continue;
    if (queryRule === "none" && search) continue;
    if (queryRule === "on_conflict=source_key" && search !== "?on_conflict=source_key") continue;
    if (queryRule === "migration-conflict" && search !== "?on_conflict=migration_name%2Csource_key" && search !== "?on_conflict=migration_name,source_key") continue;
    if (["drive", "drive-create", "upload", "sheets", "sheets-values", "query", "migration-conflict"].includes(queryRule)) {
      if (queryRule === "migration-conflict" && search !== "?on_conflict=migration_name%2Csource_key" && search !== "?on_conflict=migration_name,source_key") continue;
      if (queryRule !== "migration-conflict") {
        const keys = [...new URLSearchParams(search).keys()];
        const allowed = queryRule === "drive" ? ["fields", "pageSize", "q"] : queryRule === "drive-create" ? ["fields"] : queryRule === "upload" ? ["fields", "uploadType"] : queryRule === "sheets" ? ["fields"] : queryRule === "sheets-values" ? ["valueInputOption", "insertDataOption"] : ["source_key", "limit", "owner_user_id", "status", "document_kind", "accounting_month", "order", "or"];
        if (keys.some(key => !allowed.includes(key))) continue;
      }
    }
    return { queryRule };
  }
  return null;
}

function parseJson(body) { try { return JSON.parse(body.toString("utf8")); } catch { return null; } }
function exactKeys(value, allowed, required) { const keys = Object.keys(value); return required.every(key => keys.includes(key)) && keys.every(key => allowed.includes(key)); }
function exactForm(body, allowed, required) { const keys = [...new URLSearchParams(body.toString("utf8")).keys()]; return required.every(key => keys.includes(key)) && keys.every(key => allowed.includes(key)); }
function validBody(provider, method, pathname, body, endpoint) {
  if (method === "GET" || method === "HEAD") return body.length === 0;
  if (!body.length || (provider === "supabase" && pathname.startsWith("/storage/v1/object/"))) return Boolean(body.length);
  if (provider === "line" && pathname.endsWith("/verify")) return exactForm(body, ["id_token", "client_id"], ["id_token", "client_id"]);
  if (provider === "google" && pathname === "/token") return exactForm(body, ["client_id", "client_secret", "code", "grant_type", "redirect_uri", "refresh_token"], ["grant_type"]);
  if (provider === "google" && pathname.startsWith("/upload/drive/v3/files")) return body.length > 0;
  const value = parseJson(body);
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  if (provider === "line" && pathname.endsWith("/reply")) return exactKeys(value, ["replyToken", "messages"], ["replyToken", "messages"]);
  if (provider === "ocr") return exactKeys(value, ["fileName", "contentType", "base64"], ["fileName", "contentType", "base64"]);
  if (provider === "supabase" && pathname.endsWith("allocate_workflow_transaction_number")) return exactKeys(value, ["p_accounting_month", "p_request_key"], ["p_accounting_month", "p_request_key"]);
  if (provider === "supabase" && pathname.endsWith("e2e_documents")) return exactKeys(value, ["documentNo", "title"], ["documentNo"]);
  if (provider === "supabase" && pathname.endsWith("e2e_reservations")) return exactKeys(value, ["requestKey", "transactionNo"], ["requestKey", "transactionNo"]);
  if (provider === "supabase" && pathname === "/rest/v1/documents") return Object.keys(value).every(key => ["source_key", "document_kind", "document_no", "owner_user_id", "status", "accounting_month", "folder_path", "payload", "source_hash", "created_at", "updated_at"].includes(key));
  if (provider === "supabase" && pathname === "/rest/v1/document_files") return Object.keys(value).every(key => ["source_key", "document_source_key", "bucket_name", "object_path", "source_sha256", "byte_size", "content_type", "original_name", "migrated_at"].includes(key));
  if (provider === "supabase" && pathname === "/rest/v1/storage_migration_records") return Object.keys(value).every(key => ["migration_name", "source_key", "bucket_name", "object_path", "source_sha256", "byte_size", "content_type", "migrated_at"].includes(key));
  if (provider === "google" && pathname === "/drive/v3/files") return endpoint.queryRule === "drive-create" ? exactKeys(value, ["name", "mimeType", "parents"], ["name", "mimeType"]) : exactKeys(value, ["name", "mimeType", "parents"], []);
  if (provider === "google" && pathname.startsWith("/v4/spreadsheets/")) return pathname.includes(":batchUpdate") ? exactKeys(value, ["requests"], ["requests"]) : exactKeys(value, ["values"], ["values"]);
  if (provider === "shopee") {
    const allowed = pathname.endsWith("get_order_list") ? ["order_status", "time_range_field", "time_from", "time_to", "page_size", "cursor"]
      : pathname.endsWith("get_order_detail") ? ["order_sn_list"]
        : pathname.endsWith("auth/token/get") ? ["partner_id", "code", "shop_id"]
          : pathname.endsWith("auth/access_token/get") ? ["partner_id", "shop_id", "refresh_token"]
            : pathname.endsWith("get_mass_tracking_number") ? ["order_sn_list"]
              : pathname.endsWith("create_shipping_document_job") ? ["order_list", "shipping_document_type"]
                : pathname.endsWith("get_shipping_document_job_status") ? ["shipping_document_job_id"]
                  : pathname.endsWith("download_shipping_document_job") ? ["shipping_document_job_id"]
                    : pathname.endsWith("get_mass_shipping_parameter") ? ["order_list"]
                      : pathname.endsWith("mass_ship_order") ? ["order_list", "pickup"] : [];
    return exactKeys(value, allowed, []);
  }
  return false;
}
function json(response, status, value) { response.writeHead(status, { "content-type": "application/json" }); response.end(JSON.stringify(value)); }

export async function createMockProviders({ profile = "local", runId = "run", state: suppliedState = null } = {}) {
  const requests = [];
  const state = suppliedState || { runId, documents: new Map(), reservations: new Map(), responseScript: [], sequences: new Map() };
  if (!state.sequences) state.sequences = new Map();
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
        if (!validBody(provider, method, parsed.pathname, body, endpoint)) return json(response, 400, { error: "unexpected mock request body" });
        const candidate = state.responseScript[0];
        const scripted = candidate && (!candidate.endpoint || parsed.pathname.includes(candidate.endpoint)) ? state.responseScript.shift() : null;
        if (provider === "supabase" && parsed.pathname === "/rest/v1/rpc/allocate_workflow_transaction_number") {
          const value = parseJson(body); const key = String(value.p_request_key || ""); let reservation = state.reservations.get(key);
          if (!reservation) { const sequence = (state.sequences.get(value.p_accounting_month) || 0) + 1; state.sequences.set(value.p_accounting_month, sequence); reservation = { requestKey: key, accountingMonth: value.p_accounting_month, sequence, transactionNo: `TXN-${value.p_accounting_month}-${String(sequence).padStart(4, "0")}` }; state.reservations.set(key, reservation); }
          const result = { sequence: reservation.sequence, transaction_no: reservation.transactionNo, existing: Boolean(state.documents.get(`workflow_transaction:${reservation.transactionNo}`)) };
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
        if (provider === "line" && parsed.pathname.endsWith("/content")) { response.writeHead(200, { "content-type": "application/octet-stream" }); return response.end(Buffer.from("fixture-bytes")); }
        return json(response, scripted?.status || 200, scripted?.body || (provider === "ocr" ? { fields: {}, confidence: 0.5 } : { ok: true, runId }));
      });
      server.listen(0, "127.0.0.1"); await once(server, "listening"); baseUrls[provider] = `http://127.0.0.1:${server.address().port}`; expectedHost = `127.0.0.1:${server.address().port}`; servers.push(server);
    }
  } catch (error) { await Promise.all(servers.map(server => new Promise(resolve => server.close(resolve)))); throw error; }
  let stopped = false;
  return { profile, baseUrls, state, requests, scriptResponse(response) { state.responseScript.push(response); }, stop: async () => { if (stopped) return; stopped = true; await Promise.all(servers.map(server => new Promise(resolve => server.close(resolve)))); } };
}
