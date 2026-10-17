const { openInventoryDatabase, ensureInventorySchema } = require("./inventory-db.logic.js");

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

      const parsedPayload = JSON.parse(job.parsed_payload_json || "{}");
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

module.exports = {
  aggregateManualSkus,
  createCustomLabelJob,
  getCustomLabelJob,
  loadCustomLabelMappings,
  normalizeMappingKey,
  normalizeMappingText,
  saveCustomLabelMappings,
  validateBundle,
};
