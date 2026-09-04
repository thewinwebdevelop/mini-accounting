import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import companySettingsLogic from "../forms/company-settings.logic.js";

const {
  getCompanySettings,
  saveCompanySettings,
} = companySettingsLogic;

test("company settings start with Sweet House Daisy defaults", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-company-"));

  try {
    assert.deepEqual(await getCompanySettings(rootDir), {
      legalName: "หจก.สวีทเฮาส์ เดซี่",
      taxId: "",
      branch: "สำนักงานใหญ่",
      address: "",
    });
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("saveCompanySettings writes normalized company master data", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-company-"));

  try {
    const saved = await saveCompanySettings({
      rootDir,
      legalName: " หจก.สวีทเฮาส์ เดซี่ ",
      taxId: " 0103569007277 ",
      branch: " สำนักงานใหญ่ ",
      address: " 500 หมู่ 10 แขวงหนองแขม เขตหนองแขม กรุงเทพฯ 10160 ",
    });

    assert.deepEqual(saved, {
      legalName: "หจก.สวีทเฮาส์ เดซี่",
      taxId: "0103569007277",
      branch: "สำนักงานใหญ่",
      address: "500 หมู่ 10 แขวงหนองแขม เขตหนองแขม กรุงเทพฯ 10160",
    });
    assert.deepEqual(await getCompanySettings(rootDir), saved);

    const stored = JSON.parse(await readFile(join(rootDir, "config", "company-settings.json"), "utf8"));
    assert.equal(stored.taxId, "0103569007277");
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});
