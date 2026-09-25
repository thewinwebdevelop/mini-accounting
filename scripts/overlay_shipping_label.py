#!/usr/bin/env python3
"""Overlay Stock SKU text on a Shopee shipping-document PDF.

The source PDF remains the label background. Coordinates are PDF points with
the origin at the bottom-left of the unrotated page.
"""

import argparse
import io
import json
from pathlib import Path

from pypdf import PdfReader, PdfWriter
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas


FONT_CANDIDATES = (
    "/Library/Fonts/Arial Unicode.ttf",
    "/System/Library/Fonts/Supplemental/Tahoma.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
)
FONT_NAME = "StockSkuUnicode"


def _font_name():
    if FONT_NAME in pdfmetrics.getRegisteredFontNames():
        return FONT_NAME
    for candidate in FONT_CANDIDATES:
        if Path(candidate).exists():
            pdfmetrics.registerFont(TTFont(FONT_NAME, candidate))
            return FONT_NAME
    return "Helvetica"


def _number(value, field):
    try:
        return float(value)
    except (TypeError, ValueError) as error:
        raise ValueError(f"invalid numeric field: {field}") from error


def _rect(item, prefix="overlay"):
    x = _number(item.get("x"), f"{prefix}.x")
    y = _number(item.get("y"), f"{prefix}.y")
    width = _number(item.get("width"), f"{prefix}.width")
    height = _number(item.get("height"), f"{prefix}.height")
    if width <= 0 or height <= 0:
        raise ValueError(f"{prefix} width and height must be positive")
    return x, y, width, height


def _intersects(first, second):
    first_x, first_y, first_width, first_height = first
    second_x, second_y, second_width, second_height = second
    return (
        first_x < second_x + second_width
        and first_x + first_width > second_x
        and first_y < second_y + second_height
        and first_y + first_height > second_y
    )


def _protected_rectangles(overlay):
    for index, region in enumerate(overlay.get("protected_regions", [])):
        if isinstance(region, dict):
            yield region.get("page", overlay.get("page")), _rect(region, f"protected_regions[{index}]")
        elif isinstance(region, (list, tuple)) and len(region) == 4:
            yield overlay.get("page"), tuple(float(value) for value in region)
        else:
            raise ValueError(f"invalid protected region at index {index}")


def _normalize_overlays(overlay_data):
    if isinstance(overlay_data, dict) and "overlays" in overlay_data:
        overlay_data = overlay_data["overlays"]
    if isinstance(overlay_data, dict):
        overlay_data = [overlay_data]
    if not isinstance(overlay_data, list) or not overlay_data:
        raise ValueError("overlay JSON must contain one or more overlays")
    return overlay_data


def _draw_overlay(page, overlay, page_index):
    page_number = int(_number(overlay.get("page"), "overlay.page"))
    if page_number != page_index + 1:
        return
    x, y, width, height = _rect(overlay)
    page_width = float(page.mediabox.width)
    page_height = float(page.mediabox.height)
    if x < 0 or y < 0 or x + width > page_width or y + height > page_height:
        raise ValueError(f"overlay on page {page_number} is outside page bounds")
    for protected_page, protected in _protected_rectangles(overlay):
        if protected_page is None or int(_number(protected_page, "protected.page")) == page_number:
            if _intersects((x, y, width, height), protected):
                raise ValueError(f"overlay on page {page_number} intersects a protected region")

    lines = overlay.get("text_lines", [])
    if isinstance(lines, str):
        lines = [lines]
    if not isinstance(lines, list) or not lines:
        raise ValueError("overlay.text_lines must contain at least one line")
    font_size = _number(overlay.get("font_size", 10), "overlay.font_size")
    if font_size <= 0:
        raise ValueError("overlay.font_size must be positive")
    line_gap = font_size * 1.2
    if len(lines) * line_gap > height:
        raise ValueError(f"overlay text does not fit on page {page_number}")

    buffer = io.BytesIO()
    layer = canvas.Canvas(buffer, pagesize=(page_width, page_height))
    layer.setFillColorRGB(1, 1, 1)
    layer.roundRect(x, y, width, height, min(3, width / 20, height / 20), stroke=0, fill=1)
    layer.setFillColorRGB(0, 0, 0)
    layer.setFont(_font_name(), font_size)
    text = layer.beginText()
    text.setTextOrigin(x + 4, y + height - font_size - 2)
    text.setLeading(line_gap)
    for line in lines:
        text.textLine(str(line))
    layer.drawText(text)
    layer.save()
    buffer.seek(0)
    overlay_page = PdfReader(buffer).pages[0]
    page.merge_page(overlay_page)


def overlay_pdf(input_path, output_path, overlays):
    """Write an overlaid copy while retaining every source page's dimensions."""
    reader = PdfReader(str(input_path))
    writer = PdfWriter()
    normalized = _normalize_overlays(overlays)
    for page_index, source_page in enumerate(reader.pages):
        page = source_page
        for overlay in normalized:
            _draw_overlay(page, overlay, page_index)
        writer.add_page(page)
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("wb") as stream:
        writer.write(stream)


def merge_pdfs(input_paths, output_path):
    """Merge PDFs in the exact order supplied by the caller."""
    writer = PdfWriter()
    for input_path in input_paths:
        reader = PdfReader(str(input_path))
        for page in reader.pages:
            writer.add_page(page)
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("wb") as stream:
        writer.write(stream)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--overlay-json", required=True, type=Path)
    args = parser.parse_args()
    overlay_data = json.loads(args.overlay_json.read_text(encoding="utf-8"))
    overlay_pdf(args.input, args.output, overlay_data)


if __name__ == "__main__":
    main()
