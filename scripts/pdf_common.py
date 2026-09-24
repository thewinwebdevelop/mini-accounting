import logging
import os
import tempfile
from copy import copy
from xml.sax.saxutils import escape
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

BRAND = colors.HexColor("#193b59")
BRAND_2 = colors.HexColor("#2275a5")
ACCENT = colors.HexColor("#2275a5")
LINE = colors.HexColor("#dce5ed")
SOFT = colors.HexColor("#f1f6fa")
WARN_SOFT = colors.HexColor("#fffbeb")
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}

logging.getLogger("pypdf").setLevel(logging.CRITICAL)


def register_font():
    font_dir = os.path.join(os.path.dirname(__file__), "fonts")
    if os.path.exists(os.path.join(font_dir, "Sarabun-Regular.ttf")):
        pdfmetrics.registerFont(TTFont("DocThai", os.path.join(font_dir, "Sarabun-Regular.ttf")))
        pdfmetrics.registerFont(TTFont("DocThaiBold", os.path.join(font_dir, "Sarabun-SemiBold.ttf")))
        pdfmetrics.registerFontFamily("DocThai", normal="DocThai", bold="DocThaiBold", italic="DocThai", boldItalic="DocThaiBold")
        return "DocThai"
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
BOLD_FONT = "DocThaiBold" if "DocThaiBold" in pdfmetrics.getRegisteredFontNames() else FONT
styles = getSampleStyleSheet()
styles.add(ParagraphStyle(
    name="DocTitle",
    fontName=BOLD_FONT,
    fontSize=18,
    leading=24,
    textColor=BRAND,
    alignment=TA_RIGHT,
    spaceAfter=8,
))
styles.add(ParagraphStyle(
    name="DocHeading",
    fontName=BOLD_FONT,
    fontSize=10.5,
    leading=15,
    textColor=BRAND,
    spaceBefore=12,
    spaceAfter=7,
    keepWithNext=True,
))
styles.add(ParagraphStyle(
    name="DocBody",
    fontName=FONT,
    fontSize=9.5,
    leading=14,
    textColor=BRAND,
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
styles.add(ParagraphStyle(name="DocHeader", parent=styles["DocSmall"], fontName=BOLD_FONT, textColor=BRAND_2))
styles.add(ParagraphStyle(name="DocCompany", parent=styles["DocBody"], fontName=BOLD_FONT, fontSize=14, leading=19, spaceAfter=5))
styles.add(ParagraphStyle(name="DocTotal", parent=styles["DocMoney"], fontName=BOLD_FONT, fontSize=19, leading=26, textColor=ACCENT))
styles.add(ParagraphStyle(name="DocCenter", parent=styles["DocBody"], alignment=TA_CENTER))
styles.add(ParagraphStyle(name="DocCaptionCenter", parent=styles["DocSmall"], alignment=TA_CENTER))


def text(value, fallback="-"):
    value = "" if value is None else str(value).strip()
    return value or fallback


def document_no(payload):
    return payload.get("requestNo") or payload.get("receiptNo") or payload.get("documentNo")


def amount(value):
    try:
        return Decimal(str(value or "0").replace(",", ""))
    except InvalidOperation:
        return Decimal("0")


def baht(value):
    return f"{amount(value):,.2f}"


def paragraph(value, style="DocBody"):
    return Paragraph(escape(text(value)).replace("\n", "<br/>"), styles[style])


def blank_paragraph(value="", style="DocBody"):
    value = "" if value is None else str(value).strip()
    return Paragraph(escape(value).replace("\n", "<br/>") or "&nbsp;", styles[style])


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


def build_doc(path, title, payload, story, page_size=A4, footer_label=None):
    company = company_info(payload)
    doc = SimpleDocTemplate(
        path,
        pagesize=page_size,
        rightMargin=14 * mm,
        leftMargin=14 * mm,
        topMargin=17 * mm,
        bottomMargin=18 * mm,
        title=f"{text(document_no(payload), '')} {title}",
        author=company["name"],
    )

    def footer(canvas, document):
        page_width, page_height = page_size
        canvas.saveState()
        canvas.setFillColor(ACCENT)
        canvas.rect(14 * mm, page_height - 10 * mm, 16 * mm, 1.2 * mm, fill=1, stroke=0)
        canvas.setStrokeColor(LINE)
        canvas.setLineWidth(0.5)
        canvas.line(14 * mm, 14 * mm, page_width - 14 * mm, 14 * mm)
        canvas.setFont(FONT, 7)
        canvas.setFillColor(colors.HexColor("#52606d"))
        if document.page > 1:
            canvas.drawRightString(page_width - 14 * mm, page_height - 10 * mm, title)
        canvas.drawString(14 * mm, 9 * mm, footer_label or text(document_no(payload), company["name"]))
        canvas.drawRightString(page_width - (14 * mm), 9 * mm, f"หน้า {document.page}")
        canvas.restoreState()

    doc.build(story, onFirstPage=footer, onLaterPages=footer)


def pdf_page_count(path):
    return len(PdfReader(path).pages)


def append_pdf(writer, path):
    reader = PdfReader(path)
    for page in reader.pages:
        writer.add_page(page)


def styled_table(rows, col_widths=None, header=True, align_right_cols=None, header_shade=True, compact=False):
    # Paragraphs own their color and alignment; TableStyle alone cannot style them.
    rows = [list(row) for row in rows]
    for row_index, row in enumerate(rows):
        for col_index, cell in enumerate(row):
            if isinstance(cell, Paragraph):
                style = copy(styles["DocHeader"] if header and row_index == 0 else cell.style)
                if compact:
                    style.fontSize = min(style.fontSize, 9)
                    style.leading = 12
                if col_index in (align_right_cols or []):
                    style.alignment = TA_RIGHT
                row[col_index] = Paragraph(cell.text, style)
    table = Table(rows, colWidths=col_widths, repeatRows=1 if header else 0, hAlign="LEFT")
    commands = [
        ("FONTNAME", (0, 0), (-1, -1), FONT),
        ("FONTSIZE", (0, 0), (-1, -1), 8),
        ("LEADING", (0, 0), (-1, -1), 11),
        ("LINEBELOW", (0, 0), (-1, -1), 0.35, LINE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 7),
        ("RIGHTPADDING", (0, 0), (-1, -1), 7),
        ("TOPPADDING", (0, 0), (-1, -1), 4 if compact else 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4 if compact else 7),
    ]
    if header and header_shade:
        commands.extend([
            ("BACKGROUND", (0, 0), (-1, 0), SOFT),
            ("LINEBELOW", (0, 0), (-1, 0), 0.8, ACCENT),
        ])
    for col in align_right_cols or []:
        commands.append(("ALIGN", (col, 1 if header else 0), (col, -1), "RIGHT"))
    table.setStyle(TableStyle(commands))
    return table


def kv_table(rows):
    wrapped = [[paragraph(label, "DocSmall"), paragraph(value)] for label, value in rows]
    table = styled_table(wrapped, col_widths=[48 * mm, 134 * mm], header=False)
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (0, -1), SOFT),
        ("TEXTCOLOR", (0, 0), (0, -1), BRAND),
    ]))
    return table


