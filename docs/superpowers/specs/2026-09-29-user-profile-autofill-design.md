# User Profile and New-Document Autofill Design

**Date:** 2026-09-29  
**Status:** Approved in conversation

## Goal

ให้ผู้ใช้ที่เข้าสู่ระบบด้วย LINE บันทึกชื่อ, นามสกุล และตำแหน่งในบริษัทของตัวเองได้ แล้วใช้ข้อมูลนั้นเป็นค่าเริ่มต้นตอนสร้างเอกสารใหม่ในระบบบัญชี โดยค่าที่ถูกเติมลงเอกสารจะกลายเป็นข้อมูลของเอกสารนั้นเองและไม่ผูกกับโปรไฟล์ภายหลัง

## Scope and non-goals

อยู่ใน scope:

- หน้าโปรไฟล์ผู้ใช้สำหรับผู้ใช้ปัจจุบันเท่านั้น
- ฟิลด์ `firstName`, `lastName` และตำแหน่งที่เลือกจาก `company_positions`
- master data ตำแหน่งบริษัท และการเปลี่ยน dropdown เดิมที่ hardcode ให้ใช้ master นี้
- API อ่านและแก้ไขโปรไฟล์โดยอ้างอิง user จาก signed LINE session
- เมนูทางเข้าหน้าโปรไฟล์
- autofill สำหรับเอกสารใหม่ของใบเบิกจ่าย ใบรับรองแทนใบเสร็จ และ lightweight workflow documents
- fallback ฝั่ง server สำหรับข้อมูลที่สร้างจาก LINE intake เมื่อ request ไม่ได้ส่งชื่อหรือตำแหน่งมา

ไม่อยู่ใน scope:

- หน้าจัดการโปรไฟล์ของผู้ใช้อื่นหรือการอนุมัติผู้ใช้
- การ sync แก้ไขโปรไฟล์ย้อนหลังไปยังเอกสารเก่า, draft เดิม หรือเอกสารที่กำลังเปิดแก้ไข
- การเปลี่ยนบทบาท/สิทธิ์จากหน้าโปรไฟล์
- การเพิ่มข้อมูลส่วนตัวอื่น เช่น เบอร์โทรศัพท์หรืออีเมล
- การทำ role-permission หรือ e-sign workflow ให้ใช้งานได้จริงใน branch นี้

## Existing context

ระบบมี LINE authentication อยู่แล้ว:

- `app_users` เป็น identity หลักของผู้ใช้ LINE
- signed session มี `userId` จาก server และ middleware บังคับ authentication ให้กับ API เมื่อ `SWEET_HOUSE_AUTH_MODE=line`
- ฟอร์มเอกสารมี field `requesterName` และบางฟอร์มมี `requesterRole`
- หน้าเอกสารรองรับ draft และการ reopen เอกสารเดิม จึงต้องแยก “เอกสารใหม่” ออกจาก “เอกสารที่มีข้อมูลแล้ว” ให้ชัดเจน

## Design

### 1. Data model

เพิ่ม migration ใหม่ต่อจาก `20260925_001_line_auth.sql` โดยแยกข้อมูลแต่ละหน้าที่ออกจากกัน

#### Identity จาก provider

`public.app_users` ยังคงเป็น identity และสถานะการเข้าใช้งานเท่านั้น:

- `id uuid primary key`
- `line_user_id text unique`
- `display_name`, `picture_url` ข้อมูลจาก LINE
- `status`, `last_login_at`, timestamps

ห้ามนำข้อมูลที่ผู้ใช้กรอกในโปรไฟล์ไปเขียนทับ `display_name` เพราะสองฟิลด์นี้มีแหล่งความจริงคนละระบบ

#### ข้อมูลโปรไฟล์สำหรับเอกสาร

สร้าง `public.app_user_profiles` แบบ one-to-one:

- `user_id uuid primary key references app_users(id) on delete cascade`
- `first_name text not null default ''`
- `last_name text not null default ''`
- `company_position_id uuid references company_positions(id) on delete set null`
- `created_at`, `updated_at`

