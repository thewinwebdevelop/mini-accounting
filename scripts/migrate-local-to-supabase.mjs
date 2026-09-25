import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { getCompanySettings } = require("../forms/company-settings.logic.js");
const { listVendors } = require("../forms/vendor.logic.js");
const { ensureInventorySchema, openInventoryDatabase } = require("../forms/inventory-db.logic.js");
const { createSupabaseAdminClient, supabaseRequest } = require("../forms/supabase.logic.js");

export const MIGRATION_NAME = "core-local-data-20260925";

function stableHash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function snakeVendor(vendor) {
  return {
    source_key: `vendor:${vendor.id}`,
    source_id: vendor.id,
    name: vendor.name,
    tax_id: vendor.taxId,
    address: vendor.address,
    contact_name: vendor.contactName,
    phone: vendor.phone,
    email: vendor.email,
    bank_name: vendor.bankName,
    account_no: vendor.accountNo,
    payment_channel: vendor.paymentChannel,
    payment_reference: vendor.paymentReference,
    default_business_purpose: vendor.defaultBusinessPurpose,
    note: vendor.note,
    status: vendor.status,
    created_at: vendor.createdAt,
    updated_at: vendor.updatedAt,
    source_payload: vendor,
  };
}

async function collectRecords(rootDir) {
  const company = await getCompanySettings(rootDir);
  const vendors = await listVendors(rootDir, { includeInactive: true });
  const db = openInventoryDatabase(rootDir);
  try {
    ensureInventorySchema(db);
    const products = db.prepare("SELECT * FROM products ORDER BY id ASC").all();
    const stockSkus = db.prepare("SELECT * FROM stock_skus ORDER BY id ASC").all();
    const movements = db.prepare("SELECT * FROM stock_movements ORDER BY id ASC").all();
    const productRecords = products.map(product => ({
      table: "inventory_products",
      sourceKey: `product:${product.id}`,
      row: {
        source_key: `product:${product.id}`,
        source_id: product.id,
        product_code: product.product_code,
        name: product.name,
        category: product.category,
        description: product.description,
        image_path: product.image_path,
        status: product.status,
        created_at: product.created_at,
        updated_at: product.updated_at,
        source_payload: product,
      },
    }));
    const skuRecords = stockSkus.map(sku => ({
      table: "inventory_stock_skus",
      sourceKey: `stock_sku:${sku.id}`,
      row: {
        source_key: `stock_sku:${sku.id}`,
        source_id: sku.id,
        product_source_id: sku.product_id,
        sku: sku.sku,
        color: sku.color,
        size: sku.size,
        barcode: sku.barcode,
        default_unit_cost: sku.default_unit_cost,
        image_path: sku.image_path,
        status: sku.status,
        created_at: sku.created_at,
        updated_at: sku.updated_at,
        source_payload: sku,
      },
    }));
    const movementRecords = movements.map(movement => ({
      table: "inventory_stock_movements",
      sourceKey: `stock_movement:${movement.id}`,
      row: {
        source_key: `stock_movement:${movement.id}`,
        source_id: movement.id,
        stock_sku_source_id: movement.stock_sku_id,
        movement_no: movement.movement_no,
        movement_type: movement.movement_type,
        movement_date: movement.movement_date,
        quantity: movement.quantity,
        unit_cost: movement.unit_cost,
        total_cost: movement.total_cost,
        reference_type: movement.reference_type,
        reference_no: movement.reference_no,
        note: movement.note,
        created_at: movement.created_at,
        source_payload: movement,
      },
    }));
    const records = [
      {
        table: "company_settings",
        sourceKey: "company_settings:default",
        row: {
          source_key: "company_settings:default",
          setting_key: "default",
          legal_name: company.legalName,
          tax_id: company.taxId,
          branch: company.branch,
          address: company.address,
          source_payload: company,
        },
      },
      ...vendors.map(vendor => ({ table: "vendors", sourceKey: `vendor:${vendor.id}`, row: snakeVendor(vendor) })),
      ...productRecords,
      ...skuRecords,
      ...movementRecords,
    ];
    return records;
  } finally {
    db.close();
  }
}

function countRecords(records) {
  return records.reduce((counts, record) => {
    const key = {
      company_settings: "companySettings",
      vendors: "vendors",
      inventory_products: "products",
      inventory_stock_skus: "stockSkus",
      inventory_stock_movements: "stockMovements",
    }[record.table];
    counts[key] += 1;
    return counts;
  }, { companySettings: 0, vendors: 0, products: 0, stockSkus: 0, stockMovements: 0 });
}

export async function planMigration({ rootDir, now = () => new Date().toISOString() }) {
  const records = await collectRecords(rootDir);
  return {
    migrationName: MIGRATION_NAME,
    mode: "dry-run",
    generatedAt: now(),
    counts: countRecords(records),
    records,
    writes: 0,
  };
}

async function updateRun({ client, request, runId, status, counts, errorCode = "", finishedAt = null }) {
  if (!runId) return;
  await request(client, `/rest/v1/migration_runs?id=eq.${encodeURIComponent(runId)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: { status, counts, error_code: errorCode, finished_at: finishedAt },
  });
}

export async function applyMigration({
  rootDir,
  client,
  request = supabaseRequest,
  now = () => new Date().toISOString(),
} = {}) {
  const plan = await planMigration({ rootDir, now });
  const startedAt = now();
  const runRows = await request(client, "/rest/v1/migration_runs", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: { migration_name: MIGRATION_NAME, mode: "apply", status: "running", counts: plan.counts, started_at: startedAt },
  });
  const runId = Array.isArray(runRows) ? runRows[0]?.id : "";
  let writes = 0;
  try {
    for (const record of plan.records) {
      const sourceKey = encodeURIComponent(record.sourceKey);
      const existing = await request(client, `/rest/v1/migration_records?migration_name=eq.${encodeURIComponent(MIGRATION_NAME)}&source_key=eq.${sourceKey}&limit=1`);
      if (Array.isArray(existing) && existing.length) continue;
      await request(client, `/rest/v1/${record.table}?on_conflict=source_key`, {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=representation" },
        body: record.row,
      });
      const verified = await request(client, `/rest/v1/${record.table}?source_key=eq.${sourceKey}&limit=1`);
      if (!Array.isArray(verified) || verified.length !== 1) {
        const error = new Error("Migration verification failed");
        error.code = "MIGRATION_VERIFY_FAILED";
        throw error;
      }
      await request(client, "/rest/v1/migration_records", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: {
          migration_name: MIGRATION_NAME,
          source_key: record.sourceKey,
          target_table: record.table,
          target_key: record.sourceKey,
          source_hash: stableHash(record.row),
          migrated_at: now(),
        },
      });
      writes += 1;
    }
    await updateRun({ client, request, runId, status: "succeeded", counts: { ...plan.counts, writes }, finishedAt: now() });
    return { ...plan, mode: "apply", writes };
  } catch (error) {
    await updateRun({ client, request, runId, status: "failed", counts: { ...plan.counts, writes }, errorCode: error.code || "MIGRATION_FAILED", finishedAt: now() }).catch(() => {});
    throw error;
  }
}

async function main() {
  const rootDir = process.env.SWEET_HOUSE_ROOT_DIR || process.cwd();
  const client = createSupabaseAdminClient();
  const result = process.argv.includes("--apply")
    ? await applyMigration({ rootDir, client })
    : await planMigration({ rootDir });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(error => {
    process.stderr.write(`${error.code || "MIGRATION_FAILED"}: ${error.message}\n`);
    process.exitCode = 1;
  });
}
