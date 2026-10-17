# LINE Webhook File Intake MVP

## Goal

รับรูปภาพหรือ PDF จาก LINE Official Account, ตรวจสอบว่า webhook มาจาก LINE, เก็บไฟล์ต้นฉบับแบบ private และสร้างรายการรอตรวจสอบในระบบเดิม โดยยังไม่สร้างเอกสารหรือเขียน Google Sheets จากไฟล์ที่ยังไม่ได้รับการยืนยัน

## Scope

- `POST /api/webhooks/line` รับ LINE webhook และตอบเร็ว
- รองรับ message events ชนิด `image` และ `file` (PDF)
- ตรวจ HMAC-SHA256 ด้วย `LINE_CHANNEL_SECRET` จาก raw request body
- ดาวน์โหลด content จาก LINE ด้วย `LINE_CHANNEL_ACCESS_TOKEN`
- เก็บ metadata และไฟล์ต้นฉบับใน local intake store เพื่อให้ dev/test ทำงานได้โดยไม่ต้องมี Supabase credential
- ทำ idempotency ด้วย webhook event ID และ message ID
- สร้าง reply card ให้ผู้ใช้เปิด Mini App ตรวจรายการ
- มี `GET /api/line-intakes/:id` และ `POST /api/line-intakes/:id/cancel` สำหรับ Mini App

## Non-goals ของ milestone นี้

- ไม่เดาค่าจาก OCR และไม่สร้างเอกสารอัตโนมัติจากไฟล์ที่ยังไม่ยืนยัน
- ไม่ซิงก์ Google Sheets จาก webhook โดยตรง; การ sync ต้องผ่าน lifecycle เดิมที่มี authorization และ approval
- ยังไม่เรียก Supabase ใน webhook path; schema/adaptor จะเป็น milestone ถัดไปหลัง contract นี้นิ่ง
- ยังไม่สร้างหรือ publish rich menu จริงใน LINE Developers Console

## Security and reliability

- ตรวจ signature ก่อน JSON parse
- ไม่ log channel secret, access token หรือ raw file contents
- จำกัดขนาดไฟล์และ MIME/extension ที่อนุญาต
- เก็บไฟล์ด้วยชื่อจาก hash/UUID ไม่ใช้ชื่อจากผู้ใช้เป็น path
- ทำ duplicate event ให้เป็น no-op ที่ตอบ 200
- route webhook ไม่ผ่าน browser session auth แต่ต้องผ่าน LINE signature auth
- ผู้ใช้ที่เปิด Mini App ต้องเป็นเจ้าของ intake หรือมี permission ที่เหมาะสม

## State machine

`received -> needs_confirmation -> confirmed | cancelled | failed`

OCR provider จะถูกต่อผ่าน interface ภายหลัง; MVP ใช้สถานะ `needs_confirmation` และแสดง filename/type/size โดยไม่สร้างข้อมูลการเงินปลอม

## Acceptance criteria

1. invalid/missing signature ไม่สร้าง record และตอบ 401
2. valid empty event ตอบ 200
3. valid image/PDF ดาวน์โหลดและสร้าง intake ได้หนึ่งรายการ
4. retry event เดิมไม่สร้างไฟล์หรือรายการซ้ำ
5. unsupported message/file ถูกปฏิเสธอย่างปลอดภัย
6. endpoint review แสดงเฉพาะ metadata ที่ปลอดภัยและไม่เปิดเผย absolute path
