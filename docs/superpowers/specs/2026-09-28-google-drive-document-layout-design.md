# Google Drive Document Layout Design

## Goal

จัดโครงสร้างไฟล์บน Google Drive ให้แยกเอกสาร standalone และ Workflow อย่างชัดเจน โดย Workflow หนึ่งรายการเก็บ raw และ PDF ทั้งชุดไว้ในโฟลเดอร์เดียว

## Remote layout

ค่า `driveBasePath` ยังคงเป็น root ที่ตั้งค่าไว้ เช่น `<ชื่อบริษัท>/เอกสารบัญชี` แล้วระบบเติมปีและเดือนจากเดือนบัญชี

Standalone:

```text
<บริษัท>/เอกสารบัญชี/<ปี>/<เดือน>/<ชื่อประเภทเอกสาร>/
  raw/
    <เลขที่เอกสาร>__<ชื่อไฟล์ต้นฉบับ>
  <เลขที่เอกสาร>__<ชื่อไฟล์ PDF>
```

ใช้โฟลเดอร์ประเภทเอกสารร่วมกันในเดือนเดียวกัน และเติมเลขเอกสารหน้าไฟล์เพื่อไม่ให้เอกสารหลายฉบับชนกัน

Workflow:

```text
<บริษัท>/เอกสารบัญชี/<ปี>/<เดือน>/<TXN ID> - <ชื่อธุรกรรม>/
  raw/
    <เลขที่เอกสารย่อย>__<ชื่อไฟล์ต้นฉบับ>
  <เลขที่เอกสารย่อย>__<ชื่อไฟล์ PDF>
  99_ชุดรวมเอกสาร_workflow-transaction.pdf
```

Workflow จะไม่อัปโหลดโฟลเดอร์ของเอกสารย่อยแยกอีกต่อไป ทุกไฟล์ของ child documents และ packet จะอยู่ใต้ root ของ Workflow เดียวกัน

## Compatibility and migration

- Local filesystem layout ไม่เปลี่ยน
- metadata การ sync เพิ่ม `layoutVersion: 2`
- metadata เดิมที่ไม่มี `layoutVersion` ถือเป็น layout เก่าและจะถูก sync ใหม่เมื่อสั่ง sync
- ไม่ลบโฟลเดอร์เก่าบน Google Drive อัตโนมัติ
- การ retry หลัง sync สำเร็จด้วย layout v2 ต้องไม่อัปโหลดไฟล์ซ้ำ

## Safety

- ชื่อโฟลเดอร์และไฟล์ remote ต้องตัด path separator/control characters ออก
- URL ของ root Workflow ต้องเป็น URL ที่ได้จาก Google Drive API
- ถ้า child ใดอ่านไฟล์ไม่ได้หรือ upload ไม่สำเร็จ ให้ Workflow sync ล้มเหลวและไม่รายงานว่า root bundle สำเร็จ

