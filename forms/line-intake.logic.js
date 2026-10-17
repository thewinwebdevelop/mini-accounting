const { createHash, randomUUID } = require("node:crypto");
const { mkdir, readFile, writeFile } = require("node:fs/promises");
const path = require("node:path");
const { createSupabaseAdminClient, supabaseRequest } = require("./supabase.logic.js");
const { createSupabaseStorageClient, downloadStorageObject, uploadStorageObject } = require("./supabase-storage.logic.js");

function intakeError(code, message) {
  return Object.assign(new Error(message), { code });
}

function safeFileName(name) {
  const basename = path.basename(String(name || "upload.bin")).replace(/[^\p{L}\p{N}._-]+/gu, "_");
  return basename.slice(0, 120) || "upload.bin";
}

function createLocalLineIntakeStore({ rootDir, maxBytes = 20 * 1024 * 1024 } = {}) {
  if (!rootDir) throw new Error("rootDir is required");
  const baseDir = path.join(rootDir, "data", "line-intakes");
  const indexPath = path.join(baseDir, "index.json");

  async function ensureBase() {
    await mkdir(baseDir, { recursive: true });
  }

  async function readIndex() {
    await ensureBase();
    try { return JSON.parse(await readFile(indexPath, "utf8")); } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
  }

  async function writeIndex(items) {
    await writeFile(indexPath, JSON.stringify(items, null, 2), "utf8");
  }

  async function create({ eventId, messageId, lineUserId, mediaKind, originalName, contentType, bytes, now = () => new Date().toISOString() }) {
    const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || []);
    if (buffer.length > maxBytes) throw intakeError("LINE_INTAKE_TOO_LARGE", "ไฟล์มีขนาดใหญ่เกินกว่าที่ระบบรับได้");
    const items = await readIndex();
    const duplicate = items.find(item => (eventId && item.eventId === eventId) || (messageId && item.messageId === messageId));
    if (duplicate) return { created: false, item: duplicate };

    const id = randomUUID();
    const sha256 = createHash("sha256").update(buffer).digest("hex");
    const itemDir = path.join(baseDir, id);
    await mkdir(itemDir, { recursive: true });
    const storagePath = path.join(itemDir, `${sha256}-${safeFileName(originalName)}`);
    await writeFile(storagePath, buffer, { flag: "wx" });
    const timestamp = now();
    const item = {
      id, eventId: String(eventId || ""), messageId: String(messageId || ""), lineUserId: String(lineUserId || ""),
      mediaKind, originalName: safeFileName(originalName), contentType: String(contentType || ""),
      byteSize: buffer.length, sha256, storagePath, status: "needs_confirmation",
      extractedPayload: {}, duplicateSourceKeys: [], ocrStatus: "pending", ocrProvider: "", ocrConfidence: 0, ocrWarnings: [], ocrError: "",
      createdAt: timestamp, updatedAt: timestamp,
    };
    items.push(item);
    await writeIndex(items);
    return { created: true, item };
  }

  async function get(id) {
    return (await readIndex()).find(item => item.id === id) || null;
  }

  async function getForUser(id, lineUserId, { privileged = false } = {}) {
    const item = await get(id);
    if (!item) throw intakeError("LINE_INTAKE_NOT_FOUND", "ไม่พบรายการไฟล์จาก LINE");
    if (!privileged && lineUserId && item.lineUserId !== lineUserId) throw intakeError("LINE_INTAKE_FORBIDDEN", "ไม่มีสิทธิ์เข้าถึงรายการนี้");
    return item;
  }

  async function readOriginal(item) {
    const absolutePath = path.resolve(String(item?.storagePath || ""));
    if (!absolutePath.startsWith(`${baseDir}${path.sep}`)) throw intakeError("LINE_INTAKE_STORAGE_INVALID", "ที่อยู่ไฟล์ intake ไม่ถูกต้อง");
    return { bytes: await readFile(absolutePath), contentType: item.contentType, fileName: item.originalName };
  }

  async function updateScan(id, scan = {}) {
    const items = await readIndex();
    const index = items.findIndex(item => item.id === id);
    if (index < 0) throw intakeError("LINE_INTAKE_NOT_FOUND", "ไม่พบรายการไฟล์จาก LINE");
    const updated = {
      ...items[index], ocrStatus: String(scan.status || "failed"), ocrProvider: String(scan.provider || ""),
      ocrConfidence: Number.isFinite(Number(scan.confidence)) ? Number(scan.confidence) : 0,
      ocrWarnings: Array.isArray(scan.warnings) ? scan.warnings : [], ocrError: String(scan.error || ""),
      extractedPayload: { fields: scan.fields && typeof scan.fields === "object" ? scan.fields : {}, warnings: Array.isArray(scan.warnings) ? scan.warnings : [] },
      updatedAt: new Date().toISOString(),
    };
    items[index] = updated;
    await writeIndex(items);
    return updated;
  }

  async function transition(id, status, { lineUserId = "", privileged = false, metadata = {}, now = () => new Date().toISOString() } = {}) {
    const items = await readIndex();
    const index = items.findIndex(item => item.id === id);
    if (index < 0) throw intakeError("LINE_INTAKE_NOT_FOUND", "ไม่พบรายการไฟล์จาก LINE");
    const item = items[index];
    if (!privileged && lineUserId && item.lineUserId !== lineUserId) throw intakeError("LINE_INTAKE_FORBIDDEN", "ไม่มีสิทธิ์ดำเนินการ");
    const allowed = { needs_confirmation: ["confirmed", "cancelled"], confirmed: [] };
    if (!allowed[item.status]?.includes(status)) throw intakeError("LINE_INTAKE_INVALID_TRANSITION", "สถานะรายการไม่รองรับการเปลี่ยนแปลงนี้");
    const updated = { ...item, ...metadata, status, updatedAt: now(), ...(status === "cancelled" ? { cancelledAt: now() } : {}), ...(status === "confirmed" ? { confirmedAt: now() } : {}) };
    items[index] = updated;
    await writeIndex(items);
    return updated;
  }

  return { create, get, getForUser, readOriginal, updateScan, transition };
}

