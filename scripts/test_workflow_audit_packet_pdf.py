import tempfile
import unittest
from pathlib import Path

from pypdf import PdfReader
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas

from generate_workflow_audit_packet_pdf import build_packet
from generate_workflow_document_pdf import build_document_pdf


class WorkflowAuditPacketPdfTests(unittest.TestCase):
    def test_packet_contains_form_and_uploaded_evidence(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            raw_dir = root / "raw"
            pdf_dir = root / "pdf"
            raw_dir.mkdir()
            pdf_dir.mkdir()
            payload = {
                "documentKind": "purchase_order",
                "documentNo": "PO-2026-09-0001",
                "title": "สั่งซื้อวัสดุ",
                "documentDate": "2026-09-24",
                "company": {"legalName": "หจก.สวีทเฮาส์ เดซี่"},
                "rawFiles": ["quote.txt", "delivery.pdf"],
                "lines": [{"description": "วัสดุ", "quantity": 1, "unitCost": "100.00", "lineTotal": "100.00"}],
                "totals": {"grossAmount": "100.00"},
            }
            (raw_dir / "quote.txt").write_text("ใบเสนอราคาอ้างอิง", encoding="utf-8")
            c = canvas.Canvas(str(raw_dir / "delivery.pdf"), pagesize=A4)
            c.drawString(60, 780, "ใบส่งของต้นฉบับ")
            c.save()

            form_path = pdf_dir / "01_purchase_order.pdf"
            packet_path = pdf_dir / "02_ชุดรวมเอกสาร_audit-packet.pdf"
            build_document_pdf(payload, str(form_path))
            metadata = build_packet(payload, str(form_path), str(raw_dir), str(packet_path))

            text = "\n".join(page.extract_text() or "" for page in PdfReader(packet_path).pages)
            self.assertIn("ชุดรวมหลักฐาน", text)
            self.assertIn("PO-2026-09-0001", text)
            self.assertIn("quote.txt", text)
            self.assertIn("delivery.pdf", text)
            self.assertEqual(metadata["annexedRawFiles"], 2)
            self.assertGreater(len(PdfReader(packet_path).pages), len(PdfReader(form_path).pages))


if __name__ == "__main__":
    unittest.main()
