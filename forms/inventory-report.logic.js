const { execFile } = require("node:child_process");
const { existsSync } = require("node:fs");
const { mkdtemp, readFile, rm, writeFile } = require("node:fs/promises");
const { homedir, tmpdir } = require("node:os");
const path = require("node:path");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);
const pdfScriptPath = path.join(__dirname, "..", "scripts", "generate_inventory_stock_pdf.py");

function getPythonExecutable() {
  const bundledPython = path.join(
    homedir(),
    ".cache",
    "codex-runtimes",
    "codex-primary-runtime",
    "dependencies",
    "python",
    "bin",
    "python3",
  );
  return existsSync(bundledPython) ? bundledPython : "python3";
}

async function generateCurrentStockPdf({ company, summary, balances }) {
  const tempDir = await mkdtemp(path.join(tmpdir(), "sweet-house-stock-pdf-"));
  const payloadPath = path.join(tempDir, "current-stock.json");
  const outputPath = path.join(tempDir, "current-stock.pdf");

  try {
    await writeFile(payloadPath, `${JSON.stringify({ company, summary, balances }, null, 2)}\n`, "utf8");
    await execFileAsync(getPythonExecutable(), [pdfScriptPath, "--input", payloadPath, "--output", outputPath], {
      maxBuffer: 1024 * 1024,
    });
    return await readFile(outputPath);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

module.exports = {
  generateCurrentStockPdf,
};
