# Google Drive Document Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** เปลี่ยน Google Drive sync ให้ใช้โครงสร้าง standalone/Workflow ใหม่ โดย Workflow หนึ่งรายการรวม raw และ PDF ทั้งหมดไว้ใน root เดียว

**Architecture:** เพิ่ม uploader แบบ file manifest ที่เขียนไฟล์ไปยัง remote path ที่กำหนดได้ แยกจาก uploader เดิมที่ mirror local folder จากนั้นให้ standalone สร้าง manifest ของตัวเอง และให้ workflow สร้าง manifest รวม child files กับ packet PDF โดยใช้ `layoutVersion: 2` ควบคุม retry และ migration จาก metadata เก่า

**Tech Stack:** Node.js CommonJS logic, Google Drive v3 REST API, Node test runner, existing local JSON/SQLite persistence

**Spec:** `docs/superpowers/specs/2026-09-28-google-drive-document-layout-design.md`

## Global Constraints

- ห้ามเปลี่ยน local document folders หรือ URL routes
- ต้องเก็บ `driveBasePath` ที่ผู้ใช้ตั้งค่าไว้เป็น root
- ห้ามลบโฟลเดอร์เก่าบน Google Drive อัตโนมัติ
- ต้อง prefix ชื่อไฟล์ด้วย document number เมื่ออยู่ใน shared folder
- ต้องไม่ upload ซ้ำหลัง metadata ระบุ `layoutVersion: 2` และ `syncStatus: synced`

## Review Focus

- standalone หลายเอกสารประเภทเดียวกันในเดือนเดียวกันต้องไม่ชนชื่อไฟล์
- Workflow ที่มี child หลายประเภทและ raw ชื่อซ้ำกันต้องรวมได้โดยไม่ overwrite
- retry จาก metadata layout เก่าต้องสร้าง layout ใหม่ แต่ retry ของ layout v2 ต้องไม่สร้างไฟล์ซ้ำ
- child file หายหรืออ่านไม่ได้ต้องทำให้ sync ล้มเหลวอย่างปลอดภัย
- ชื่อบริษัท/ชื่อธุรกรรมภาษาไทยและอักขระต้องห้ามต้องไม่สร้าง path traversal

### Task 1: Manifest uploader

**Files:**
- Modify: `forms/google-drive.logic.js`
- Test: `tests/google-drive.logic.test.mjs`

- [ ] เพิ่ม `uploadFilesToGoogleDrive({ rootDir, drivePath, files, fetchImpl, now })` รับรายการ `{ absolutePath, relativePath }`
- [ ] เขียน failing tests ให้สร้าง `<base>/<year>/<month>/<folder>`, `raw/`, upload files และคืน `layoutVersion: 2`
- [ ] ให้ uploader reuse folders และ validate relative paths อยู่ภายใน manifest
- [ ] รัน targeted tests ให้ผ่าน

### Task 2: Standalone manifest

**Files:**
- Modify: `forms/local-server.logic.js`
- Test: `tests/workflow-api.test.mjs`, `tests/local-server.logic.test.mjs`

- [ ] เพิ่ม helper สร้าง standalone remote path จาก accounting month และ document type label
- [ ] สร้าง manifest โดย prefix PDF/raw ด้วย document number
- [ ] เปลี่ยน standalone sync actions ทั้ง expense request, substitute receipt และ lightweight documents ให้ใช้ manifest uploader
- [ ] preserve `driveFolderUrl`, `drivePath`, counts และเพิ่ม `layoutVersion: 2`
- [ ] รัน targeted tests ให้ผ่าน

### Task 3: Workflow bundle manifest

**Files:**
- Modify: `forms/local-server.logic.js`
- Test: `tests/workflow-api.test.mjs`

- [ ] เพิ่ม helper สร้างชื่อ root `<TXN ID> - <ชื่อธุรกรรม>` และ manifest รวม raw/PDF ของทุก child กับ packet PDF
- [ ] เปลี่ยน `syncWorkflowTransactionToDrive` ให้ upload root bundle ครั้งเดียว ไม่เรียก child standalone uploader
- [ ] ให้ `driveSync.documents` รายงาน child ทุกตัวโดยชี้กลับไปที่ root Workflow เดียวกัน
- [ ] ให้ partial failure ไม่เขียนสถานะ synced ของ bundle
- [ ] รัน targeted tests ให้ผ่าน

### Task 4: Versioned retry and compatibility

**Files:**
- Modify: `forms/local-server.logic.js`, `forms/workflow.logic.js`
- Test: `tests/workflow-api.test.mjs`, `tests/google-drive.logic.test.mjs`

- [ ] metadata เก่าที่ไม่มี `layoutVersion` ต้องถูกมองว่า stale และ sync ใหม่
- [ ] metadata v2 ที่ synced แล้วต้องเป็น no-op เมื่อกด sync ซ้ำ
- [ ] สรุป Workflow และ root Drive link ต้องใช้ metadata v2 โดยไม่แสดง child folder เก่าเป็นตำแหน่งหลัก
- [ ] รัน targeted tests ให้ผ่าน

### Task 5: Full verification

- [ ] รัน `git diff --check`
- [ ] รัน `./scripts/test.sh`
- [ ] ตรวจว่าการเปลี่ยนแปลงไม่แก้ local folder layout และไม่ลบ Google Drive folders เก่า

