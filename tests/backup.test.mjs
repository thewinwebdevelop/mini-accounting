import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import inventoryLogic from "../forms/inventory.logic.js";
import inventoryDbLogic from "../forms/inventory-db.logic.js";

const { createProduct } = inventoryLogic;
const { getInventoryDbPath } = inventoryDbLogic;

const execFileAsync = promisify(execFile);
const repoRoot = new URL("..", import.meta.url);

// Risk 1: the accounting data (documents/, data/*.sqlite, config/) is not in
// version control and has no backup anywhere. scripts/backup.mjs must
// produce one consistent, timestamped snapshot outside the repo, using
// SQLite's own online-backup mechanism (VACUUM INTO) rather than copying the
// live *.sqlite file -- a plain `cp` while the WAL-mode server is running can
// produce a torn/corrupt copy.

function seedDocuments(rootDir) {
  const docsDir = join(rootDir, "documents", "2026", "09");
  mkdirSync(docsDir, { recursive: true });
  writeFileSync(join(docsDir, "expense-0001.json"), JSON.stringify({ hello: "world" }));
  mkdirSync(join(docsDir, "attachments"), { recursive: true });
  writeFileSync(join(docsDir, "attachments", "receipt.txt"), "receipt contents");
}

function seedConfig(rootDir) {
  const configDir = join(rootDir, "config");
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, "google-drive.json"), JSON.stringify({ token: "fake" }));
}

function seedDatabase(rootDir) {
  createProduct(rootDir, { productCode: "p001", name: "เสื้อยืดทดสอบ", category: "เสื้อ" });
  createProduct(rootDir, { productCode: "p002", name: "กระโปรงทดสอบ", category: "กระโปรง" });
}

function listFilesRecursive(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  const walk = (current, prefix) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const abs = join(current, entry.name);
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(abs, rel);
      } else {
        out.push(rel);
      }
    }
  };
  walk(dir, "");
  return out.sort();
}

function runBackup(env) {
  return execFileAsync(process.execPath, ["scripts/backup.mjs"], {
    cwd: repoRoot,
    env: { ...process.env, ...env },
  });
}

function findSnapshotDirs(backupRoot) {
  return readdirSync(backupRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("sweet-house-backup-"))
    .map((entry) => join(backupRoot, entry.name));
}

test("backup script produces a consistent snapshot of documents, config, and the SQLite database", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-backup-src-"));
  const backupRoot = await mkdtemp(join(tmpdir(), "sweet-house-backup-dst-"));

  try {
    seedDocuments(rootDir);
    seedConfig(rootDir);
    seedDatabase(rootDir);

    // Keep a live handle open on the source database, WAL file un-checkpointed,
    // to simulate the server still running while the backup happens.
    const dbPath = getInventoryDbPath(rootDir);
    const liveHandle = new DatabaseSync(dbPath);
    liveHandle.exec("PRAGMA journal_mode = WAL");

    const { stdout } = await runBackup({
      SWEET_HOUSE_ROOT_DIR: rootDir,
      SWEET_HOUSE_BACKUP_DIR: backupRoot,
    });

    const snapshots = findSnapshotDirs(backupRoot);
    assert.equal(snapshots.length, 1, `expected exactly one snapshot dir, stdout was:\n${stdout}`);
    const snapshotDir = snapshots[0];

    // Database: must open and return a sane row count that matches what we
    // seeded, proving the copy is complete and not corrupt/torn.
    const copiedDbPath = join(snapshotDir, "data", "sweet-house.sqlite");
    assert.equal(existsSync(copiedDbPath), true, "snapshot must contain the copied sqlite database");
    const copy = new DatabaseSync(copiedDbPath, { readOnly: true });
    const integrity = copy.prepare("PRAGMA integrity_check").get();
    assert.equal(Object.values(integrity)[0], "ok", "copied database must pass PRAGMA integrity_check");
    const productCount = copy.prepare("SELECT COUNT(*) AS c FROM products").get().c;
    assert.equal(productCount, 2, "copied database must contain all rows written before the backup ran");
    copy.close();

    // The live source database must still be usable after the backup --
    // VACUUM INTO on a read-only connection must not lock or modify it.
    liveHandle.exec("PRAGMA journal_mode = WAL");
    liveHandle.close();

    // Documents tree must be copied completely.
    const sourceDocs = listFilesRecursive(join(rootDir, "documents"));
    const copiedDocs = listFilesRecursive(join(snapshotDir, "documents"));
    assert.deepEqual(copiedDocs, sourceDocs, "every document file must be present in the snapshot");
    assert.equal(
      readFileSync(join(snapshotDir, "documents", "2026", "09", "attachments", "receipt.txt"), "utf8"),
      "receipt contents",
    );

    // Config tree must be copied completely.
    const sourceConfig = listFilesRecursive(join(rootDir, "config"));
    const copiedConfig = listFilesRecursive(join(snapshotDir, "config"));
    assert.deepEqual(copiedConfig, sourceConfig, "every config file must be present in the snapshot");
  } finally {
    await rm(rootDir, { recursive: true, force: true });
    await rm(backupRoot, { recursive: true, force: true });
  }
});

