#!/usr/bin/env python3
import argparse
import json
import os

from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, Spacer, Table, TableStyle

from pdf_common import (
    FONT,
    LINE,
    amount,
    baht,
    build_audit_packet_with_annexes,
    build_doc,
    company_info,
    evidence_rows,
    kv_table,
    money_paragraph,
    paragraph,
    pdf_page_count,
    signature_cell,
    styled_table,
    styles,
)
from substitute_receipt_pdf import build_substitute_receipt_outputs


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
    audit_metadata = build_audit_packet_with_annexes(
        audit_path,
        payload,
        raw_dir,
        reimbursement_path,
        audit_story_builder=build_audit_story,
    )
    return [reimbursement_path, audit_path], {audit_path: audit_metadata}


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
        output_paths, metadata_by_path = build_substitute_receipt_outputs(payload, args.output_dir, args.raw_dir)
    else:
        output_paths, metadata_by_path = build_reimbursement_outputs(payload, args.output_dir, args.raw_dir)

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
        metadata.update(metadata_by_path.get(file_path, {}))
        result.append(metadata)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
