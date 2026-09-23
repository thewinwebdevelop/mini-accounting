#!/usr/bin/env python3
import argparse
import json
import os

from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.units import mm
from reportlab.platypus import Spacer, Table, TableStyle

from pdf_common import (
    FONT,
    LINE,
    build_doc,
    company_info,
    kv_table,
    money_paragraph,
    paragraph,
    pdf_page_count,
    signature_cell,
    styled_table,
    styles,
    text,
)

# Mirrors DOCUMENT_TYPE_DEFINITIONS labels in forms/workflow.logic.js for the
# five lightweight, standalone document kinds this generator serves.
DOCUMENT_KIND_LABELS = {
    "purchase_order": "ใบสั่งซื้อ",
    "payment_voucher": "ใบสำคัญจ่าย",
    "cash_spend_declaration": "ใบรับรองการจ่ายเงินสดส่วนตัว",
    "payee_acknowledgement": "ใบสำคัญรับเงิน/ใบรับเงินคืนค่าใช้จ่าย",
    "goods_receipt": "ใบรับของ/ใบรับสินค้าเข้าคลัง",
}


def document_title(payload):
    document_kind = payload.get("documentKind")
    return DOCUMENT_KIND_LABELS.get(document_kind, document_kind or "เอกสาร")


def _signature_table():
    rows = [[
        signature_cell("ผู้จัดทำ"),
        signature_cell("ผู้อนุมัติ"),
    ]]
    table = Table(rows, colWidths=[130 * mm, 130 * mm], rowHeights=[36 * mm], hAlign="LEFT")
    table.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (-1, -1), FONT),
        ("FONTSIZE", (0, 0), (-1, -1), 8),
        ("GRID", (0, 0), (-1, -1), 0.35, LINE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 7),
        ("RIGHTPADDING", (0, 0), (-1, -1), 7),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
    ]))
    return table


def build_document_story(payload):
    company = company_info(payload)
    lines = payload.get("lines") or []
    totals = payload.get("totals") or {}

    header_rows = [
        ("ชื่อนิติบุคคล", company["name"]),
        ("เลขที่เอกสาร", payload.get("documentNo")),
        ("วันที่เอกสาร", payload.get("documentDate")),
    ]
    if text(payload.get("transactionNo"), ""):
        header_rows.append(("เลขที่ธุรกรรม (Transaction)", payload.get("transactionNo")))
    header_rows.extend([
        ("ชื่อเอกสาร", payload.get("title")),
        ("ผู้ขอ/ผู้จัดทำ", payload.get("requesterName")),
        ("ผู้รับเงิน/คู่ค้า", payload.get("payeeName")),
        ("วัตถุประสงค์ทางธุรกิจ", payload.get("businessPurpose")),
    ])

    story = [
        paragraph(document_title(payload), "DocTitle"),
        kv_table(header_rows),
        paragraph("รายการ", "DocHeading"),
    ]

    item_rows = [[
        paragraph("ลำดับ"), paragraph("รายละเอียด"), paragraph("จำนวน"),
        paragraph("ราคา/หน่วย"), paragraph("ยอดรวม"),
    ]]
    for index, line in enumerate(lines, 1):
        item_rows.append([
            paragraph(index),
            paragraph(line.get("description")),
            paragraph(line.get("quantity")),
            money_paragraph(line.get("unitCost")),
            money_paragraph(line.get("lineTotal")),
        ])
    if len(item_rows) == 1:
        item_rows.append([paragraph("-"), paragraph("ไม่มีรายการ"), paragraph("-"), paragraph("-"), paragraph("-")])

    story.append(styled_table(
        item_rows,
        col_widths=[16 * mm, 150 * mm, 24 * mm, 34 * mm, 34 * mm],
        align_right_cols=[2, 3, 4],
    ))
    story.append(Spacer(1, 8))
    story.append(paragraph(f"รวมทั้งสิ้น: {text(totals.get('grossAmount'), '0.00')} บาท", "DocHeading"))
    story.append(Spacer(1, 14))
    story.append(_signature_table())
    return story


def build_document_pdf(payload, output_path):
    build_doc(output_path, document_title(payload), payload, build_document_story(payload), page_size=landscape(A4))
    return output_path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--payload", required=True)
    parser.add_argument("--output-dir", required=True)
    args = parser.parse_args()

    with open(args.payload, "r", encoding="utf-8") as handle:
        payload = json.load(handle)

    os.makedirs(args.output_dir, exist_ok=True)
    document_kind = payload.get("documentKind") or "document"
    output_path = os.path.join(args.output_dir, f"01_{document_kind}.pdf")
    build_document_pdf(payload, output_path)

    result = [{
        "name": os.path.basename(output_path),
        "path": f"pdf/{os.path.basename(output_path)}",
        "absolutePath": output_path,
        "size": os.path.getsize(output_path),
        "pageCount": pdf_page_count(output_path),
        "annexedRawFiles": 0,
    }]
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
