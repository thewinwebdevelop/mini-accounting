import os
import re
import tempfile
import unittest
from pathlib import Path
from pypdf import PdfReader

from generate_workflow_document_pdf import DOCUMENT_KIND_LABELS, build_document_pdf
from pdf_common import pdf_page_count

REPO_ROOT = Path(__file__).resolve().parent.parent
WORKFLOW_LOGIC_PATH = REPO_ROOT / "forms" / "workflow.logic.js"


class WorkflowDocumentPdfTests(unittest.TestCase):
    def pdf_text(self, payload):
        with tempfile.TemporaryDirectory() as tmp:
            output_path = Path(tmp) / "document.pdf"
            build_document_pdf(payload, str(output_path))
            return "\n".join(page.extract_text() for page in PdfReader(output_path).pages)

    def test_legacy_prices_stay_unclassified(self):
        extracted = self.pdf_text({
            "documentKind": "purchase_order",
            "lines": [{"description": "Legacy", "quantity": 2, "unitCost": "50.00", "lineTotal": "100.00"}],
            "totals": {"grossAmount": "100.00"},
        })
        self.assertIn("ยังไม่ระบุ VAT", extracted)
        self.assertIn("50.00", extracted)
        self.assertIn("100.00", extracted)
        self.assertNotIn("VAT 0.00", extracted)
        self.assertNotIn("VAT 7%", extracted)

    def test_inclusive_vat_and_net_payment_are_printed_for_every_kind(self):
        for kind in DOCUMENT_KIND_LABELS:
            with self.subTest(kind=kind):
                extracted = self.pdf_text({
                    "documentKind": kind,
                    "lines": [{"description": "Inclusive", "quantity": 1, "unitCost": "107.00", "lineTotal": "107.00",
                               "vatMode": "inclusive", "vatRate": "7", "amountBeforeVat": "100.00", "vatAmount": "7.00",
                               "withholdingTax": "3.00", "netPayment": "104.00"}],
                    "totals": {"amountBeforeVat": "100.00", "vatAmount": "7.00", "grossAmount": "107.00",
                               "withholdingTax": "3.00", "netPayment": "104.00", "vatStatus": "specified"},
                })
                for expected in ["ราคา/หน่วยรวม VAT 7%", "ก่อน VAT 100.00", "VAT 7.00", "107.00", "3.00", "104.00", "ยอดสุทธิ"]:
                    self.assertIn(expected, extracted)
                self.assertNotIn("ยังไม่ระบุ VAT", extracted)

    def test_mixed_vat_keeps_known_line_breakdown_and_unknown_summary(self):
        extracted = self.pdf_text({
            "documentKind": "purchase_order",
            "lines": [
                {"description": "Known", "quantity": 1, "unitCost": "100.00", "lineTotal": "107.00",
                 "vatMode": "exclusive", "vatRate": "7", "amountBeforeVat": "100.00", "vatAmount": "7.00"},
                {"description": "Unknown", "quantity": 1, "unitCost": "20.00", "lineTotal": "20.00", "vatMode": "unspecified",
                 "amountBeforeVat": None, "vatAmount": None},
            ],
            "totals": {"amountBeforeVat": None, "vatAmount": None, "grossAmount": "127.00",
                       "withholdingTax": "0.00", "netPayment": "127.00", "vatStatus": "partial"},
        })
        for expected in ["ราคา/หน่วยก่อน VAT 7%", "ก่อน VAT 100.00", "VAT 7.00", "ยังไม่ระบุ VAT", "127.00"]:
            self.assertIn(expected, extracted)
        self.assertNotIn("VAT 0.00", extracted)

    def test_large_manual_vat_totals_remain_complete(self):
        extracted = self.pdf_text({
            "documentKind": "payment_voucher",
            "lines": [{"description": "Manual", "quantity": 1, "unitCost": "1234567890.00", "lineTotal": "1320987642.30",
                       "vatMode": "manual", "vatRate": None, "amountBeforeVat": "1234567890.00", "vatAmount": "86419752.30"}],
            "totals": {"amountBeforeVat": "1234567890.00", "vatAmount": "86419752.30", "grossAmount": "1320987642.30",
                       "withholdingTax": "0.00", "netPayment": "1320987642.30", "vatStatus": "specified"},
        })
        for expected in ["ระบุ VAT เอง", "1,234,567,890.00", "86,419,752.30", "1,320,987,642.30"]:
            self.assertIn(expected, extracted)

    def test_explicit_no_vat_prints_zero_without_unknown_warning(self):
        extracted = self.pdf_text({
            "documentKind": "goods_receipt",
            "lines": [{"description": "No VAT", "quantity": 1, "unitCost": "50.00", "lineTotal": "50.00",
                       "vatMode": "none", "vatRate": None, "amountBeforeVat": "50.00", "vatAmount": "0.00"}],
            "totals": {"amountBeforeVat": "50.00", "vatAmount": "0.00", "grossAmount": "50.00",
                       "withholdingTax": "0.00", "netPayment": "50.00", "vatStatus": "specified"},
        })
        self.assertIn("ไม่มี VAT", extracted)
        self.assertIn("VAT 0.00", extracted)
        self.assertNotIn("ยังไม่ระบุ VAT", extracted)

    def test_each_line_shows_its_own_positive_withholding(self):
        extracted = self.pdf_text({
            "documentKind": "payment_voucher",
            "lines": [
                {"description": "First service", "quantity": 1, "unitCost": "100.00", "lineTotal": "107.00",
                 "vatMode": "exclusive", "vatRate": "7", "amountBeforeVat": "100.00", "vatAmount": "7.00",
                 "withholdingTax": "3.00", "netPayment": "104.00"},
                {"description": "Second service", "quantity": 1, "unitCost": "200.00", "lineTotal": "200.00",
                 "vatMode": "unspecified", "amountBeforeVat": None, "vatAmount": None,
                 "withholdingTax": "10.00", "netPayment": "190.00"},
            ],
            "totals": {"amountBeforeVat": None, "vatAmount": None, "grossAmount": "307.00",
                       "withholdingTax": "13.00", "netPayment": "294.00", "vatStatus": "partial"},
        })
        first_line, second_line = extracted.split("Second service", 1)
        self.assertIn("หัก ณ ที่จ่าย 3.00 บาท", first_line)
        self.assertNotIn("หัก ณ ที่จ่าย 10.00 บาท", first_line)
        self.assertIn("หัก ณ ที่จ่าย 10.00 บาท", second_line)
        self.assertIn("13.00", second_line)

    def test_build_document_pdf_creates_payment_voucher_pdf(self):
        payload = {
            "documentKind": "payment_voucher",
            "documentNo": "PV-2026-09-0001",
            "title": "คืนเงินกรรมการ",
            "documentDate": "2026-09-06",
            "businessPurpose": "คืนเงินสำรองจ่าย",
            "requesterName": "คุณต้า",
            "payeeName": "กรรมการ",
            "lines": [{"description": "ค่าส่งเข้าคลัง", "quantity": 1, "unitCost": "120.00", "lineTotal": "120.00"}],
            "totals": {"grossAmount": "120.00"},
        }
        with tempfile.TemporaryDirectory() as tmp:
            output_path = Path(tmp) / "document.pdf"
            build_document_pdf(payload, str(output_path))
            self.assertTrue(output_path.exists())
            self.assertGreater(os.path.getsize(output_path), 0)
            self.assertGreaterEqual(pdf_page_count(str(output_path)), 1)

    def test_build_document_pdf_shows_transaction_number_when_present(self):
        payload = {
            "documentKind": "purchase_order",
            "documentNo": "PO-2026-09-0001",
            "title": "สั่งซื้อสินค้า",
            "documentDate": "2026-09-06",
            "businessPurpose": "สั่งซื้อสินค้าเข้าคลัง",
            "payeeName": "ร้านค้า",
            "transactionNo": "TXN-2026-09-0001",
            "lines": [{"description": "สินค้า A", "quantity": 2, "unitCost": "50.00", "lineTotal": "100.00"}],
            "totals": {"grossAmount": "100.00"},
        }
        with tempfile.TemporaryDirectory() as tmp:
            output_path = Path(tmp) / "document.pdf"
            build_document_pdf(payload, str(output_path))
            self.assertTrue(output_path.exists())
            self.assertGreater(os.path.getsize(output_path), 0)

    def test_build_document_pdf_handles_every_lightweight_kind(self):
        kinds = [
            "purchase_order",
            "payment_voucher",
            "cash_spend_declaration",
            "payee_acknowledgement",
            "goods_receipt",
        ]
        with tempfile.TemporaryDirectory() as tmp:
            for kind in kinds:
                payload = {
                    "documentKind": kind,
                    "documentNo": f"XX-2026-09-0001",
                    "title": f"ทดสอบ {kind}",
                    "documentDate": "2026-09-06",
                    "businessPurpose": "ทดสอบ",
                    "payeeName": "ผู้ทดสอบ",
                    "lines": [{"description": "รายการ", "quantity": 1, "unitCost": "10.00", "lineTotal": "10.00"}],
                    "totals": {"grossAmount": "10.00"},
                }
                output_path = Path(tmp) / f"{kind}.pdf"
                build_document_pdf(payload, str(output_path))
                self.assertTrue(output_path.exists(), f"missing pdf for {kind}")
                self.assertGreater(os.path.getsize(output_path), 0, f"empty pdf for {kind}")

    def test_build_document_pdf_handles_missing_optional_fields(self):
        payload = {
            "documentKind": "goods_receipt",
            "documentNo": "GR-2026-09-0001",
            "lines": [],
            "totals": {},
        }
        with tempfile.TemporaryDirectory() as tmp:
            output_path = Path(tmp) / "document.pdf"
            build_document_pdf(payload, str(output_path))
            self.assertTrue(output_path.exists())
            self.assertGreater(os.path.getsize(output_path), 0)


