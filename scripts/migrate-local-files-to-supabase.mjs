import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { lstat, readdir, readFile } from "node:fs/promises";
import path from "node:path";

const require = createRequire(import.meta.url);
const { assertObjectPath } = require("../forms/supabase-storage.logic.js");

export const STORAGE_MIGRATION_NAME = "local-file-storage-20260925";

const APPROVED_ROOTS = [
  { directory: "documents", objectPrefix: "documents" },
  { directory: path.join("data", "inventory-images"), objectPrefix: "inventory-images" },
];

const CONTENT_TYPES = {
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".json": "application/json",
  ".md": "text/markdown",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".txt": "text/plain",
  ".webp": "image/webp",
};

function storageError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function contentTypeFor(filePath) {
  return CONTENT_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream";
}

function relativePosix(rootDir, absolutePath) {
  return path.relative(rootDir, absolutePath).split(path.sep).join("/");
}

async function collectDirectory({ rootDir, sourceRoot, absoluteDir, relativeDir, objectPrefix }) {
  let entries;
  try {
    entries = await readdir(absoluteDir, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }

  const records = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const absolutePath = path.join(absoluteDir, entry.name);
    if (entry.isSymbolicLink()) {
      throw storageError("STORAGE_SOURCE_SYMLINK", `Storage source contains a symlink: ${relativePosix(rootDir, absolutePath)}`);
    }
    if (entry.isDirectory()) {
      records.push(...await collectDirectory({
        rootDir,
        sourceRoot,
        absoluteDir: absolutePath,
        relativeDir: path.join(relativeDir, entry.name),
        objectPrefix,
      }));
      continue;
    }
    if (!entry.isFile()) {
      throw storageError("STORAGE_SOURCE_NOT_REGULAR", `Storage source is not a regular file: ${relativePosix(rootDir, absolutePath)}`);
    }

    const relativePath = relativePosix(rootDir, path.join(rootDir, relativeDir, entry.name));
    const objectPath = assertObjectPath(`${objectPrefix}/${relativePosix(sourceRoot, absolutePath)}`);
    const body = await readFile(absolutePath);
    records.push({
      sourceKey: `file:${relativePath}`,
      relativePath,
      absolutePath,
      objectPath,
      sourceSha256: createHash("sha256").update(body).digest("hex"),
      byteSize: body.length,
      contentType: contentTypeFor(absolutePath),
    });
  }
  return records;
}

export async function collectStorageManifest({ rootDir } = {}) {
  const resolvedRootDir = path.resolve(String(rootDir || ""));
  let rootStats;
  try {
    rootStats = await lstat(resolvedRootDir);
  } catch (error) {
    if (error.code === "ENOENT") throw storageError("STORAGE_ROOT_MISSING", "Storage source root is missing");
    throw error;
  }
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
    throw storageError("STORAGE_ROOT_INVALID", "Storage source root is not a directory");
  }

  const records = [];
  for (const approvedRoot of APPROVED_ROOTS) {
    records.push(...await collectDirectory({
      rootDir: resolvedRootDir,
      sourceRoot: path.join(resolvedRootDir, approvedRoot.directory),
      absoluteDir: path.join(resolvedRootDir, approvedRoot.directory),
      relativeDir: approvedRoot.directory,
      objectPrefix: approvedRoot.objectPrefix,
    }));
  }
  return records.sort((left, right) => left.sourceKey.localeCompare(right.sourceKey));
}

export { contentTypeFor };