def signature_cell(role, name="", compact=False):
    signer = text(name, "")
    name_line = f"({signer})" if signer else "(........................................)"
    return [
        Spacer(1, (6 if compact else 10) * mm),
        paragraph("........................................", "DocCaptionCenter"),
        blank_paragraph(name_line, "DocCaptionCenter"),
        paragraph(f"ลงชื่อ{role}", "DocCenter"),
        paragraph("วันที่ ........../........../..........", "DocCaptionCenter"),
    ]


def signature_table(roles, width=182 * mm, preparer_position=False, compact=False):
    cells = [signature_cell(role, name, compact=compact) for role, name in roles]
    if preparer_position:
        cells[0].append(paragraph("ตำแหน่ง........................................", "DocCaptionCenter"))
    table = Table([cells],
                  colWidths=[width / len(roles)] * len(roles), hAlign="LEFT")
    table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 4 if compact else 10),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    return table


def document_header(payload, title, width=182 * mm, subtitle=None, date=None):
    company = company_info(payload)
    left = [paragraph(company["name"], "DocCompany")]
    if company["address"]:
        left.append(paragraph(company["address"], "DocSmall"))
    left.extend([paragraph(f"เลขประจำตัวผู้เสียภาษี {company['tax_id']}", "DocSmall"),
                 paragraph(company["branch"], "DocSmall")])
    title_style = ParagraphStyle("HeaderTitle", parent=styles["DocTitle"], fontSize=16, leading=23)
    right = [Paragraph(escape(title), title_style)]
    if subtitle:
        right.append(Paragraph(escape(subtitle), ParagraphStyle("Subtitle", parent=styles["DocSmall"], alignment=TA_RIGHT)))
    reference = document_no(payload) or payload.get("transactionNo")
    for label, value in [("เลขที่", reference), ("วันที่", date or payload.get("documentDate") or payload.get("receiptDate") or payload.get("requestDate"))]:
        if value:
            right.append(Paragraph(f"{label}  {escape(str(value))}", ParagraphStyle("Meta", parent=styles["DocBody"], alignment=TA_RIGHT)))
    table = Table([[left, right]], colWidths=[width * .51, width * .49], hAlign="LEFT")
    table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (0, 0), 16),
        ("RIGHTPADDING", (1, 0), (1, 0), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 14),
        ("LINEBELOW", (0, 0), (-1, -1), 0.8, ACCENT),
    ]))
    return table


