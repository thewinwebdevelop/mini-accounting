# Inventory System Design

วันที่: 2026-09-04
โปรเจกต์: หจก.สวีทเฮาส์ local accounting web app
สถานะ: Design approved in chat, pending written spec review

## Purpose

สร้างระบบสต๊อกสินค้าใหม่ในแอปนี้ก่อนต่อยอดใบรับรองแทนใบเสร็จรับเงิน เพื่อให้เอกสารซื้อสต๊อกสามารถเลือก SKU ที่มีอยู่ในคลัง และบันทึกรับเข้า stock card ได้อย่างถูกต้องในอนาคต

ระบบนี้ต้องรองรับร้านเสื้อผ้าที่ขายบน Shopee และ TikTok Shop โดยเก็บสินค้าในระดับ SKU + สี + ไซซ์ และออกแบบให้ต่อยอดไปสู่การตัดสต๊อกจาก order platform ได้

## Current Context

ระบบปัจจุบันมีฟีเจอร์ใบเบิกจ่ายอยู่แล้ว:

- ฟอร์ม `forms/expense-request.html`
- business logic `forms/expense-request.logic.js`
- local server และ file persistence `forms/local-server.logic.js`
- PDF generator `scripts/generate_expense_pdfs.py`
- raw evidence storage ใต้โฟลเดอร์เอกสารแต่ละใบ

ยังไม่พบระบบ inventory เดิมใน repo จึงจะสร้างเป็น subsystem ใหม่ โดยไม่ผูก logic สต๊อกเข้ากับใบเบิกจ่ายโดยตรง

## Architectural Decision

ใช้ SQLite เป็นฐานข้อมูลกลางสำหรับข้อมูลที่ต้อง query และเชื่อมกัน เช่น สินค้า, SKU, stock movement, และ stock card

เหตุผล:

- ข้อมูลสต๊อกต้องค้นหาและรวมยอดย้อนหลังบ่อยกว่าไฟล์ JSON ธรรมดา
- movement ledger ต้องรักษาความสัมพันธ์ระหว่างเอกสาร, SKU, จำนวน, และต้นทุน
- SQLite ยังเป็น local-first ใช้ง่าย แต่พร้อมย้ายไป backend เต็มรูปแบบภายหลัง
- PDF และ raw attachments ยังควรเก็บเป็นไฟล์ในโฟลเดอร์เดิม แล้วให้ฐานข้อมูลเก็บ reference/path

## Module Boundaries

### Inventory Module

รับผิดชอบ:

- master สินค้าแม่
- Stock SKU จริงในคลัง
- stock movement ledger
- stock card
- ยอดคงเหลือ ต้นทุนต่อหน่วย และมูลค่าสต๊อก

ไม่รับผิดชอบ:

- สร้าง PDF ใบเบิกจ่ายหรือใบรับรองแทนใบเสร็จ
- จัดการ raw evidence files
- ตรวจเอกสารภาษี

### Expense Document Module

รับผิดชอบ:

- ใบเบิกจ่าย
- ใบรับรองแทนใบเสร็จรับเงิน
- PDF packet
- raw attachments

เมื่อเอกสารประเภทซื้อสินค้าเพื่อขายถูก submit ในอนาคต module นี้จะเรียก inventory module ผ่าน function/API ที่ชัดเจนเพื่อสร้าง stock movement

### Future Sales Module

รับผิดชอบในอนาคต:

- mapping รายการขาย Shopee/TikTok เข้ากับ Sale SKU
- แปลง Sale SKU หรือ Bundle SKU เป็น Stock SKU ที่ต้องตัด
- สร้าง movement ประเภท `sale_out`

เฟสแรกยังไม่สร้าง UI หรือ import order แต่ schema ต้องไม่ปิดทางส่วนนี้

## SKU Model

ระบบแยก SKU เป็น 2 ชั้น

### Stock SKU

Stock SKU คือของจริงที่นับในคลัง รับเข้า ตัดออก ตรวจนับ และคำนวณต้นทุน เช่น:

- `SHIRT-A-BLACK-M`
- `SKIRT-B-BLACK-M`

Stock card และ stock movement จะผูกกับ Stock SKU เสมอ

### Sale SKU / Bundle SKU

Sale SKU คือสิ่งที่ลูกค้าเห็นบน marketplace หรือ variation ที่ขายหน้าร้าน เช่น:

- `SET-A-ONLY`
- `SET-A-SKIRT`

Sale SKU อาจเป็นสินค้าเดี่ยวหรือ bundle ก็ได้ โดยผูกกับ Stock SKU ผ่านตาราง `bundle_components`

ตัวอย่าง:

| sale_sku | stock_sku | quantity |
|---|---|---:|
| SET-A-ONLY | SHIRT-A-BLACK-M | 1 |
| SET-A-SKIRT | SHIRT-A-BLACK-M | 1 |
| SET-A-SKIRT | SKIRT-B-BLACK-M | 1 |

เฟสแรกจะเตรียม schema สำหรับ Sale SKU และ bundle ไว้ แต่ UI หลักจะเน้น Stock SKU และการรับเข้า

