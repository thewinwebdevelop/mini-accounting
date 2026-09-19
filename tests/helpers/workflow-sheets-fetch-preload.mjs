import { appendFileSync } from "node:fs";

const calls = [];
const rows = [];
const mode = process.env.WORKFLOW_SHEETS_FETCH_MODE || "success";
const logPath = process.env.WORKFLOW_SHEETS_FETCH_LOG || "";
function reply(data) { return new Response(JSON.stringify(data), { status: 200, headers: { "content-type": "application/json" } }); }
function record(url, options = {}) { calls.push({ url: String(url), method: options.method || "GET" }); if (logPath) appendFileSync(logPath, `${JSON.stringify(calls.at(-1))}\n`); }

globalThis.fetch = async (url, options = {}) => {
  const text = String(url); const method = options.method || "GET"; record(text, options);
  if (!text.startsWith("https://www.googleapis.com/") && !text.startsWith("https://sheets.googleapis.com/")) throw new Error(`unexpected outbound URL: ${text}`);
  if (text.includes("drive/v3/files")) {
    const query = new URL(text).searchParams.get("q") || "";
    if (query.includes("application/vnd.google-apps.spreadsheet")) return reply({ files: [{ id: "sheet-id", name: "รายจ่าย-2026", webViewLink: "https://docs.google.com/spreadsheets/d/sheet-id" }] });
    const match = query.match(/name = '([^']+)'/); return reply({ files: match ? [{ id: `folder-${match[1]}`, name: match[1] }] : [] });
  }
  if (text.includes("/values/")) {
    if (method === "GET") {
      const keyRows = mode === "conflict" ? [["expense_request:REQ-2026-09-0001"]] : rows;
      return reply({ values: keyRows });
    }
    const body = JSON.parse(options.body || "{}");
    if (decodeURIComponent(text).includes(":append")) { rows.push(...(body.values || [])); return reply({ updates: { updatedRange: "'2026-09'!A2:N2" } }); }
    if (body.values?.[0]?.[0] === "Source Key") rows.splice(0, rows.length, ...body.values);
    else if (body.values?.[0]) rows[1] = body.values[0];
    return reply({ updatedRange: "'2026-09'!A1:N1" });
  }
  if (text.includes("sheets.googleapis.com/v4/spreadsheets/sheet-id")) return reply({ sheets: [{ properties: { title: "2026-09" } }] });
  throw new Error(`unexpected Google request: ${method} ${text}`);
};
