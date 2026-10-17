import os
import tempfile
import unittest
from pathlib import Path

import pdfplumber

from substitute_receipt_pdf import baht_text, build_substitute_receipt_outputs, thai_date


class BahtTextTests(unittest.TestCase):
    def test_zero(self):
        self.assertEqual(baht_text("0"), "ศูนย์บาทถ้วน")

    def test_small_numbers(self):
        self.assertEqual(baht_text("1"), "หนึ่งบาทถ้วน")
        self.assertEqual(baht_text("10"), "สิบบาทถ้วน")
        self.assertEqual(baht_text("11"), "สิบเอ็ดบาทถ้วน")
        self.assertEqual(baht_text("20"), "ยี่สิบบาทถ้วน")
        self.assertEqual(baht_text("21"), "ยี่สิบเอ็ดบาทถ้วน")

    def test_hundreds(self):
        self.assertEqual(baht_text("100"), "หนึ่งร้อยบาทถ้วน")
        self.assertEqual(baht_text("101"), "หนึ่งร้อยเอ็ดบาทถ้วน")

    def test_millions(self):
        self.assertEqual(baht_text("1000000"), "หนึ่งล้านบาทถ้วน")
        self.assertEqual(
            baht_text("1234567.89"),
            "หนึ่งล้านสองแสนสามหมื่นสี่พันห้าร้อยหกสิบเจ็ดบาทแปดสิบเก้าสตางค์",
        )

    def test_satang(self):
        self.assertEqual(baht_text("0.25"), "ศูนย์บาทยี่สิบห้าสตางค์")

    def test_negative(self):
        self.assertEqual(baht_text("-50"), "ลบห้าสิบบาทถ้วน")


class ThaiDateTests(unittest.TestCase):
    def test_valid_date(self):
        self.assertEqual(thai_date("2026-09-05"), "5 กันยายน 2569")

    def test_empty_falls_back(self):
        self.assertEqual(thai_date(""), "-")
        self.assertEqual(thai_date(None), "-")

    def test_unparseable_returns_original(self):
        self.assertEqual(thai_date("not-a-date"), "not-a-date")


