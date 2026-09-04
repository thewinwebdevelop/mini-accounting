#!/usr/bin/env python3
import argparse
import json
import logging
import os
import tempfile
from decimal import Decimal, InvalidOperation

from pypdf import PdfReader, PdfWriter
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_RIGHT
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    Image,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)


COMPANY = {
    "name": "หจก.สวีทเฮาส์",
    "tax_id": "กรุณาระบุเลขประจำตัวผู้เสียภาษี",
    "branch": "สำนักงานใหญ่",
    "address": "",
}

BRAND = colors.HexColor("#102a43")
BRAND_2 = colors.HexColor("#334e68")
ACCENT = colors.HexColor("#0f766e")
LINE = colors.HexColor("#cbd2d9")
SOFT = colors.HexColor("#f5f7fa")
WARN_SOFT = colors.HexColor("#fffbeb")
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}

logging.getLogger("pypdf").setLevel(logging.CRITICAL)


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
    name="DocHeading",
    fontName=FONT,
    fontSize=12,
    leading=16,
    textColor=BRAND,
    spaceBefore=7,
    spaceAfter=5,
))
styles.add(ParagraphStyle(
    name="DocBody",
    fontName=FONT,
    fontSize=9,
    leading=13,
))
styles.add(ParagraphStyle(
    name="DocSmall",
    fontName=FONT,
    fontSize=8,
    leading=11,
    textColor=colors.HexColor("#52606d"),
))
styles.add(ParagraphStyle(
    name="DocMoney",
    fontName=FONT,
    fontSize=9,
    leading=13,
    alignment=TA_RIGHT,
))


def text(value, fallback="-"):
    value = "" if value is None else str(value).strip()
    return value or fallback


def document_no(payload):
    return payload.get("requestNo") or payload.get("receiptNo")


def amount(value):
    try:
        return Decimal(str(value or "0").replace(",", ""))
    except InvalidOperation:
        return Decimal("0")


def baht(value):
    return f"{amount(value):,.2f}"


def paragraph(value, style="DocBody"):
    return Paragraph(text(value), styles[style])


def blank_paragraph(value="", style="DocBody"):
    value = "" if value is None else str(value).strip()
    return Paragraph(value or "&nbsp;", styles[style])


def money_paragraph(value):
    return Paragraph(baht(value), styles["DocMoney"])


def company_info(payload):
    company = payload.get("company") or {}
    return {
        "name": text(company.get("legalName"), COMPANY["name"]),
        "tax_id": text(company.get("taxId"), COMPANY["tax_id"]),
        "branch": text(company.get("branch"), COMPANY["branch"]),
        "address": text(company.get("address"), COMPANY["address"]),
    }


def build_doc(path, title, payload, story, page_size=A4):
    company = company_info(payload)
    doc = SimpleDocTemplate(
        path,
        pagesize=page_size,
        rightMargin=14 * mm,
        leftMargin=14 * mm,
        topMargin=13 * mm,
        bottomMargin=13 * mm,
        title=f"{text(document_no(payload), '')} {title}",
        author=company["name"],
    )

    def footer(canvas, document):
        page_width, _ = page_size
        canvas.saveState()
        canvas.setFont(FONT, 7)
        canvas.setFillColor(colors.HexColor("#52606d"))
        canvas.drawString(14 * mm, 9 * mm, text(document_no(payload)))
        canvas.drawRightString(page_width - (14 * mm), 9 * mm, f"หน้า {document.page}")
        canvas.restoreState()

    doc.build(story, onFirstPage=footer, onLaterPages=footer)


def pdf_page_count(path):
    return len(PdfReader(path).pages)


def append_pdf(writer, path):
    reader = PdfReader(path)
    for page in reader.pages:
        writer.add_page(page)


