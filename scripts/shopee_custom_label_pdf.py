#!/usr/bin/env python3
"""Parse and render text-based Shopee custom-label PDFs."""

import argparse
import io
import json
import re
import unicodedata
from pathlib import Path
from typing import Any

import pdfplumber
from pypdf import PdfReader, PdfWriter
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas


PRIVATE_USE_THAI_TONE_MAP = {
    "\uf70a": "่",
    "\uf70b": "้",
    "\uf70c": "๊",
    "\uf70d": "๋",
}
ORDER_PATTERN = re.compile(r"Shopee\s+Order\s+No\.\s*([A-Z0-9]+)", re.IGNORECASE)
THAI_HEADER_MARKERS = ("ชื่อสินค้า", "ตัวเลือกสินค้า", "จำนวน")
ENGLISH_HEADER_MARKERS = ("product", "option", "quantity")
FONT_NAME = "SweetHouseCustomLabel"


def normalize_text(value: Any) -> str:
    text = str(value or "")
    text = re.sub(r"\(cid:\d+\)", " ", text, flags=re.IGNORECASE)
    text = "".join(PRIVATE_USE_THAI_TONE_MAP.get(char, char) for char in text)
    text = unicodedata.normalize("NFC", text)
    text = re.sub(r"([เ-ไก-ฮ])([่้๊๋])([ิีึืูุ])([ก-ฮ])", r"\1\3\2\4", text)
    text = re.sub(r"([ก-ฮ])([่้๊๋])([ุู])", r"\1\3\2", text)
    text = re.sub(r"[\u00a0\t\r\n]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def _word_text(word: dict) -> str:
    return normalize_text(word.get("text", ""))


def _join_words(words: list[dict]) -> str:
    # PDF text extraction may give glyphs on the same visual line slightly
    # different `top` values. Group near-equal baselines first, then read each
    # visual line from left to right. This matters for options such as
    # "ฟ้าดอกไม้" followed by "1,เสื้อ+กางเกง".
    lines: list[tuple[float, list[dict]]] = []
    for word in sorted(words, key=lambda item: (float(item["top"]), float(item["x0"]))):
        top = float(word["top"])
        if not lines or abs(top - lines[-1][0]) > 4:
            lines.append((top, [word]))
        else:
            lines[-1][1].append(word)
    return normalize_text(" ".join(
        normalize_text(" ".join(_word_text(word) for word in sorted(line_words, key=lambda item: float(item["x0"]))))
        for _, line_words in lines
    ))


def _order_number(page) -> str:
    text = normalize_text(page.extract_text(x_tolerance=1, y_tolerance=3) or "")
    matches = ORDER_PATTERN.findall(text)
    return matches[-1].upper() if matches else ""


def _header_top(words: list[dict]) -> float | None:
    candidates = []
    for word in words:
        normalized = _word_text(word).lower()
        if any(marker in normalized for marker in THAI_HEADER_MARKERS + ENGLISH_HEADER_MARKERS):
            candidates.append(float(word["top"]))
    return min(candidates) if candidates else None


def _footer_top(words: list[dict], header_top: float, page_height: float) -> float:
    candidates = [
        float(word["top"])
        for word in words
        if float(word["top"]) > header_top + 20
        and "shopee" in _word_text(word).lower()
    ]
    return min(candidates) if candidates else page_height - 45


def _item_starts(words: list[dict], header_top: float, footer_top: float) -> list[dict]:
    starts = []
    for word in words:
        if not (header_top + 10 < float(word["top"]) < footer_top - 8):
            continue
        if float(word["x0"]) > 38:
            continue
        if re.fullmatch(r"[1-9]\d*", _word_text(word)):
            starts.append(word)
    return sorted(starts, key=lambda word: float(word["top"]))


def _parse_items(words: list[dict], header_top: float, footer_top: float) -> list[dict]:
    starts = _item_starts(words, header_top, footer_top)
    items = []
    for index, start in enumerate(starts):
        start_top = float(start["top"])
        end_top = float(starts[index + 1]["top"]) - 3 if index + 1 < len(starts) else footer_top - 5
        row_words = [
            word for word in words
            if start_top - 15 <= float(word["top"]) < end_top
            and float(word["x1"]) >= 40
        ]
        name_words = [word for word in row_words if 40 <= float(word["x0"]) < 355]
        option_words = [word for word in row_words if 350 <= float(word["x0"]) < 520]
        quantity_words = [word for word in row_words if float(word["x0"]) >= 520 and re.fullmatch(r"[1-9]\d*", _word_text(word))]
        try:
            quantity = int(_word_text(quantity_words[0])) if quantity_words else 0
        except ValueError:
            quantity = 0
        product_name = _join_words(name_words)
        option_name = _join_words(option_words)
        item = {
            "lineNo": _word_text(start),
            "productName": product_name,
            "optionName": option_name,
            "quantity": quantity,
            "mappingKey": f"{product_name}::{option_name}" if product_name and option_name else "",
        }
        if not product_name or not option_name or quantity <= 0:
            item["status"] = "needs_review"
        else:
            item["status"] = "parsed"
        items.append(item)
    return items


def parse_pdf(input_path: Path) -> dict:
    input_path = Path(input_path)
    pages = []
    with pdfplumber.open(str(input_path)) as document:
        for page_number, page in enumerate(document.pages, 1):
            words = page.extract_words(x_tolerance=1, y_tolerance=3, keep_blank_chars=False, use_text_flow=False)
            order_no = _order_number(page)
            header_top = _header_top(words)
            errors = []
            if header_top is None:
                header_top = float(page.height) * 0.51
                errors.append("ไม่พบหัวตารางสินค้า")
            footer_top = _footer_top(words, header_top, float(page.height))
            items = _parse_items(words, header_top, footer_top)
            if not order_no:
                errors.append("ไม่พบ Shopee Order No.")
            if not items:
                errors.append("ไม่พบรายการสินค้า")
            if any(item["status"] == "needs_review" for item in items):
                errors.append("ข้อมูลรายการสินค้าบางส่วนอ่านไม่ครบ")
            pages.append({
                "pageNumber": page_number,
                "pageWidth": float(page.width),
                "pageHeight": float(page.height),
                "orderNo": order_no,
                "status": "parsed" if not errors else "needs_review",
                "errors": errors,
                "items": items,
            })
    return {"pages": pages}


def _font_name() -> str:
    if FONT_NAME in pdfmetrics.getRegisteredFontNames():
        return FONT_NAME
    candidate = Path(__file__).resolve().parent / "fonts" / "Sarabun-Regular.ttf"
    if candidate.exists():
        pdfmetrics.registerFont(TTFont(FONT_NAME, str(candidate)))
        return FONT_NAME
    return "Helvetica"


def _positive_quantity(value: Any, field: str) -> int:
    try:
        number = int(value)
    except (TypeError, ValueError) as error:
        raise ValueError(f"{field} must be a positive integer") from error
    if number <= 0:
        raise ValueError(f"{field} must be a positive integer")
    return number


def _draw_page_overlay(page, page_payload: dict, page_index: int) -> None:
    page_number = int(page_payload.get("pageNumber", page_index + 1))
    if page_number != page_index + 1:
        return
    rows = page_payload.get("manualRows") or []
    if not rows:
        raise ValueError(f"page {page_number} must contain manual SKU rows")

    page_width = float(page.mediabox.width)
    page_height = float(page.mediabox.height)
    bottom = max(30.0, page_height * 0.043)
    # Start slightly above Shopee's lower product block so its dashed border
    # cannot peek through the replacement overlay, while keeping the delivery
    # section, barcode, and QR area untouched.
    top = page_height * 0.53
    left = max(16.0, page_width * 0.028)
    right = page_width - left
    header_height = 30.0
    footer_height = 27.0
    padding = 8.0
    row_height = 22.0
    available_height = top - bottom - header_height - footer_height - padding
    max_rows = int(available_height // row_height)
    if len(rows) > max_rows:
        raise ValueError(f"manual SKU rows on page {page_number} do not fit")

    buffer = io.BytesIO()
    layer = canvas.Canvas(buffer, pagesize=(page_width, page_height))
    layer.setFillColorRGB(1, 1, 1)
    # Extend the whiteout to the page edges so the original table's dashed
    # border cannot remain as a stray mark beside the new inset table.
    layer.rect(0, max(0.0, bottom - 2), page_width, top - max(0.0, bottom - 2), stroke=0, fill=1)
    layer.setStrokeColorRGB(0.1, 0.1, 0.1)
    layer.setFillColorRGB(0, 0, 0)
    layer.setFont(_font_name(), 12)
    table_top = top - padding
    layer.line(left, table_top, right, table_top)
    layer.drawString(left + 8, table_top - 20, "Manual SKU")
    layer.drawRightString(right - 8, table_top - 20, "จำนวน")
    layer.line(left, table_top - header_height, right, table_top - header_height)

    y = table_top - header_height - row_height + 5
    for row in rows:
        sku = str(row.get("sku", "")).strip()
        if not sku:
            raise ValueError(f"manual SKU on page {page_number} is empty")
        quantity = _positive_quantity(row.get("quantity"), f"quantity on page {page_number}")
        layer.drawString(left + 8, y, sku)
        layer.drawRightString(right - 8, y, str(quantity))
        y -= row_height
        layer.setStrokeColorRGB(0.75, 0.75, 0.75)
        layer.line(left, y + 5, right, y + 5)
        layer.setStrokeColorRGB(0.1, 0.1, 0.1)

    layer.setFont(_font_name(), 11)
    layer.drawString(left, bottom + 7, f"Shopee Order No. {page_payload.get('orderNo', '')}")
    layer.save()
    buffer.seek(0)
    page.merge_page(PdfReader(buffer).pages[0])


def render_custom_label(input_path: Path, output_path: Path, page_payloads: list[dict]) -> None:
    payload_by_page = {int(item.get("pageNumber")): item for item in page_payloads}
    writer = PdfWriter(clone_from=str(input_path))
    for index, source_page in enumerate(writer.pages):
        payload = payload_by_page.get(index + 1)
        if payload:
            _draw_page_overlay(source_page, payload, index)
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("wb") as stream:
        writer.write(stream)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    parse_command = subparsers.add_parser("parse")
    parse_command.add_argument("--input", required=True, type=Path)
    parse_command.add_argument("--output", required=True, type=Path)

    render_command = subparsers.add_parser("render")
    render_command.add_argument("--input", required=True, type=Path)
    render_command.add_argument("--output", required=True, type=Path)
    render_command.add_argument("--payload", required=True, type=Path)

    args = parser.parse_args()
    if args.command == "parse":
        result = parse_pdf(args.input)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")
        return

    payload = json.loads(args.payload.read_text(encoding="utf-8"))
    page_payloads = payload.get("pages", payload) if isinstance(payload, dict) else payload
    render_custom_label(args.input, args.output, page_payloads)


if __name__ == "__main__":
    main()