test("backup script is safe to run repeatedly and never overwrites a prior snapshot", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-backup-src-"));
  const backupRoot = await mkdtemp(join(tmpdir(), "sweet-house-backup-dst-"));

  try {
    seedDocuments(rootDir);
    seedDatabase(rootDir);

    await runBackup({ SWEET_HOUSE_ROOT_DIR: rootDir, SWEET_HOUSE_BACKUP_DIR: backupRoot });
    await runBackup({ SWEET_HOUSE_ROOT_DIR: rootDir, SWEET_HOUSE_BACKUP_DIR: backupRoot });

    const snapshots = findSnapshotDirs(backupRoot);
    assert.equal(snapshots.length, 2, "running the backup twice must produce two distinct snapshots");
  } finally {
    await rm(rootDir, { recursive: true, force: true });
    await rm(backupRoot, { recursive: true, force: true });
  }
});

test("backup script writes outside the repository by default", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-backup-src-"));

  try {
    seedDocuments(rootDir);
    seedDatabase(rootDir);

    const { stdout } = await runBackup({ SWEET_HOUSE_ROOT_DIR: rootDir });
    const match = stdout.match(/สำรองข้อมูลสำเร็จ.*?:\s*(\/\S+)/);
    assert.ok(match, `expected the snapshot path to be printed, stdout was:\n${stdout}`);
    const snapshotPath = match[1];
    assert.equal(
      snapshotPath.startsWith(rootDir),
      false,
      "default backup destination must not be inside the repo/data root",
    );

    await rm(snapshotPath, { recursive: true, force: true });
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("backup script fails loudly (non-zero exit, no snapshot left behind) when the database is missing", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-backup-src-empty-"));
  const backupRoot = await mkdtemp(join(tmpdir(), "sweet-house-backup-dst-"));

  try {
    // No seedDatabase() call: data/sweet-house.sqlite never gets created.
    seedDocuments(rootDir);

    await assert.rejects(
      () => runBackup({ SWEET_HOUSE_ROOT_DIR: rootDir, SWEET_HOUSE_BACKUP_DIR: backupRoot }),
      /./,
      "backup must exit non-zero when the SQLite database does not exist",
    );

    const snapshots = findSnapshotDirs(backupRoot);
    assert.equal(snapshots.length, 0, "a failed backup must not leave a half-written snapshot directory");

    const leftovers = existsSync(backupRoot) ? readdirSync(backupRoot) : [];
    const staging = leftovers.filter((name) => name.startsWith(".") || name.includes("staging") || name.includes("tmp"));
    assert.equal(staging.length, 0, "a failed backup must not leave temporary/staging directories behind either");
  } finally {
    await rm(rootDir, { recursive: true, force: true });
    await rm(backupRoot, { recursive: true, force: true });
  }
});

test("backup script tolerates a missing config/ directory (not every install has Google Drive configured)", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-backup-src-noconfig-"));
  const backupRoot = await mkdtemp(join(tmpdir(), "sweet-house-backup-dst-"));

  try {
    seedDocuments(rootDir);
    seedDatabase(rootDir);
    // No seedConfig(rootDir): config/ does not exist, mirroring this very
    // dev worktree, which has no config/ directory either.

    const { stdout } = await runBackup({
      SWEET_HOUSE_ROOT_DIR: rootDir,
      SWEET_HOUSE_BACKUP_DIR: backupRoot,
    });

    const snapshots = findSnapshotDirs(backupRoot);
    assert.equal(snapshots.length, 1, `expected the backup to still succeed, stdout was:\n${stdout}`);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
    await rm(backupRoot, { recursive: true, force: true });
  }
});
