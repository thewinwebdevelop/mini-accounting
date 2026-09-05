const { openInventoryDatabase, ensureInventorySchema } = require("./inventory-db.logic.js");

const PLATFORM_VALUES = new Set(["shopee", "tiktok", "manual"]);
const HEADER_ALIASES = {
  platform: ["platform", "ช่องทาง", "แพลตฟอร์ม"],
  orderNo: ["order_no", "order id", "order number", "หมายเลขคำสั่งซื้อ"],
  lineNo: ["line_no", "line number", "item no", "ลำดับ"],
  saleSku: ["sale_sku", "seller sku", "sku", "รหัสสินค้า"],
  quantity: ["quantity", "qty", "จำนวน"],
  orderDate: ["order_date", "order date", "วันที่สั่งซื้อ"],
  orderStatus: ["status", "order status", "สถานะ"],
  displayName: ["display_name", "product name", "item name", "ชื่อสินค้า"],
  buyerName: ["buyer_name", "buyer name", "ชื่อลูกค้า", "ชื่อผู้ซื้อ"],
};

function cleanText(value) {
  return String(value ?? "").trim();
}

function normalizeHeader(value) {
  return cleanText(value).toLowerCase().replace(/\s+/g, " ");
}

function normalizePlatform(value) {
  const platform = normalizeHeader(value || "manual");
  if (!platform) return "manual";
  if (PLATFORM_VALUES.has(platform)) return platform;
  throw new Error("platform ไม่รองรับ");
}

function detectDelimiter(text) {
  const firstLine = text.split(/\r?\n/).find((line) => line.trim()) || "";
  return firstLine.includes("\t") ? "\t" : ",";
}

function parseDelimitedLine(line, delimiter) {
  const cells = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells.map(cleanText);
}

function buildHeaderMap(headers) {
  const normalized = headers.map(normalizeHeader);
  const map = {};
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    const index = normalized.findIndex((header) => aliases.includes(header));
    if (index >= 0) map[field] = index;
  }
  return map;
}

function cell(cells, map, field) {
  const index = map[field];
  return Number.isInteger(index) ? cleanText(cells[index]) : "";
}

function isSkippedStatus(status) {
  return /cancel|cancelled|canceled|refund|refunded|ยกเลิก|คืนเงิน/i.test(status || "");
}

function parsePlatformOrderFile(fileBuffer, options = {}) {
  const text = Buffer.isBuffer(fileBuffer) ? fileBuffer.toString("utf8") : String(fileBuffer ?? "");
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) throw new Error("ไฟล์ต้องมี header และข้อมูลอย่างน้อย 1 แถว");
  const delimiter = detectDelimiter(text);
  const headers = parseDelimitedLine(lines[0], delimiter);
  const headerMap = buildHeaderMap(headers);
  for (const required of ["orderNo", "saleSku", "quantity"]) {
    if (!Number.isInteger(headerMap[required])) throw new Error(`ไม่พบคอลัมน์ ${required}`);
  }

  const selectedPlatform = normalizePlatform(options.platform || "");
  const seen = new Set();
  const duplicateKeys = [];
  const perOrderCounts = new Map();
  const rows = lines.slice(1).map((line) => {
    const cells = parseDelimitedLine(line, delimiter);
    const platform = normalizePlatform(cell(cells, headerMap, "platform") || selectedPlatform);
    const orderNo = cell(cells, headerMap, "orderNo");
    const saleSku = cell(cells, headerMap, "saleSku");
    const orderCount = (perOrderCounts.get(orderNo) || 0) + 1;
    perOrderCounts.set(orderNo, orderCount);
    const lineNo = cell(cells, headerMap, "lineNo") || String(orderCount);
    const quantity = Number.parseInt(cell(cells, headerMap, "quantity"), 10);
    const key = `${platform}:${orderNo}:${lineNo}:${saleSku}`;
    if (seen.has(key)) duplicateKeys.push(key);
    seen.add(key);
    const orderStatus = cell(cells, headerMap, "orderStatus");
    return {
      platform,
      orderNo,
      lineNo,
      saleSku,
      quantity: Number.isFinite(quantity) ? quantity : 0,
      orderDate: cell(cells, headerMap, "orderDate"),
      orderStatus,
      displayName: cell(cells, headerMap, "displayName"),
      buyerName: cell(cells, headerMap, "buyerName"),
      skipped: isSkippedStatus(orderStatus),
    };
  });

  return { rows, duplicateKeys };
}

module.exports = {
  normalizePlatform,
  parsePlatformOrderFile,
};
