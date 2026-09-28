function mapCloudVendor(record = {}) {
  return {
    id: String(record.source_id || record.source_key || "").replace(/^vendor:/, ""),
    name: String(record.name || ""),
    taxId: String(record.tax_id || ""),
    address: String(record.address || ""),
    contactName: String(record.contact_name || ""),
    phone: String(record.phone || ""),
    email: String(record.email || ""),
    bankName: String(record.bank_name || ""),
    accountNo: String(record.account_no || ""),
    paymentChannel: String(record.payment_channel || ""),
    paymentReference: String(record.payment_reference || ""),
    defaultBusinessPurpose: String(record.default_business_purpose || ""),
    note: String(record.note || ""),
    status: String(record.status || "active"),
    createdAt: record.created_at || "",
    updatedAt: record.updated_at || "",
  };
}

function mapCloudVendors(rows = [], { includeInactive = false } = {}) {
  return rows
    .map(mapCloudVendor)
    .filter(vendor => includeInactive || vendor.status === "active");
}

module.exports = { mapCloudVendor, mapCloudVendors };