## Data Model

### products

สินค้าแม่ เช่น เสื้อ A หรือกระโปรง B

Fields:

- `id`
- `product_code`
- `name`
- `category`
- `description`
- `status`
- `created_at`
- `updated_at`

### stock_skus

SKU จริงในคลัง แยกสีและไซซ์

Fields:

- `id`
- `product_id`
- `sku`
- `color`
- `size`
- `barcode`
- `default_unit_cost`
- `status`
- `created_at`
- `updated_at`

Constraints:

- `sku` ต้อง unique
- `product_id` อ้างอิง `products.id`

### stock_movements

สมุดรายวันสต๊อกของ Stock SKU

Fields:

- `id`
- `movement_no`
- `stock_sku_id`
- `movement_type`
- `movement_date`
- `quantity`
- `unit_cost`
- `total_cost`
- `reference_type`
- `reference_no`
- `note`
- `created_at`

Movement types เริ่มต้น:

- `purchase_in`: รับเข้าจากการซื้อสินค้า
- `sale_out`: ตัดออกจากการขายในอนาคต
- `return_in`: คืนสินค้าจากลูกค้าในอนาคต
- `adjustment_in`: ปรับเพิ่ม
- `adjustment_out`: ปรับลด

Rules:

- `quantity` เก็บเป็นจำนวนบวกเสมอ
- direction ตีความจาก `movement_type`
- movement รับเข้าจากการซื้อสินค้าต้องมี `unit_cost` และ `total_cost`
- `total_cost` ควรเท่ากับ `quantity * unit_cost` ยกเว้นกรณี rounding ที่ระบบคุมไว้
- movement ที่เกิดจากเอกสารต้องมี `reference_type` และ `reference_no`

### sale_skus

SKU หรือ variation ที่ขายหน้าร้าน/marketplace

Fields:

- `id`
- `sale_sku`
- `display_name`
- `platform`
- `platform_product_id`
- `platform_variation_id`
- `status`
- `created_at`
- `updated_at`

เฟสแรกสร้าง schema ได้ แต่ยังไม่จำเป็นต้องมี UI

### bundle_components

สูตรแปลง Sale SKU เป็น Stock SKU ที่ต้องตัด

Fields:

- `id`
- `sale_sku_id`
- `stock_sku_id`
- `quantity`
- `created_at`

Constraints:

- คู่ `sale_sku_id + stock_sku_id` ต้อง unique
- `quantity` ต้องมากกว่า 0

## First Slice Scope

เฟสแรกให้ทำระบบใช้งานจริงขั้นต่ำ:

1. สร้าง SQLite database และ migration bootstrap
2. สร้าง inventory logic module สำหรับ CRUD สินค้า/SKU และบันทึก stock movement
3. เพิ่ม API ใน local server:
   - list products
   - create/update product
   - list stock SKUs
   - create/update stock SKU
   - create purchase-in movement
   - get stock card by SKU
   - get inventory balance list
4. เพิ่มหน้า UI:
   - รายการสินค้า/SKU
   - เพิ่ม/แก้ SKU
   - รับสินค้าเข้าคลัง
   - stock card
   - ยอดคงเหลือ
5. เพิ่มเมนูจากหน้าหลักและ top menu ไปยังระบบสต๊อก
6. เพิ่ม tests สำหรับ logic และ API-level behavior ที่สำคัญ

## Purchase-In Flow

ผู้ใช้สามารถรับสินค้าเข้าคลังจากหน้าระบบสต๊อกโดยตรง:

1. เลือก Stock SKU ที่มีอยู่ หรือสร้างสินค้าแม่และ Stock SKU ใหม่
2. กรอกวันที่รับเข้า
3. กรอกจำนวน
4. กรอกต้นทุนต่อหน่วย
5. ระบบคำนวณต้นทุนรวมของรายการรับเข้า
6. ระบุ reference เช่น `manual` หรือเลขเอกสารในอนาคต
7. ระบบสร้าง `stock_movements` ประเภท `purchase_in`
8. หน้า balance และ stock card แสดงยอดใหม่ ต้นทุนเฉลี่ย และมูลค่าสต๊อกทันที

## Balance Calculation

ยอดคงเหลือคำนวณจาก `stock_movements`:

- movement เข้าเพิ่มยอด
- movement ออกลดยอด
- ต้นทุนเฉลี่ยเบื้องต้นคำนวณจาก purchase-in movements ที่มีต้นทุน
- มูลค่าสต๊อกเบื้องต้นคำนวณจาก `quantity_on_hand * average_unit_cost`

เฟสแรกสามารถคำนวณ balance แบบ query-time จาก movement ledger เพื่อความถูกต้องและลดความเสี่ยงเรื่อง cache เพี้ยน ถ้าข้อมูลโตขึ้นจึงค่อยเพิ่มตาราง snapshot/cache