ข้อกำหนดข้อมูล:

- `firstName` trim แล้วต้องไม่ว่าง และยาวไม่เกิน 100 ตัวอักษร
- `lastName` trim แล้วต้องไม่ว่าง และยาวไม่เกิน 100 ตัวอักษร
- `companyPositionId` ต้องเป็นตำแหน่งที่มีอยู่และมีสถานะ `active` ตอนบันทึก
- ค่า identity, role, status และ timestamps เป็น server-owned

การแยกตารางนี้ทำให้ profile ไม่ผูกกับ provider และเปิดทางให้เพิ่มข้อมูลบุคคลหรือ profile history ภายหลัง โดยไม่ทำให้ `app_users` กลายเป็นตารางข้อมูลทุกอย่าง

#### Company position master

สร้าง `public.company_positions` เป็นแหล่งข้อมูลกลางสำหรับตำแหน่งที่ผู้ใช้เลือก:

- `id uuid primary key default gen_random_uuid()`
- `code text unique not null`
- `label text not null`
- `status text not null default 'active'` โดยรับค่า `active` หรือ `inactive`
- `sort_order integer not null default 0`
- `created_at`, `updated_at`

migration ต้อง seed ค่าเดิมจาก dropdown ปัจจุบันโดยใช้ code ที่คงที่ เช่น:

- `owner` / `เจ้าของบริษัท`
- `marketing` / `marketing`

การ seed ต้อง idempotent และไม่ลบหรือปิดตำแหน่งที่ผู้ใช้เคยเลือกไว้เอง เมื่อปิดตำแหน่งให้ไม่แสดงในตัวเลือกใหม่ แต่ยังอ่าน label เดิมของ profile และเอกสารเก่าได้

เพิ่ม read API `GET /api/company-positions` สำหรับรายการ active เรียงตาม `sort_order`, `label` และให้ใช้ endpoint เดียวกันทั้งหน้าโปรไฟล์และฟอร์มเอกสารเดิมที่เคย hardcode option ไว้

`company_position_id` ใช้สำหรับค่าปัจจุบันใน profile เท่านั้น ส่วนตอนเติมเอกสารให้คัดลอก `company_positions.label` ลง `requesterRole` เป็น snapshot ของเอกสาร ไม่ใช่ reference ที่ต้อง resolve ใหม่ทุกครั้ง

#### Role and permission extension

โครงสร้างสิทธิ์ปัจจุบัน (`app_roles` และ `app_user_roles`) ยังคงเป็นแหล่งอ้างอิง role ของ session ในงานนี้ และ profile API ไม่มีสิทธิ์แก้ role ใด ๆ

เพื่อรองรับการขยายเป็น permission-based authorization ในอนาคต ให้ยึดโครงสร้างต่อไปนี้เป็นทิศทาง:

- `app_roles`: catalog ของ role เช่น employee, owner, accounting, admin
- `app_permissions`: catalog ของ permission แบบ stable code เช่น `document:approve`
- `app_role_permissions`: many-to-many ระหว่าง role กับ permission โดยใช้ composite key `(role_code, permission_code)`
- `app_user_roles`: assignment ระหว่างผู้ใช้กับ role; หากอนาคตต้องมีหลาย role, organization scope หรือ effective dates ให้ migrate ตารางนี้เป็น assignment rows โดยไม่เก็บ permission ไว้ใน profile หรือใน client session เป็นแหล่งความจริง

ตอนนี้ยังไม่เปลี่ยน authorization matrix ที่ใช้งานอยู่ เพื่อให้การเพิ่ม profile ไม่เปลี่ยน behavior ของสิทธิ์เดิม แต่ชื่อและขอบเขตของ profile ต้องไม่ทำให้การย้ายจาก role-based ไป permission-based ติดข้อจำกัด

#### E-sign extension

ไม่เก็บสถานะการเซ็นหรือรูป/ลายเซ็นไว้ใน `app_user_profiles` และไม่ถือว่าการกรอกชื่อใน profile เป็นการเซ็นเอกสาร

