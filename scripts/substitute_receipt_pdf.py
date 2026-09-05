import os
import tempfile
from decimal import Decimal

from pypdf import PdfWriter
from reportlab.lib.enums import TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, Spacer, Table, TableStyle
from reportlab.platypus.flowables import HRFlowable

from pdf_common import (
    FONT,
    LINE,
    amount,
    append_pdf,
    append_raw_annex,
    baht,
    blank_paragraph,
    build_doc,
    company_info,
    money_paragraph,
    paragraph,
    signature_cell,
    styled_table,
    styles,
)

RECEIPT_TYPE_LABELS = {
    "stock_purchase": "ซื้อสต๊อกสินค้า",
    "general_expense": "รายจ่ายทั่วไป",
}

styles.add(ParagraphStyle(name="DocRight", parent=styles["DocBody"], alignment=TA_RIGHT))
styles.add(ParagraphStyle(name="DocCompanyName", parent=styles["DocBody"], fontSize=11.5, leading=15))

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


def _preparer_signature_cell(name=""):
    name_line = f"({name})" if name else "(........................................)"
    return [
        Paragraph("ลงชื่อผู้จ่ายเงิน/ผู้รับรอง", styles["DocBody"]),
        Spacer(1, 8 * mm),
        Paragraph("........................................", styles["DocBody"]),
        blank_paragraph(name_line, "DocSmall"),
        blank_paragraph("ตำแหน่ง........................................", "DocSmall"),
        Paragraph("วันที่ ........../........../..........", styles["DocSmall"]),
    ]


def _substitute_signature_table(payload):
    prepared_by = payload.get("preparedBy") or payload.get("requesterName") or ""
    rows = [[
        _preparer_signature_cell(prepared_by),
        signature_cell("ผู้อนุมัติ"),
    ]]
    table = Table(rows, colWidths=[91 * mm, 91 * mm], rowHeights=[40 * mm], hAlign="LEFT")
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


def _header_table(payload, company):
    receipt_type = payload.get("receiptType") or "stock_purchase"
    left = Paragraph(
        f"{company['name']}<br/>{company['address']}<br/>"
        f"เลขประจำตัวผู้เสียภาษี {company['tax_id']} ({company['branch']})",
        styles["DocCompanyName"],
    )
    right = Paragraph(
        f"เลขที่&nbsp;&nbsp;{paragraph_text(payload.get('receiptNo'))}<br/>"
        f"วันที่&nbsp;&nbsp;{thai_date(payload.get('receiptDate'))}<br/>"
        f"ประเภท&nbsp;&nbsp;{payload.get('receiptTypeLabel') or RECEIPT_TYPE_LABELS.get(receipt_type, receipt_type)}",
        styles["DocRight"],
    )
    table = Table([[left, right]], colWidths=[122 * mm, 60 * mm])
    table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))
    return table


def paragraph_text(value):
    return "" if value is None else str(value).strip()


def _payee_table(payload):
    rows = [
        [
            paragraph("ชื่อผู้รับเงิน/ผู้ขาย"), paragraph(payload.get("payeeName")),
            paragraph("เลขประจำตัวผู้เสียภาษี"), paragraph(payload.get("payeeTaxId")),
        ],
        [paragraph("ที่อยู่"), blank_paragraph(""), "", ""],
        [
            paragraph("ช่องทางชำระเงิน"), paragraph(payload.get("paymentChannel")),
            paragraph("เลขอ้างอิงชำระเงิน"), paragraph(payload.get("paymentReference")),
        ],
    ]
    table = Table(rows, colWidths=[34 * mm, 62 * mm, 34 * mm, 52 * mm], hAlign="LEFT")
    table.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (-1, -1), FONT),
        ("FONTSIZE", (0, 0), (-1, -1), 8.5),
        ("GRID", (0, 0), (-1, -1), 0.35, LINE),
        ("SPAN", (1, 1), (3, 1)),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    return table


def _totals_box(total_amount):
    rows = [
        [paragraph("รวมทั้งสิ้น"), money_paragraph(total_amount)],
        [Paragraph(f"(ตัวอักษร) {baht_text(total_amount)}", styles["DocBody"]), ""],
    ]
    table = Table(rows, colWidths=[122 * mm, 60 * mm], hAlign="LEFT")
    table.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (-1, -1), FONT),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("BOX", (0, 0), (-1, -1), 0.6, LINE),
        ("LINEBELOW", (0, 0), (-1, 0), 0.35, LINE),
        ("SPAN", (0, 1), (1, 1)),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    return table


def build_substitute_receipt_story(payload):
    lines = payload.get("lines") or []
    totals = payload.get("totals") or {}
    company = company_info(payload)
    receipt_type = payload.get("receiptType") or "stock_purchase"
    is_stock_purchase = receipt_type == "stock_purchase"

    story = [
        _header_table(payload, company),
        Spacer(1, 6),
        HRFlowable(width="100%", thickness=0.6, color=LINE, spaceBefore=2, spaceAfter=4),
        Paragraph("ใบรับรองแทนใบเสร็จรับเงิน", styles["DocTitle"]),
        HRFlowable(width="100%", thickness=0.6, color=LINE, spaceBefore=0, spaceAfter=8),
        _payee_table(payload),
        Spacer(1, 8),
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
        col_widths = [10 * mm, 32 * mm, 60 * mm, 14 * mm, 22 * mm, 24 * mm, 20 * mm]
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
        styled_table(item_rows, col_widths=col_widths, align_right_cols=align_right_cols, header_shade=False),
        Spacer(1, 4),
        _totals_box(total_amount),
        Spacer(1, 10),
        Paragraph(f"วัตถุประสงค์ทางธุรกิจ: {paragraph_text(payload.get('businessPurpose')) or '-'}", styles["DocBody"]),
        Spacer(1, 6),
        Paragraph(
            f"ข้าพเจ้าขอรับรองว่า รายจ่ายข้างต้นนี้ไม่อาจเรียกเก็บใบเสร็จรับเงินจากผู้รับได้ "
            f"และข้าพเจ้าได้จ่ายไปในงานของทาง {company['name']} โดยแท้ "
            f"ตั้งแต่วันที่ {thai_date(payload.get('receiptDate'))} ถึงวันที่ {thai_date(payload.get('receiptDate'))} "
            "ทั้งนี้ ได้แนบหลักฐานการชำระเงิน/การสั่งซื้อประกอบไว้ในชุดเอกสารนี้แล้ว",
            styles["DocBody"],
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
