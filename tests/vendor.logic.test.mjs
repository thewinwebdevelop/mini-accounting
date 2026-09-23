import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import vendorLogic from "../forms/vendor.logic.js";
import serverLogic from "../forms/local-server.logic.js";

const {
  normalizeVendorInput,
  vendorSnapshotFromRecord,
  findVendorMatches,
  assertVendorSelection,
  createVendor,
  updateVendor,
  getVendorById,
  listVendors,
} = vendorLogic;

test("normalizes vendor fields and leaves taxId optional", () => {
  assert.deepEqual(normalizeVendorInput({
    name: "  บริษัท ตัวอย่าง  ",
    taxId: "  ",
    address: "  1 ถนนสุขุมวิท  ",
    paymentChannel: " โอนผ่านบัญชี ",
  }), {
    name: "บริษัท ตัวอย่าง",
    taxId: "",
    address: "1 ถนนสุขุมวิท",
    contactName: "",
    phone: "",
    email: "",
    bankName: "",
    accountNo: "",
    paymentChannel: "โอนผ่านบัญชี",
    paymentReference: "",
    defaultBusinessPurpose: "",
    note: "",
  });
  assert.throws(() => normalizeVendorInput({ taxId: "123" }), /ชื่อผู้ขาย/);
});

test("projects a stable isolated document snapshot", () => {
  const record = {
    id: "VENDOR-1", status: "active", name: "ร้านตัวอย่าง", taxId: "123",
    address: "ที่อยู่", contactName: "คุณเอ", phone: "099", email: "a@example.com",
    bankName: "ธนาคาร", accountNo: "001", paymentChannel: "โอน", paymentReference: "ref",
    defaultBusinessPurpose: "ซื้อของ", note: "ลับ", createdAt: "created", updatedAt: "updated",
  };
  const snapshot = vendorSnapshotFromRecord(record);
  assert.deepEqual(snapshot, {
    name: "ร้านตัวอย่าง", taxId: "123", address: "ที่อยู่", contactName: "คุณเอ",
    phone: "099", email: "a@example.com", bankName: "ธนาคาร", accountNo: "001",
    paymentChannel: "โอน", paymentReference: "ref", defaultBusinessPurpose: "ซื้อของ",
  });
  snapshot.name = "แก้เฉพาะเอกสาร";
  assert.equal(record.name, "ร้านตัวอย่าง");
});

test("finds duplicates by normalized name or tax ID", () => {
  const vendors = [{ id: "V1", name: "บริษัท  เอ จำกัด", taxId: "010-5555-12345-67", status: "active" }];
  assert.deepEqual(findVendorMatches({ name: "บริษัท เอ จำกัด", taxId: "" }, vendors).map((item) => item.id), ["V1"]);
  const match = findVendorMatches({ name: "รายอื่น", taxId: "01055551234567" }, vendors)[0];
  assert.equal(match.id, "V1");
  assert.deepEqual(match.matchedFields, ["taxId"]);
  assert.equal(match.vendor.id, "V1");
});

test("selection rejects inactive vendors unless explicitly allowed", () => {
  const inactive = { id: "V1", name: "เก่า", status: "inactive" };
  assert.throws(() => assertVendorSelection(inactive), (error) => error.code === "VENDOR_INACTIVE");
  assert.equal(assertVendorSelection(inactive, { allowInactive: true }), inactive);
});

test("shared persistence supports no-tax vendors and requires bound duplicate confirmation", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-vendor-domain-"));
  try {
    const created = await serverLogic.createVendor(rootDir, { name: "ไม่มีเลขภาษี", address: "ที่อยู่" }, { now: () => "2026-09-23T00:00:00.000Z", idSuffix: "one" });
    assert.equal(created.taxId, "");
    assert.equal(created.status, "active");
    assert.equal((await serverLogic.listVendors(rootDir)).length, 1);

    let duplicateError;
    await assert.rejects(
      serverLogic.createVendor(rootDir, { name: " ไม่มีเลขภาษี " }),
      (error) => {
        duplicateError = error;
        return error.code === "VENDOR_DUPLICATE_CONFIRMATION_REQUIRED"
          && error.matches.some((item) => item.id === created.id)
          && /^[a-f0-9]{64}$/.test(error.candidateFingerprint);
      },
    );
    await assert.rejects(
      serverLogic.createVendor(rootDir, { name: "ไม่มีเลขภาษี" }, { confirmDuplicate: true, expectedMatchIds: [created.id], expectedCandidateFingerprint: "stale" }),
      (error) => error.code === "VENDOR_DUPLICATE_CONFIRMATION_REQUIRED",
    );
    const duplicate = await serverLogic.createVendor(rootDir, { name: "ไม่มีเลขภาษี" }, {
      confirmDuplicate: true,
      expectedMatchIds: [created.id],
      expectedCandidateFingerprint: duplicateError.candidateFingerprint,
      now: () => "2026-09-23T00:00:01.000Z",
      idSuffix: "two",
    });
    assert.notEqual(duplicate.id, created.id);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("does not lose concurrent vendor creations and writes atomically", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-vendor-concurrency-"));
  try {
    const created = await Promise.all(Array.from({ length: 20 }, (_, index) => serverLogic.createVendor(rootDir, { name: `พร้อมกัน ${index}` }, { idSuffix: `concurrent-${index}` })));
    assert.equal(new Set(created.map((vendor) => vendor.id)).size, 20);
    assert.equal((await serverLogic.listVendors(rootDir)).length, 20);
    const stored = JSON.parse(await readFile(join(rootDir, "config", "vendors.json"), "utf8"));
    assert.equal(stored.vendors.length, 20);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("reads legacy substitute vendor records without changing their IDs", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-vendor-legacy-"));
  try {
    const configDir = join(rootDir, "config");
    await mkdir(configDir, { recursive: true });
    await writeFile(join(configDir, "substitute-receipt-vendors.json"), JSON.stringify({ vendors: [{
      id: "SRV-old", name: "ผู้ขายเดิม", taxId: "", paymentChannel: "โอน", status: "active",
      createdAt: "2026-01-01", updatedAt: "2026-01-01",
    }] }), "utf8");
    const vendors = await serverLogic.listVendors(rootDir);
    assert.equal(vendors[0].id, "SRV-old");
    assert.equal((await serverLogic.getVendorById(rootDir, "SRV-old")).name, "ผู้ขายเดิม");
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("updates a vendor without mutating previously returned snapshots", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-vendor-update-"));
  try {
    const first = await serverLogic.createVendor(rootDir, { name: "เดิม" }, { idSuffix: "edit" });
    const snapshot = vendorSnapshotFromRecord(first);
    const updated = await serverLogic.updateVendor(rootDir, first.id, { name: "ใหม่", status: "inactive" });
    assert.equal(updated.name, "ใหม่");
    assert.equal(updated.status, "inactive");
    assert.equal(snapshot.name, "เดิม");
    assert.throws(() => assertVendorSelection(updated), /ปิดใช้งาน/);
    assert.equal((await serverLogic.getVendorById(rootDir, first.id)).name, "ใหม่");
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("listVendors defaults to active records and can include inactive records", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-vendor-list-"));
  try {
    const active = await serverLogic.createVendor(rootDir, { name: "แอคทีฟ" }, { idSuffix: "active" });
    await serverLogic.updateVendor(rootDir, active.id, { status: "inactive" });
    assert.equal((await listVendors({ rootDir })).length, 0);
    assert.equal((await listVendors({ rootDir, includeInactive: true })).length, 1);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});