เฟสแรกใช้ต้นทุนเฉลี่ยแบบง่ายจาก movement รับเข้าที่มีต้นทุน เพื่อให้ผู้ใช้เห็นต้นทุนสินค้าได้ทันที ส่วน costing แบบ FIFO หรือ weighted average รายงวดเต็มรูปแบบยังอยู่นอก scope เฟสแรก

## Future Expense Integration

หลังจากระบบสต๊อกพร้อม จะเพิ่มใบรับรองแทนใบเสร็จรับเงินใน expense document module:

1. ผู้ใช้เลือกประเภทเอกสารเป็นใบรับรองแทนใบเสร็จรับเงิน
2. ถ้าเลือกประเภทค่าใช้จ่ายเป็นซื้อสินค้าเพื่อขาย ระบบแสดงส่วนเลือก Stock SKU
3. ผู้ใช้เลือก SKU, สี, ไซซ์, จำนวน, ต้นทุนต่อหน่วย
4. ระบบคำนวณต้นทุนรวมของ SKU แต่ละรายการ
5. ระบบสร้าง PDF ใบรับรองแทนใบเสร็จรับเงิน
6. ระบบรวม raw evidence เข้า PDF packet เดียวกัน
7. ระบบเก็บ raw evidence ในโฟลเดอร์เอกสาร
8. ระบบเรียก inventory module เพื่อสร้าง `purchase_in` movement โดยอ้างอิงเลขเอกสารพร้อมต้นทุนต่อหน่วยและต้นทุนรวม

ต้องป้องกันการบันทึกซ้ำเมื่อแก้ไขเอกสารเดิม โดย movement ที่มาจากเอกสารควรใช้ `reference_type + reference_no` เพื่อ identify และ regenerate/update อย่างมีหลักเกณฑ์ในเฟส integration

## Future Sales Deduction Flow

เมื่อต่อ Shopee/TikTok order:

1. import order line จาก platform
2. map platform variation เข้ากับ `sale_skus`
3. อ่าน `bundle_components`
4. สร้าง `sale_out` movement ให้ Stock SKU จริงทุกตัวใน bundle
5. stock card ของ Stock SKU แสดงการตัดสต๊อกพร้อม reference order

ตัวอย่าง:

- ลูกค้าซื้อ `SET-A-ONLY` ระบบตัด `SHIRT-A-BLACK-M` 1 ชิ้น
- ลูกค้าซื้อ `SET-A-SKIRT` ระบบตัด `SHIRT-A-BLACK-M` 1 ชิ้น และ `SKIRT-B-BLACK-M` 1 ชิ้น

## Error Handling

ต้องตรวจ:

- SKU ซ้ำ
- product หายหรือถูกปิดใช้งาน
- quantity ไม่มากกว่า 0
- unit cost ติดลบ
- purchase-in ไม่มีต้นทุนต่อหน่วย
- total cost ไม่ตรงกับ quantity และ unit cost ในกรณีที่ผู้ใช้ส่งค่ามาเอง
- movement type ไม่ถูกต้อง
- reference ซ้ำในกรณี integration จากเอกสารในอนาคต

API ส่ง JSON error ที่อ่านง่ายเหมือน endpoint เดิม

## Testing

เพิ่ม test อย่างน้อย:

- migration/bootstrap สร้าง database ได้
- create product และ SKU สำเร็จ
- ป้องกัน SKU ซ้ำ
- purchase-in movement เพิ่ม balance
- purchase-in movement เก็บ unit cost และ total cost
- stock card เรียง movement ตามวันที่/เวลา
- balance คำนวณจาก movement เข้า/ออก ต้นทุนเฉลี่ย และมูลค่าสต๊อกถูกต้อง
- bundle schema รองรับ sale SKU กับ components แม้ยังไม่มี UI

## Out Of Scope For First Slice

ยังไม่ทำในเฟสแรก:

- import order จาก Shopee/TikTok
- UI จัดการ Sale SKU/Bundle SKU แบบเต็ม
- ตัดสต๊อกอัตโนมัติจากยอดขาย
- ใบรับรองแทนใบเสร็จรับเงิน
- เชื่อมใบเบิกจ่ายเข้าสต๊อก
- multi-user account, auth, role permission
- FIFO/weighted average costing แบบรายงวดเต็มรูปแบบ

## Open Decisions For Implementation Plan

เพื่อเริ่ม implementation plan ให้เลือก technical detail เหล่านี้:

- ใช้ SQLite library ตัวใดใน Node local server
- เก็บ database file ที่ path ใด เช่น `data/sweet-house.sqlite`
- UI สต๊อกจะแยกเป็นไฟล์เดียวก่อน หรือแยกหลายหน้า
- จะสร้าง API แบบ REST endpoint ตรง ๆ ตาม pattern เดิม หรือมี router helper เล็ก ๆ เพื่อลดความยาว `local-server.mjs`

คำแนะนำเบื้องต้น: เริ่มด้วย REST endpoint ตาม pattern เดิมเพื่อให้ scope แคบ แต่แยก business logic และ database access ไปอยู่ไฟล์ `forms/inventory.logic.js` หรือ `forms/inventory-db.logic.js` เพื่อไม่ให้ server file โตเกินไป
