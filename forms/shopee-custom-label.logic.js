const { execFile } = require("node:child_process");
const { existsSync } = require("node:fs");
const { mkdir, readFile, writeFile } = require("node:fs/promises");
const path = require("node:path");
const { promisify } = require("node:util");
const { randomUUID } = require("node:crypto");
const { openInventoryDatabase, ensureInventorySchema } = require("./inventory-db.logic.js");

const execFileAsync = promisify(execFile);

const PRIVATE_USE_THAI_TONE_MAP = {
  "\uf70a": "่",
  "\uf70b": "้",
  "\uf70c": "๊",
  "\uf70d": "๋",
};

function cleanText(value) {
  return String(value ?? "").trim();
}

function normalizeMappingText(value) {
  return cleanText(value)
    .replace(/\(cid:\d+\)/gi, " ")
    .replace(/[\uf70a\uf70b\uf70c\uf70d]/g, (char) => PRIVATE_USE_THAI_TONE_MAP[char] || char)
    .normalize("NFC")
    .replace(/([เ-ไก-ฮ])([่้๊๋])([ิีึืูุ])([ก-ฮ])/g, "$1$3$2$4")
    .replace(/([ก-ฮ])([่้๊๋])([ุู])/g, "$1$3$2")
    .replace(/[\u00a0\t\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeMappingKey(productName, optionName) {
  const normalizedProductName = normalizeMappingText(productName);
  const normalizedOptionName = normalizeMappingText(optionName);
  if (!normalizedProductName || !normalizedOptionName) {
    throw new Error("ชื่อสินค้าและตัวเลือกสินค้าต้องไม่ว่าง");
  }
  return {
    productName: normalizedProductName,
    optionName: normalizedOptionName,
    key: `${normalizedProductName}::${normalizedOptionName}`,
  };
}

function parsePositiveInteger(value, fieldName) {
  const normalized = cleanText(value);
  if (!/^[1-9]\d*$/.test(normalized)) {
    throw new Error(`${fieldName} ต้องเป็นจำนวนเต็มบวก`);
  }
  return Number.parseInt(normalized, 10);
}

function validateBundle(bundle) {
  if (!Array.isArray(bundle) || bundle.length === 0) {
    throw new Error("bundle ต้องมี manual SKU อย่างน้อยหนึ่งรายการ");
  }
  return bundle.map((row, index) => {
    const sku = cleanText(row?.sku);
    if (!sku) throw new Error(`bundle row ${index + 1} ต้องมี SKU`);
    return {
      sku,
      quantity: parsePositiveInteger(row?.quantity, `จำนวนของ ${sku}`),
    };
  });
}

function aggregateManualSkus(lines) {
  const totals = new Map();
  for (const line of lines || []) {
    const lineQuantity = parsePositiveInteger(line?.quantity, "จำนวนสินค้า");
    const bundle = validateBundle(line?.bundle);
    for (const component of bundle) {
      const key = component.sku.toUpperCase();
      const current = totals.get(key);
      if (current) {
        current.quantity += lineQuantity * component.quantity;
      } else {
        totals.set(key, {
          sku: component.sku,
          quantity: lineQuantity * component.quantity,
        });
      }
    }
  }
  return [...totals.values()];
}

function nowIso(options = {}) {
  return options.now ? options.now() : new Date().toISOString();
}

function withDatabase(rootDir, callback) {
  const db = openInventoryDatabase(rootDir);
  ensureInventorySchema(db);
  try {
    return callback(db);
  } finally {
    db.close();
  }
}

function mapJob(row) {
  if (!row) return null;
  let parsedPayload = {};
  try {
    parsedPayload = JSON.parse(row.parsed_payload_json || "{}");
  } catch {
    parsedPayload = {};
  }
  return {
    id: row.id,
    originalFileName: row.original_file_name,
    sourceFilePath: row.source_file_path,
    previewFilePath: row.preview_file_path,
    outputFilePath: row.output_file_path,
    pageCount: row.page_count,
    parsedPayload,
    savedMappings: parsedPayload.savedMappings || {},
    status: row.status,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function createCustomLabelJob(rootDir, payload = {}, options = {}) {
  return withDatabase(rootDir, (db) => {
    const timestamp = nowIso(options);
    const parsedPayload = payload.parsedPayload || {};
    const row = db.prepare(`
      INSERT INTO shopee_custom_label_jobs (
        original_file_name, source_file_path, preview_file_path, output_file_path,
        page_count, parsed_payload_json, status, error_message, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, 'parsed', '', ?, ?)
      RETURNING *
    `).get(
      cleanText(payload.originalFileName),
      cleanText(payload.sourceFilePath),
      cleanText(payload.previewFilePath),
      cleanText(payload.outputFilePath),
      Number(payload.pageCount ?? parsedPayload.pages?.length ?? 0),
      JSON.stringify(parsedPayload),
      timestamp,
      timestamp,
    );
    return mapJob(row);
  });
}

function getCustomLabelJob(rootDir, jobId) {
  return withDatabase(rootDir, (db) => mapJob(
    db.prepare("SELECT * FROM shopee_custom_label_jobs WHERE id = ?").get(Number(jobId)),
  ));
}

function loadCustomLabelMappings(rootDir, keys = []) {
  return withDatabase(rootDir, (db) => {
    const rows = db.prepare("SELECT * FROM shopee_custom_label_mappings ORDER BY id ASC").all();
    const requested = new Set(keys.map(cleanText).filter(Boolean));
    const result = {};
    for (const row of rows) {
      const key = `${row.product_name_key}::${row.option_name_key}`;
      if (requested.size && !requested.has(key)) continue;
      try {
        result[key] = JSON.parse(row.bundle_json || "[]");
      } catch {
        result[key] = [];
      }
    }
    return result;
  });
}

function normalizeSavedMappings(mappings) {
  if (!mappings || typeof mappings !== "object" || Array.isArray(mappings)) {
    throw new Error("mappings ไม่ถูกต้อง");
  }
  const result = {};
  for (const [fallbackKey, value] of Object.entries(mappings)) {
    const keyParts = fallbackKey.split("::");
    const names = normalizeMappingKey(value?.productName || keyParts[0], value?.optionName || keyParts.slice(1).join("::"));
    const bundle = validateBundle(value?.bundle || value);
    result[names.key] = {
      productName: names.productName,
      optionName: names.optionName,
      bundle,
    };
  }
  return result;
}

function saveCustomLabelMappings(rootDir, jobId, mappings, options = {}) {
  return withDatabase(rootDir, (db) => {
    const job = db.prepare("SELECT * FROM shopee_custom_label_jobs WHERE id = ?").get(Number(jobId));
    if (!job) throw new Error("ไม่พบ custom label job");
    const normalizedMappings = normalizeSavedMappings(mappings);
    const timestamp = nowIso(options);
    db.exec("BEGIN");
    try {
      const upsert = db.prepare(`
        INSERT INTO shopee_custom_label_mappings (
          product_name_key, option_name_key, product_name_display,
          option_name_display, bundle_json, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(product_name_key, option_name_key) DO UPDATE SET
          product_name_display = excluded.product_name_display,
          option_name_display = excluded.option_name_display,
          bundle_json = excluded.bundle_json,
          updated_at = excluded.updated_at
      `);
      for (const mapping of Object.values(normalizedMappings)) {
        upsert.run(
          mapping.productName,
          mapping.optionName,
          mapping.productName,
          mapping.optionName,
          JSON.stringify(mapping.bundle),
          timestamp,
          timestamp,
        );
      }

      const parsedPayload = options.parsedPayload || JSON.parse(job.parsed_payload_json || "{}");
      parsedPayload.savedMappings = normalizedMappings;
      const updated = db.prepare(`
        UPDATE shopee_custom_label_jobs
        SET output_file_path = ?, parsed_payload_json = ?, status = 'saved', updated_at = ?, error_message = ''
        WHERE id = ?
        RETURNING *
      `).get(
        cleanText(options.outputFilePath),
        JSON.stringify(parsedPayload),
        timestamp,
        Number(jobId),
      );
      db.exec("COMMIT");
      return mapJob(updated);
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  });
}

function pythonExecutable(options = {}) {
  const configured = options.pythonBin || process.env.SWEET_HOUSE_PYTHON_BIN;
  if (configured) return configured;
  const bundled = "/Users/tar/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3";
  return existsSync(bundled) ? bundled : "python3";
}

function customLabelScriptPath() {
  return path.join(__dirname, "..", "scripts", "shopee_custom_label_pdf.py");
}

function assertPdfBuffer(file) {
  if (!file?.buffer?.length) throw new Error("เลือกไฟล์ PDF ใบปะหน้า Shopee");
  if (!file.buffer.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
    throw new Error("ไฟล์ที่อัปโหลดไม่ใช่ PDF ที่ถูกต้อง");
  }
}

function jobDirectory(rootDir, job) {
  const storageRoot = path.resolve(rootDir, "data", "shopee-custom-labels");
  const directory = path.resolve(path.dirname(job.sourceFilePath));
  if (!directory.startsWith(`${storageRoot}${path.sep}`)) {
    throw new Error("custom label file path ไม่ถูกต้อง");
  }
  return directory;
}

async function runPdfCommand(args, options = {}) {
  try {
    await execFileAsync(pythonExecutable(options), [customLabelScriptPath(), ...args], {
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch (error) {
    const detail = String(error?.stderr || error?.message || "").trim();
    throw new Error(detail || "ไม่สามารถประมวลผลไฟล์ PDF ใบปะหน้า Shopee ได้");
  }
}

function pagePayloadSource(job, options = {}) {
  return options.parsedPayload || job.parsedPayload || {};
}

function buildPagePayloads(job, mappings, options = {}) {
  const parsedPayload = pagePayloadSource(job, options);
  const pages = Array.isArray(parsedPayload.pages) ? parsedPayload.pages : [];
  if (!pages.length) throw new Error("ไม่พบข้อมูลรายการสินค้าในไฟล์ PDF");
  if (!mappings || typeof mappings !== "object" || Array.isArray(mappings)) {
    throw new Error("กรุณากรอก manual SKU ให้ครบทุกรายการ");
  }

  const normalizedMappings = {};
  const pagePayloads = pages.map((page) => {
    if (page.status === "needs_review") {
      throw new Error(`กรุณาตรวจสอบรายการสินค้าในหน้า ${page.pageNumber} ก่อนดำเนินการต่อ`);
    }
    const manualLines = (page.items || []).map((item) => {
      const mapping = mappings[item.mappingKey];
      if (!mapping) throw new Error(`ยังไม่มี manual SKU สำหรับ ${item.productName} / ${item.optionName}`);
      const names = normalizeMappingKey(
        mapping.productName || item.productName,
        mapping.optionName || item.optionName,
      );
      const bundle = validateBundle(mapping.bundle || mapping);
      normalizedMappings[names.key] = {
        productName: names.productName,
        optionName: names.optionName,
        bundle,
      };
      return { quantity: item.quantity, bundle };
    });
    return {
      pageNumber: page.pageNumber,
      orderNo: page.orderNo,
      manualRows: aggregateManualSkus(manualLines),
    };
  });
  return { normalizedMappings, pagePayloads, parsedPayload };
}

async function parseCustomLabelUpload(rootDir, file, options = {}) {
  assertPdfBuffer(file);
  const id = randomUUID();
  const directory = path.resolve(rootDir, "data", "shopee-custom-labels", id);
  await mkdir(directory, { recursive: true });
  const sourceFilePath = path.join(directory, "source.pdf");
  const parsedFilePath = path.join(directory, "parsed.json");
  await writeFile(sourceFilePath, file.buffer);
  await runPdfCommand(["parse", "--input", sourceFilePath, "--output", parsedFilePath], options);
  const parsedPayload = JSON.parse(await readFile(parsedFilePath, "utf8"));
  const keys = (parsedPayload.pages || []).flatMap((page) => (page.items || []).map((item) => item.mappingKey));
  parsedPayload.autofillMappings = loadCustomLabelMappings(rootDir, keys);
  return createCustomLabelJob(rootDir, {
    originalFileName: file.originalName || file.filename || "shopee-labels.pdf",
    sourceFilePath,
    pageCount: parsedPayload.pages?.length || 0,
    parsedPayload,
  });
}

async function renderCustomLabelJob(rootDir, job, mappings, fileName, options = {}) {
  const { normalizedMappings, pagePayloads, parsedPayload } = buildPagePayloads(job, mappings, options);
  const directory = jobDirectory(rootDir, job);
  const payloadFilePath = path.join(directory, "render-payload.json");
  const outputFilePath = path.join(directory, fileName);
  await writeFile(payloadFilePath, JSON.stringify({ pages: pagePayloads }, null, 2), "utf8");
  await runPdfCommand([
    "render",
    "--input", job.sourceFilePath,
    "--output", outputFilePath,
    "--payload", payloadFilePath,
  ], options);
  return { normalizedMappings, parsedPayload, outputFilePath };
}

function updateCustomLabelPreview(rootDir, jobId, previewFilePath, options = {}) {
  return withDatabase(rootDir, (db) => {
    const timestamp = nowIso(options);
    const updated = db.prepare(`
      UPDATE shopee_custom_label_jobs
      SET preview_file_path = ?, status = 'previewed', updated_at = ?, error_message = ''
      WHERE id = ?
      RETURNING *
    `).get(cleanText(previewFilePath), timestamp, Number(jobId));
    if (!updated) throw new Error("ไม่พบ custom label job");
    return mapJob(updated);
  });
}

async function previewCustomLabel(rootDir, jobId, mappings, options = {}) {
  const job = getCustomLabelJob(rootDir, jobId);
  if (!job) throw new Error("ไม่พบ custom label job");
  const result = await renderCustomLabelJob(rootDir, job, mappings, "preview.pdf", options);
  return updateCustomLabelPreview(rootDir, jobId, result.outputFilePath, options);
}

async function saveCustomLabel(rootDir, jobId, mappings, options = {}) {
  const job = getCustomLabelJob(rootDir, jobId);
  if (!job) throw new Error("ไม่พบ custom label job");
  const result = await renderCustomLabelJob(rootDir, job, mappings, "output.pdf", options);
  return saveCustomLabelMappings(rootDir, jobId, result.normalizedMappings, {
    ...options,
    outputFilePath: result.outputFilePath,
    parsedPayload: result.parsedPayload,
  });
}

async function createCustomLabelComparison(rootDir, jobId, options = {}) {
  const job = getCustomLabelJob(rootDir, jobId);
  if (!job) throw new Error("ไม่พบ custom label job");
  const generatedPath = job.outputFilePath || job.previewFilePath;
  if (!generatedPath) throw new Error("กรุณาสร้าง Preview หรือ Save PDF ก่อนเปิดไฟล์เทียบ");
  const outputPath = path.join(jobDirectory(rootDir, job), "comparison.pdf");
  await runPdfCommand([
    "compare",
    "--original", job.sourceFilePath,
    "--generated", generatedPath,
    "--output", outputPath,
  ], options);
  return {
    path: outputPath,
    fileName: "shopee-custom-label-comparison.pdf",
  };
}

function getCustomLabelFile(rootDir, jobId, kind) {
  const job = getCustomLabelJob(rootDir, jobId);
  if (!job) throw new Error("ไม่พบ custom label job");
  const filePath = kind === "source" ? job.sourceFilePath
    : kind === "preview" ? job.previewFilePath
      : kind === "output" ? job.outputFilePath : "";
  if (!filePath) throw new Error("ยังไม่มีไฟล์ที่ร้องขอ");
  const directory = jobDirectory(rootDir, job);
  const absolutePath = path.resolve(filePath);
  if (!absolutePath.startsWith(`${directory}${path.sep}`) || !existsSync(absolutePath)) {
    throw new Error("ไม่พบไฟล์ที่ร้องขอ");
  }
  return {
    path: absolutePath,
    fileName: kind === "source" ? job.originalFileName || "source.pdf" : `${kind}.pdf`,
  };
}

module.exports = {
  aggregateManualSkus,
  createCustomLabelJob,
  createCustomLabelComparison,
  getCustomLabelJob,
  getCustomLabelFile,
  loadCustomLabelMappings,
  normalizeMappingKey,
  normalizeMappingText,
  parseCustomLabelUpload,
  previewCustomLabel,
  saveCustomLabel,
  saveCustomLabelMappings,
  validateBundle,
};
