#!/usr/bin/env node
// สร้างดัชนีเอกสาร (documents index) ใหม่จากไฟล์บนดิสก์ทั้งหมด
//
// ทำไมต้องมีสคริปต์นี้: forms/document-index.logic.js เก็บดัชนีของเอกสารบัญชี
// ทั้งเจ็ดชนิดไว้ในตาราง `documents` ของฐานข้อมูล SQLite เดียวกับที่สต๊อกใช้
// (data/sweet-house.sqlite) เพื่อค้นหา/รายงานได้เร็วกว่าการวนอ่านโฟลเดอร์
// documents/YYYY/MM/... ทุกครั้ง แต่ไฟล์บนดิสก์คือแหล่งความจริงเสมอ ดัชนีนี้
// เป็นเพียงอนุพันธ์ (derived) — สคริปต์นี้จึงต้องรันได้ตามต้องการเพื่อสร้าง
// ดัชนีใหม่ทั้งหมดจากไฟล์จริง หากดัชนีเพี้ยนไปจากดิสก์ไม่ว่าด้วยสาเหตุใด
//
// ไม่แตะไฟล์ใด ๆ ใน documents/ เลย (อ่านอย่างเดียว) เขียนเฉพาะตาราง
// documents และ document_number_allocations ในฐานข้อมูล SQLite เท่านั้น จึง
// ปลอดภัยที่จะรันซ้ำได้ตลอด (idempotent — ดู rebuildDocumentIndex)
//
// ไม่ใช้ dependency จาก npm เพิ่มเติม ใช้ node:sqlite ตัวเดียวกับที่
// forms/inventory-db.logic.js ใช้อยู่แล้ว (ต้องรันด้วย Node ที่มี node:sqlite
// เช่น runtime ที่แนบมากับโปรเจกต์ — ดู scripts/rebuild-document-index.sh)

import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { rebuildDocumentIndex, DOCUMENT_KINDS } = require("../forms/document-index.logic.js");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.join(__dirname, "..");
const rootDir = process.env.SWEET_HOUSE_ROOT_DIR || appDir;

function log(message) {
  console.log(`[ดัชนีเอกสาร] ${message}`);
}

function fail(message) {
  console.error(`[ดัชนีเอกสาร] ล้มเหลว: ${message}`);
  process.exitCode = 1;
}

async function run() {
  log(`เริ่มสร้างดัชนีเอกสารใหม่จากไฟล์บนดิสก์ใน ${rootDir}`);
  const startedAt = Date.now();

  const { counts, total } = await rebuildDocumentIndex(rootDir);

  const durationSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  log(`เสร็จสิ้น (ใช้เวลา ${durationSeconds} วินาที): พบเอกสารทั้งหมด ${total} ฉบับ`);
  for (const kind of DOCUMENT_KINDS) {
    log(`  ${kind}: ${counts[kind] || 0}`);
  }
}

run().catch((error) => {
  fail(error.message || String(error));
});
