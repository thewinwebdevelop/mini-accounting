# ชุดรวมส่งตรวจเอกสารเบิกจ่าย

> Template: Expense Audit Packet

## ข้อมูลแฟ้ม

| รายการ | ข้อมูล |
|---|---|
| เลขที่เอกสาร | {{request_no}} |
| ชื่อแฟ้ม | {{packet_name}} |
| เดือนบัญชี | {{accounting_month}} |
| ประเภทคำขอ | {{request_type}} |
| ยอดจ่ายสุทธิ | {{net_payment_total}} |
| สถานะ | {{status}} |
| โฟลเดอร์ raw | {{raw_folder_path}} |
| Google Drive folder | {{google_drive_folder_url}} |

## รายการเอกสารในชุดรวม

| รหัส | เอกสาร | สถานะ | หน้า/ไฟล์ raw |
|---|---|---|---|
| FORM | ใบเบิกจ่ายค่าใช้จ่าย | {{form_status}} | {{form_page_or_raw}} |
| TAX | Tax & Accounting Review | {{tax_review_status}} | {{tax_review_page_or_raw}} |
| A1 | ใบเสร็จรับเงิน | {{receipt_status}} | {{receipt_page_or_raw}} |
| A2 | ใบกำกับภาษีเต็มรูป | {{tax_invoice_status}} | {{tax_invoice_page_or_raw}} |
| A3 | หลักฐานการจ่ายเงินให้ผู้ขาย | {{vendor_payment_status}} | {{vendor_payment_page_or_raw}} |
| A4 | หลักฐานโอนคืนพนักงาน / บริษัทจ่ายตรง | {{reimbursement_status}} | {{reimbursement_page_or_raw}} |
| A5 | รูปสินค้า / หลักฐานการใช้งานจริง | {{business_evidence_status}} | {{business_evidence_page_or_raw}} |
| A6 | หลักฐานประกอบอื่น | {{other_evidence_status}} | {{other_evidence_page_or_raw}} |

## Tax & Accounting Review

| รายการตรวจ | ผลตรวจ | หมายเหตุ |
|---|---|---|
| รายจ่ายเกี่ยวข้องกับกิจการ | {{business_related_check}} | {{business_related_note}} |
| เอกสารจากผู้ขายอ่านชัดและตรงกับรายการ | {{vendor_document_check}} | {{vendor_document_note}} |
| ใบกำกับภาษีเต็มรูปมีรายการสำคัญครบ | {{full_tax_invoice_check}} | {{full_tax_invoice_note}} |
| VAT ใช้เป็นภาษีซื้อได้ | {{input_vat_final_decision}} | {{input_vat_final_note}} |
| ต้องหักภาษี ณ ที่จ่าย | {{withholding_final_decision}} | {{withholding_final_note}} |
| หลักฐานชำระเงินครบ | {{payment_evidence_check}} | {{payment_evidence_note}} |
| ไฟล์ raw ถูกจัดเก็บและอ้างอิงได้ | {{raw_file_check}} | {{raw_file_note}} |

## หมายเหตุ

- เอกสารชุดนี้เป็นสำเนารวบรวมเพื่อใช้ตรวจสอบ ไม่ทดแทนไฟล์หลักฐานดิบในโฟลเดอร์ raw
- กรณีใช้ภาษีซื้อ ต้องตรวจใบกำกับภาษีเต็มรูปจากไฟล์ต้นฉบับเสมอ
- กรณีเข้าเงื่อนไขหัก ณ ที่จ่าย ต้องมีหลักฐานการนำส่งและหนังสือรับรองหัก ณ ที่จ่าย
- กรณีเอกสารไม่ครบ ให้ระบุเหตุผลและผู้อนุมัติข้อยกเว้นก่อนบันทึกบัญชี