function cloudItemFromRow(row = {}) {
  return {
    id: String(row.id || ""), eventId: String(row.event_id || ""), messageId: String(row.message_id || ""),
    lineUserId: String(row.line_user_id || ""), mediaKind: String(row.media_kind || ""),
    originalName: String(row.original_name || ""), contentType: String(row.content_type || ""),
    byteSize: Number(row.byte_size || 0), sha256: String(row.sha256 || ""),
    storageBucket: String(row.storage_bucket || ""), objectPath: String(row.object_path || ""),
    status: String(row.status || ""), extractedPayload: row.extracted_payload || {},
    duplicateSourceKeys: row.duplicate_source_keys || [], createdAt: row.created_at || "", updatedAt: row.updated_at || "",
    ocrStatus: String(row.ocr_status || "pending"), ocrProvider: String(row.ocr_provider || ""), ocrConfidence: Number(row.ocr_confidence || 0),
    ocrWarnings: Array.isArray(row.ocr_warnings) ? row.ocr_warnings : [], ocrError: String(row.ocr_error || ""),
    ...(row.created_document ? { createdDocument: row.created_document } : {}),
    ...(row.created_document_no ? { createdDocumentNo: String(row.created_document_no) } : {}),
    ...(row.cancelled_at ? { cancelledAt: row.cancelled_at } : {}),
    ...(row.confirmed_at ? { confirmedAt: row.confirmed_at } : {}),
  };
}

