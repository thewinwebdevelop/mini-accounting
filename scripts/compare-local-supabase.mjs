import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { canonicalHash } = require("../forms/data-backend.logic.js");
const { createSupabaseAdminClient, supabaseRequest } = require("../forms/supabase.logic.js");
import { MIGRATION_NAME, planMigration } from "./migrate-local-to-supabase.mjs";
import { DOCUMENT_MIGRATION_NAME, planDocumentMigration } from "./migrate-local-documents-to-supabase.mjs";

function recordKey(record = {}) {
  return String(record.sourceKey ?? record.source_key ?? "");
}

function recordHash(record = {}) {
  if (record.payload && record.document_kind) return canonicalHash(record.payload);
  if (record.document_source_key && record.object_path) {
    const { migrated_at: _migratedAt, ...stableFileFields } = record;
    return canonicalHash(stableFileFields);
  }
  return canonicalHash(record.sourcePayload ?? record.source_payload ?? record);
}

export function compareRecordSets(localRecords = [], cloudRecords = []) {
  const local = new Map(localRecords.map(record => [recordKey(record), recordHash(record)]));
  const cloud = new Map(cloudRecords.map(record => [recordKey(record), recordHash(record)]));
  const missing = [...local.keys()].filter(key => !cloud.has(key));
  const extra = [...cloud.keys()].filter(key => !local.has(key));
  const mismatches = [...local.keys()].filter(key => cloud.has(key) && local.get(key) !== cloud.get(key));
  return {
    localCount: local.size,
    cloudCount: cloud.size,
    missing,
    extra,
    mismatches,
    ok: missing.length === 0 && extra.length === 0 && mismatches.length === 0,
  };
}

export async function compareLocalAndSupabase({ rootDir, client, request = supabaseRequest, now = () => new Date().toISOString() } = {}) {
  const [plan, documentPlan] = await Promise.all([
    planMigration({ rootDir, now }),
    planDocumentMigration({ rootDir, now }),
  ]);
  const plans = [plan, documentPlan];
  const records = plans.flatMap(item => item.records);
  const tables = [...new Set(records.map(record => record.table))].sort();
  const domains = {};
  for (const table of tables) {
    const localRecords = records.filter(record => record.table === table).map(record => record.row);
    const cloudRecords = await request(client, `/rest/v1/${table}?select=*&limit=10000`);
    domains[table] = compareRecordSets(localRecords, Array.isArray(cloudRecords) ? cloudRecords : []);
  }
  const ok = Object.values(domains).every(domain => domain.ok);
  return {
    migrationName: MIGRATION_NAME,
    documentMigrationName: DOCUMENT_MIGRATION_NAME,
    mode: "compare",
    generatedAt: now(),
    ok,
    domains,
  };
}

async function main() {
  const rootDir = process.env.SWEET_HOUSE_ROOT_DIR || process.cwd();
  const client = createSupabaseAdminClient();
  const report = await compareLocalAndSupabase({ rootDir, client });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.ok) process.exitCode = 2;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(error => {
    process.stderr.write(`${JSON.stringify({ error: { code: error.code || "COMPARE_FAILED", message: error.message } })}\n`);
    process.exitCode = 1;
  });
}
