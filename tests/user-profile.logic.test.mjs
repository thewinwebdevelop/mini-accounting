import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  normalizeProfileInput,
  mapProfileRow,
  formatProfileName,
} = require("../forms/user-profile.logic.js");

test("normalizes first and last names and validates required fields", () => {
  assert.deepEqual(
    normalizeProfileInput({ firstName: "  ชื่อ ", lastName: " นามสกุล ", companyPositionId: "p-1" }),
    { firstName: "ชื่อ", lastName: "นามสกุล", companyPositionId: "p-1" },
  );
  assert.throws(() => normalizeProfileInput({ firstName: " ", lastName: "นามสกุล" }), /first name/i);
  assert.throws(() => normalizeProfileInput({ firstName: "ชื่อ", lastName: "  " }), /last name/i);
});

test("rejects overlong profile fields", () => {
  assert.throws(
    () => normalizeProfileInput({ firstName: "a".repeat(101), lastName: "นามสกุล" }),
    /first name/i,
  );
  assert.throws(
    () => normalizeProfileInput({ firstName: "ชื่อ", lastName: "a".repeat(121) }),
    /last name/i,
  );
});

test("maps profile rows without exposing provider-owned fields as editable", () => {
  assert.deepEqual(
    mapProfileRow({
      user_id: "user-1",
      first_name: "ชื่อ",
      last_name: "นามสกุล",
      company_position_id: "p-1",
      company_positions: { label: "เจ้าของบริษัท" },
      display_name: "LINE name",
      picture_url: "https://example.com/p.png",
      status: "active",
      role_code: "owner",
      created_at: "2026-09-29T00:00:00.000Z",
      updated_at: "2026-09-29T00:00:00.000Z",
    }),
    {
      firstName: "ชื่อ",
      lastName: "นามสกุล",
      companyPositionId: "p-1",
      companyPositionLabel: "เจ้าของบริษัท",
      displayName: "LINE name",
      pictureUrl: "https://example.com/p.png",
    },
  );
});

test("formats a profile name from partial values", () => {
  assert.equal(formatProfileName({ firstName: " ชื่อ ", lastName: " นามสกุล " }), "ชื่อ นามสกุล");
  assert.equal(formatProfileName({ firstName: " ชื่อ ", lastName: " " }), "ชื่อ");
  assert.equal(formatProfileName({ firstName: " ", lastName: " นามสกุล " }), "นามสกุล");
});

test("migration preserves legacy blanks but rejects new blank profile writes", () => {
  const migration = fs.readFileSync(
    new URL("../supabase/migrations/202609290001_user_profile_and_positions.sql", import.meta.url),
    "utf8",
  );

  assert.match(migration, /app_user_profiles_first_name_nonblank_check[\s\S]*?check \(char_length\(trim\(first_name\)\) > 0\)[\s\S]*?not valid/i);
  assert.match(migration, /app_user_profiles_last_name_nonblank_check[\s\S]*?check \(char_length\(trim\(last_name\)\) > 0\)[\s\S]*?not valid/i);
  assert.match(migration, /if not exists[\s\S]*?app_user_profiles_first_name_nonblank_check/i);
});