def detail_grid(rows, width=182 * mm):
    cells = [[paragraph(label, "DocSmall"), paragraph(value)] for label, value in rows]
    paired = [cells[i:i + 2] for i in range(0, len(cells), 2)]
    if paired and len(paired[-1]) == 1:
        paired[-1].append("")
    table = Table(paired, colWidths=[width / 2] * 2, hAlign="LEFT")
    table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 16),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    return table


def totals_table(rows, width=182 * mm, note=""):
    total_text = baht(rows[-1][1])
    total_style = copy(styles["DocTotal"])
    # Keep large amounts on one line, including their two decimal places.
    total_style.fontSize = min(total_style.fontSize,
                              (42 * mm - 12.5) / pdfmetrics.stringWidth(total_text, BOLD_FONT, 1))
    summary = Table([[paragraph(label, "DocSmall"), money_paragraph(value)] for label, value in rows[:-1]] +
                    [[paragraph(rows[-1][0], "DocHeader"), Paragraph(total_text, total_style)]],
                    colWidths=[43 * mm, 42 * mm], hAlign="RIGHT")
    summary.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("BACKGROUND", (0, -1), (-1, -1), SOFT),
        ("LINEABOVE", (0, -1), (-1, -1), .8, ACCENT),
    ]))
    table = Table([[blank_paragraph(note, "DocSmall"), summary]], colWidths=[width - 89 * mm, 89 * mm], hAlign="LEFT")
    table.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "BOTTOM"),
                              ("LEFTPADDING", (0, 0), (-1, -1), 0),
                              ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                              ("TOPPADDING", (0, 0), (-1, -1), 12)]))
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


def raw_file_ref(payload, file_name):
    evidence = payload.get("evidence") or {}
    for item in evidence.values():
        if file_name in (item.get("files") or []):
            return f"{item.get('ref', '-')}: {item.get('label', '-')}"
    return "-"


def build_annex_story(payload, file_name, raw_path, status):
    return [
        document_header(payload, "เอกสารแนบท้ายชุดรวมส่งตรวจ"),
        Spacer(1, 10),
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
    # SimpleDocTemplate's frame adds six points of padding on each edge.
    max_width = A4[0] - (28 * mm) - 12
    available_height = A4[1] - (35 * mm) - 12
    heading_height = sum(item.wrap(max_width, available_height)[1] +
                         item.getSpaceBefore() + item.getSpaceAfter() for item in story)
    max_height = max(40 * mm, available_height - heading_height - 12)
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