class SubstituteReceiptPdfTests(unittest.TestCase):
    def test_pdf_includes_payment_note(self):
        payload = {
            "documentKind": "substitute_receipt",
            "receiptNo": "SR-2026-09-0008",
            "receiptDate": "2026-09-04",
            "receiptType": "general_expense",
            "payeeName": "ร้านตัวอย่าง",
            "paymentNote": "จ่ายเงินสด 500 บาท\nโอนเงิน 2,000 บาท",
            "businessPurpose": "ค่าใช้จ่ายตัวอย่าง",
            "lines": [{"description": "ค่าใช้จ่าย", "quantity": "1", "unitCost": "2500", "lineTotal": "2500.00"}],
            "totals": {"totalAmount": "2500.00"},
        }
        with tempfile.TemporaryDirectory() as tmp:
            output_dir = Path(tmp) / "pdf"
            raw_dir = Path(tmp) / "raw"
            output_dir.mkdir()
            raw_dir.mkdir()
            output_paths, _ = build_substitute_receipt_outputs(payload, str(output_dir), str(raw_dir))
            self.assertTrue(os.path.exists(output_paths[0]))
            with pdfplumber.open(output_paths[0]) as pdf:
                rendered = "\n".join(page.extract_text() or "" for page in pdf.pages)
        self.assertIn("จ่ายเงินสด 500 บาท", rendered)
        self.assertIn("โอนเงิน 2,000 บาท", rendered)

    def test_pdf_renders_legacy_additional_note_once_as_the_single_note(self):
        payload = {
            "documentKind": "substitute_receipt",
            "receiptNo": "SR-2026-09-0009",
            "receiptDate": "2026-09-04",
            "receiptType": "general_expense",
            "payeeName": "ร้านตัวอย่าง",
            "additionalNote": "จ่ายเงินสด 500 บาท และโอนเงิน 2,000 บาท",
            "businessPurpose": "ค่าใช้จ่ายตัวอย่าง",
            "lines": [{"description": "ค่าใช้จ่าย", "quantity": "1", "unitCost": "2500", "lineTotal": "2500.00"}],
            "totals": {"totalAmount": "2500.00"},
        }
        with tempfile.TemporaryDirectory() as tmp:
            output_dir = Path(tmp) / "pdf"
            raw_dir = Path(tmp) / "raw"
            output_dir.mkdir()
            raw_dir.mkdir()
            output_paths, _ = build_substitute_receipt_outputs(payload, str(output_dir), str(raw_dir))
            with pdfplumber.open(output_paths[0]) as pdf:
                rendered = "\n".join(page.extract_text() or "" for page in pdf.pages)
        self.assertIn("หมายเหตุเพิ่มเติม", rendered)
        self.assertIn("จ่ายเงินสด 500 บาท และโอนเงิน 2,000 บาท", rendered)
        self.assertNotIn("หมายเหตุ: -", rendered)

    def test_pdf_omits_vendor_address_and_payment_reference(self):
        payload = {
            "documentKind": "substitute_receipt",
            "receiptNo": "SR-2026-09-0010",
            "receiptDate": "2026-09-04",
            "receiptType": "general_expense",
            "payeeName": "ร้านตัวอย่าง",
            "payeeTaxId": "0105550000001",
            "paymentChannel": "โอนผ่านบัญชีบริษัท",
            "paymentReference": "BANK-REFERENCE-001",
            "vendorSnapshot": {"address": "99/9 ถนนสุขุมวิท กรุงเทพฯ 10110"},
            "businessPurpose": "ค่าใช้จ่ายตัวอย่าง",
            "lines": [{"description": "ค่าใช้จ่าย", "quantity": "1", "unitCost": "2500"}],
            "totals": {"totalAmount": "2500.00"},
        }
        with tempfile.TemporaryDirectory() as tmp:
            output_dir = Path(tmp) / "pdf"
            raw_dir = Path(tmp) / "raw"
            output_dir.mkdir()
            raw_dir.mkdir()
            output_paths, _ = build_substitute_receipt_outputs(payload, str(output_dir), str(raw_dir))
            with pdfplumber.open(output_paths[0]) as pdf:
                rendered = "\n".join(page.extract_text() or "" for page in pdf.pages)
        self.assertNotIn("เลขอ้างอิงชำระเงิน", rendered)
        self.assertNotIn("BANK-REFERENCE-001", rendered)
        self.assertNotIn("ที่อยู่", rendered)
        self.assertNotIn("99/9 ถนนสุขุมวิท กรุงเทพฯ 10110", rendered)

    def test_pdf_acknowledgement_includes_requester_name_and_position(self):
        payload = {
            "documentKind": "substitute_receipt",
            "receiptNo": "SR-2026-09-0012",
            "receiptDate": "2026-09-04",
            "receiptType": "general_expense",
            "payeeName": "ร้านตัวอย่าง",
            "requesterName": "คุณต้า",
            "requesterRole": "ผู้จัดการ",
            "businessPurpose": "ค่าใช้จ่ายตัวอย่าง",
            "lines": [{"description": "ค่าใช้จ่าย", "quantity": "1", "unitCost": "2500"}],
            "totals": {"totalAmount": "2500.00"},
        }
        with tempfile.TemporaryDirectory() as tmp:
            output_dir = Path(tmp) / "pdf"
            raw_dir = Path(tmp) / "raw"
            output_dir.mkdir()
            raw_dir.mkdir()
            output_paths, _ = build_substitute_receipt_outputs(payload, str(output_dir), str(raw_dir))
            with pdfplumber.open(output_paths[0]) as pdf:
                rendered = "\n".join(page.extract_text() or "" for page in pdf.pages)
        self.assertIn("คุณต้า", rendered)
        self.assertIn("ผู้จัดการ", rendered)
        self.assertIn("ข้าพเจ้า คุณต้า (ผู้เบิกจ่าย)", rendered)

    def test_pdf_acknowledgement_does_not_leave_fill_in_placeholders(self):
        payload = {
            "documentKind": "substitute_receipt",
            "receiptNo": "SR-2026-09-0013",
            "receiptDate": "2026-09-04",
            "receiptType": "general_expense",
            "payeeName": "ร้านตัวอย่าง",
            "businessPurpose": "ค่าใช้จ่ายตัวอย่าง",
            "lines": [{"description": "ค่าใช้จ่าย", "quantity": "1", "unitCost": "2500"}],
            "totals": {"totalAmount": "2500.00"},
        }
        with tempfile.TemporaryDirectory() as tmp:
            output_dir = Path(tmp) / "pdf"
            raw_dir = Path(tmp) / "raw"
            output_dir.mkdir()
            raw_dir.mkdir()
            output_paths, _ = build_substitute_receipt_outputs(payload, str(output_dir), str(raw_dir))
            with pdfplumber.open(output_paths[0]) as pdf:
                rendered = "\n".join(page.extract_text() or "" for page in pdf.pages)
        self.assertNotIn("ข้าพเจ้า ........................................", rendered)
        self.assertNotIn("ตำแหน่ง ........................................", rendered)

    def test_stock_purchase_pdf_shows_description_without_stock_sku(self):
        payload = {
            "documentKind": "substitute_receipt",
            "receiptNo": "SR-2026-09-0011",
            "receiptDate": "2026-09-04",
            "receiptType": "stock_purchase",
            "payeeName": "ร้านตัวอย่าง",
            "lines": [{
                "sku": "SKU-ONLY-001",
                "description": "รายละเอียดเสื้อ A สีขาว",
                "quantity": "2",
                "unitCost": "100",
                "lineTotal": "200.00",
            }],
            "totals": {"totalAmount": "200.00"},
        }
        with tempfile.TemporaryDirectory() as tmp:
            output_dir = Path(tmp) / "pdf"
            raw_dir = Path(tmp) / "raw"
            output_dir.mkdir()
            raw_dir.mkdir()
            output_paths, _ = build_substitute_receipt_outputs(payload, str(output_dir), str(raw_dir))
            with pdfplumber.open(output_paths[0]) as pdf:
                rendered = "\n".join(page.extract_text() or "" for page in pdf.pages)
        self.assertNotIn("Stock SKU", rendered)
        self.assertNotIn("SKU-ONLY-001", rendered)
        self.assertIn("รายละเอียดเสื้อ A สีขาว", rendered)


if __name__ == "__main__":
    unittest.main()