function createSupabaseLineIntakeStore({
  client,
  storageClient,
  bucket = "sweet-house-files",
  maxBytes = 20 * 1024 * 1024,
  request = supabaseRequest,
  uploadObject = uploadStorageObject,
  downloadObject,
  now = () => new Date().toISOString(),
} = {}) {
  if (!client || !storageClient) throw new Error("Supabase LINE intake clients are required");

  async function findBy(route) {
    const rows = await request(client, route);
    return Array.isArray(rows) ? rows[0] || null : null;
  }

  async function create({ eventId, messageId, lineUserId, mediaKind, originalName, contentType, bytes }) {
    const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || []);
    if (buffer.length > maxBytes) throw intakeError("LINE_INTAKE_TOO_LARGE", "ไฟล์มีขนาดใหญ่เกินกว่าที่ระบบรับได้");
    const existing = (eventId && await findBy(`/rest/v1/line_intake_items?event_id=eq.${encodeURIComponent(eventId)}&limit=1`))
      || (messageId && await findBy(`/rest/v1/line_intake_items?message_id=eq.${encodeURIComponent(messageId)}&limit=1`));
    if (existing) return { created: false, item: cloudItemFromRow(existing) };
    const id = randomUUID();
    const sha256 = createHash("sha256").update(buffer).digest("hex");
    const objectPath = `line-intakes/${id}/${sha256}-${safeFileName(originalName)}`;
    await uploadObject(storageClient, { objectPath, body: buffer, contentType });
    const timestamp = now();
    const response = await request(client, "/rest/v1/line_intake_items", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: {
        id, event_id: String(eventId || ""), message_id: String(messageId || ""), line_user_id: String(lineUserId || ""),
        media_kind: mediaKind, original_name: safeFileName(originalName), content_type: contentType,
        byte_size: buffer.length, sha256, storage_bucket: bucket, object_path: objectPath,
        status: "needs_confirmation", extracted_payload: {}, duplicate_source_keys: [], created_at: timestamp, updated_at: timestamp,
        ocr_status: "pending", ocr_provider: "", ocr_confidence: 0, ocr_warnings: [], ocr_error: "",
      },
    });
    const row = Array.isArray(response) ? response[0] : response;
    return { created: true, item: cloudItemFromRow(row) };
  }

  async function get(id) {
    const row = await findBy(`/rest/v1/line_intake_items?id=eq.${encodeURIComponent(id)}&limit=1`);
    return row ? cloudItemFromRow(row) : null;
  }

  async function getForUser(id, lineUserId, { privileged = false } = {}) {
    const item = await get(id);
    if (!item) throw intakeError("LINE_INTAKE_NOT_FOUND", "ไม่พบรายการไฟล์จาก LINE");
    if (!privileged && lineUserId && item.lineUserId !== lineUserId) throw intakeError("LINE_INTAKE_FORBIDDEN", "ไม่มีสิทธิ์เข้าถึงรายการนี้");
    return item;
  }

  async function readOriginal(item) {
    if (!item?.objectPath || typeof downloadObject !== "function") throw intakeError("LINE_INTAKE_STORAGE_INVALID", "ไม่พบไฟล์ต้นฉบับใน Storage");
    return { bytes: Buffer.from(await downloadObject(storageClient, item.objectPath)), contentType: item.contentType, fileName: item.originalName };
  }

  async function updateScan(id, scan = {}) {
    const timestamp = now();
    const response = await request(client, `/rest/v1/line_intake_items?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH", headers: { Prefer: "return=representation" },
      body: {
        ocr_provider: String(scan.provider || ""), ocr_status: String(scan.status || "failed"),
        ocr_confidence: Number.isFinite(Number(scan.confidence)) ? Number(scan.confidence) : 0,
        ocr_warnings: Array.isArray(scan.warnings) ? scan.warnings : [], ocr_error: String(scan.error || ""),
        extracted_payload: { fields: scan.fields && typeof scan.fields === "object" ? scan.fields : {}, warnings: Array.isArray(scan.warnings) ? scan.warnings : [] },
        updated_at: timestamp,
      },
    });
    return cloudItemFromRow(Array.isArray(response) ? response[0] : response);
  }

  async function transition(id, status, { lineUserId = "", privileged = false, metadata = {} } = {}) {
    const current = await getForUser(id, lineUserId, { privileged });
    const allowed = { needs_confirmation: ["confirmed", "cancelled"], confirmed: [] };
    if (!allowed[current.status]?.includes(status)) throw intakeError("LINE_INTAKE_INVALID_TRANSITION", "สถานะรายการไม่รองรับการเปลี่ยนแปลงนี้");
    const timestamp = now();
    const response = await request(client, `/rest/v1/line_intake_items?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH", headers: { Prefer: "return=representation" },
      body: { status, updated_at: timestamp, ...(metadata.createdDocument ? { created_document: metadata.createdDocument } : {}), ...(metadata.createdDocumentNo ? { created_document_no: metadata.createdDocumentNo } : {}), ...(status === "cancelled" ? { cancelled_at: timestamp } : {}), ...(status === "confirmed" ? { confirmed_at: timestamp } : {}) },
    });
    const row = Array.isArray(response) ? response[0] : response;
    return cloudItemFromRow(row || { ...current, status, updated_at: timestamp });
  }

  return { create, get, getForUser, readOriginal, updateScan, transition };
}

function createConfiguredLineIntakeStore({ rootDir, env = process.env, maxBytes } = {}) {
  const backend = String(env.LINE_INTAKE_BACKEND || "local").trim().toLowerCase();
  if (backend === "local") return createLocalLineIntakeStore({ rootDir, maxBytes });
  if (backend !== "supabase") throw intakeError("LINE_INTAKE_BACKEND_INVALID", "LINE intake backend ไม่ถูกต้อง");
  const client = createSupabaseAdminClient({ url: env.SUPABASE_URL, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY });
  const storageClient = createSupabaseStorageClient({ url: env.SUPABASE_URL, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY, bucket: env.SUPABASE_STORAGE_BUCKET });
  return createSupabaseLineIntakeStore({ client, storageClient, bucket: storageClient.bucket, maxBytes, downloadObject: downloadStorageObject });
}

module.exports = { createConfiguredLineIntakeStore, createLocalLineIntakeStore, createSupabaseLineIntakeStore, safeFileName };
