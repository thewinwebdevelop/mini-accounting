import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import inventoryDb from "../forms/inventory-db.logic.js";
import customLabel from "../forms/shopee-custom-label.logic.js";

const { openInventoryDatabase, ensureInventorySchema } = inventoryDb;
const {
  aggregateManualSkus,
  createCustomLabelJob,
  getCustomLabelJob,
  loadCustomLabelMappings,
  normalizeMappingKey,
  parseCustomLabelUpload,
  pythonExecutable,
  saveCustomLabel,
  customLabelStorageObjectPath,
  saveCustomLabelMappings,
  validateBundle,
} = customLabel;

const FIXTURE = join(process.cwd(), "tests", "fixtures", "shopee-custom-label-sample.pdf");

async function sampleUpload(rootDir, options = {}) {
  return parseCustomLabelUpload(rootDir, {
    originalName: "shopee-labels.pdf",
    buffer: await readFile(FIXTURE),
  }, options);
}

test("custom label PDF commands use the Cloud Run Python virtualenv", () => {
  const previousPython = process.env.SWEET_HOUSE_PYTHON;
  const previousPythonBin = process.env.SWEET_HOUSE_PYTHON_BIN;
  try {
    delete process.env.SWEET_HOUSE_PYTHON_BIN;
    process.env.SWEET_HOUSE_PYTHON = "/opt/sweet-house-python/bin/python";
    assert.equal(pythonExecutable(), "/opt/sweet-house-python/bin/python");
  } finally {
    if (previousPython === undefined) delete process.env.SWEET_HOUSE_PYTHON;
    else process.env.SWEET_HOUSE_PYTHON = previousPython;
    if (previousPythonBin === undefined) delete process.env.SWEET_HOUSE_PYTHON_BIN;
    else process.env.SWEET_HOUSE_PYTHON_BIN = previousPythonBin;
  }
});

test("custom label artifacts use a stable storage path", () => {
  assert.equal(
    customLabelStorageObjectPath(42, "output"),
    "shopee-custom-labels/42/output.pdf",
  );
  assert.throws(() => customLabelStorageObjectPath("bad", "output"), /job/i);
  assert.throws(() => customLabelStorageObjectPath(42, "unknown"), /kind/i);
});

test("normalizeMappingKey converts Shopee Thai private-use tone glyphs and removes PDF markers", () => {
  const result = normalizeMappingKey("เส้ือแขนต\uf70cุกตาผ\uf70bา (cid:0)", "ฟ\uf70bา   ,   เฉพาะเส้ือ");

  assert.equal(result.productName, "เสื้อแขนตุ๊กตาผ้า");
  assert.equal(result.optionName, "ฟ้า , เฉพาะเสื้อ");
  assert.equal(result.key, "เสื้อแขนตุ๊กตาผ้า::ฟ้า , เฉพาะเสื้อ");
});

test("validateBundle accepts a non-empty positive bundle and rejects invalid rows", () => {
  assert.deepEqual(validateBundle([
    { sku: " dress-blue ", quantity: "1" },
    { sku: "SKIRT-LACE", quantity: 2 },
  ]), [
    { sku: "dress-blue", quantity: 1 },
    { sku: "SKIRT-LACE", quantity: 2 },
  ]);

  assert.throws(() => validateBundle([]), /bundle/i);
  assert.throws(() => validateBundle([{ sku: "", quantity: 1 }]), /sku/i);
  assert.throws(() => validateBundle([{ sku: "A", quantity: 0 }]), /quantity|จำนวน/i);
  assert.throws(() => validateBundle([{ sku: "A", quantity: 1.5 }]), /quantity|จำนวน/i);
});

test("aggregateManualSkus multiplies bundle quantities and merges duplicate SKUs in first-seen order", () => {
  assert.deepEqual(aggregateManualSkus([
    { quantity: 2, bundle: [{ sku: "A", quantity: 1 }, { sku: "B", quantity: 2 }] },
    { quantity: 1, bundle: [{ sku: "B", quantity: 1 }, { sku: "A", quantity: 3 }] },
  ]), [
    { sku: "A", quantity: 5 },
    { sku: "B", quantity: 5 },
  ]);
});

test("custom label schema creates job and mapping tables", () => {
  const db = openInventoryDatabase(join(tmpdir(), `sweet-house-custom-label-schema-${Date.now()}.sqlite`));
  try {
    ensureInventorySchema(db);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name);
    assert.ok(tables.includes("shopee_custom_label_jobs"));
    assert.ok(tables.includes("shopee_custom_label_mappings"));
  } finally {
    const dbPath = db.prepare("PRAGMA database_list").get().file;
    db.close();
    rm(dbPath, { force: true });
  }
});

