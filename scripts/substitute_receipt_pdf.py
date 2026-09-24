import os
import tempfile
from decimal import Decimal

from pypdf import PdfWriter
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.platypus import Spacer

from pdf_common import (
    document_header, detail_grid, totals_table, signature_table as shared_signatures,
    amount,
    append_pdf,
    append_raw_annex,
    build_doc,
    company_info,
    money_paragraph,
    paragraph,
    styled_table,
)

RECEIPT_TYPE_LABELS = {
    "stock_purchase": "ซื้อสต๊อกสินค้า",
    "general_expense": "รายจ่ายทั่วไป",
}


THAI_MONTHS = [
    "", "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
    "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม",
]

_THAI_DIGITS = ["ศูนย์", "หนึ่ง", "สอง", "สาม", "สี่", "ห้า", "หก", "เจ็ด", "แปด", "เก้า"]
_THAI_POSITIONS = ["", "สิบ", "ร้อย", "พัน", "หมื่น", "แสน"]


def thai_date(value):
    raw = "" if value is None else str(value).strip()
    if not raw:
        return "-"
    try:
        year, month, day = raw.split("-")
        year_be = int(year) + 543
        month_name = THAI_MONTHS[int(month)]
        return f"{int(day)} {month_name} {year_be}"
    except (ValueError, IndexError):
        return raw


def _read_six_digit_group(group):
    text_value = ""
    length = len(group)
    for index, char in enumerate(group):
        digit = int(char)
        if digit == 0:
            continue
        position = length - index - 1
        if position == 0 and digit == 1 and length > 1:
            text_value += "เอ็ด"
        elif position == 1 and digit == 2:
            text_value += "ยี่"
        elif position == 1 and digit == 1:
            text_value += ""
        else:
            text_value += _THAI_DIGITS[digit]
        text_value += _THAI_POSITIONS[position]
    return text_value


def _read_integer(number_str):
    number_str = number_str.lstrip("0")
    if not number_str:
        return "ศูนย์"
    groups = []
    remaining = number_str
    while remaining:
        groups.insert(0, remaining[-6:])
        remaining = remaining[:-6]
    parts = []
    for index, group in enumerate(groups):
        remaining_groups = len(groups) - index - 1
        group_text = _read_six_digit_group(group.lstrip("0"))
        if not group_text:
            continue
        parts.append(group_text + ("ล้าน" * remaining_groups))
    return "".join(parts) if parts else "ศูนย์"


def baht_text(value):
    decimal_value = amount(value).quantize(Decimal("0.01"))
    negative = decimal_value < 0
    decimal_value = abs(decimal_value)
    baht_part = int(decimal_value)
    satang_part = int((decimal_value - baht_part) * 100)
    result = _read_integer(str(baht_part)) + "บาท"
    result += (_read_integer(str(satang_part)) + "สตางค์") if satang_part else "ถ้วน"
    return ("ลบ" if negative else "") + result


def _substitute_signature_table(payload):
    prepared_by = payload.get("preparedBy") or payload.get("requesterName") or ""
    return shared_signatures([("ผู้จ่ายเงิน/ผู้รับรอง", prepared_by), ("ผู้อนุมัติ", "")], preparer_position=True)


def paragraph_text(value):
    return "" if value is None else str(value).strip()


def _payee_table(payload):
    return detail_grid([
        ("ชื่อผู้รับเงิน/ผู้ขาย", payload.get("payeeName")),
        ("เลขประจำตัวผู้เสียภาษี", payload.get("payeeTaxId")),
        ("ที่อยู่", "........................................................................................"),
        ("ประเภท", payload.get("receiptTypeLabel") or RECEIPT_TYPE_LABELS.get(payload.get("receiptType"), "ซื้อสต๊อกสินค้า")),
        ("ช่องทางชำระเงิน", payload.get("paymentChannel")),
        ("เลขอ้างอิงชำระเงิน", payload.get("paymentReference")),
    ])


def _totals_box(total_amount):
    return totals_table([("รวมทั้งสิ้น (บาท)", total_amount)], note=f"(ตัวอักษร) {baht_text(total_amount)}")


