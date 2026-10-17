import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationPath = new URL(
  "../supabase/migrations/202610180001_shopee_custom_label_mappings.sql",
  import.meta.url,
);

test("Shopee custom label mappings migration defines the protected mapping table", async () => {
  const sql = await readFile(migrationPath, "utf8");

  assert.match(sql, /create table if not exists public\.shopee_custom_label_mappings\s*\(/i);
  assert.match(sql, /id\s+bigint\s+generated\s+by\s+default\s+as\s+identity\s+primary\s+key/i);
  assert.match(sql, /product_name_key\s+text\s+not null/i);
  assert.match(sql, /option_name_key\s+text\s+not null/i);
  assert.match(sql, /product_name_display\s+text\s+not null\s+default\s+''/i);
  assert.match(sql, /option_name_display\s+text\s+not null\s+default\s+''/i);
  assert.match(sql, /bundle\s+jsonb\s+not null\s+default\s+'\[\]'::jsonb/i);
  assert.match(sql, /created_at\s+timestamptz\s+not null\s+default\s+now\(\)/i);
  assert.match(sql, /updated_at\s+timestamptz\s+not null\s+default\s+now\(\)/i);
  assert.match(sql, /unique\s*\(\s*product_name_key\s*,\s*option_name_key\s*\)/i);
  assert.match(sql, /alter table public\.shopee_custom_label_mappings enable row level security/i);
  assert.match(sql, /revoke all on table public\.shopee_custom_label_mappings from anon,\s*authenticated/i);
});