def styled_table(rows, col_widths=None, header=True, align_right_cols=None):
    table = Table(rows, colWidths=col_widths, repeatRows=1 if header else 0, hAlign="LEFT")
    commands = [
        ("FONTNAME", (0, 0), (-1, -1), FONT),
        ("FONTSIZE", (0, 0), (-1, -1), 8),
        ("LEADING", (0, 0), (-1, -1), 11),
        ("GRID", (0, 0), (-1, -1), 0.35, LINE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]
    if header:
        commands.extend([
            ("BACKGROUND", (0, 0), (-1, 0), BRAND_2),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ])
    for col in align_right_cols or []:
        commands.append(("ALIGN", (col, 1 if header else 0), (col, -1), "RIGHT"))
    table.setStyle(TableStyle(commands))
    return table


def kv_table(rows):
    wrapped = [[paragraph(label), paragraph(value)] for label, value in rows]
    table = styled_table(wrapped, col_widths=[48 * mm, 134 * mm], header=False)
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (0, -1), SOFT),
        ("TEXTCOLOR", (0, 0), (0, -1), BRAND),
    ]))
    return table


def signature_cell(role, name=""):
    signer = text(name, "")
    name_line = f"({signer})" if signer else "(........................................)"
    return [
        Paragraph(f"ลงชื่อ{role}", styles["DocBody"]),
        Spacer(1, 9 * mm),
        Paragraph("........................................", styles["DocBody"]),
        blank_paragraph(name_line, "DocSmall"),
        Paragraph("วันที่ ........../........../..........", styles["DocSmall"]),
    ]


def signature_table(payload):
    rows = [
        [
            signature_cell("ผู้ขอเบิก", payload.get("requesterName")),
            signature_cell("ผู้ตรวจเอกสารบัญชี"),
        ],
        [
            signature_cell("ผู้อนุมัติ"),
            signature_cell("ผู้จ่ายเงิน"),
        ],
    ]
    table = Table(rows, colWidths=[91 * mm, 91 * mm], rowHeights=[36 * mm, 36 * mm], hAlign="LEFT")
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


def evidence_rows(payload):
    evidence = payload.get("evidence") or {}
    rows = []
    for item in evidence.values():
        files = item.get("files") or []
        rows.append([
            paragraph(item.get("ref")),
            paragraph(item.get("label")),
            paragraph(item.get("status")),
            paragraph(", ".join(files) if files else "-"),
        ])
    return rows


def build_reimbursement_story(payload):
    lines = payload.get("expenseLines") or []
    totals = payload.get("totals") or {}
    company = company_info(payload)
    story = [
        Paragraph("ใบเบิกจ่ายค่าใช้จ่าย", styles["DocTitle"]),
        kv_table([
            ("ชื่อนิติบุคคล", company["name"]),
            ("เลขประจำตัวผู้เสียภาษี", company["tax_id"]),
            ("สำนักงานใหญ่/สาขา", company["branch"]),
            ("ที่อยู่", company["address"]),
            ("เลขที่เอกสาร", payload.get("requestNo")),
            ("ประเภทคำขอ", payload.get("requestTypeLabel")),
            ("ผู้ขอ", payload.get("requesterName")),
            ("วัตถุประสงค์ทางธุรกิจ", payload.get("businessPurpose")),
            ("ผู้รับเงิน/ผู้ขาย", payload.get("paymentTargetName")),
        ]),
        Paragraph("รายการค่าใช้จ่าย", styles["DocHeading"]),
    ]

    expense_rows = [[
        paragraph("ลำดับ"),
        paragraph("วันที่"),
        paragraph("หมวด"),
        paragraph("รายละเอียด"),
        paragraph("ผู้ขาย"),
        paragraph("ก่อน VAT"),
        paragraph("VAT"),
        paragraph("หัก ณ ที่จ่าย"),
        paragraph("จ่ายสุทธิ"),
    ]]
    for index, line in enumerate(lines, 1):
        gross = amount(line.get("amountBeforeVat")) + amount(line.get("vatAmount"))
        net = gross - amount(line.get("withholdingTax"))
        expense_rows.append([
            paragraph(index),
            paragraph(line.get("date")),
            paragraph(line.get("category")),
            paragraph(line.get("description")),
            paragraph(line.get("vendor")),
            money_paragraph(line.get("amountBeforeVat")),
            money_paragraph(line.get("vatAmount")),
            money_paragraph(line.get("withholdingTax")),
            money_paragraph(net),
        ])

    story.extend([
        styled_table(
            expense_rows,
            col_widths=[11 * mm, 19 * mm, 25 * mm, 43 * mm, 30 * mm, 18 * mm, 16 * mm, 22 * mm, 20 * mm],
            align_right_cols=[5, 6, 7, 8],
        ),
        Paragraph("สรุปยอด", styles["DocHeading"]),
        kv_table([
            ("ยอดก่อน VAT", f"{baht(totals.get('amountBeforeVat'))} บาท"),
            ("VAT", f"{baht(totals.get('vatAmount'))} บาท"),
            ("ยอดรวม", f"{baht(totals.get('grossAmount'))} บาท"),
            ("หัก ณ ที่จ่าย", f"{baht(totals.get('withholdingTax'))} บาท"),
            ("ยอดจ่ายสุทธิ", f"{baht(totals.get('netPayment'))} บาท"),
        ]),
        Paragraph("Checklist หลักฐาน", styles["DocHeading"]),
        styled_table(
            [[paragraph("รหัส"), paragraph("หลักฐาน"), paragraph("สถานะ"), paragraph("ชื่อไฟล์ raw")]] + evidence_rows(payload),
            col_widths=[16 * mm, 55 * mm, 30 * mm, 81 * mm],
        ),
        Paragraph("การอนุมัติ", styles["DocHeading"]),
        signature_table(payload),
    ])
    return story


