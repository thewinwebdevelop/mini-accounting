#!/usr/bin/env python3
import argparse
import json
import os

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.platypus import Spacer

from pdf_common import (
    document_header, detail_grid, totals_table, signature_table,
    build_doc,
    amount,
    baht,
    money_paragraph,
    paragraph,
    pdf_page_count,
    styled_table,
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
    return signature_table([("ผู้จัดทำ", ""), ("ผู้อนุมัติ", "")])


def _line_description(line):
    mode = line.get("vatMode") or "unspecified"
    rate = text(line.get("vatRate"), "")
    mode_label = {
        "exclusive": "ราคา/หน่วยก่อน VAT",
        "inclusive": "ราคา/หน่วยรวม VAT",
        "none": "ไม่มี VAT",
        "manual": "ราคา/หน่วยก่อน VAT - ระบุ VAT เอง",
    }.get(mode, "ยังไม่ระบุ VAT")
    if mode in ("exclusive", "inclusive") and rate:
        mode_label += f" {rate}%"
    details = [paragraph(line.get("description")), paragraph(mode_label, "DocSmall")]
    # An unclassified historical amount is not evidence of a zero VAT charge.
    if mode != "unspecified":
        values = []
        if line.get("amountBeforeVat") is not None:
            values.append(f"ก่อน VAT {baht(line['amountBeforeVat'])}")
        if line.get("vatAmount") is not None:
            values.append(f"VAT {baht(line['vatAmount'])}")
        if values:
            details.append(paragraph(" | ".join(values), "DocSmall"))
    if amount(line.get("withholdingTax")) > 0:
        details.append(paragraph(f"หัก ณ ที่จ่าย {baht(line['withholdingTax'])} บาท", "DocSmall"))
    return details


def _document_totals(payload):
    totals = payload.get("totals") or {}
    rows = []
    notes = ["สกุลเงิน: บาท (THB)"]
    # The shared totals helper accepts numeric values only. Keep unknown VAT
    # explicit in its note area rather than passing None through as zero.
    for label, key in [("ยอดก่อน VAT (บาท)", "amountBeforeVat"), ("VAT (บาท)", "vatAmount")]:
        if totals.get(key) is not None:
            rows.append((label, totals[key]))
        else:
            notes.append(f"{label}: ยังไม่ระบุ VAT")
    gross = totals.get("grossAmount") or "0.00"
    withholding = totals.get("withholdingTax") or "0.00"
    rows.append(("ยอดรวม (บาท)", gross))
    if amount(withholding) > 0 or payload.get("documentKind") in (
        "payment_voucher", "cash_spend_declaration", "payee_acknowledgement"
    ):
        rows.append(("หัก ณ ที่จ่าย (บาท)", withholding))
    net = totals.get("netPayment")
    rows.append(("ยอดสุทธิ (บาท)", net if net is not None else amount(gross) - amount(withholding)))
    return totals_table(rows, note="\n".join(notes))


def build_document_story(payload):
    lines = payload.get("lines") or []

    header_rows = [
        ("ผู้รับเงิน/คู่ค้า", payload.get("payeeName")),
        ("ผู้ขอ/ผู้จัดทำ", payload.get("requesterName")),
        ("ชื่อเอกสาร", payload.get("title")),
    ]
    if text(payload.get("transactionNo"), ""):
        header_rows.append(("เลขที่ธุรกรรม", payload.get("transactionNo")))
    header_rows.append(("วัตถุประสงค์ทางธุรกิจ", payload.get("businessPurpose")))
    story = [
        document_header(payload, document_title(payload)),
        detail_grid(header_rows),
        paragraph("รายการ", "DocHeading"),
    ]

    item_rows = [[
        paragraph("ลำดับ"), paragraph("รายละเอียด"), paragraph("จำนวน"),
        paragraph("ราคา/หน่วย"), paragraph("ยอดรวม"),
    ]]
    for index, line in enumerate(lines, 1):
        item_rows.append([
            paragraph(index),
            _line_description(line),
            paragraph(line.get("quantity")),
            money_paragraph(line.get("unitCost")),
            money_paragraph(line.get("lineTotal")),
        ])
    if len(item_rows) == 1:
        item_rows.append([paragraph("-"), paragraph("ไม่มีรายการ"), paragraph("-"), paragraph("-"), paragraph("-")])

    story.append(styled_table(
        item_rows,
        col_widths=[14 * mm, 84 * mm, 22 * mm, 31 * mm, 31 * mm],
        align_right_cols=[2, 3, 4],
    ))
    story.append(Spacer(1, 8))
    story.append(_document_totals(payload))
    story.append(Spacer(1, 14))
    story.append(_signature_table())
    return story


def build_document_pdf(payload, output_path):
    build_doc(output_path, document_title(payload), payload, build_document_story(payload), page_size=A4)
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
