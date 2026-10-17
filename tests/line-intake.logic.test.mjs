import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createLocalLineIntakeStore, createSupabaseLineIntakeStore } = require("../forms/line-intake.logic.js");

test("local LINE intake store saves original bytes and is idempotent", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-line-intake-"));
  try {
    const store = createLocalLineIntakeStore({ rootDir, maxBytes: 1024 });
    const first = await store.create({
      eventId: "evt-1",
      messageId: "msg-1",
      lineUserId: "U1",
      mediaKind: "pdf",
      originalName: "invoice.pdf",
      contentType: "application/pdf",
      bytes: Buffer.from("%PDF-test"),
    });
    assert.equal(first.created, true);
    assert.equal(first.item.status, "needs_confirmation");
    assert.equal(first.item.byteSize, 9);
    assert.match(first.item.sha256, /^[a-f0-9]{64}$/);
    assert.equal(await readFile(first.item.storagePath, "utf8"), "%PDF-test");
    const scanned = await store.updateScan(first.item.id, {
      provider: "manual", status: "needs_review", confidence: 0, fields: { vendorName: "" }, warnings: [],
    });
    assert.equal(scanned.ocrStatus, "needs_review");
    assert.equal((await store.readOriginal(scanned)).bytes.toString(), "%PDF-test");

    const duplicate = await store.create({
      eventId: "evt-1",
      messageId: "msg-1",
      lineUserId: "U1",
      mediaKind: "pdf",
      originalName: "different.pdf",
      contentType: "application/pdf",
      bytes: Buffer.from("different"),
    });
    assert.equal(duplicate.created, false);
    assert.equal(duplicate.item.id, first.item.id);
    assert.equal((await store.get(first.item.id)).id, first.item.id);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("intake store rejects oversized files and invalid transitions", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-line-intake-"));
  try {
    const store = createLocalLineIntakeStore({ rootDir, maxBytes: 3 });
    await assert.rejects(() => store.create({
      eventId: "evt-big", messageId: "msg-big", lineUserId: "U1", mediaKind: "image",
      originalName: "x.jpg", contentType: "image/jpeg", bytes: Buffer.from("1234"),
    }), error => error.code === "LINE_INTAKE_TOO_LARGE");

    const created = await store.create({
      eventId: "evt-2", messageId: "msg-2", lineUserId: "U1", mediaKind: "image",
      originalName: "x.jpg", contentType: "image/jpeg", bytes: Buffer.from("12"),
    });
    const cancelled = await store.transition(created.item.id, "cancelled", { lineUserId: "U1" });
    assert.equal(cancelled.status, "cancelled");
    await assert.rejects(() => store.transition(created.item.id, "confirmed", { lineUserId: "U1" }), error => error.code === "LINE_INTAKE_INVALID_TRANSITION");
    await assert.rejects(() => store.getForUser(created.item.id, "U2"), error => error.code === "LINE_INTAKE_FORBIDDEN");
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("Supabase LINE intake store writes metadata and private object identity", async () => {
  const calls = [];
  const rows = [];
  const store = createSupabaseLineIntakeStore({
    client: {},
    storageClient: {},
    bucket: "sweet-house-files",
    uploadObject: async (_storageClient, input) => { calls.push({ type: "upload", input }); },
    downloadObject: async () => Buffer.from("%PDF"),
    request: async (_client, route, options = {}) => {
      calls.push({ type: "request", route, options });
      if (options.method === "POST") {
        const record = { ...options.body, id: "cloud-intake-1", created_at: "2026-09-25T00:00:00.000Z", updated_at: "2026-09-25T00:00:00.000Z" };
        rows.push(record);
        return [record];
      }
      if (options.method === "PATCH") return [{ ...rows[0], ...options.body, ocr_provider: options.body.ocr_provider, ocr_status: options.body.ocr_status }];
      if (route.includes("id=eq.cloud-intake-1")) return rows;
      return [];
    },
  });
  const result = await store.create({
    eventId: "evt-cloud", messageId: "msg-cloud", lineUserId: "U-cloud", mediaKind: "pdf",
    originalName: "invoice.pdf", contentType: "application/pdf", bytes: Buffer.from("%PDF"),
  });
  assert.equal(result.created, true);
  assert.equal(result.item.id, "cloud-intake-1");
  const uploadCall = calls.find(call => call.type === "upload");
  assert.equal(uploadCall.type, "upload");
  assert.match(uploadCall.input.objectPath, /^line-intakes\/[0-9a-f-]{36}\/[a-f0-9]{64}-invoice\.pdf$/);
  assert.equal(calls.find(call => call.type === "request" && call.options.method === "POST").options.method, "POST");
  assert.equal((await store.getForUser("cloud-intake-1", "U-cloud")).lineUserId, "U-cloud");
  const scanned = await store.updateScan("cloud-intake-1", { provider: "http", status: "needs_review", confidence: 0.8, fields: { vendorName: "ร้าน" }, warnings: [] });
  assert.equal(scanned.ocrStatus, "needs_review");
  assert.equal(scanned.ocrProvider, "http");
  const original = await store.readOriginal(scanned);
  assert.equal(original.bytes.toString(), "%PDF");
});