เมื่อเริ่มทำ e-sign ให้เพิ่มโมเดลแยกอย่างน้อย:

- `signing_profiles`: ผู้มีสิทธิ์เซ็น, provider/key reference, status และ metadata ที่ไม่ใช่ private key
- `document_signatures`: คำขอ/ผลการเซ็นที่ผูกกับ canonical document source key, signer user, signing profile, ลำดับ, status, signed timestamp, provider reference และ `signed_payload_hash`
- `document_signature_events`: append-only audit trail เช่น requested, approved, signed, rejected, revoked พร้อม actor, เวลา และ event hash

`document_signatures` ต้องเก็บ snapshot ของชื่อและตำแหน่ง ณ เวลาที่เซ็น (`signer_first_name`, `signer_last_name`, `signer_position`) เพื่อให้ประวัติลายเซ็นไม่เปลี่ยนเมื่อผู้ใช้แก้ profile ภายหลัง การเก็บ private key ให้เป็นหน้าที่ของ signing provider/KMS ผ่าน reference เท่านั้น

### 2. Profile API

เพิ่มโมดูล logic แยกสำหรับ profile เพื่อให้ mapping, validation และ Supabase writes ทดสอบได้โดยไม่ต้องเปิด HTTP server:

- `getAppUserProfile({ client, userId, request })`
- `updateAppUserProfile({ client, userId, input, request })`

เพิ่ม routes:

- `GET /api/auth/profile` อ่าน profile ของ `request.auth.userId`
- `PATCH /api/auth/profile` รับ JSON `{ firstName, lastName, companyPositionId }` และแก้เฉพาะ row ของ `request.auth.userId`

response ใช้รูปแบบ:

```json
{
  "profile": {
    "firstName": "ชื่อ",
    "lastName": "นามสกุล",
    "companyPositionId": "position-uuid",
    "companyPositionLabel": "ผู้จัดการ",
    "displayName": "ชื่อจาก LINE",
    "pictureUrl": "https://..."
  }
}
```

เมื่อ auth mode ไม่ใช่ LINE, profile API ไม่ควรพยายามอ่านจาก local file หรือรับ user id จาก client; ให้ตอบสถานะที่บอกว่า profile ใช้ได้เฉพาะ LINE session

การแก้ไขต้องใช้ server-side `userId` จาก session เสมอ และต้องไม่ให้ body มีผลต่อ target row หรือสิทธิ์

### 3. Profile page and navigation

เพิ่ม:

- `forms/user-profile.html`
- `forms/user-profile.logic.browser.js`
- static route `/user-profile`

หน้าแสดงชื่อจาก LINE แบบอ่านอย่างเดียว โหลดตัวเลือกจาก `GET /api/company-positions` และมีฟอร์มแก้ `firstName`, `lastName` และ `companyPositionId` พร้อมสถานะ loading/saved/error ตาม pattern ของหน้าตั้งค่าที่มีอยู่

เพิ่มรายการ `ข้อมูลส่วนตัว` ในกลุ่ม `ระบบ` ของ main menu ทุกหน้า โดยใช้ path เดียวกัน

### 4. New-document autofill

เพิ่ม browser helper กลาง เช่น `forms/user-profile-autofill.browser.js` ที่:

1. เรียก `GET /api/auth/profile` เมื่อหน้าฟอร์มพร้อมใช้งาน
2. รวม `firstName` และ `lastName` ด้วยช่องว่างเป็นชื่อที่แสดงในเอกสาร แล้วใช้ `companyPositionLabel` เติม field ผู้ขอ/ผู้จัดทำที่ยังว่าง
3. ไม่เขียนทับค่าที่ผู้ใช้กรอกไว้แล้ว
4. ไม่ทำงานเมื่อหน้าอยู่ในโหมดโหลด draft, reopen เอกสาร, หรือมี document number เดิม
5. ไม่ต้องรอหรือทำให้ฟอร์มใช้ไม่ได้หาก profile API unavailable; แสดงสถานะที่เหมาะสมและให้ผู้ใช้กรอกเองได้

