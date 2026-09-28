import assert from "node:assert/strict";
import test from "node:test";
import { mapCloudVendor, mapCloudVendors } from "../forms/cloud-vendor-read.logic.js";

test("cloud vendor rows map to the shared vendor shape", () => {
  assert.deepEqual(mapCloudVendor({
    source_id: "VENDOR-1",
    name: "Vendor",
    tax_id: "0101",
    bank_name: "Bank",
    account_no: "123",
    payment_channel: "cash",
    status: "active",
  }), {
    id: "VENDOR-1",
    name: "Vendor",
    taxId: "0101",
    address: "",
    contactName: "",
    phone: "",
    email: "",
    bankName: "Bank",
    accountNo: "123",
    paymentChannel: "cash",
    paymentReference: "",
    defaultBusinessPurpose: "",
    note: "",
    status: "active",
    createdAt: "",
    updatedAt: "",
  });
});

test("cloud vendor reads hide inactive vendors unless settings explicitly asks for them", () => {
  const rows = [
    { source_id: "VENDOR-1", name: "Active", status: "active" },
    { source_id: "VENDOR-2", name: "Inactive", status: "inactive" },
  ];
  assert.deepEqual(mapCloudVendors(rows).map(vendor => vendor.id), ["VENDOR-1"]);
  assert.deepEqual(mapCloudVendors(rows, { includeInactive: true }).map(vendor => vendor.id), ["VENDOR-1", "VENDOR-2"]);
});