def build_substitute_receipt_story(payload):
    lines = payload.get("lines") or []
    totals = payload.get("totals") or {}
    company = company_info(payload)
    story = [
        Paragraph("ใบรับรองแทนใบเสร็จรับเงิน", styles["DocTitle"]),
        kv_table([
            ("ชื่อนิติบุคคล", company["name"]),
            ("เลขประจำตัวผู้เสียภาษี", company["tax_id"]),
            ("สำนักงานใหญ่/สาขา", company["branch"]),
            ("ที่อยู่", company["address"]),
            ("เลขที่เอกสาร", payload.get("receiptNo")),
            ("วันที่เอกสาร", payload.get("receiptDate")),
            ("ประเภทเอกสาร", payload.get("receiptTypeLabel")),
            ("ผู้ขาย/ผู้รับเงิน", payload.get("payeeName")),
            ("เลขผู้เสียภาษีผู้ขาย", payload.get("payeeTaxId")),
            ("ช่องทางชำระเงิน", payload.get("paymentChannel")),
            ("เลขอ้างอิงชำระเงิน", payload.get("paymentReference")),
            ("วัตถุประสงค์ทางธุรกิจ", payload.get("businessPurpose")),
        ]),
        Paragraph("รายการที่รับรอง", styles["DocHeading"]),
    ]

    item_rows = [[
        paragraph("ลำดับ"),
        paragraph("Stock SKU"),
        paragraph("รายละเอียด"),
        paragraph("จำนวน"),
        paragraph("ต้นทุน/หน่วย"),
        paragraph("ยอดรวม"),
    ]]
    for index, line in enumerate(lines, 1):
        item_rows.append([
            paragraph(index),
            paragraph(line.get("sku")),
            paragraph(line.get("description")),
            paragraph(line.get("quantity")),
            money_paragraph(line.get("unitCost")),
            money_paragraph(line.get("lineTotal")),
        ])

    story.extend([
        styled_table(
            item_rows,
            col_widths=[13 * mm, 38 * mm, 73 * mm, 18 * mm, 25 * mm, 25 * mm],
            align_right_cols=[3, 4, 5],
        ),
        Paragraph("สรุปยอด", styles["DocHeading"]),
        kv_table([
            ("ยอดรวมตามหลักฐาน", f"{baht(totals.get('totalAmount'))} บาท"),
        ]),
        Paragraph("คำรับรอง", styles["DocHeading"]),
        Paragraph(
            "ข้าพเจ้าขอรับรองว่ารายการข้างต้นเป็นค่าใช้จ่ายที่เกิดขึ้นจริงเพื่อกิจการ "
            "ผู้ขายไม่ได้ออกใบเสร็จรับเงินให้ และได้แนบหลักฐานการชำระเงิน/การสั่งซื้อประกอบไว้ในชุดเอกสารนี้",
            styles["DocBody"],
        ),
        Paragraph("Checklist หลักฐาน", styles["DocHeading"]),
        styled_table(
            [[paragraph("รหัส"), paragraph("หลักฐาน"), paragraph("สถานะ"), paragraph("ชื่อไฟล์ raw")]] + evidence_rows(payload),
            col_widths=[16 * mm, 62 * mm, 30 * mm, 74 * mm],
        ),
        Paragraph("การลงนาม", styles["DocHeading"]),
        signature_table({
            "requesterName": payload.get("preparedBy") or payload.get("requesterName") or "",
        }),
    ])
    return story


