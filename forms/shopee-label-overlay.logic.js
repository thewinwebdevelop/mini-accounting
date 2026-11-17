const { mkdtemp, readFile, rm, writeFile } = require("node:fs/promises");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const os = require("node:os");
const path = require("node:path");
const { buildBatchOverlays } = require("./shopee-shipment.logic.js");

const execFileAsync = promisify(execFile);

async function renderShipmentLabelOverlay({ batch, sourcePdf, mappings, pythonBin, overlayScript } = {}) {
  if (!batch?.id || !Array.isArray(batch.orders) || !batch.orders.length) throw new Error("Shipment batch has no orders");
  if (!Buffer.isBuffer(sourcePdf) || !sourcePdf.length) throw new Error("Shipping document is empty");
  const overlays = buildBatchOverlays(batch.orders, mappings || {});
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "sweet-house-shipment-overlay-"));
  try {
    const inputPath = path.join(temporaryDirectory, "shipping-document.pdf");
    const outputPath = path.join(temporaryDirectory, "shipping-labels.pdf");
    const overlayPath = path.join(temporaryDirectory, "overlay.json");
    await writeFile(inputPath, sourcePdf);
    await writeFile(overlayPath, JSON.stringify(overlays), "utf8");
    await execFileAsync(pythonBin || process.env.SWEET_HOUSE_PYTHON_BIN || "python3", [
      overlayScript || path.join(__dirname, "..", "scripts", "overlay_shipping_label.py"),
      "--input", inputPath, "--output", outputPath, "--overlay-json", overlayPath,
    ], { maxBuffer: 1024 * 1024 });
    return { body: await readFile(outputPath), pages: batch.orders.map((order, index) => ({ page: index + 1, orderId: order.platformOrderId, orderNo: order.orderNo })) };
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

module.exports = { renderShipmentLabelOverlay };
