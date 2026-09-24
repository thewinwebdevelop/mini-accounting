#!/usr/bin/env python3
import argparse
import json
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.units import mm
from reportlab.platypus import TableStyle
from pdf_common import (
    SOFT, ACCENT, build_doc, document_header, detail_grid, paragraph,
    money_paragraph, styled_table, text, baht,
)


def build_pdf(payload, output_path):
    summary = payload.get("summary") or {}
    balances = payload.get("balances") or []
    page_size = landscape(A4)
    story = [
        document_header(payload, "รายงานสต๊อกสินค้าคงเหลือ", width=269 * mm, date=summary.get("asOfDate")),
        detail_grid([
            ("จำนวน Stock SKU", summary.get("stockSkuCount")),
            ("มูลค่าสต๊อกรวม (บาท)", baht(summary.get("totalInventoryValue"))),
            ("จำนวนคงเหลือรวม", summary.get("totalQuantityOnHand")),
            ("SKU ที่คงเหลือ 0", summary.get("zeroQuantitySkuCount")),
        ], width=269 * mm),
        paragraph("รายการสินค้าคงเหลือ", "DocHeading"),
    ]

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

    table = styled_table(table_data,
        col_widths=[12 * mm, 26 * mm, 38 * mm, 70 * mm, 22 * mm, 18 * mm, 25 * mm, 28 * mm, 30 * mm],
        align_right_cols=[6, 7, 8])
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, -1), (-1, -1), SOFT),
        ("LINEABOVE", (0, -1), (-1, -1), .8, ACCENT),
    ]))
    story.append(table)
    build_doc(output_path, "รายงานสต๊อกสินค้าคงเหลือ", payload, story, page_size=page_size,
              footer_label=f"ออกรายงานวันที่ {text(summary.get('asOfDate'))}")


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
