import os
import tempfile
import unittest
from pathlib import Path

import pdfplumber

from generate_workflow_packet_pdf import build_packet_pdf, step_status_label, transaction_status_label


class WorkflowPacketPdfTests(unittest.TestCase):
    def test_build_packet_pdf_creates_summary_pdf(self):
        transaction = {
            "transactionNo": "TXN-2026-09-0001",
            "title": "ซื้อสต๊อกล็อตกันยายน",
            "templateSnapshot": {"name": "ซื้อสต๊อกสินค้าแบบไม่มีใบกำกับภาษี"},
            "status": "completed",
            "steps": [
                {"stepId": "step-001", "documentKind": "purchase_order", "label": "ใบสั่งซื้อ", "workflowStatus": "completed"},
                {"stepId": "step-002", "documentKind": "substitute_receipt", "label": "ใบรับรองแทนใบเสร็จรับเงิน", "workflowStatus": "completed"},
            ],
        }
        child_documents = [
            {"documentKind": "purchase_order", "documentNo": "PO-2026-09-0001", "pdfFiles": [{"name": "po.pdf"}], "rawFiles": []},
            {"documentKind": "substitute_receipt", "documentNo": "SR-2026-09-0001", "pdfFiles": [{"name": "sr.pdf"}], "rawFiles": [{"name": "slip.jpg"}]},
        ]
        with tempfile.TemporaryDirectory() as tmp:
            output_path = Path(tmp) / "workflow-packet.pdf"
            build_packet_pdf(transaction, child_documents, str(output_path))
            self.assertTrue(output_path.exists())
            self.assertGreater(os.path.getsize(output_path), 0)