def build_audit_story(payload, raw_dir):
    totals = payload.get("totals") or {}
    evidence = payload.get("evidence") or {}
    raw_files = payload.get("rawFiles") or []
    company = company_info(payload)
    story = [
        Paragraph("ชุดรวมส่งตรวจเอกสารเบิกจ่าย", styles["DocTitle"]),
        kv_table([
            ("ชื่อนิติบุคคล", company["name"]),
            ("เลขประจำตัวผู้เสียภาษี", company["tax_id"]),
            ("สำนักงานใหญ่/สาขา", company["branch"]),
            ("เลขที่เอกสาร", payload.get("requestNo")),
            ("ชื่อแฟ้ม", os.path.basename(payload.get("folderPath") or "")),
            ("ประเภทคำขอ", payload.get("requestTypeLabel")),
            ("ยอดจ่ายสุทธิ", f"{baht(totals.get('netPayment'))} บาท"),
            ("โฟลเดอร์ raw", "raw/"),
            ("จำนวนไฟล์หลักฐาน", f"{len(raw_files)} ไฟล์"),
        ]),
        Paragraph("รายการเอกสารในชุดรวม", styles["DocHeading"]),
        styled_table(
            [[paragraph("รหัส"), paragraph("เอกสาร"), paragraph("สถานะ"), paragraph("ไฟล์อ้างอิง")]]
            + [[
                paragraph("FORM"),
                paragraph("ใบเบิกจ่ายค่าใช้จ่าย"),
                paragraph("มี"),
                paragraph("01_ใบเบิกจ่าย.pdf"),
            ]]
            + evidence_rows(payload),
            col_widths=[16 * mm, 58 * mm, 30 * mm, 78 * mm],
        ),
        Paragraph("Tax & Accounting Review เบื้องต้น", styles["DocHeading"]),
        styled_table([
            [paragraph("รายการตรวจ"), paragraph("ผลตรวจ"), paragraph("หมายเหตุ")],
            [paragraph("รายจ่ายเกี่ยวข้องกับกิจการ"), paragraph("รอตรวจ"), paragraph("ตรวจจากวัตถุประสงค์และหลักฐาน raw")],
            [paragraph("ใบกำกับภาษีเต็มรูปครบถ้วน"), paragraph(evidence.get("fullTaxInvoice", {}).get("status", "รอตรวจ")), paragraph("ตรวจชื่อผู้ซื้อ เลขผู้เสียภาษี สาขา เลขที่ วันที่ รายการ และ VAT")],
            [paragraph("หลักฐานชำระเงินครบ"), paragraph("รอตรวจ"), paragraph("ตรวจสลิปจ่ายผู้ขาย/โอนคืนพนักงานตามประเภทคำขอ")],
            [paragraph("หัก ณ ที่จ่าย"), paragraph("รอตรวจ"), paragraph("พิจารณาจากประเภทค่าใช้จ่ายและผู้รับเงิน")],
            [paragraph("ไฟล์ raw ถูกจัดเก็บ"), paragraph("มี" if raw_files else "รอดำเนินการ"), paragraph(", ".join(raw_files) if raw_files else "ยังไม่มีไฟล์ raw")],
        ], col_widths=[55 * mm, 32 * mm, 95 * mm]),
        Paragraph("สารบัญไฟล์ raw", styles["DocHeading"]),
    ]

    raw_rows = [[paragraph("ลำดับ"), paragraph("ชื่อไฟล์"), paragraph("สถานะ")]]
    for index, file_name in enumerate(raw_files, 1):
        raw_path = os.path.join(raw_dir, file_name)
        raw_rows.append([
            paragraph(index),
            paragraph(file_name),
            paragraph("พบไฟล์" if os.path.exists(raw_path) else "ไม่พบไฟล์"),
        ])
    if len(raw_rows) == 1:
        raw_rows.append([paragraph("-"), paragraph("ยังไม่มีไฟล์ raw"), paragraph("รอดำเนินการ")])
    story.append(styled_table(raw_rows, col_widths=[18 * mm, 122 * mm, 42 * mm]))
    story.extend([
        Spacer(1, 6),
        Paragraph(
            "หมายเหตุ: PDF ชุดรวมนี้เป็นแฟ้มสรุปสำหรับส่งตรวจและอ้างอิงไฟล์หลักฐานดิบ "
            "ไม่ทดแทนการเก็บใบกำกับภาษี/ใบเสร็จต้นฉบับตามรูปแบบที่ได้รับมา",
            styles["DocSmall"],
        ),
    ])
    return story


