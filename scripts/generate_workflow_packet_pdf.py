#!/usr/bin/env python3
import argparse
import json
import os

from reportlab.lib.units import mm
from reportlab.platypus import Spacer

from generate_workflow_document_pdf import DOCUMENT_KIND_LABELS
from pdf_common import (
    build_doc,
    kv_table,
    paragraph,
    pdf_page_count,
    styled_table,
)

WORKFLOW_STEP_STATUS_LABELS = {
    "not_started": "ยังไม่เริ่ม",
    "in_progress": "กำลังดำเนินการ",
    "completed": "เสร็จสิ้น",
    "blocked": "รอขั้นตอนก่อนหน้า",
}

# DOCUMENT_KIND_LABELS (imported above) only covers the five lightweight
# document kinds generate_workflow_document_pdf.py itself renders. A workflow
# transaction's steps/childDocuments can also reference expense_request and
# substitute_receipt, each with its own dedicated PDF generator, so the two
# labels below are added here purely for this packet's summary tables. They
# mirror DOCUMENT_TYPE_DEFINITIONS in forms/workflow.logic.js.
ALL_DOCUMENT_KIND_LABELS = {
    **DOCUMENT_KIND_LABELS,
    "expense_request": "ใบเบิกค่าใช้จ่าย",
    "substitute_receipt": "ใบรับรองแทนใบเสร็จรับเงิน",
}


def document_kind_label(document_kind):
    return ALL_DOCUMENT_KIND_LABELS.get(document_kind, document_kind or "-")


def step_status_label(status):
    return WORKFLOW_STEP_STATUS_LABELS.get(status, status or "-")


def build_step_table(steps):
    rows = [[paragraph("ลำดับ"), paragraph("ประเภทเอกสาร"), paragraph("สถานะ")]]
    for index, step in enumerate(steps, 1):
        label = step.get("label") or document_kind_label(step.get("documentKind"))
        rows.append([
            paragraph(index),
            paragraph(label),
            paragraph(step_status_label(step.get("workflowStatus"))),
        ])
    if len(rows) == 1:
        rows.append([paragraph("-"), paragraph("ไม่มีขั้นตอนใน Workflow นี้"), paragraph("-")])
    return styled_table(rows, col_widths=[16 * mm, 120 * mm, 46 * mm])


def build_child_document_table(child_documents):
    rows = [[paragraph("ประเภทเอกสาร"), paragraph("เลขที่เอกสาร"), paragraph("สถานะ")]]
    for doc in child_documents:
        label = document_kind_label(doc.get("documentKind"))
        status = doc.get("statusLabel") or doc.get("status") or "-"
        rows.append([
            paragraph(label),
            paragraph(doc.get("documentNo")),
            paragraph(status),
        ])
    if len(rows) == 1:
        rows.append([paragraph("-"), paragraph("ยังไม่มีเอกสารในธุรกรรมนี้"), paragraph("-")])
    return styled_table(rows, col_widths=[70 * mm, 56 * mm, 56 * mm])


def build_file_table(child_documents, file_field, empty_message):
    rows = [[paragraph("เอกสาร"), paragraph("เลขที่เอกสาร"), paragraph("ชื่อไฟล์")]]
    for doc in child_documents:
        label = document_kind_label(doc.get("documentKind"))
        for file_entry in doc.get(file_field) or []:
            rows.append([
                paragraph(label),
                paragraph(doc.get("documentNo")),
                paragraph(file_entry.get("name")),
            ])
    if len(rows) == 1:
        rows.append([paragraph("-"), paragraph("-"), paragraph(empty_message)])
    return styled_table(rows, col_widths=[56 * mm, 40 * mm, 86 * mm])


def build_packet_story(transaction, child_documents):
    template_snapshot = transaction.get("templateSnapshot") or {}
    steps = transaction.get("steps") or []

    story = [
        paragraph("ชุดรวมเอกสาร Workflow", "DocTitle"),
        kv_table([
            ("เลขที่ธุรกรรม", transaction.get("transactionNo")),
            ("ชื่อธุรกรรม", transaction.get("title")),
            ("Template", template_snapshot.get("name")),
            ("เดือนบัญชี", transaction.get("accountingMonth")),
            ("สถานะธุรกรรม", step_status_label(transaction.get("status"))),
        ]),
        Spacer(1, 8),
        paragraph("ขั้นตอนเอกสารตามลำดับ", "DocHeading"),
        build_step_table(steps),
        Spacer(1, 10),
        paragraph("เอกสารย่อยของธุรกรรมนี้", "DocHeading"),
        build_child_document_table(child_documents),
        Spacer(1, 10),
        paragraph("ไฟล์ PDF ของเอกสารย่อย", "DocHeading"),
        build_file_table(child_documents, "pdfFiles", "ยังไม่มีไฟล์ PDF"),
        Spacer(1, 10),
        paragraph("ไฟล์ต้นฉบับ (raw) ของเอกสารย่อย", "DocHeading"),
        build_file_table(child_documents, "rawFiles", "ยังไม่มีไฟล์ต้นฉบับ"),
    ]
    return story


def build_packet_pdf(transaction, child_documents, output_path):
    packet_payload = {**transaction, "documentNo": transaction.get("transactionNo")}
    build_doc(
        output_path,
        "ชุดรวมเอกสาร Workflow",
        packet_payload,
        build_packet_story(transaction, child_documents),
    )
    return output_path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--payload", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    with open(args.payload, "r", encoding="utf-8") as handle:
        payload = json.load(handle)

    transaction = payload.get("transaction") or {}
    child_documents = payload.get("childDocuments") or []

    output_dir = os.path.dirname(args.output)
    if output_dir:
        os.makedirs(output_dir, exist_ok=True)

    build_packet_pdf(transaction, child_documents, args.output)

    result = {
        "name": os.path.basename(args.output),
        "path": f"pdf/{os.path.basename(args.output)}",
        "absolutePath": args.output,
        "size": os.path.getsize(args.output),
        "pageCount": pdf_page_count(args.output),
    }
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
