# Shopee Custom Label From Uploaded PDF Design

วันที่: 2026-10-17  
โปรเจกต์: หจก.สวีทเฮาส์ local accounting web app

## Goal

เพิ่ม workflow แยกสำหรับผู้ใช้ที่ยังไม่สามารถใช้ Shopee API ได้ โดยผู้ใช้ upload PDF ใบปะหน้าจาก Shopee แบบหลาย order แล้วระบบอ่านข้อมูลทีละหน้า, ให้ผู้ใช้ map manual SKU เป็นชุด bundle ต่อรายการสินค้า, แสดง preview เทียบต้นฉบับกับผลลัพธ์ทีละหน้า และบันทึก PDF custom label ใหม่พร้อม mapping ที่ใช้สร้างไฟล์นั้น

Workflow นี้ไม่พึ่ง Shopee API และไม่ใช้ order ที่ sync จาก `platform_orders` เป็นข้อมูลหลัก

## Confirmed Input Characteristics

ไฟล์ตัวอย่างที่ใช้เป็น fixture: `ใบปะหน้าพัสดุ & Packing List.Standard Delivery - ส่งธรรมดาในประเทศ_19 (13).pdf`

- 19 หน้า, หน้าเป็น A4 ขนาด 595 x 842 points
- 1 หน้า = 1 order
- ส่วนจัดส่ง, recipient, barcode/QR, tracking และ Shopee Order No. อยู่ด้านบน
- ตารางสินค้าอยู่ด้านล่าง มีคอลัมน์ชื่อสินค้า, ตัวเลือกสินค้า และจำนวน
- ข้อความสินค้าอาจขึ้นหลายบรรทัด
- PDF มี text layer และไม่เข้ารหัส จึงไม่ต้องทำ OCR ใน MVP
- ฟอนต์บางตัว encode เครื่องหมายวรรณยุกต์ไทยเป็น private-use glyph เช่น U+F70A/U+F70B/U+F70C ต้อง normalize ก่อนสร้าง mapping key

ตัวอย่างที่ได้รับมีหนึ่งรายการต่อหน้า แต่ parser จะรองรับหลายรายการต่อหน้าโดยจัดกลุ่มจากตำแหน่งคอลัมน์และบรรทัดของตาราง

## User Flow

```text
เปิดหน้า Shopee Custom Label
  -> Upload PDF
  -> ระบบสร้าง session และ parse ทุกหน้า
  -> แสดง order/page list พร้อมสถานะ parse
  -> ผู้ใช้เลือกหน้าและกรอก manual SKU bundle ต่อรายการสินค้า
  -> mapping เดิมจากชื่อสินค้า + ตัวเลือกสินค้าเติมให้อัตโนมัติ
  -> ผู้ใช้ตรวจสอบ PDF ต้นฉบับและ PDF ใหม่แบบหน้าเดียวกันซ้าย-ขวา
  -> Preview สร้าง PDF ชั่วคราว
  -> Save ตรวจความครบถ้วน, บันทึก mapping template และ snapshot
  -> เก็บ PDF custom label ถาวรและเปิดดาวน์โหลด/พิมพ์
```

## Scope

### Included

- Upload PDF เดียวต่อ session และ parse ทุกหน้า
- รองรับ text-based Shopee label template ตาม fixture นี้
- 1 หน้า = 1 order และตรวจจับ Shopee Order No.
- รองรับหลายรายการสินค้าและข้อความที่ wrap หลายบรรทัด
- Manual SKU bundle ไม่จำกัดจำนวนต่อรายการสินค้า
- แต่ละ manual SKU มีจำนวนเต็มบวกของตัวเอง
- ค้นหา/เลือก SKU ที่มีอยู่ในระบบ หรือกรอก SKU ดิบเอง
- จำ bundle mapping ด้วยคู่ `ชื่อสินค้า + ตัวเลือกสินค้า` แบบ normalized
- Autofill mapping เดิม แต่แก้ไขได้ทุกครั้ง
- คูณจำนวน bundle ต่อจำนวนสินค้าของ Shopee line
- รวม manual SKU เดียวกันเป็นแถวเดียวใน PDF ผลลัพธ์
- Preview และ Save แยกกัน
- PDF ผลลัพธ์คงส่วนจัดส่งด้านบนจากต้นฉบับ และแทนที่ส่วนรายการสินค้าด้านล่างด้วยตาราง `Manual SKU / จำนวน`
- แสดง PDF ต้นฉบับและผลลัพธ์แบบเลือกหน้าเดียวกันเพื่อช่วยตรวจสอบ
- เก็บ source PDF เดิม, output PDF และ mapping snapshot แยกกัน

