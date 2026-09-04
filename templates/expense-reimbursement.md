# ใบเบิกจ่ายค่าใช้จ่าย

> Template: Expense Reimbursement / Direct Payment Request

## 1. ข้อมูลเอกสาร

| รายการ | ข้อมูล |
|---|---|
| ชื่อนิติบุคคล | {{company_legal_name}} |
| เลขประจำตัวผู้เสียภาษี | {{company_tax_id}} |
| สำนักงานใหญ่/สาขา | {{company_branch}} |
| ที่อยู่ | {{company_address}} |
| เลขที่เอกสาร | {{request_no}} |
| วันที่จัดทำ | {{created_date}} |
| เดือนบัญชี | {{accounting_month}} |
| ประเภทคำขอ | {{request_type}} |
| สถานะเอกสาร | {{status}} |

## 2. ข้อมูลผู้ขอ

| รายการ | ข้อมูล |
|---|---|
| ชื่อผู้ขอ | {{requester_name}} |
| แผนก/ตำแหน่ง | {{requester_role}} |
| ช่องทางติดต่อ | {{requester_contact}} |
| วันที่เกิดค่าใช้จ่าย | {{expense_date}} |
| วัตถุประสงค์ทางธุรกิจ | {{business_purpose}} |

## 3. ข้อมูลการจ่าย

### กรณีเบิกคืนพนักงาน

| รายการ | ข้อมูล |
|---|---|
| ชื่อบัญชีพนักงาน | {{employee_bank_account_name}} |
| ธนาคาร | {{employee_bank_name}} |
| เลขบัญชี | {{employee_bank_account_no}} |
| วันที่พนักงานจ่ายจริง | {{employee_paid_date}} |

### กรณีบริษัทจ่ายตรงผู้ขาย

| รายการ | ข้อมูล |
|---|---|
| ชื่อผู้ขาย | {{vendor_name}} |
| เลขประจำตัวผู้เสียภาษีผู้ขาย | {{vendor_tax_id}} |
| ช่องทางการจ่าย | {{vendor_payment_method}} |
| กำหนดจ่าย | {{vendor_due_date}} |
| รายละเอียดบัญชีผู้ขาย | {{vendor_bank_detail}} |

## 4. รายการค่าใช้จ่าย

| ลำดับ | วันที่ | หมวด | รายละเอียด | ผู้ขาย | ยอดก่อน VAT | VAT | ยอดรวม | หัก ณ ที่จ่าย | ยอดจ่ายสุทธิ |
|---:|---|---|---|---|---:|---:|---:|---:|---:|
| {{line_no}} | {{line_date}} | {{category}} | {{description}} | {{line_vendor}} | {{amount_before_vat}} | {{vat_amount}} | {{gross_amount}} | {{withholding_tax}} | {{net_payment}} |

## 5. สรุปภาษีและบัญชี

| รายการ | ข้อมูล |
|---|---|
| ใช้ภาษีซื้อได้ | {{input_vat_claimable}} |
| มีใบกำกับภาษีเต็มรูป | {{full_tax_invoice}} |
| ผลตรวจชื่อผู้ซื้อในใบกำกับภาษี | {{tax_invoice_buyer_name_check}} |
| ผลตรวจเลขประจำตัวผู้เสียภาษี/สาขาผู้ซื้อ | {{tax_invoice_buyer_tax_id_check}} |
| ผลตรวจเลขที่/วันที่/รายการ/ยอด VAT | {{tax_invoice_required_items_check}} |
| ต้องหัก ณ ที่จ่าย | {{withholding_required}} |
| ประเภทเงินได้/ค่าใช้จ่ายเพื่อพิจารณาหัก ณ ที่จ่าย | {{withholding_income_type}} |
| หนังสือรับรองหัก ณ ที่จ่าย | {{withholding_certificate_status}} |
| หมวดบัญชี | {{accounting_category}} |
| ช่องทาง/โครงการ | {{sales_channel_or_project}} |
| ชื่อไฟล์ raw หลัก | {{primary_raw_file_names}} |
| วันที่อัปโหลด raw | {{raw_uploaded_date}} |
| ผู้ตรวจเอกสาร | {{document_reviewer}} |
| หมายเหตุบัญชี | {{accounting_note}} |

## 6. Checklist หลักฐาน

| หลักฐาน | สถานะ | รหัสอ้างอิง |
|---|---|---|
| ใบเสร็จรับเงิน | {{receipt_status}} | {{receipt_ref}} |
| ใบกำกับภาษีเต็มรูป | {{tax_invoice_status}} | {{tax_invoice_ref}} |
| สลิปจ่ายเงินให้ผู้ขาย | {{vendor_payment_status}} | {{vendor_payment_ref}} |
| สลิปโอนคืนพนักงาน / หลักฐานบริษัทจ่ายตรง | {{reimbursement_status}} | {{reimbursement_ref}} |
| ใบเสนอราคา / ใบแจ้งหนี้ | {{quote_or_invoice_status}} | {{quote_or_invoice_ref}} |
| รูปสินค้า / หลักฐานการใช้งานจริง | {{business_evidence_status}} | {{business_evidence_ref}} |
| หลักฐานประกอบอื่น | {{other_evidence_status}} | {{other_evidence_ref}} |

## 7. Tax & Accounting Review

| รายการตรวจ | ผลตรวจ | หมายเหตุ |
|---|---|---|
| รายจ่ายเกี่ยวข้องกับกิจการ | {{business_related_check}} | {{business_related_note}} |
| เอกสารจากผู้ขายอ่านชัดและตรงกับรายการ | {{vendor_document_check}} | {{vendor_document_note}} |
| ใบกำกับภาษีเต็มรูปมีรายการสำคัญครบ | {{full_tax_invoice_check}} | {{full_tax_invoice_note}} |
| VAT ใช้เป็นภาษีซื้อได้ | {{input_vat_final_decision}} | {{input_vat_final_note}} |
| ต้องหักภาษี ณ ที่จ่าย | {{withholding_final_decision}} | {{withholding_final_note}} |
| หลักฐานชำระเงินครบทั้งจ่ายผู้ขายและจ่ายคืน/จ่ายตรง | {{payment_evidence_check}} | {{payment_evidence_note}} |
| ไฟล์ raw ถูกจัดเก็บและอ้างอิงได้ | {{raw_file_check}} | {{raw_file_note}} |

## 8. การอนุมัติ

| บทบาท | ชื่อ | วันที่ | ลายเซ็น/หมายเหตุ |
|---|---|---|---|
| ผู้ขอเบิก | {{requester_approval_name}} | {{requester_approval_date}} | {{requester_signature_note}} |
| ผู้ตรวจเอกสารบัญชี | {{accounting_reviewer_name}} | {{accounting_reviewer_date}} | {{accounting_reviewer_note}} |
| ผู้อนุมัติ | {{approver_name}} | {{approver_date}} | {{approver_note}} |
| ผู้จ่ายเงิน | {{payer_name}} | {{payer_date}} | {{payer_note}} |