class WorkflowDocumentLabelDriftTests(unittest.TestCase):
    """Nothing previously asserted that DOCUMENT_KIND_LABELS here still matches
    the labels forms/workflow.logic.js defines for the same five lightweight
    document kinds. This is a cheap text-level check against that drift — it
    does not execute the JS, just confirms the Thai label strings agree."""

    def test_pdf_labels_match_workflow_logic_definitions(self):
        source = WORKFLOW_LOGIC_PATH.read_text(encoding="utf-8")
        self.assertTrue(DOCUMENT_KIND_LABELS, "DOCUMENT_KIND_LABELS must not be empty")

        for document_kind, expected_label in DOCUMENT_KIND_LABELS.items():
            match = re.search(
                r"%s:\s*\{[^}]*?label:\s*\"([^\"]+)\"" % re.escape(document_kind),
                source,
            )
            self.assertIsNotNone(
                match,
                f"no DOCUMENT_TYPE_DEFINITIONS entry found for '{document_kind}' in workflow.logic.js",
            )
            self.assertEqual(
                match.group(1),
                expected_label,
                f"label drift for '{document_kind}': "
                f"generate_workflow_document_pdf.py says '{expected_label}' but "
                f"workflow.logic.js says '{match.group(1)}'",
            )


if __name__ == "__main__":
    unittest.main()
