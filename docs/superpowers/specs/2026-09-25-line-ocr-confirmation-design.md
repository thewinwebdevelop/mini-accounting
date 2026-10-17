# LINE OCR Confirmation and Expense Draft Design

## Outcome

ให้ผู้ใช้ส่งรูป invoice/receipt หรือ PDF จาก LINE แล้วเปิด Mini App เพื่อตรวจผล OCR, แก้ข้อมูลที่ไม่ถูกต้อง และยืนยันสร้างใบเบิกจ่ายแบบร่างใน lifecycle เดิมของระบบ

## Decisions

- OCR ใช้ provider interface ที่มี `manual` และ `http` adapter; ไม่ผูก domain logic กับ vendor รายเดียว
- `manual` เป็นค่าเริ่มต้นที่ปลอดภัยเมื่อยังไม่ได้ตั้ง OCR endpoint
- OCR ไม่สามารถยืนยันหรืออนุมัติเอกสารเองได้ ทุกค่าที่อ่านได้เป็น suggestion และต้องผ่าน user confirmation
- การยืนยันจะสร้าง `expense_request` สถานะ `draft` พร้อมแนบไฟล์ต้นฉบับเป็น evidence `receipt`
- Google Sheets ไม่ถูกเขียนจาก webhook หรือการสร้าง draft; ยังคง sync ตาม approval/completion lifecycle เดิม
- ผู้ใช้ที่อยู่ใน LINE auth mode ต้องเป็นเจ้าของ intake และสิทธิ์สร้างเอกสารผ่าน existing permission matrix

## Data flow

1. `GET /api/line-intakes/:id` โหลด intake และ trigger OCR ครั้งแรก
2. server อ่าน raw bytes จาก local store หรือ Supabase Storage
3. OCR adapter คืน `fields`, `confidence`, `warnings`, `provider`
4. Mini App แสดง fields ที่แก้ไขได้ พร้อมเตือนเมื่อ OCR ไม่ได้ตั้งค่า/ความมั่นใจต่ำ
5. `POST /api/line-intakes/:id/confirm` validate canonical expense fields, สร้าง draft ผ่าน `saveExpenseDraft`, และ mark intake confirmed
6. ผู้ใช้เปิด draft เดิมใน expense workflow เพื่อแก้ไข/submit; ผู้มีสิทธิ์อนุมัติเป็นผู้ทำให้ Sheets sync ตามกติกาเดิม

## OCR contract

Input: `{bytes, contentType, fileName}`

Output: `{provider, status, confidence, fields, warnings}` where fields are limited to:

- `accountingMonth`, `expenseDate`, `vendorName`, `taxId`, `documentNo`
- `description`, `amountBeforeVat`, `vatAmount`, `withholdingTax`, `grossAmount`

The HTTP adapter sends base64 bytes and metadata to a configured server-side endpoint and never exposes its API key to the browser.

## Safety

- Validate all confirmed values again with the existing expense request validation.
- Recalculate totals from editable line fields; never trust OCR totals as authoritative.
- Do not accept `ownerUserId`, status, request number, folder path, or approval fields from the browser.
- Preserve original file bytes and never expose storage object paths in API responses.
- Failed OCR remains retryable and does not create a document.

## Acceptance criteria

1. manual provider returns a deterministic pending-review result without inventing financial values
2. HTTP provider receives bytes with a server-only API key and normalizes a safe response
3. review API exposes OCR fields but no private storage metadata
4. confirm rejects missing/invalid accounting, requester, payee, purpose, or amount data
5. confirm creates exactly one expense draft with the original file as receipt evidence
6. repeated GET is idempotent; repeated confirm returns the existing created draft
7. no Google Sheets call occurs during intake or draft creation