test("saveCustomLabelMappings persists reusable bundle templates and an immutable job snapshot", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-custom-label-job-"));
  try {
    const job = createCustomLabelJob(rootDir, {
      originalFileName: "labels.pdf",
      sourceFilePath: join(rootDir, "source.pdf"),
      parsedPayload: {
        pages: [{
          pageNumber: 1,
          orderNo: "261016RBTADAXA",
          items: [{ productName: "ชุดเซต", optionName: "ฟ้า", quantity: 2, mappingKey: "ชุดเซต::ฟ้า" }],
        }],
      },
    }, { now: () => "2026-10-17T12:00:00.000Z" });

    const mappings = {
      "ชุดเซต::ฟ้า": {
        productName: "ชุดเซต",
        optionName: "ฟ้า",
        bundle: [{ sku: "TOP-BLUE", quantity: 1 }, { sku: "SKIRT-BLUE", quantity: 1 }],
      },
    };
    const saved = saveCustomLabelMappings(rootDir, job.id, mappings, {
      outputFilePath: join(rootDir, "output.pdf"),
      now: () => "2026-10-17T12:01:00.000Z",
    });

    assert.equal(saved.status, "saved");
    assert.deepEqual(loadCustomLabelMappings(rootDir, ["ชุดเซต::ฟ้า"]), {
      "ชุดเซต::ฟ้า": [
        { sku: "TOP-BLUE", quantity: 1 },
        { sku: "SKIRT-BLUE", quantity: 1 },
      ],
    });

    const loaded = getCustomLabelJob(rootDir, job.id);
    assert.equal(loaded.outputFilePath, join(rootDir, "output.pdf"));
    assert.deepEqual(loaded.savedMappings["ชุดเซต::ฟ้า"].bundle, mappings["ชุดเซต::ฟ้า"].bundle);

    const savedAgain = saveCustomLabelMappings(rootDir, job.id, mappings, {
      outputFilePath: join(rootDir, "output.pdf"),
      now: () => "2026-10-17T12:02:00.000Z",
    });
    assert.equal(savedAgain.id, job.id);
    const db = openInventoryDatabase(rootDir);
    try {
      assert.equal(db.prepare("SELECT COUNT(*) AS count FROM shopee_custom_label_jobs").get().count, 1);
      assert.equal(db.prepare("SELECT COUNT(*) AS count FROM shopee_custom_label_mappings").get().count, 1);
    } finally {
      db.close();
    }
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("parseCustomLabelUpload awaits an injected loader and stores its bundle in autofill", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-custom-label-loader-"));
  try {
    let requestedKeys;
    const bundle = [{ sku: "TOP-BLUE", quantity: 1 }, { sku: "SKIRT-LACE", quantity: 2 }];
    const job = await sampleUpload(rootDir, {
      mappingLoader: async (keys) => {
        requestedKeys = keys;
        return Object.fromEntries(keys.map((key) => [key, bundle]));
      },
    });
    const firstKey = job.parsedPayload.pages[0].items[0].mappingKey;

    assert.ok(requestedKeys.includes(firstKey));
    assert.deepEqual(job.parsedPayload.autofillMappings[firstKey], bundle);
    assert.deepEqual(getCustomLabelJob(rootDir, job.id).parsedPayload.autofillMappings[firstKey], bundle);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("saveCustomLabel sends normalized multi-SKU mappings to injected saver and keeps SQLite reusable mappings empty", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-custom-label-saver-"));
  try {
    const job = await sampleUpload(rootDir);
    const mappings = {};
    for (const page of job.parsedPayload.pages) {
      for (const item of page.items) {
        mappings[item.mappingKey] = {
          productName: item.productName,
          optionName: item.optionName,
          bundle: [{ sku: " TOP-BLUE ", quantity: "1" }, { sku: "SKIRT-LACE", quantity: "2" }],
        };
      }
    }
    let savedMappings;
    const saved = await saveCustomLabel(rootDir, job.id, mappings, {
      mappingSaver: async (normalizedMappings) => {
        await Promise.resolve();
        savedMappings = normalizedMappings;
      },
    });
    const firstKey = job.parsedPayload.pages[0].items[0].mappingKey;
    const expectedBundle = [{ sku: "TOP-BLUE", quantity: 1 }, { sku: "SKIRT-LACE", quantity: 2 }];

    assert.deepEqual(savedMappings[firstKey].bundle, expectedBundle);
    assert.equal(saved.status, "saved");
    assert.deepEqual(getCustomLabelJob(rootDir, job.id).savedMappings[firstKey].bundle, expectedBundle);
    const db = openInventoryDatabase(rootDir);
    try {
      assert.equal(db.prepare("SELECT COUNT(*) AS count FROM shopee_custom_label_mappings").get().count, 0);
    } finally {
      db.close();
    }
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});