def build_substitute_audit_story(payload, raw_dir):
    totals = payload.get("totals") or {}
    raw_files = payload.get("rawFiles") or []
    company = company_info(payload)
    story = [
        Paragraph("ชุดรวมส่งตรวจใบรับรองแทนใบเสร็จ", styles["DocTitle"]),
        kv_table([
            ("ชื่อนิติบุคคล", company["name"]),
            ("เลขประจำตัวผู้เสียภาษี", company["tax_id"]),
            ("สำนักงานใหญ่/สาขา", company["branch"]),
            ("เลขที่เอกสาร", payload.get("receiptNo")),
            ("ชื่อแฟ้ม", os.path.basename(payload.get("folderPath") or "")),
            ("ประเภทเอกสาร", payload.get("receiptTypeLabel")),
            ("ยอดรวม", f"{baht(totals.get('totalAmount'))} บาท"),
            ("โฟลเดอร์ raw", "raw/"),
            ("จำนวนไฟล์หลักฐาน", f"{len(raw_files)} ไฟล์"),
        ]),
        Paragraph("รายการเอกสารในชุดรวม", styles["DocHeading"]),
        styled_table(
            [[paragraph("รหัส"), paragraph("เอกสาร"), paragraph("สถานะ"), paragraph("ไฟล์อ้างอิง")]]
            + [[
                paragraph("FORM"),
                paragraph("ใบรับรองแทนใบเสร็จรับเงิน"),
                paragraph("มี"),
                paragraph("01_ใบรับรองแทนใบเสร็จรับเงิน.pdf"),
            ]]
            + evidence_rows(payload),
            col_widths=[16 * mm, 64 * mm, 30 * mm, 72 * mm],
        ),
        Paragraph("Tax & Accounting Review เบื้องต้น", styles["DocHeading"]),
        styled_table([
            [paragraph("รายการตรวจ"), paragraph("ผลตรวจ"), paragraph("หมายเหตุ")],
            [paragraph("ผู้ขายไม่ออกใบเสร็จ"), paragraph("รอตรวจ"), paragraph("ตรวจจากหมายเหตุและหลักฐานการสั่งซื้อ")],
            [paragraph("จ่ายเงินจริงจากบัญชีบริษัท"), paragraph("รอตรวจ"), paragraph("ตรวจจากสลิปหรือ statement")],
            [paragraph("สินค้ารับเข้าคลัง"), paragraph("รอตรวจ"), paragraph("ตรวจจากรายการ Stock SKU และ stock card")],
            [paragraph("ไฟล์ raw ถูกจัดเก็บ"), paragraph("มี" if raw_files else "รอดำเนินการ"), paragraph(", ".join(raw_files) if raw_files else "ยังไม่มีไฟล์ raw")],
        ], col_widths=[55 * mm, 32 * mm, 95 * mm]),
        Paragraph("สารบัญไฟล์ raw", styles["DocHeading"]),
    ]

    raw_rows = [[paragraph("ลำดับ"), paragraph("ชื่อไฟล์"), paragraph("สถานะ")]]
    for index, file_name in enumerate(raw_files, 1):
        raw_path = os.path.join(raw_dir, file_name)
        raw_rows.append([
            paragraph(index),
            paragraph(file_name),
            paragraph("พบไฟล์" if os.path.exists(raw_path) else "ไม่พบไฟล์"),
        ])
    if len(raw_rows) == 1:
        raw_rows.append([paragraph("-"), paragraph("ยังไม่มีไฟล์ raw"), paragraph("รอดำเนินการ")])
    story.append(styled_table(raw_rows, col_widths=[18 * mm, 122 * mm, 42 * mm]))
    story.extend([
        Spacer(1, 6),
        Paragraph(
            "หมายเหตุ: PDF ชุดนี้รวมใบรับรองและหลักฐานประกอบเพื่อใช้ตรวจสอบภายใน "
            "ควรเก็บไฟล์ raw ต้นฉบับไว้คู่กันตามโฟลเดอร์เอกสาร",
            styles["DocSmall"],
        ),
    ])
    return story


