import importlib.util
import tempfile
import unittest
from pathlib import Path

from pypdf import PdfReader
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas


ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "tests" / "fixtures" / "shopee-custom-label-sample.pdf"
SCRIPT = ROOT / "scripts" / "shopee_custom_label_pdf.py"


def load_module():
    spec = importlib.util.spec_from_file_location("shopee_custom_label_pdf", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def make_synthetic_pdf(path: Path):
    page_width, page_height = A4
    pdf = canvas.Canvas(str(path), pagesize=A4)
    pdf.setFont("Helvetica", 12)
    pdf.drawString(20, page_height - 100, "DELIVERY-KEEP")
    pdf.drawString(20, page_height - 270, "Shopee Order No. TEST123")
    pdf.drawString(48, page_height - 430, "# Product Name")
    pdf.drawString(360, page_height - 430, "Option")
    pdf.drawString(527, page_height - 430, "Quantity")
    pdf.drawString(20, page_height - 458, "1")
    pdf.drawString(48, page_height - 458, "Product Alpha")
    pdf.drawString(48, page_height - 474, "Wrapped Name")
    pdf.drawString(360, page_height - 458, "Red")
    pdf.drawString(360, page_height - 474, "Large")
    pdf.drawString(527, page_height - 458, "2")
    pdf.drawString(20, page_height - 510, "2")
    pdf.drawString(48, page_height - 510, "Product Beta")
    pdf.drawString(360, page_height - 510, "Blue")
    pdf.drawString(527, page_height - 510, "1")
    pdf.drawString(20, page_height - 790, "Shopee Order No. TEST123")
    pdf.save()


class ShopeeCustomLabelPdfTest(unittest.TestCase):
    def test_normalize_text_repairs_private_use_tone_glyphs_and_markers(self):
        module = load_module()
        self.assertEqual(module.normalize_text("เส้ือแขนต\uf70cุกตาผ\uf70bา (cid:0)"), "เสื้อแขนตุ๊กตาผ้า")

    def test_parse_real_shopee_fixture_extracts_every_order_and_item(self):
        module = load_module()
        parsed = module.parse_pdf(FIXTURE)

        self.assertEqual(len(parsed["pages"]), 19)
        self.assertEqual(parsed["pages"][0]["orderNo"], "261016RBTADAXA")
        self.assertEqual(parsed["pages"][-1]["orderNo"], "261017TC07R4E1")
        self.assertEqual(parsed["pages"][0]["status"], "parsed")
        self.assertEqual(parsed["pages"][0]["items"][0]["quantity"], 1)
        self.assertIn("เสื้อแขนตุ๊กตาผ้าฉลุลายดอกไม้", parsed["pages"][0]["items"][0]["productName"])
        self.assertEqual(parsed["pages"][0]["items"][0]["optionName"], "ผ้าลายดอกไม้เหลือง,เฉพาะเสื้อ")

    def test_parse_keeps_same_line_option_order_when_baselines_differ(self):
        module = load_module()
        parsed = module.parse_pdf(FIXTURE)

        option = parsed["pages"][7]["items"][0]["optionName"]
        self.assertLess(option.index("ฟ้าดอกไม้"), option.index("1,เสื้อ+กางเกง"))

    def test_parse_groups_wrapped_names_and_multiple_item_rows(self):
        module = load_module()
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "synthetic.pdf"
            make_synthetic_pdf(source)
            parsed = module.parse_pdf(source)

        page = parsed["pages"][0]
        self.assertEqual(page["orderNo"], "TEST123")
        self.assertEqual(len(page["items"]), 2)
        self.assertEqual(page["items"][0]["productName"], "Product Alpha Wrapped Name")
        self.assertEqual(page["items"][0]["optionName"], "Red Large")
        self.assertEqual(page["items"][0]["quantity"], 2)
        self.assertEqual(page["items"][1]["productName"], "Product Beta")

    def test_render_preserves_page_sizes_and_keeps_upper_delivery_content(self):
        module = load_module()
        with tempfile.TemporaryDirectory() as directory:
            directory = Path(directory)
            source = directory / "source.pdf"
            output = directory / "output.pdf"
            pdf = canvas.Canvas(str(source), pagesize=(595, 842))
            pdf.drawString(20, 760, "DELIVERY-KEEP")
            pdf.drawString(40, 300, "OLD-PRODUCT")
            pdf.showPage()
            pdf.setPageSize((500, 500))
            pdf.drawString(20, 450, "DELIVERY-KEEP-2")
            pdf.drawString(40, 200, "OLD-PRODUCT-2")
            pdf.showPage()
            pdf.save()

            module.render_custom_label(source, output, [
                {"pageNumber": 1, "orderNo": "TEST123", "manualRows": [{"sku": "MANUAL-A", "quantity": 2}]},
                {"pageNumber": 2, "orderNo": "TEST456", "manualRows": [{"sku": "MANUAL-B", "quantity": 3}]},
            ])
            reader = PdfReader(str(output))
            self.assertEqual([(float(page.mediabox.width), float(page.mediabox.height)) for page in reader.pages], [(595.0, 842.0), (500.0, 500.0)])
            extracted = "\n".join(page.extract_text() or "" for page in reader.pages)
            self.assertIn("DELIVERY-KEEP", extracted)
            self.assertIn("MANUAL-A", extracted)
            self.assertIn("MANUAL-B", extracted)

    def test_render_preserves_shopee_qr_images(self):
        module = load_module()
        with tempfile.TemporaryDirectory() as directory:
            directory = Path(directory)
            output = directory / "output.pdf"
            module.render_custom_label(FIXTURE, output, [{
                "pageNumber": 1,
                "orderNo": "TEST123",
                "manualRows": [
                    {"sku": "MANUAL-A", "quantity": 1},
                    {"sku": "MANUAL-B", "quantity": 1},
                ],
            }])
            source_page = PdfReader(str(FIXTURE)).pages[0]
            output_page = PdfReader(str(output)).pages[0]
            self.assertEqual(len(output_page.images), len(source_page.images))

    def test_render_rejects_manual_rows_that_do_not_fit(self):
        module = load_module()
        with tempfile.TemporaryDirectory() as directory:
            directory = Path(directory)
            source = directory / "source.pdf"
            output = directory / "output.pdf"
            pdf = canvas.Canvas(str(source), pagesize=A4)
            pdf.drawString(20, 760, "DELIVERY-KEEP")
            pdf.save()
            rows = [{"sku": f"SKU-{index}", "quantity": 1} for index in range(80)]
            with self.assertRaises(ValueError):
                module.render_custom_label(source, output, [{"pageNumber": 1, "orderNo": "TEST", "manualRows": rows}])


if __name__ == "__main__":
    unittest.main()
