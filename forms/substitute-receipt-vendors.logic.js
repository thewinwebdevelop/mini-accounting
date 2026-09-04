const { mkdir, readFile, writeFile } = require("node:fs/promises");
const path = require("node:path");

function nowIso(options = {}) {
  return options.now ? options.now() : new Date().toISOString();
}

function cleanText(value) {
  return String(value ?? "").trim();
}

function vendorsPath(rootDir) {
  return path.join(rootDir, "config", "substitute-receipt-vendors.json");
}

function createVendorId(options = {}) {
  const suffix = options.idSuffix || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return `SRV-${suffix}`;
}

function normalizeStatus(value) {
  const status = cleanText(value) || "active";
  if (!["active", "inactive"].includes(status)) throw new Error("สถานะไม่ถูกต้อง");
  return status;
}

function normalizeVendor(data = {}, existing = {}, options = {}) {
  const name = cleanText(data.name);
  if (!name) throw new Error("ระบุชื่อผู้ขาย");

  const timestamp = nowIso(options);
  return {
    id: cleanText(existing.id) || createVendorId(options),
    name,
    taxId: cleanText(data.taxId),
    paymentChannel: cleanText(data.paymentChannel) || "โอนผ่านบัญชีบริษัท",
    paymentReference: cleanText(data.paymentReference),
    defaultBusinessPurpose: cleanText(data.defaultBusinessPurpose),
    note: cleanText(data.note),
    status: normalizeStatus(data.status || existing.status || "active"),
    createdAt: existing.createdAt || timestamp,
    updatedAt: timestamp,
  };
}

async function readVendorFile(rootDir) {
  try {
    const stored = JSON.parse(await readFile(vendorsPath(rootDir), "utf8"));
    return Array.isArray(stored.vendors) ? stored.vendors : [];
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return [];
  }
}

async function writeVendorFile(rootDir, vendors) {
  await mkdir(path.dirname(vendorsPath(rootDir)), { recursive: true });
  await writeFile(vendorsPath(rootDir), `${JSON.stringify({ vendors }, null, 2)}\n`, "utf8");
}

function sortVendors(vendors) {
  return [...vendors].sort((a, b) => {
    if (a.status !== b.status) return a.status === "active" ? -1 : 1;
    return a.name.localeCompare(b.name, "th");
  });
}

async function listSubstituteReceiptVendors(rootDir, filters = {}) {
  const includeInactive = Boolean(filters.includeInactive);
  const vendors = await readVendorFile(rootDir);
  return sortVendors(vendors).filter((vendor) => includeInactive || vendor.status === "active");
}

async function createSubstituteReceiptVendor(rootDir, data = {}, options = {}) {
  const vendors = await readVendorFile(rootDir);
  const vendor = normalizeVendor(data, {}, options);
  const duplicate = vendors.find((item) => item.name === vendor.name);
  if (duplicate) throw new Error("ผู้ขายนี้มีอยู่แล้ว");

  await writeVendorFile(rootDir, [...vendors, vendor]);
  return vendor;
}

async function updateSubstituteReceiptVendor(rootDir, vendorId, data = {}, options = {}) {
  const vendors = await readVendorFile(rootDir);
  const id = cleanText(vendorId);
  const index = vendors.findIndex((vendor) => vendor.id === id);
  if (index < 0) throw new Error("ไม่พบผู้ขาย");

  const vendor = normalizeVendor(data, vendors[index], options);
  const duplicate = vendors.find((item) => item.id !== id && item.name === vendor.name);
  if (duplicate) throw new Error("ผู้ขายนี้มีอยู่แล้ว");

  const nextVendors = [...vendors];
  nextVendors[index] = vendor;
  await writeVendorFile(rootDir, nextVendors);
  return vendor;
}

module.exports = {
  createSubstituteReceiptVendor,
  listSubstituteReceiptVendors,
  updateSubstituteReceiptVendor,
};
