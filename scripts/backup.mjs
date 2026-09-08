#!/usr/bin/env node
// สคริปต์สำรองข้อมูลของระบบบัญชี (documents/, data/*.sqlite, config/)
//
// ทำไมต้องมีสคริปต์นี้: .gitignore กันไม่ให้ documents/, config/ และ
// data/*.sqlite เข้า git ดังนั้นข้อมูลเอกสารและฐานข้อมูลสต๊อกทั้งหมดไม่มีสำเนา
// อยู่ที่ไหนเลยนอกจากเครื่องนี้เครื่องเดียว หากเครื่องพัง ข้อมูลทั้งหมดจะหายถาวร
//
// ฐานข้อมูล SQLite เปิดในโหมด WAL (ดู forms/inventory-db.logic.js) การใช้ `cp`
// คัดลอกไฟล์ .sqlite ตรง ๆ ขณะเซิร์ฟเวอร์กำลังทำงานอาจได้ไฟล์ที่ไม่สมบูรณ์หรือ
// เสียหาย (torn copy) เพราะข้อมูลบางส่วนยังค้างอยู่ใน -wal/-shm สคริปต์นี้จึงใช้
// กลไกสำรองข้อมูลของ SQLite เอง (`VACUUM INTO`) ซึ่งอ่านผ่าน SQLite API ตามปกติ
// (รวมเนื้อหาใน WAL ที่ยังไม่ checkpoint ด้วย) ทำให้ได้ไฟล์ปลายทางที่สอดคล้องกัน
// (consistent) แม้เซิร์ฟเวอร์จะยังทำงานและเขียนข้อมูลอยู่ระหว่างสำรอง
//
// ไม่ใช้ dependency จาก npm เพิ่มเติม ใช้ node:sqlite ตัวเดียวกับที่
// forms/inventory-db.logic.js ใช้อยู่แล้ว (ต้องรันด้วย Node ที่มี node:sqlite
// เช่น runtime ที่แนบมากับโปรเจกต์ — ดู scripts/backup.sh)

import { DatabaseSync } from "node:sqlite";
import { createRequire } from "node:module";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

const require = createRequire(import.meta.url);
const { getInventoryDbPath } = require("../forms/inventory-db.logic.js");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.join(__dirname, "..");
const rootDir = process.env.SWEET_HOUSE_ROOT_DIR || appDir;
const backupRoot = process.env.SWEET_HOUSE_BACKUP_DIR || path.join(homedir(), "sweet-house-backups");

function log(message) {
  console.log(`[สำรองข้อมูล] ${message}`);
}

function fail(message) {
  console.error(`[สำรองข้อมูล] ล้มเหลว: ${message}`);
  process.exitCode = 1;
}

function timestampForFilename(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

function countFilesRecursive(dir) {
  if (!existsSync(dir)) return 0;
  let count = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      count += countFilesRecursive(abs);
    } else {
      count += 1;
    }
  }
  return count;
}

function listFilesRecursive(dir, prefix = "") {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      out.push(...listFilesRecursive(abs, rel));
    } else {
      out.push(rel);
    }
  }
  return out;
}

// คัดลอกโฟลเดอร์ทั้งต้นทาง (documents/ หรือ config/) แบบครบถ้วน แล้วตรวจสอบว่า
// ทุกไฟล์ที่มีอยู่ก่อนเริ่มคัดลอกถูกคัดลอกไปครบ (ขนาดไฟล์ตรงกัน) ไม่ถือว่าเป็น
// ข้อผิดพลาดหากมีไฟล์ใหม่เกิดขึ้นระหว่างคัดลอก (เซิร์ฟเวอร์ยังทำงานอยู่) แต่ถือ
// เป็นข้อผิดพลาดร้ายแรงหากไฟล์ที่มีอยู่แล้วหายไปหรือขนาดไม่ตรง
function copyTreeAndVerify(sourceDir, destDir, label) {
  if (!existsSync(sourceDir)) {
    log(`ไม่พบโฟลเดอร์ ${label} (${sourceDir}) ข้ามการสำรองข้อมูลส่วนนี้`);
    return { fileCount: 0, skipped: true };
  }

  const beforeFiles = listFilesRecursive(sourceDir);
  const beforeSizes = new Map(
    beforeFiles.map((rel) => [rel, statSync(path.join(sourceDir, rel)).size]),
  );

  mkdirSync(path.dirname(destDir), { recursive: true });
  cpSync(sourceDir, destDir, { recursive: true });

  const afterFiles = new Set(listFilesRecursive(destDir));
  const missing = [];
  const mismatched = [];
  for (const rel of beforeFiles) {
    if (!afterFiles.has(rel)) {
      missing.push(rel);
      continue;
    }
    const copiedSize = statSync(path.join(destDir, rel)).size;
    if (copiedSize !== beforeSizes.get(rel)) {
      mismatched.push(rel);
    }
  }

  if (missing.length > 0 || mismatched.length > 0) {
    throw new Error(
      `การคัดลอก ${label} ไม่สมบูรณ์: ไฟล์หาย ${missing.length} ไฟล์, ขนาดไม่ตรง ${mismatched.length} ไฟล์ ` +
        `(ตัวอย่าง: ${[...missing, ...mismatched].slice(0, 5).join(", ")})`,
    );
  }

  log(`คัดลอก ${label} สำเร็จ: ${beforeFiles.length} ไฟล์`);
  return { fileCount: beforeFiles.length, skipped: false };
}

