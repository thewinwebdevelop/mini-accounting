import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { collectStorageManifest } = await import("../scripts/migrate-local-files-to-supabase.mjs");

async function makeFixture() {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-storage-") );
  await mkdir(join(rootDir, "documents", "2026", "09", "REQ-1", "pdf"), { recursive: true });
  await mkdir(join(rootDir, "documents", "2026", "09", "REQ-1", "raw"), { recursive: true });
  await mkdir(join(rootDir, "data", "inventory-images", "products"), { recursive: true });
  await writeFile(join(rootDir, "documents", "2026", "09", "REQ-1", "data.json"), "{\"ok\":true}\n");
  await writeFile(join(rootDir, "documents", "2026", "09", "REQ-1", "pdf", "receipt.pdf"), Buffer.from("pdf"));
  await writeFile(join(rootDir, "documents", "2026", "09", "REQ-1", "raw", "slip.txt"), "raw evidence\n");
  await writeFile(join(rootDir, "data", "inventory-images", "products", "product-1.png"), Buffer.from([137, 80, 78, 71]));
  return rootDir;
}

test("collectStorageManifest returns stable ordered records with hashes and content types", async () => {
  const rootDir = await makeFixture();
  try {
    const records = await collectStorageManifest({ rootDir });
    assert.deepEqual(records.map(record => record.sourceKey), [
      "file:data/inventory-images/products/product-1.png",
      "file:documents/2026/09/REQ-1/data.json",
      "file:documents/2026/09/REQ-1/pdf/receipt.pdf",
      "file:documents/2026/09/REQ-1/raw/slip.txt",
    ]);
    const pdf = records.find(record => record.objectPath.endsWith("receipt.pdf"));
    assert.equal(pdf.contentType, "application/pdf");
    assert.equal(pdf.byteSize, 3);
    assert.match(pdf.sourceSha256, /^[a-f0-9]{64}$/);
    assert.equal(pdf.objectPath, "documents/2026/09/REQ-1/pdf/receipt.pdf");
    assert.equal(await readFile(pdf.absolutePath, "utf8"), "pdf");
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("collectStorageManifest rejects symlinks under approved roots", async () => {
  const rootDir = await makeFixture();
  try {
    await symlink(join(rootDir, "documents", "2026", "09", "REQ-1", "data.json"), join(rootDir, "documents", "linked.json"));
    await assert.rejects(() => collectStorageManifest({ rootDir }), error => error.code === "STORAGE_SOURCE_SYMLINK");
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("collectStorageManifest ignores unsupported roots and rejects an invalid root", async () => {
  const rootDir = await makeFixture();
  try {
    await writeFile(join(rootDir, "not-approved.bin"), "do not upload");
    const records = await collectStorageManifest({ rootDir });
    assert.equal(records.some(record => record.sourceKey.includes("not-approved")), false);
    await assert.rejects(() => collectStorageManifest({ rootDir: join(rootDir, "missing") }), error => error.code === "STORAGE_ROOT_MISSING");
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});