class WorkflowPacketPdfContentTests(unittest.TestCase):
    """A packet that exists but is missing half its documents in the actual
    rendered text is still a failure, so this asserts on the PDF's extracted
    text directly (via pdfplumber) rather than only checking the file is
    non-empty — and checks every step/document/file, not just the first one,
    per the "one entry asserted, five silently wrong" lesson on this branch."""

    def _extract_text(self, path):
        with pdfplumber.open(str(path)) as pdf:
            return "\n".join(page.extract_text() or "" for page in pdf.pages)

    def test_packet_text_includes_every_step_document_and_file(self):
        transaction = {
            "transactionNo": "TXN-2026-09-0001",
            "title": "ซื้อสต๊อกล็อตกันยายน",
            "templateSnapshot": {"name": "ซื้อสต๊อกสินค้าแบบไม่มีใบกำกับภาษี"},
            "status": "completed",
            "accountingMonth": "2026-09",
            "steps": [
                {"stepId": "step-001", "documentKind": "purchase_order", "label": "ใบสั่งซื้อ", "workflowStatus": "completed"},
                {"stepId": "step-002", "documentKind": "substitute_receipt", "label": "ใบรับรองแทนใบเสร็จรับเงิน", "workflowStatus": "completed"},
                {"stepId": "step-003", "documentKind": "payment_voucher", "label": "ใบสำคัญจ่าย", "workflowStatus": "completed"},
                {"stepId": "step-004", "documentKind": "goods_receipt", "label": "ใบรับของ/ใบรับสินค้าเข้าคลัง", "workflowStatus": "completed"},
            ],
        }
        child_documents = [
            {"documentKind": "purchase_order", "documentNo": "PO-2026-09-0001", "statusLabel": "เสร็จสิ้น", "pdfFiles": [{"name": "01_purchase_order.pdf"}], "rawFiles": []},
            {"documentKind": "substitute_receipt", "documentNo": "SR-2026-09-0001", "statusLabel": "อนุมัติแล้ว", "pdfFiles": [{"name": "01_substitute_receipt.pdf"}], "rawFiles": [{"name": "slip.jpg"}]},
            {"documentKind": "payment_voucher", "documentNo": "PV-2026-09-0001", "statusLabel": "เสร็จสิ้น", "pdfFiles": [{"name": "01_payment_voucher.pdf"}], "rawFiles": [{"name": "voucher-slip.png"}]},
            {"documentKind": "goods_receipt", "documentNo": "GR-2026-09-0001", "statusLabel": "เสร็จสิ้น", "pdfFiles": [{"name": "01_goods_receipt.pdf"}], "rawFiles": []},
        ]

        with tempfile.TemporaryDirectory() as tmp:
            output_path = Path(tmp) / "workflow-packet.pdf"
            build_packet_pdf(transaction, child_documents, str(output_path))
            text = self._extract_text(output_path)

        self.assertIn(transaction["transactionNo"], text)
        self.assertIn(transaction["templateSnapshot"]["name"], text)

        for step in transaction["steps"]:
            self.assertIn(step["label"], text, f"step label missing from packet text: {step['label']}")

        for doc in child_documents:
            self.assertIn(doc["documentNo"], text, f"document number missing from packet text: {doc['documentNo']}")
            for pdf_file in doc["pdfFiles"]:
                self.assertIn(pdf_file["name"], text, f"pdf file name missing from packet text: {pdf_file['name']}")
            for raw_file in doc["rawFiles"]:
                self.assertIn(raw_file["name"], text, f"raw file name missing from packet text: {raw_file['name']}")

    def test_transaction_status_label_differs_from_step_status_label_when_completed(self):
        # A transaction's own status only ever takes two values (in_progress /
        # completed) and must be labeled through the transaction-level map
        # ("เสร็จสมบูรณ์" for completed), not the step-level map ("เสร็จสิ้น" for
        # completed) — forms/workflow.logic.browser.js's TRANSACTION_STATUS_LABELS
        # is the source of truth this must mirror.
        self.assertEqual(transaction_status_label("completed"), "เสร็จสมบูรณ์")
        self.assertEqual(step_status_label("completed"), "เสร็จสิ้น")
        self.assertNotEqual(transaction_status_label("completed"), step_status_label("completed"))

    def test_packet_uses_the_transaction_status_label_for_the_transaction_row(self):
        transaction = {
            "transactionNo": "TXN-2026-09-0009",
            "title": "ทดสอบสถานะธุรกรรม",
            "templateSnapshot": {"name": "ตัวอย่าง Template"},
            "status": "completed",
            "steps": [
                {"stepId": "step-001", "documentKind": "purchase_order", "label": "ใบสั่งซื้อ", "workflowStatus": "completed"},
            ],
        }
        with tempfile.TemporaryDirectory() as tmp:
            output_path = Path(tmp) / "workflow-packet.pdf"
            build_packet_pdf(transaction, [], str(output_path))
            text = self._extract_text(output_path)
        self.assertIn(
            "เสร็จสมบูรณ์",
            text,
            "a completed transaction's own status row must use the transaction label (เสร็จสมบูรณ์), not the step label (เสร็จสิ้น)",
        )

    def test_packet_handles_a_transaction_with_no_child_documents_yet(self):
        transaction = {
            "transactionNo": "TXN-2026-09-0002",
            "title": "ธุรกรรมยังไม่เริ่ม",
            "templateSnapshot": {"name": "ตัวอย่าง Template"},
            "status": "in_progress",
            "steps": [
                {"stepId": "step-001", "documentKind": "purchase_order", "label": "ใบสั่งซื้อ", "workflowStatus": "not_started"},
            ],
        }
        with tempfile.TemporaryDirectory() as tmp:
            output_path = Path(tmp) / "workflow-packet.pdf"
            build_packet_pdf(transaction, [], str(output_path))
            self.assertTrue(output_path.exists())
            self.assertGreater(os.path.getsize(output_path), 0)
            text = self._extract_text(output_path)
            self.assertIn(transaction["transactionNo"], text)


if __name__ == "__main__":
    unittest.main()