def build_substitute_receipt_story(payload):
    lines = payload.get("lines") or []
    totals = payload.get("totals") or {}
    company = company_info(payload)
    receipt_type = payload.get("receiptType") or "stock_purchase"
    is_stock_purchase = receipt_type == "stock_purchase"

    story = [
        document_header(payload, "ใบรับรองแทนใบเสร็จรับเงิน", date=thai_date(payload.get("receiptDate"))),
        _payee_table(payload),
        paragraph("รายการ", "DocHeading"),
    ]

    if is_stock_purchase:
        item_rows = [[
            paragraph("ลำดับ"), paragraph("Stock SKU"), paragraph("รายละเอียด"),
            paragraph("จำนวน"), paragraph("ต้นทุน/หน่วย"), paragraph("ยอดรวม"), paragraph("หมายเหตุ"),
        ]]
        for index, line in enumerate(lines, 1):
            item_rows.append([
                paragraph(index), paragraph(line.get("sku")), paragraph(line.get("description")),
                paragraph(line.get("quantity")), money_paragraph(line.get("unitCost")), money_paragraph(line.get("lineTotal")),
                paragraph("-"),
            ])
        col_widths = [12 * mm, 40 * mm, 40 * mm, 18 * mm, 25 * mm, 27 * mm, 20 * mm]
        align_right_cols = [3, 4, 5]
    else:
        item_rows = [[
            paragraph("ลำดับ"), paragraph("รายละเอียดรายจ่าย"), paragraph("จำนวน"),
            paragraph("ราคา/หน่วย"), paragraph("ยอดรวม"), paragraph("หมายเหตุ"),
        ]]
        for index, line in enumerate(lines, 1):
            item_rows.append([
                paragraph(index), paragraph(line.get("description")),
                paragraph(line.get("quantity")), money_paragraph(line.get("unitCost")), money_paragraph(line.get("lineTotal")),
                paragraph("-"),
            ])
        col_widths = [11 * mm, 63 * mm, 18 * mm, 27 * mm, 33 * mm, 30 * mm]
        align_right_cols = [2, 3, 4]

    total_amount = totals.get("totalAmount")
    story.extend([
        styled_table(item_rows, col_widths=col_widths, align_right_cols=align_right_cols, header_shade=True),
        Spacer(1, 4),
        _totals_box(total_amount),
        Spacer(1, 6),
        paragraph(f"หมายเหตุ: {paragraph_text(payload.get('paymentNote')) or '-'}"),
        Spacer(1, 10),
        paragraph(f"วัตถุประสงค์ทางธุรกิจ: {paragraph_text(payload.get('businessPurpose')) or '-'}"),
    ])

    additional_note = paragraph_text(payload.get("additionalNote"))
    if additional_note:
        story.extend([
            Spacer(1, 4),
            paragraph(f"หมายเหตุเพิ่มเติม: {additional_note}"),
        ])

    story.extend([
        Spacer(1, 6),
        paragraph(
            f"ข้าพเจ้าขอรับรองว่า รายจ่ายข้างต้นนี้ไม่อาจเรียกเก็บใบเสร็จรับเงินจากผู้รับได้ "
            f"และข้าพเจ้าได้จ่ายไปในงานของทาง {company['name']} โดยแท้ "
            f"ตั้งแต่วันที่ {thai_date(payload.get('receiptDate'))} ถึงวันที่ {thai_date(payload.get('receiptDate'))} "
            "ทั้งนี้ ได้แนบหลักฐานการชำระเงิน/การสั่งซื้อประกอบไว้ในชุดเอกสารนี้แล้ว",
            "DocSmall",
        ),
        Spacer(1, 12),
        _substitute_signature_table(payload),
    ])
    return story


def build_substitute_receipt_outputs(payload, output_dir, raw_dir):
    receipt_path = os.path.join(output_dir, "01_ใบรับรองแทนใบเสร็จรับเงิน.pdf")
    raw_files = payload.get("rawFiles") or []

    with tempfile.TemporaryDirectory() as temp_dir:
        body_path = os.path.join(temp_dir, "receipt-body.pdf")
        build_doc(body_path, "ใบรับรองแทนใบเสร็จรับเงิน", payload, build_substitute_receipt_story(payload), page_size=A4)

        writer = PdfWriter()
        append_pdf(writer, body_path)
        annexed_raw_files = 0
        for file_name in raw_files:
            annexed_raw_files += append_raw_annex(writer, payload, raw_dir, file_name, temp_dir)

        with open(receipt_path, "wb") as handle:
            writer.write(handle)

    metadata_by_path = {
        receipt_path: {"annexedRawFiles": annexed_raw_files},
    }
    return [receipt_path], metadata_by_path
