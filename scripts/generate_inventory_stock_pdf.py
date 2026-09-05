#!/usr/bin/env python3
import argparse
import json
import os
from decimal import Decimal, InvalidOperation

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_RIGHT
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle


BRAND = colors.HexColor("#102a43")
BRAND_2 = colors.HexColor("#334e68")
LINE = colors.HexColor("#cbd2d9")
SOFT = colors.HexColor("#f5f7fa")


def register_font():
    candidates = [
        "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
        "/System/Library/Fonts/Supplemental/Thonburi.ttc",
        "/System/Library/Fonts/ThonburiUI.ttc",
    ]
    for font_path in candidates:
        if os.path.exists(font_path):
            pdfmetrics.registerFont(TTFont("DocThai", font_path))
            return "DocThai"
    return "Helvetica"


FONT = register_font()
styles = getSampleStyleSheet()
styles.add(ParagraphStyle(
    name="DocTitle",
    fontName=FONT,
    fontSize=18,
    leading=24,
    textColor=BRAND,
    alignment=TA_CENTER,
    spaceAfter=8,
))
styles.add(ParagraphStyle(
    name="DocBody",
    fontName=FONT,
    fontSize=8,
    leading=11,
))
styles.add(ParagraphStyle(
    name="DocSmall",
    fontName=FONT,
    fontSize=7,
    leading=10,
    textColor=colors.HexColor("#52606d"),
))
styles.add(ParagraphStyle(
    name="DocHeader",
    fontName=FONT,
    fontSize=8,
    leading=11,
    textColor=colors.white,
))
styles.add(ParagraphStyle(
    name="DocMoney",
    fontName=FONT,
    fontSize=8,
    leading=11,
    alignment=TA_RIGHT,
))


def text(value, fallback="-"):
    value = "" if value is None else str(value).strip()
    return value or fallback


def amount(value):
    try:
        return Decimal(str(value or "0").replace(",", ""))
    except InvalidOperation:
        return Decimal("0")


def baht(value):
    return f"{amount(value):,.2f}"


def paragraph(value, style="DocBody"):
    return Paragraph(text(value), styles[style])


def money_paragraph(value):
    return Paragraph(baht(value), styles["DocMoney"])


def build_pdf(payload, output_path):
    company = payload.get("company") or {}
    summary = payload.get("summary") or {}
    balances = payload.get("balances") or []
    page_size = landscape(A4)
    doc = SimpleDocTemplate(
        output_path,
        pagesize=page_size,
        rightMargin=10 * mm,
        leftMargin=10 * mm,
        topMargin=10 * mm,
        bottomMargin=10 * mm,
        title="รายงานสต๊อกสินค้าคงเหลือ",
        author=text(company.get("legalName"), "หจก.สวีทเฮาส์"),
    )

    def footer(canvas, document):
        width, _ = page_size
        canvas.saveState()
        canvas.setFont(FONT, 7)
        canvas.setFillColor(colors.HexColor("#52606d"))
        canvas.drawString(10 * mm, 7 * mm, f"ออกรายงานวันที่ {text(summary.get('asOfDate'))}")
        canvas.drawRightString(width - (10 * mm), 7 * mm, f"หน้า {document.page}")
        canvas.restoreState()

    story = [
        Paragraph("รายงานสต๊อกสินค้าคงเหลือ", styles["DocTitle"]),
        paragraph(text(company.get("legalName"), "หจก.สวีทเฮาส์")),
        paragraph(f"เลขผู้เสียภาษี: {text(company.get('taxId'))} | สาขา: {text(company.get('branch'), 'สำนักงานใหญ่')}"),
        paragraph(text(company.get("address"), ""), "DocSmall"),
        Spacer(1, 5 * mm),
    ]

    summary_rows = [
        [paragraph("วันที่ออกรายงาน"), paragraph(summary.get("asOfDate"))],
        [paragraph("จำนวน Stock SKU"), paragraph(summary.get("stockSkuCount"))],
        [paragraph("จำนวนคงเหลือรวม"), paragraph(summary.get("totalQuantityOnHand"))],
        [paragraph("SKU ที่คงเหลือ 0"), paragraph(summary.get("zeroQuantitySkuCount"))],
        [paragraph("มูลค่าสต๊อกรวม"), money_paragraph(summary.get("totalInventoryValue"))],
    ]
    summary_table = Table(summary_rows, colWidths=[42 * mm, 48 * mm], hAlign="LEFT")
    summary_table.setStyle(TableStyle([
        ("GRID", (0, 0), (-1, -1), 0.4, LINE),
        ("BACKGROUND", (0, 0), (0, -1), SOFT),
        ("FONTNAME", (0, 0), (-1, -1), FONT),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("PADDING", (0, 0), (-1, -1), 5),
    ]))
    story.extend([summary_table, Spacer(1, 5 * mm)])

    table_data = [[
        paragraph("ลำดับ", "DocHeader"),
        paragraph("Parent SKU", "DocHeader"),
        paragraph("Stock SKU", "DocHeader"),
        paragraph("สินค้า", "DocHeader"),
        paragraph("สี", "DocHeader"),
        paragraph("Size", "DocHeader"),
        paragraph("คงเหลือ", "DocHeader"),
        paragraph("ต้นทุนเฉลี่ย", "DocHeader"),
        paragraph("มูลค่า", "DocHeader"),
    ]]
    for index, item in enumerate(balances, start=1):
        table_data.append([
            paragraph(index),
            paragraph(item.get("productCode")),
            paragraph(item.get("sku")),
            paragraph(item.get("productName")),
            paragraph(item.get("color")),
            paragraph(item.get("size")),
            paragraph(item.get("quantityOnHand")),
            money_paragraph(item.get("averageUnitCost")),
            money_paragraph(item.get("inventoryValue")),
        ])
    table_data.append([
        paragraph("รวม"),
        paragraph(""),
        paragraph(""),
        paragraph(""),
        paragraph(""),
        paragraph(""),
        paragraph(summary.get("totalQuantityOnHand")),
        paragraph(""),
        money_paragraph(summary.get("totalInventoryValue")),
    ])

    table = Table(table_data, colWidths=[12 * mm, 26 * mm, 38 * mm, 52 * mm, 22 * mm, 18 * mm, 20 * mm, 25 * mm, 28 * mm], repeatRows=1)
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), BRAND_2),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("GRID", (0, 0), (-1, -1), 0.35, LINE),
        ("FONTNAME", (0, 0), (-1, -1), FONT),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("ALIGN", (0, 1), (0, -1), "RIGHT"),
        ("BACKGROUND", (0, -1), (-1, -1), SOFT),
        ("PADDING", (0, 0), (-1, -1), 4),
    ]))
    story.append(table)
    doc.build(story, onFirstPage=footer, onLaterPages=footer)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    with open(args.input, "r", encoding="utf-8") as handle:
        payload = json.load(handle)
    build_pdf(payload, args.output)


if __name__ == "__main__":
    main()