def raw_file_ref(payload, file_name):
    evidence = payload.get("evidence") or {}
    for item in evidence.values():
        if file_name in (item.get("files") or []):
            return f"{item.get('ref', '-')}: {item.get('label', '-')}"
    return "-"


def build_annex_story(payload, file_name, raw_path, status):
    return [
        Paragraph("เอกสารแนบท้ายชุดรวมส่งตรวจ", styles["DocTitle"]),
        kv_table([
            ("เลขที่เอกสาร", document_no(payload)),
            ("รหัส/ประเภทหลักฐาน", raw_file_ref(payload, file_name)),
            ("ชื่อไฟล์ raw", file_name),
            ("สถานะ", status),
        ]),
        Spacer(1, 8),
    ]


def build_note_annex(path, payload, file_name, raw_path, status, note):
    story = build_annex_story(payload, file_name, raw_path, status)
    story.append(Paragraph(note, styles["DocBody"]))
    build_doc(path, f"เอกสารแนบ {file_name}", payload, story, page_size=A4)


def build_image_annex(path, payload, file_name, raw_path):
    story = build_annex_story(payload, file_name, raw_path, "แนบรูปหลักฐานในหน้านี้")
    image = Image(raw_path)
    max_width = A4[0] - (28 * mm)
    max_height = A4[1] - (78 * mm)
    scale = min(max_width / image.imageWidth, max_height / image.imageHeight, 1)
    image.drawWidth = image.imageWidth * scale
    image.drawHeight = image.imageHeight * scale
    image.hAlign = "CENTER"
    story.append(image)
    build_doc(path, f"เอกสารแนบ {file_name}", payload, story, page_size=A4)


def append_raw_annex(writer, payload, raw_dir, file_name, temp_dir):
    raw_path = os.path.join(raw_dir, file_name)
    annex_path = os.path.join(temp_dir, f"annex-{len(writer.pages) + 1}.pdf")
    extension = os.path.splitext(file_name)[1].lower()

    if not os.path.exists(raw_path):
        build_note_annex(
            annex_path,
            payload,
            file_name,
            raw_path,
            "ไม่พบไฟล์ raw",
            "ระบบพบชื่อไฟล์ในสารบัญ แต่ไม่พบไฟล์จริงในโฟลเดอร์ raw กรุณาตรวจสอบก่อนส่งตรวจ",
        )
        append_pdf(writer, annex_path)
        return 1

    if extension == ".pdf":
        build_note_annex(
            annex_path,
            payload,
            file_name,
            raw_path,
            "แนบ PDF ต้นฉบับต่อจากหน้านี้",
            "หน้าถัดไปคือ PDF หลักฐานต้นฉบับตามไฟล์ raw ที่อ้างอิง",
        )
        append_pdf(writer, annex_path)
        try:
            append_pdf(writer, raw_path)
        except Exception:
            fallback_path = os.path.join(temp_dir, f"annex-fallback-{len(writer.pages) + 1}.pdf")
            build_note_annex(
                fallback_path,
                payload,
                file_name,
                raw_path,
                "อ่าน PDF ต้นฉบับไม่ได้",
                "ระบบเก็บไฟล์ raw ไว้แล้ว แต่ไม่สามารถรวมหน้า PDF ต้นฉบับเข้า packet ได้ กรุณาเปิดตรวจจากโฟลเดอร์ raw",
            )
            append_pdf(writer, fallback_path)
        return 1

    if extension in IMAGE_EXTENSIONS:
        try:
            build_image_annex(annex_path, payload, file_name, raw_path)
        except Exception:
            build_note_annex(
                annex_path,
                payload,
                file_name,
                raw_path,
                "แสดงรูป preview ไม่ได้",
                "ระบบเก็บไฟล์ raw ไว้แล้ว แต่ไม่สามารถแสดงรูปใน packet ได้ กรุณาเปิดตรวจจากโฟลเดอร์ raw",
            )
        append_pdf(writer, annex_path)
        return 1

    build_note_annex(
        annex_path,
        payload,
        file_name,
        raw_path,
        "แนบแบบอ้างอิงไฟล์ raw",
        "ไฟล์ประเภทนี้ถูกเก็บไว้ในโฟลเดอร์ raw และระบุชื่อไว้ใน packet แต่ยังไม่รองรับการแสดง preview ใน PDF",
    )
    append_pdf(writer, annex_path)
    return 1


