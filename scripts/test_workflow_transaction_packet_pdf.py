import tempfile
import unittest
from pathlib import Path

from pypdf import PdfReader

from generate_workflow_document_pdf import build_document_pdf
from generate_workflow_packet_pdf import build_packet_pdf


class WorkflowTransactionPacketPdfTests(unittest.TestCase):
    def test_packet_merges_cover_and_each_child_pdf_in_step_order(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            pdf_dir = root / "pdf"
            pdf_dir.mkdir()
            children = []
            for index, document_kind in enumerate(("purchase_order", "payment_voucher"), 1):
                document_no = f"{document_kind.upper()}-2026-09-000{index}"
                payload = {
                    "documentKind": document_kind,
                    "documentNo": document_no,
                    "title": f"เอกสาร {document_kind}",
                    "documentDate": "2026-09-24",
                    "company": {"legalName": "หจก.สวีทเฮาส์ เดซี่", "taxId": "0103569007277", "branch": "สำนักงานใหญ่"},
                    "payeeName": "ร้านค้าตัวอย่าง",
                    "requesterName": "คุณต้า",
                    "businessPurpose": "ทดสอบ packet",
                    "lines": [{"description": f"รายการ {document_kind}", "quantity": "1", "unitCost": "100.00", "lineTotal": "100.00"}],
                    "totals": {"grossAmount": "100.00", "netPayment": "100.00"},
                }
                child_path = pdf_dir / f"01_{document_kind}.pdf"
                build_document_pdf(payload, str(child_path))
                children.append({
                    "documentKind": document_kind,
                    "documentNo": document_no,
                    "workflowStepId": f"step-{index:03d}",
                    "status": "completed",
                    "statusLabel": "เสร็จสิ้น",
                    "pdfFiles": [{"name": child_path.name, "absolutePath": str(child_path)}],
                    "rawFiles": [],
                })

            transaction = {
                "transactionNo": "TXN-2026-09-0001",
                "accountingMonth": "2026-09",
                "title": "ทดสอบ merged audit packet",
                "status": "completed",
                "templateSnapshot": {"name": "ทดสอบ"},
                "steps": [
                    {"stepId": "step-001", "documentKind": "purchase_order", "workflowStatus": "completed"},
                    {"stepId": "step-002", "documentKind": "payment_voucher", "workflowStatus": "completed"},
                ],
            }
            output_path = pdf_dir / "99_ชุดรวมเอกสาร_workflow-transaction.pdf"
            build_packet_pdf(transaction, list(reversed(children)), str(output_path))

            reader = PdfReader(str(output_path))
            self.assertGreaterEqual(len(reader.pages), 3)
            text = "\n".join(page.extract_text() or "" for page in reader.pages)
            self.assertIn("PURCHASE_ORDER-2026-09-0001", text)
            self.assertIn("PAYMENT_VOUCHER-2026-09-0002", text)


if __name__ == "__main__":
    unittest.main()