### Non-goals

- Shopee API, OAuth, sync order หรือ arrange shipment
- OCR สำหรับ PDF ที่เป็นภาพสแกน
- การแก้ไขชื่อผู้รับ, ที่อยู่, tracking, barcode หรือส่วนจัดส่ง
- การเดา bundle จากชื่อสินค้าโดย AI
- การทำ stock movement, reservation หรือ accounting movement
- การสร้าง layout ใหม่ทั้งหน้าแทนต้นฉบับ
- การแยก bundle quantity เป็นความหมายอื่นนอกจากจำนวนที่ผู้ใช้กรอก

## Bundle Mapping Semantics

การกรอกต่อรายการสินค้า Shopee จะเป็นรายการแบบ:

```json
[
  {"sku": "DRESS-BLUE", "quantity": 1},
  {"sku": "SKIRT-LACE", "quantity": 1},
  {"sku": "BELT", "quantity": 2}
]
```

จำนวนใน bundle หมายถึงจำนวนต่อสินค้า Shopee หนึ่งชิ้น เมื่อ line quantity เป็น `n` ระบบจะคูณจำนวนทุก component ด้วย `n` แล้วรวมรายการที่มี SKU เดียวกันทั่วทั้ง order/page ตามลำดับที่พบครั้งแรก เช่น:

```text
Shopee line quantity = 2
DRESS-BLUE x 1
BELT x 2

ผลลัพธ์ใน label:
DRESS-BLUE x 2
BELT x 4
```

Mapping template จะผูกกับ `normalized_product_name + normalized_option_name` และเก็บเป็นทั้ง bundle ไม่ใช่ค่าข้อความเดียว เมื่อพบคู่เดิมใน session ใหม่ ระบบจะเติม bundle ทั้งชุดให้อัตโนมัติ

## Design Alternatives

### Recommended: Overlay lower product section

ใช้ PDF ต้นฉบับเป็น background, วาดพื้นขาวทับเฉพาะ product table ด้านล่าง, แล้ววาดตาราง manual SKU ใหม่บนพื้นที่เดิม วิธีนี้คง barcode, QR, tracking, recipient และ layout ของ Shopee ได้ดีที่สุด และลดความเสี่ยงที่ carrier จะอ่านใบปะหน้าไม่ได้

### Rebuild page from extracted data

อ่านข้อมูลจัดส่งแล้วสร้าง A4 ใหม่ทั้งหมด วิธีนี้ควบคุม layout ง่ายกว่าในระยะยาว แต่เสี่ยงต่อ barcode/QR, ฟอนต์, ระยะขอบ และข้อมูล carrier ที่ parser อาจอ่านไม่ครบ จึงไม่เหมาะกับ MVP

### Generate a separate packing-list page

คงใบปะหน้าเดิมและสร้าง packing-list ใหม่อีกหน้า วิธีนี้ไม่ทำลายต้นฉบับ แต่ไม่ตรงกับความต้องการที่ต้องการให้ส่วนล่างของใบปะหน้าแสดง manual SKU และทำให้หยิบสินค้า/พิมพ์ตรวจสอบแยกกันมากขึ้น

## Architecture

### Browser page

สร้าง `forms/shopee-custom-label.html` และ `forms/shopee-custom-label.logic.browser.js` แยกจาก `shopee-shipment` โดยมี:

- file upload และ parse status
- page/order navigator พร้อมจำนวนหน้าที่ parse สำเร็จ/ต้องตรวจ
- item editor ต่อหน้า
- ช่องแก้ไขชื่อสินค้า, ตัวเลือก และจำนวนของแถวที่ parser อ่านได้ไม่ครบ พร้อมสถานะเตือน
- bundle rows เพิ่ม/ลบได้ไม่จำกัด
- SKU autocomplete จาก inventory พร้อมช่องกรอก raw SKU
- source PDF และ generated PDF แบบ side-by-side โดยใช้ page number เดียวกัน
- Preview, Save, Download และ Print controls

เมื่อเปลี่ยนหน้า ระบบจะโหลด mapping ของหน้านั้นเข้า editor และเปลี่ยน fragment `#page=n` ของ PDF viewer ทั้งสองฝั่งให้ตรงกัน

### Server logic

สร้าง `forms/shopee-custom-label.logic.js` สำหรับ:

- parse PDF session metadata
- normalize extracted Thai text และ mapping key
- validate item/bundle data
- load/save mapping templates
- build per-page overlay payload
- เรียก Python PDF helper และคืน public file metadata

สร้าง `scripts/shopee_custom_label_pdf.py` หรือขยาย helper เฉพาะทางที่แยกจาก Shopee API flow สำหรับ:

- extract text/word coordinates ด้วย `pdfplumber`
- render whiteout + replacement table ด้วย `pypdf`/`reportlab`
- merge output pages โดยรักษาขนาดและ rotation ของต้นฉบับ
- split/render source/output page previews เมื่อจำเป็น

Parser จะไม่ยึดข้อความเป็นบรรทัดเดียวอย่างเดียว แต่ใช้ทั้ง text และ bounding boxes:

1. ค้น `Shopee Order No.` และรหัส order บนหน้า
2. ค้น header ตารางด้านล่างจากตำแหน่ง/ข้อความที่ normalize แล้ว
3. ใช้ x ranges ของคอลัมน์เลขลำดับ, ชื่อสินค้า, ตัวเลือก และจำนวน
4. จัดกลุ่มคำที่อยู่ใน y band เดียวกันเป็นรายการเดียว และรวมบรรทัดต่อเนื่องจนถึงรายการถัดไปหรือ footer
5. ถ้าหา order no., item row หรือ quantity ไม่ได้ ให้บันทึก page status เป็น `needs_review` พร้อมข้อความเตือน; form ต้องเปิดให้ผู้ใช้แก้ชื่อสินค้า, ตัวเลือก และจำนวนของแถวนั้น แล้วจึงเปลี่ยนสถานะเป็นพร้อมตรวจสอบและ Save ได้

สำหรับ fixture นี้ parser ต้องแปลง private-use tone glyph อย่างน้อย:

- U+F70A -> Thai mai ek (U+0E48)
- U+F70B -> Thai mai tho (U+0E49)
- U+F70C -> Thai mai tri (U+0E4A)

พร้อม normalize Unicode, whitespace และ marker `(cid:0)` ที่เกิดจาก icon ใน PDF

### Persistence

เพิ่มตารางใน SQLite:

`shopee_custom_label_jobs`

- `id`
- `original_file_name`
- `source_file_path`
- `preview_file_path`
- `output_file_path`
- `page_count`
- `parsed_payload_json`
- `status`: `parsed`, `previewed`, `saved`, `failed`
- `error_message`
- `created_at`, `updated_at`

`shopee_custom_label_mappings`

- `id`
- `product_name_key`
- `option_name_key`
- `product_name_display`
- `option_name_display`
- `bundle_json` ซึ่งเป็น array ของ `{sku, quantity}`
- `created_at`, `updated_at`
- unique constraint บน `(product_name_key, option_name_key)`

เมื่อ Save ให้เก็บ mapping bundle ที่ใช้จริงไว้ใน `parsed_payload_json` ของ job ด้วย เพื่อให้ output PDF ย้อนกลับไปตรวจสอบได้แม้ mapping template ถูกแก้ภายหลัง

ไฟล์จะเก็บแยกใน `data/shopee-custom-labels/` และ source จะไม่ถูกเขียนทับ

### API

- `POST /api/shopee/custom-labels` รับ multipart PDF และสร้าง job/parse result
- `GET /api/shopee/custom-labels/:id` คืน parsed pages, items, autofill mapping และสถานะ
- `POST /api/shopee/custom-labels/:id/preview` รับ mapping snapshot แล้วสร้าง preview PDF
- `POST /api/shopee/custom-labels/:id/save` validate, persist mapping และสร้าง output PDF ถาวร
- `GET /api/shopee/custom-labels/:id/source` ส่ง source PDF inline
- `GET /api/shopee/custom-labels/:id/preview-file` ส่ง preview PDF inline
- `GET /api/shopee/custom-labels/:id/output` ส่ง output PDF inline/download
- reuse inventory SKU/product APIs ที่มีอยู่สำหรับ autocomplete โดยไม่สร้าง mapping ซ้ำกับ `platform_orders`

### PDF rendering

การ render จะใช้ page-size จาก source page เสมอและแทนที่ product block ด้านล่างจากเส้นคั่นตารางจนถึง footer ด้วย safe region ที่ไม่แตะ delivery region, barcode หรือ QR. พื้นที่ใหม่จะมี:

- header `Manual SKU` และ `จำนวน`
- หนึ่งแถวต่อ SKU หลังรวมยอด
- footer `Shopee Order No.` ที่วาดซ้ำจาก parsed/corrected order no. และไม่คงตารางสินค้าเก่าไว้ด้านหลัง
- จำนวนรวมของ manual SKU ที่คำนวณแล้ว ถ้าพื้นที่ของ template รองรับ โดยไม่ใช้แทนจำนวนรายการ Shopee ในการคำนวณ

หากจำนวน component มากกว่าพื้นที่ว่างใน template ให้ลด font/เพิ่ม line wrapping ภายใน product section เท่านั้น หากยังไม่พอให้ mark หน้าเป็น `needs_review` และไม่สร้าง output ที่ตัดข้อความ

## Error Handling

- reject non-PDF, encrypted PDF, empty PDF และไฟล์เกิน local body limit
- ถ้า PDF เป็นภาพสแกนหรือไม่มี text layer ให้แจ้งว่า MVP ยังไม่รองรับ OCR
- หน้าใด parse ไม่ครบจะแสดง warning แยกหน้า และเปิดให้แก้ parsed name/option/quantity ใน form; ข้อมูลหน้าที่สำเร็จจะไม่หาย
- SKU quantity ต้องเป็นจำนวนเต็มบวก
- ต้องกรอก bundle อย่างน้อยหนึ่ง SKU ต่อรายการสินค้าก่อน Preview/Save
- ห้าม Save ถ้ามีหน้า/item ที่ `needs_review` หรือมี bundle ไม่ครบ
- Preview ไม่บันทึก mapping template ถาวร
- Save เป็น idempotent ต่อ job โดยสร้าง output path เดิมและ update snapshot เดิม
- ต้นฉบับไม่ถูก overwrite และไฟล์ที่สร้างแล้วสามารถเปิดดู/ดาวน์โหลดได้แม้ mapping template ภายหลังเปลี่ยน

## Verification

- Node unit tests สำหรับ mapping key normalization, bundle validation, quantity multiplication/aggregation และ saved-template autofill
- Python tests สำหรับ fixture 19 หน้า: page count, order no., item name/option/quantity, wrapped text และ private-use Thai glyph normalization
- PDF tests ตรวจ page size/rotation, การคง delivery region และการมี manual SKU/quantity ใน text layer ของ output
- Test ว่าหลาย manual SKU และ duplicate SKU ถูก aggregate ถูกต้อง
- Test ว่า Preview ไม่เปลี่ยน mapping table และ Save บันทึก mapping + snapshot + output path
- Browser HTML tests ตรวจ route, upload, page navigator, side-by-side preview, add/remove bundle row, preview/save controls
- Local server API tests สำหรับ multipart upload, parse result, preview, save, source/output file access และ validation error
- Render fixture output ด้วย Poppler แล้วตรวจภาพอย่างน้อยหน้าแรก, หน้าที่มีข้อความยาว และกรณีหลาย SKU เพื่อยืนยันไม่มีทับ barcode/QR และไม่มีข้อความล้น

## Acceptance Criteria

- ผู้ใช้ upload ไฟล์ตัวอย่าง 19 หน้าแล้วระบบแยกได้ 19 orders โดยไม่พึ่ง Shopee API
- แต่ละหน้ามีข้อมูลชื่อสินค้า, ตัวเลือกสินค้า และจำนวนให้กรอก mapping ได้
- ผู้ใช้เพิ่ม manual SKU ได้หลายตัวต่อรายการ และกำหนดจำนวนแต่ละตัวได้
- ระบบจำ bundle ด้วยชื่อสินค้า+ตัวเลือก และเติมทั้ง bundle ใน session ถัดไป
- Order quantity คูณ bundle quantity และ SKU ซ้ำถูกรวมเป็นแถวเดียว
- ผู้ใช้เห็น PDF เดิมและ PDF ใหม่ของหน้าเดียวกันก่อน Save
- PDF ใหม่คงส่วนจัดส่ง/barcode/QR/tracking และส่วนล่างแสดงเฉพาะ Manual SKU กับจำนวน
- Save เก็บ mapping template, mapping snapshot และ PDF output โดยไม่แก้ source PDF
- ถ้า parser อ่านไม่ได้หรือ output ล้น ระบบ block Save พร้อมแจ้งหน้าที่ต้องแก้
- Existing Shopee API workflow, platform orders และ CSV import ทำงานเหมือนเดิม