def build_audit_packet_with_annexes(path, payload, raw_dir, form_path, audit_story_builder=build_audit_story):
    raw_files = payload.get("rawFiles") or []
    with tempfile.TemporaryDirectory() as temp_dir:
        summary_path = os.path.join(temp_dir, "audit-summary.pdf")
        build_doc(summary_path, "ชุดรวมส่งตรวจ", payload, audit_story_builder(payload, raw_dir))

        writer = PdfWriter()
        append_pdf(writer, summary_path)
        append_pdf(writer, form_path)
        annexed_raw_files = 0
        for file_name in raw_files:
            annexed_raw_files += append_raw_annex(writer, payload, raw_dir, file_name, temp_dir)

        with open(path, "wb") as handle:
            writer.write(handle)

    return {
        "annexedRawFiles": annexed_raw_files,
        "includedFormPages": pdf_page_count(form_path),
        "pageCount": pdf_page_count(path),
    }


def build_reimbursement_outputs(payload, output_dir, raw_dir):
    reimbursement_path = os.path.join(output_dir, "01_ใบเบิกจ่าย.pdf")
    audit_path = os.path.join(output_dir, "02_ชุดรวมส่งตรวจ_audit-packet.pdf")

    build_doc(
        reimbursement_path,
        "ใบเบิกจ่ายค่าใช้จ่าย",
        payload,
        build_reimbursement_story(payload),
        page_size=landscape(A4),
    )
    audit_metadata = build_audit_packet_with_annexes(audit_path, payload, raw_dir, reimbursement_path)
    return [reimbursement_path, audit_path], audit_path, audit_metadata


def build_substitute_receipt_outputs(payload, output_dir, raw_dir):
    receipt_path = os.path.join(output_dir, "01_ใบรับรองแทนใบเสร็จรับเงิน.pdf")
    audit_path = os.path.join(output_dir, "02_ชุดรวมส่งตรวจ_ใบรับรองแทนใบเสร็จ.pdf")

    build_doc(
        receipt_path,
        "ใบรับรองแทนใบเสร็จรับเงิน",
        payload,
        build_substitute_receipt_story(payload),
        page_size=A4,
    )
    audit_metadata = build_audit_packet_with_annexes(
        audit_path,
        payload,
        raw_dir,
        receipt_path,
        audit_story_builder=build_substitute_audit_story,
    )
    return [receipt_path, audit_path], audit_path, audit_metadata


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--payload", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--raw-dir", required=True)
    args = parser.parse_args()

    with open(args.payload, "r", encoding="utf-8") as handle:
        payload = json.load(handle)

    os.makedirs(args.output_dir, exist_ok=True)
    if payload.get("documentKind") == "substitute_receipt":
        output_paths, audit_path, audit_metadata = build_substitute_receipt_outputs(payload, args.output_dir, args.raw_dir)
    else:
        output_paths, audit_path, audit_metadata = build_reimbursement_outputs(payload, args.output_dir, args.raw_dir)

    result = []
    for file_path in output_paths:
        metadata = {
            "name": os.path.basename(file_path),
            "path": f"pdf/{os.path.basename(file_path)}",
            "absolutePath": file_path,
            "size": os.path.getsize(file_path),
            "pageCount": pdf_page_count(file_path),
            "annexedRawFiles": 0,
        }
        if file_path == audit_path:
            metadata.update(audit_metadata)
        result.append(metadata)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