mapping:

- `expense-request`: `${firstName} ${lastName} -> requesterName`, `companyPositionLabel -> requesterRole`
- `substitute-receipt`: `${firstName} ${lastName} -> requesterName`, `companyPositionLabel -> requesterRole`
- `workflow-document`: `${firstName} ${lastName} -> requesterName`; shell นี้ไม่มี `requesterRole` ใน payload ปัจจุบัน

เมื่อ autofill สำเร็จ ค่าเหล่านี้จะถูกส่งไปพร้อม payload ตอน save/submit ตาม flow เดิม จึงเป็น snapshot ของเอกสาร ไม่ใช่ reference ที่ต้องอ่าน profile ทุกครั้ง

### 5. LINE intake fallback

เส้นทางสร้างใบเบิกจ่ายจาก LINE intake จะอ่าน profile ของ `request.auth.userId` ตอนสร้าง payload และใช้ชื่อเต็มกับ `companyPositionLabel` เป็น fallback เฉพาะเมื่อ body ไม่มี `requesterName` หรือ `requesterRole`:

- body ที่ส่งค่ามาแล้วมี precedence สูงกว่า profile
- profile ที่ว่างให้ fallback เป็นค่าเดิมจาก LINE display name หรือค่าว่างตาม flow เดิม
- owner binding ยังคงใช้ user id จาก session และไม่รับจาก body

fallback นี้ไม่เปลี่ยนเอกสารที่สร้างไปแล้ว และไม่ทำให้การแก้ profile ย้อนกลับไปแก้ payload เก่า

## Error handling and security

- API profile ใช้ auth middleware เดิมและคืน `401` เมื่อไม่มี/มี session ที่ใช้ไม่ได้
- update ที่ไม่ผ่าน validation คืน `400` พร้อมข้อความที่ปลอดภัยต่อผู้ใช้
- Supabase configuration/provider failure ใช้รูปแบบ `503` เดียวกับ LINE auth ที่มีอยู่
- ห้าม log ค่า profile เต็ม ๆ หรือข้อมูล session/token
- PATCH ต้องใช้ allowlist เฉพาะ `firstName`, `lastName`, `companyPositionId`; ห้าม mass-assignment ฟิลด์ใน `app_users`, `company_positions` หรือ role tables

## Testing strategy

เพิ่มหรือแก้ tests ให้ครอบคลุม:

- profile mapping จาก snake_case และ validation ของชื่อ/นามสกุล/ตำแหน่ง
- company-position master seed, active/inactive filtering และการโหลด dropdown จาก API แทนค่า hardcode เดิม
- profile read/update ใช้ user id จาก session และไม่ยอมรับ target id จาก body
- HTTP API: อ่าน/บันทึก profile, unauthenticated request, invalid payload และ provider failure
- HTML profile page มี fields, API endpoint และเมนูหลักมีลิงก์ครบ
- browser autofill รวม first/last name เติมเฉพาะเอกสารใหม่ ไม่ทับค่าที่มีอยู่ และไม่ทำงานกับ draft/reopened document
- LINE intake ใช้ profile เป็น fallback เฉพาะช่องที่ body ไม่ส่งมา
- existing document payload ยังคงเป็น snapshot หลัง profile ถูกแก้ไขภายหลัง
- profile feature ไม่เพิ่มสิทธิ์ใหม่และไม่เปลี่ยนผลของ authorization matrix เดิม

## Rollout and compatibility

ตาราง `app_user_profiles` สร้างแยกและมีค่า default เป็นค่าว่าง จึงรองรับผู้ใช้เดิมและ migration ที่รันกับฐานข้อมูลซึ่งมี `app_users` อยู่แล้วได้ การทำงานเดิมยังคงใช้ `display_name` ของ LINE ได้เมื่อผู้ใช้ยังไม่ได้กรอก profile ค่า `requesterRole` ในเอกสารเก่าจะไม่ถูก rewrite เมื่อ master ตำแหน่งถูกแก้ไข
