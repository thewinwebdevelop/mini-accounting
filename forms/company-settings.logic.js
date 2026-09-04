const { mkdir, readFile, writeFile } = require("node:fs/promises");
const path = require("node:path");

const defaultCompanySettings = {
  legalName: "หจก.สวีทเฮาส์ เดซี่",
  taxId: "",
  branch: "สำนักงานใหญ่",
  address: "",
};

function companySettingsPath(rootDir) {
  return path.join(rootDir, "config", "company-settings.json");
}

function normalizeCompanySettings(data = {}) {
  return {
    legalName: String(data.legalName ?? defaultCompanySettings.legalName).trim(),
    taxId: String(data.taxId ?? defaultCompanySettings.taxId).trim(),
    branch: String(data.branch ?? defaultCompanySettings.branch).trim(),
    address: String(data.address ?? defaultCompanySettings.address).trim(),
  };
}

async function getCompanySettings(rootDir) {
  try {
    const stored = JSON.parse(await readFile(companySettingsPath(rootDir), "utf8"));
    return normalizeCompanySettings({
      ...defaultCompanySettings,
      ...stored,
    });
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return { ...defaultCompanySettings };
  }
}

async function saveCompanySettings({ rootDir, legalName, taxId, branch, address }) {
  const settings = normalizeCompanySettings({ legalName, taxId, branch, address });
  if (!settings.legalName) throw new Error("Missing company legal name");

  await mkdir(path.dirname(companySettingsPath(rootDir)), { recursive: true });
  await writeFile(companySettingsPath(rootDir), `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  return settings;
}

module.exports = {
  defaultCompanySettings,
  getCompanySettings,
  saveCompanySettings,
};
