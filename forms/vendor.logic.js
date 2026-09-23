const { mkdir, readFile, writeFile } = require("node:fs/promises");
const path = require("node:path");

const VENDOR_FIELDS = [
  "name",
  "taxId",
  "address",
  "contactName",
  "phone",
  "email",
  "bankName",
  "accountNo",
  "paymentChannel",
  "paymentReference",
  "defaultBusinessPurpose",
  "note",
];

const SNAPSHOT_FIELDS = VENDOR_FIELDS.filter((field) => field !== "note");
const DEFAULT_ROOT_DIR = process.env.SWEET_HOUSE_ROOT_DIR || process.cwd();

function cleanText(value) {
  return String(value ?? "").trim();
}

function normalizeStatus(value = "active") {
  const status = cleanText(value) || "active";
  if (status !== "active" && status !== "inactive") {
    const error = new Error("สถานะผู้ขายไม่ถูกต้อง");
    error.code = "INVALID_VENDOR_STATUS";
    error.statusCode = 400;
    throw error;
  }
  return status;
}

function validationError(message = "ระบุชื่อผู้ขาย") {
  const error = new Error(message);
  error.code = "INVALID_VENDOR";
  error.statusCode = 400;
  return error;
}

function normalizeVendorInput(input = {}) {
  const normalized = Object.fromEntries(VENDOR_FIELDS.map((field) => [field, cleanText(input?.[field])]));
  if (!normalized.name) throw validationError("ระบุชื่อผู้ขาย");
  return normalized;
}

function cloneVendor(record) {
  return record && typeof record === "object" ? { ...record } : record;
}

function vendorSnapshotFromRecord(record = {}) {
  return Object.fromEntries(SNAPSHOT_FIELDS.map((field) => [field, cleanText(record?.[field])]));
}

function normalizedMatchValue(value) {
  return cleanText(value).normalize("NFKC").replace(/\s+/g, " ").toLocaleLowerCase("th-TH");
}

function normalizedTaxId(value) {
  return normalizedMatchValue(value).replace(/[^\p{L}\p{N}]/gu, "");
}

function findVendorMatches(candidate = {}, vendors = []) {
  const normalized = normalizeVendorInput(candidate);
  const name = normalizedMatchValue(normalized.name);
  const taxId = normalizedTaxId(normalized.taxId);
  return vendors.filter(Boolean).flatMap((vendor) => {
    const matchedFields = [];
    if (name && normalizedMatchValue(vendor.name) === name) matchedFields.push("name");
    if (taxId && normalizedTaxId(vendor.taxId) && normalizedTaxId(vendor.taxId) === taxId) matchedFields.push("taxId");
    if (!matchedFields.length) return [];

    // Keep the record shape convenient for callers that only need an ID while
    // also exposing the source record explicitly for API adapters. `vendor` is
    // non-enumerable so this remains a record plus matchedFields projection.
    const match = { ...cloneVendor(vendor), matchedFields };
    Object.defineProperty(match, "vendor", { value: cloneVendor(vendor), enumerable: false });
    return [match];
  });
}

function assertVendorSelection(vendor, options = {}) {
  if (!vendor || typeof vendor !== "object" || !cleanText(vendor.id)) {
    const error = new Error("ไม่พบผู้ขาย");
    error.code = "VENDOR_NOT_FOUND";
    error.statusCode = 404;
    throw error;
  }
  if (!cleanText(vendor.name)) throw validationError("ผู้ขายไม่มีชื่อ");
  if (normalizeStatus(vendor.status) === "inactive" && !options.allowInactive) {
    const error = new Error("ผู้ขายถูกปิดใช้งาน");
    error.code = "VENDOR_INACTIVE";
    error.statusCode = 409;
    throw error;
  }
  return vendor;
}

function resolveRootAndOptions(first, second, third) {
  if (typeof first === "string") {
    return { rootDir: first, input: second, options: third || {} };
  }
  if (first && typeof first === "object" && first.rootDir) {
    const { rootDir, input, ...options } = first;
    return { rootDir, input, options: { ...options, ...(second || {}) } };
  }
  return { rootDir: DEFAULT_ROOT_DIR, input: first, options: second || {} };
}

function resolveRootAndId(first, second, third) {
  if (typeof first === "string" && second !== undefined) return { rootDir: first, id: second, patch: third };
  if (first && typeof first === "object" && first.rootDir) {
    const { rootDir, id, ...options } = first;
    return { rootDir, id, patch: options };
  }
  return { rootDir: DEFAULT_ROOT_DIR, id: first, patch: second };
}

function vendorsPath(rootDir) {
  return path.join(rootDir, "config", "vendors.json");
}

function legacyVendorsPath(rootDir) {
  return path.join(rootDir, "config", "substitute-receipt-vendors.json");
}

