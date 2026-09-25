import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from pypdf import PdfReader
from reportlab.pdfgen import canvas


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "overlay_shipping_label.py"


def load_overlay_module():
    spec = importlib.util.spec_from_file_location("overlay_shipping_label", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def make_pdf(path, sizes):
    pdf = canvas.Canvas(str(path), pagesize=sizes[0])
    for index, size in enumerate(sizes):
        pdf.setPageSize(size)
        pdf.drawString(20, 20, f"source-page-{index + 1}")
        pdf.showPage()
    pdf.save()


class ShippingLabelOverlayTest(unittest.TestCase):
    def test_overlay_preserves_page_sizes_and_embeds_utf8_thai_text(self):
        module = load_overlay_module()
        with tempfile.TemporaryDirectory() as directory:
            directory = Path(directory)
            source = directory / "source.pdf"
            output = directory / "output.pdf"
            make_pdf(source, [(400, 600), (800, 300)])
            overlays = [
                {
                    "page": 1,
                    "x": 40,
                    "y": 80,
                    "width": 180,
                    "height": 36,
                    "text_lines": ["Stock SKU", "ขนมไทย-001"],
                    "font_size": 12,
                    "protected_regions": [],
                },
                {
                    "page": 2,
                    "x": 100,
                    "y": 100,
                    "width": 200,
                    "height": 36,
                    "text_lines": ["SKU-SECOND"],
                    "font_size": 12,
                    "protected_regions": [],
                },
            ]
            module.overlay_pdf(source, output, overlays)
            reader = PdfReader(str(output))
            self.assertEqual([(float(page.mediabox.width), float(page.mediabox.height)) for page in reader.pages], [(400.0, 600.0), (800.0, 300.0)])
            extracted = "\n".join(page.extract_text() or "" for page in reader.pages)
            self.assertIn("Stock SKU", extracted)
            self.assertIn("ขนมไทย-001", extracted)

    def test_protected_region_collision_is_rejected(self):
        module = load_overlay_module()
        with tempfile.TemporaryDirectory() as directory:
            directory = Path(directory)
            source = directory / "source.pdf"
            output = directory / "output.pdf"
            make_pdf(source, [(400, 600)])
            with self.assertRaises(ValueError):
                module.overlay_pdf(source, output, [{
                    "page": 1,
                    "x": 40,
                    "y": 80,
                    "width": 180,
                    "height": 36,
                    "text_lines": ["SKU-001"],
                    "font_size": 12,
                    "protected_regions": [{"page": 1, "x": 50, "y": 90, "width": 20, "height": 20}],
                }])

    def test_batch_merge_preserves_selected_pdf_order(self):
        module = load_overlay_module()
        with tempfile.TemporaryDirectory() as directory:
            directory = Path(directory)
            first = directory / "first.pdf"
            second = directory / "second.pdf"
            output = directory / "merged.pdf"
            make_pdf(first, [(400, 600)])
            make_pdf(second, [(400, 600)])
            module.merge_pdfs([second, first], output)
            reader = PdfReader(str(output))
            self.assertEqual(len(reader.pages), 2)
            extracted = [page.extract_text() or "" for page in reader.pages]
            self.assertIn("source-page-1", extracted[0])
            self.assertIn("source-page-1", extracted[1])

    def test_cli_reads_overlay_json(self):
        with tempfile.TemporaryDirectory() as directory:
            directory = Path(directory)
            source = directory / "source.pdf"
            output = directory / "output.pdf"
            overlay_json = directory / "overlay.json"
            make_pdf(source, [(400, 600)])
            overlay_json.write_text(json.dumps({
                "page": 1,
                "x": 40,
                "y": 80,
                "width": 180,
                "height": 36,
                "text_lines": ["SKU-CLI"],
                "font_size": 12,
                "protected_regions": [],
            }), encoding="utf-8")
            completed = subprocess.run(
                [sys.executable, str(SCRIPT), "--input", str(source), "--output", str(output), "--overlay-json", str(overlay_json)],
                check=False,
                capture_output=True,
                text=True,
            )
            self.assertEqual(completed.returncode, 0, completed.stderr)
            self.assertIn("SKU-CLI", (PdfReader(str(output)).pages[0].extract_text() or ""))


if __name__ == "__main__":
    unittest.main()
