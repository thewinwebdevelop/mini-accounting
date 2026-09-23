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


if __name__ == "__main__":
    unittest.main()