async function readJsonVendors(filePath) {
  try {
    const stored = JSON.parse(await readFile(filePath, "utf8"));
    return Array.isArray(stored) ? stored : (Array.isArray(stored.vendors) ? stored.vendors : []);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

function normalizeStoredRecord(record) {
  const fields = normalizeVendorInput(record);
  return {
    id: cleanText(record.id),
    ...fields,
    status: normalizeStatus(record.status),
    createdAt: cleanText(record.createdAt),
    updatedAt: cleanText(record.updatedAt),
  };
}

async function readAllVendors(rootDir) {
  const shared = (await readJsonVendors(vendorsPath(rootDir))).filter((record) => record && record.id);
  const legacy = (await readJsonVendors(legacyVendorsPath(rootDir))).filter((record) => record && record.id);
  const byId = new Map();
  for (const record of legacy) byId.set(record.id, normalizeStoredRecord(record));
  for (const record of shared) byId.set(record.id, normalizeStoredRecord(record));
  return [...byId.values()];
}

async function writeAllVendors(rootDir, vendors) {
  const filePath = vendorsPath(rootDir);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify({ vendors }, null, 2)}\n`, "utf8");
}

function sortVendors(vendors) {
  return [...vendors].sort((a, b) => {
    if (a.status !== b.status) return a.status === "active" ? -1 : 1;
    return a.name.localeCompare(b.name, "th");
  });
}

function parseListArgs(first, second) {
  if (typeof first === "string") return { rootDir: first, options: second || {} };
  if (first && typeof first === "object" && first.rootDir) {
    const { rootDir, ...options } = first;
    return { rootDir, options };
  }
  return { rootDir: DEFAULT_ROOT_DIR, options: first || {} };
}

async function listVendors(first, second) {
  const { rootDir, options } = parseListArgs(first, second);
  const includeInactive = Boolean(options.includeInactive);
  const vendors = sortVendors(await readAllVendors(rootDir));
  return vendors.filter((vendor) => includeInactive || vendor.status === "active").map(cloneVendor);
}

async function getVendorById(first, second) {
  const rootDir = first && typeof first === "object" && first.rootDir
    ? first.rootDir
    : (typeof first === "string" && second !== undefined ? first : DEFAULT_ROOT_DIR);
  const id = first && typeof first === "object" && first.rootDir
    ? first.id
    : (typeof first === "string" && second !== undefined ? second : first);
  const vendors = await readAllVendors(rootDir);
  const found = vendors.find((vendor) => vendor.id === cleanText(id));
  return found ? cloneVendor(found) : null;
}

function createVendorId(options = {}) {
  const suffix = options.idSuffix || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return `VENDOR-${suffix}`;
}

function duplicateError(matches, stale = false) {
  const error = new Error(stale ? "ข้อมูลยืนยันผู้ขายซ้ำไม่ตรงกับข้อมูลล่าสุด" : "พบผู้ขายที่อาจซ้ำ กรุณายืนยันก่อนบันทึก");
  error.code = "VENDOR_DUPLICATE_CONFIRMATION_REQUIRED";
  error.statusCode = 409;
  error.matches = matches.map((match) => ({
    id: match.id,
    name: match.name,
    taxId: match.taxId,
    matchedFields: [...match.matchedFields],
  }));
  return error;
}

async function createVendor(first, second, third) {
  const { rootDir, input, options } = resolveRootAndOptions(first, second, third);
  const normalized = normalizeVendorInput(input || {});
  const vendors = await readAllVendors(rootDir);
  const matches = findVendorMatches(normalized, vendors);
  const expectedIds = Array.isArray(options.expectedMatchIds) ? [...new Set(options.expectedMatchIds.map(cleanText))].sort() : [];
  const actualIds = matches.map((match) => match.id).sort();
  if ((matches.length || expectedIds.length) && (!options.confirmDuplicate || expectedIds.length !== actualIds.length || expectedIds.some((id, index) => id !== actualIds[index]))) {
    throw duplicateError(matches, Boolean(options.confirmDuplicate || expectedIds.length));
  }

  const timestamp = options.now ? options.now() : new Date().toISOString();
  const vendor = {
    id: createVendorId(options),
    ...normalized,
    status: "active",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  await writeAllVendors(rootDir, [...vendors, vendor]);
  return cloneVendor(vendor);
}

async function updateVendor(first, second, third) {
  const { rootDir, id, patch } = resolveRootAndId(first, second, third);
  const vendors = await readAllVendors(rootDir);
  const index = vendors.findIndex((vendor) => vendor.id === cleanText(id));
  if (index < 0) {
    const error = new Error("ไม่พบผู้ขาย");
    error.code = "VENDOR_NOT_FOUND";
    error.statusCode = 404;
    throw error;
  }
  const current = vendors[index];
  const options = patch?.options || {};
  const nextInput = normalizeVendorInput({ ...current, ...(patch || {}) });
  const matches = findVendorMatches(nextInput, vendors.filter((vendor) => vendor.id !== current.id));
  const expectedIds = Array.isArray(options.expectedMatchIds) ? [...new Set(options.expectedMatchIds.map(cleanText))].sort() : [];
  const actualIds = matches.map((match) => match.id).sort();
  if ((matches.length || expectedIds.length) && (!options.confirmDuplicate || expectedIds.length !== actualIds.length || expectedIds.some((matchId, matchIndex) => matchId !== actualIds[matchIndex]))) {
    throw duplicateError(matches, Boolean(options.confirmDuplicate || expectedIds.length));
  }
  const timestamp = options.now ? options.now() : new Date().toISOString();
  const updated = {
    ...current,
    ...nextInput,
    status: normalizeStatus(patch?.status || current.status),
    updatedAt: timestamp,
  };
  await writeAllVendors(rootDir, vendors.map((vendor, itemIndex) => itemIndex === index ? updated : vendor));
  return cloneVendor(updated);
}

module.exports = {
  VENDOR_FIELDS,
  SNAPSHOT_FIELDS,
  normalizeVendorInput,
  vendorSnapshotFromRecord,
  findVendorMatches,
  assertVendorSelection,
  listVendors,
  getVendorById,
  createVendor,
  updateVendor,
};