// สำรองฐานข้อมูล SQLite ด้วย VACUUM INTO (กลไกสำรองข้อมูลของ SQLite เอง)
// เปิดฐานข้อมูลต้นทางแบบอ่านอย่างเดียว (readOnly) เพื่อไม่ให้กระทบข้อมูลจริง
// และใช้งานร่วมกับเซิร์ฟเวอร์ที่ยังทำงานอยู่ได้ (WAL รองรับผู้อ่านพร้อมกันได้)
function backupDatabase(sourceDbPath, destDbPath) {
  if (!existsSync(sourceDbPath)) {
    throw new Error(
      `ไม่พบฐานข้อมูล SQLite ที่ ${sourceDbPath} — ระบบยังไม่เคยถูกใช้งาน หรือ SWEET_HOUSE_ROOT_DIR ไม่ถูกต้อง`,
    );
  }

  mkdirSync(path.dirname(destDbPath), { recursive: true });

  const source = new DatabaseSync(sourceDbPath, { readOnly: true });
  try {
    const escapedDest = destDbPath.replace(/'/g, "''");
    source.exec(`VACUUM INTO '${escapedDest}'`);
  } finally {
    source.close();
  }

  if (!existsSync(destDbPath)) {
    throw new Error("VACUUM INTO ไม่ได้สร้างไฟล์ฐานข้อมูลปลายทาง");
  }

  const copy = new DatabaseSync(destDbPath, { readOnly: true });
  let rowCounts;
  try {
    const integrity = copy.prepare("PRAGMA integrity_check").get();
    const integrityResult = Object.values(integrity)[0];
    if (integrityResult !== "ok") {
      throw new Error(`ไฟล์ฐานข้อมูลที่สำรองไม่ผ่านการตรวจสอบความสมบูรณ์: ${integrityResult}`);
    }

    const tables = copy
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all()
      .map((row) => row.name);

    rowCounts = {};
    let totalRows = 0;
    for (const table of tables) {
      const { c } = copy.prepare(`SELECT COUNT(*) AS c FROM "${table.replace(/"/g, '""')}"`).get();
      rowCounts[table] = c;
      totalRows += c;
    }

    if (tables.length === 0) {
      throw new Error("ไฟล์ฐานข้อมูลที่สำรองไม่มีตารางใดเลย ผิดปกติสำหรับฐานข้อมูลที่เคยใช้งานแล้ว");
    }

    log(`สำเนาฐานข้อมูล SQLite ผ่านการตรวจสอบ: ${tables.length} ตาราง, รวม ${totalRows} แถว`);
    return { tables: tables.length, totalRows, rowCounts };
  } finally {
    copy.close();
  }
}

function run() {
  const startedAt = Date.now();
  log(`เริ่มต้นสำรองข้อมูลจาก ${rootDir}`);

  mkdirSync(backupRoot, { recursive: true });

  const snapshotName = `sweet-house-backup-${timestampForFilename(new Date())}-${randomBytes(3).toString("hex")}`;
  const stagingDir = path.join(backupRoot, `.staging-${snapshotName}`);
  const finalDir = path.join(backupRoot, snapshotName);

  // ล้าง staging เก่าที่อาจตกค้างจากการรันที่ล้มเหลวก่อนหน้า ก่อนเริ่มงานใหม่
  rmSync(stagingDir, { recursive: true, force: true });
  mkdirSync(stagingDir, { recursive: true });

  try {
    const sourceDbPath = getInventoryDbPath(rootDir);
    const destDbPath = path.join(stagingDir, "data", path.basename(sourceDbPath));
    const dbReport = backupDatabase(sourceDbPath, destDbPath);

    // ไฟล์อื่น ๆ ที่อาจอยู่ใน data/ นอกจากตัวฐานข้อมูลเอง (ไม่รวม -wal/-shm ซึ่ง
    // เป็นไฟล์ชั่วคราวของ SQLite ที่ไม่มีความหมายนอกบริบทของการเชื่อมต่อจริง)
    const sourceDataDir = path.dirname(sourceDbPath);
    if (existsSync(sourceDataDir)) {
      const dbBaseName = path.basename(sourceDbPath);
      for (const entry of readdirSync(sourceDataDir, { withFileTypes: true })) {
        if (entry.isDirectory()) continue;
        if (entry.name === dbBaseName) continue;
        if (entry.name === `${dbBaseName}-wal` || entry.name === `${dbBaseName}-shm`) continue;
        cpSync(path.join(sourceDataDir, entry.name), path.join(stagingDir, "data", entry.name));
      }
    }

    const documentsReport = copyTreeAndVerify(
      path.join(rootDir, "documents"),
      path.join(stagingDir, "documents"),
      "documents/",
    );
    const configReport = copyTreeAndVerify(
      path.join(rootDir, "config"),
      path.join(stagingDir, "config"),
      "config/",
    );

    // ย้าย staging ไปเป็นชื่อสุดท้ายแบบอะตอมมิก (rename บนไฟล์ระบบเดียวกัน) —
    // จะเห็นสแนปช็อตนี้ก็ต่อเมื่อทุกขั้นตอนข้างบนสำเร็จหมดแล้วเท่านั้น
    renameSync(stagingDir, finalDir);

    const durationSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);
    log(`สำรองข้อมูลสำเร็จ (ใช้เวลา ${durationSeconds} วินาที): ${finalDir}`);
    log(
      `สรุป: ฐานข้อมูล ${dbReport.tables} ตาราง/${dbReport.totalRows} แถว, ` +
        `เอกสาร ${documentsReport.fileCount} ไฟล์${documentsReport.skipped ? " (ไม่พบโฟลเดอร์)" : ""}, ` +
        `config ${configReport.fileCount} ไฟล์${configReport.skipped ? " (ไม่พบโฟลเดอร์)" : ""}`,
    );
  } catch (error) {
    rmSync(stagingDir, { recursive: true, force: true });
    rmSync(finalDir, { recursive: true, force: true });
    fail(error.message || String(error));
  }
}

run();
