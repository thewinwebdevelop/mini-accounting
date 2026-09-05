import logging
import os
import tempfile
from decimal import Decimal, InvalidOperation

from pypdf import PdfReader, PdfWriter
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Image, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle


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


def styled_table(rows, col_widths=None, header=True, align_right_cols=None, header_shade=True):
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
    if header and header_shade:
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


def build_audit_packet_with_annexes(path, payload, raw_dir, form_path, audit_story_builder):
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
