import os
import re
import tempfile
import unittest
from pathlib import Path

from generate_workflow_document_pdf import DOCUMENT_KIND_LABELS, build_document_pdf
from pdf_common import pdf_page_count

REPO_ROOT = Path(__file__).resolve().parent.parent
WORKFLOW_LOGIC_PATH = REPO_ROOT / "forms" / "workflow.logic.js"


class WorkflowDocumentPdfTests(unittest.TestCase):
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
