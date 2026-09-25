# Plan: LINE Webhook File Intake MVP

## Task 1 — Pure webhook and intake contracts

- เขียนเทสต์ signature, event extraction, MIME validation, state transitions และ idempotency
- เพิ่ม `forms/line-webhook.logic.js` และ `forms/line-intake.logic.js`
- รันเทสต์เฉพาะกลุ่มให้ fail ก่อน แล้ว implement จน pass

## Task 2 — LINE transport boundary

- เพิ่ม content downloader และ reply-card builder ที่รับ `fetchImpl` เพื่อทดสอบโดยไม่ยิง LINE จริง
- เพิ่ม environment variables สำหรับ channel secret, access token และ max bytes
- ทดสอบว่า token ไม่ถูกใส่ใน error/log payload

## Task 3 — HTTP webhook and Mini App review API

- เพิ่ม route ก่อน session auth gate เฉพาะ webhook
- เก็บ local intake metadata/file ใน root data directory
- เพิ่ม GET review และ POST cancel ที่ผ่าน existing session/ownership checks
- ทดสอบ HTTP path ด้วย child server

## Task 4 — Documentation and regression verification

- เพิ่ม checklist สำหรับ webhook deployment
- รัน `./scripts/test.sh`
- ตรวจ git diff และ commit เป็นชุดเล็ก ๆ
