#!/usr/bin/env python3
import argparse
import json
import os

from reportlab.lib.units import mm

from generate_workflow_document_pdf import DOCUMENT_KIND_LABELS, document_title
from pdf_common import (
    build_audit_packet_with_annexes,
    detail_grid,
    document_header,
    paragraph,
    pdf_page_count,
    styled_table,
)


def build_audit_story(payload, raw_dir):
    raw_files = payload.get("rawFiles") or []
    rows = [[paragraph("ลำดับ"), paragraph("ไฟล์หลักฐาน"), paragraph("สถานะ")]]
    for index, file_name in enumerate(raw_files, 1):
        rows.append([
            paragraph(index),
            paragraph(file_name),
            paragraph("พบไฟล์ใน raw/" if os.path.exists(os.path.join(raw_dir, file_name)) else "ไม่พบไฟล์ใน raw/"),
        ])
    if len(rows) == 1:
        rows.append([paragraph("-"), paragraph("ยังไม่มีไฟล์หลักฐาน"), paragraph("รอดำเนินการ")])

    document_kind = payload.get("documentKind") or "เอกสาร"
    return [
        document_header(payload, f"ชุดรวมหลักฐาน · {document_title(payload)}", width=182 * mm),
        detail_grid([
            ("ประเภทเอกสาร", DOCUMENT_KIND_LABELS.get(document_kind, document_kind)),
            ("เลขที่เอกสาร", payload.get("documentNo")),
            ("จำนวนไฟล์หลักฐาน", f"{len(raw_files)} ไฟล์"),
            ("โฟลเดอร์ต้นฉบับ", "raw/"),
        ]),
        paragraph("สารบัญหลักฐาน", "DocHeading"),
        styled_table(rows, col_widths=[20 * mm, 120 * mm, 42 * mm]),
        paragraph(
            "ไฟล์หลักฐานต้นฉบับจะถูกแนบต่อจาก PDF เอกสารหลักในชุดนี้ "
            "โดยไฟล์ raw/ ยังคงถูกเก็บไว้เป็นต้นฉบับสำหรับตรวจสอบย้อนหลัง",
            "DocSmall",
        ),
    ]


def build_packet(payload, form_path, raw_dir, output_path):
    return build_audit_packet_with_annexes(
        output_path,
        payload,
        raw_dir,
        form_path,
        audit_story_builder=build_audit_story,
    )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--payload", required=True)
    parser.add_argument("--form", required=True)
    parser.add_argument("--raw-dir", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    with open(args.payload, "r", encoding="utf-8") as handle:
        payload = json.load(handle)
    os.makedirs(os.path.dirname(args.output), exist_ok=True)
    metadata = build_packet(payload, args.form, args.raw_dir, args.output)
    result = {
        "name": os.path.basename(args.output),
        "path": f"pdf/{os.path.basename(args.output)}",
        "absolutePath": args.output,
        "size": os.path.getsize(args.output),
        "pageCount": pdf_page_count(args.output),
        **metadata,
    }
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
