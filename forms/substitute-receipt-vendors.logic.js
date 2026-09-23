const {
  createVendor,
  listVendors,
  updateVendor,
} = require("./vendor.logic.js");

// The substitute-receipt settings page predates the shared vendor master. Keep
// this projection deliberately narrow so existing clients receive exactly the
// fields they know while the shared service owns storage, validation, IDs, and
// duplicate handling.
const COMPATIBILITY_FIELDS = [
  "id",
  "name",
  "taxId",
  "paymentChannel",
  "paymentReference",
  "defaultBusinessPurpose",
  "note",
  "status",
  "createdAt",
  "updatedAt",
];

function compatibilityVendor(record) {
  if (!record || typeof record !== "object") return record;
  return Object.fromEntries(COMPATIBILITY_FIELDS.map((field) => [field, record[field] ?? ""]));
}

function legacyVendorInput(data = {}) {
  return {
    ...data,
    // This default was part of the old substitute-receipt preset contract.
    paymentChannel: data.paymentChannel || "โอนผ่านบัญชีบริษัท",
  };
}

function mutationOptions(data = {}, options = {}) {
  const source = data && typeof data === "object" ? data : {};
  const nested = source.options && typeof source.options === "object" ? source.options : {};
  return { ...nested, ...options };
}

async function listSubstituteReceiptVendors(rootDir, filters = {}) {
  const vendors = await listVendors(rootDir, { includeInactive: Boolean(filters.includeInactive) });
  return vendors.map(compatibilityVendor);
}

async function createSubstituteReceiptVendor(rootDir, data = {}, options = {}) {
  const status = String(data?.status ?? "active").trim() || "active";
  if (!["active", "inactive"].includes(status)) {
    const error = new Error("สถานะผู้ขายไม่ถูกต้อง");
    error.code = "INVALID_VENDOR_STATUS";
    error.statusCode = 400;
    throw error;
  }
  const vendor = await createVendor(rootDir, legacyVendorInput(data), mutationOptions(data, options));
  if (status === "inactive") {
    return compatibilityVendor(await updateVendor(rootDir, vendor.id, { status: "inactive" }));
  }
  return compatibilityVendor(vendor);
}

async function updateSubstituteReceiptVendor(rootDir, vendorId, data = {}, options = {}) {
  const vendor = await updateVendor(
    rootDir,
    vendorId,
    { ...legacyVendorInput(data), options: mutationOptions(data, options) },
  );
  return compatibilityVendor(vendor);
}

module.exports = {
  compatibilityVendor,
  createSubstituteReceiptVendor,
  listSubstituteReceiptVendors,
  updateSubstituteReceiptVendor,
};
