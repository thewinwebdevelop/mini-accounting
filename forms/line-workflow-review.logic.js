"use strict";

const {
  applyWorkflowPrefillGroups
} = require('./workflow-prefill.logic.js');
const {
  validateExpenseRequest
} = require('./expense-request.logic.js');
const {
  validateSubstituteReceipt
} = require('./substitute-receipt.logic.js');
const {
  validateWorkflowDocumentPayload
} = require('./workflow-document.logic.js');
const text = v => typeof v === 'string' || typeof v === 'number' ? String(v).trim().slice(0, 500) : '';
const cents = v => Math.round(Number(String(v).replace(/,/g, '')) * 100);
const money = v => (v / 100).toFixed(2);
const validDate=value=>/^\d{4}-\d{2}-\d{2}$/.test(value||'')&&!Number.isNaN(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
const fields = ['accountingMonth', 'expenseDate', 'vendorName', 'taxId', 'documentNo', 'description', 'requesterName', 'requesterRole', 'businessPurpose', 'receivedDate', 'paymentChannel', 'paymentReference'];
function normalizeInvoiceExtraction(raw = {}) {
  const f = Object.fromEntries(fields.map(k => [k, text(raw.fields?.[k])]));
  const rows = Array.isArray(raw.lines) && raw.lines.length ? raw.lines : [{
    description: raw.fields?.description,
    quantity: '1',
    unitCost: raw.fields?.amountBeforeVat,
    amountBeforeVat: raw.fields?.amountBeforeVat,
    vatAmount: raw.fields?.vatAmount,
    withholdingTax: raw.fields?.withholdingTax
  }];
  return {
    fields: f,
    lines: rows.map(l => Object.fromEntries(['description', 'quantity', 'unitCost', 'amountBeforeVat', 'vatAmount', 'withholdingTax', 'stockSkuId'].map(k => [k, text(l[k])]))),
    warnings: Array.isArray(raw.warnings) ? raw.warnings.map(text) : []
  };
}
function buildReviewedWorkflowContext({
  edits = {}
}) {
  const f = normalizeInvoiceExtraction({
    fields: edits,
    lines: edits.lines
  });
  return {
    invoice: {
      ...f.fields
    },
    payee: {
      name: f.fields.vendorName,
      taxId: f.fields.taxId,
      vendorSnapshot: {
        name: f.fields.vendorName,
        taxId: f.fields.taxId
      }
    },
    purpose: {
      title: f.fields.documentNo || f.fields.description,
      businessPurpose: f.fields.businessPurpose
    },
    parties: {
      requesterName: f.fields.requesterName,
      requesterRole: f.fields.requesterRole
    },
    lines: f.lines.map(l => ({
      ...l,
      vatMode: 'manual',
      lineTotal: money(cents(l.amountBeforeVat) + cents(l.vatAmount)),
      netPayment: money(cents(l.amountBeforeVat) + cents(l.vatAmount) - cents(l.withholdingTax || '0'))
    }))
  };
}
function payloadForStep(context, step) {
  const i = context.invoice || {};
  const patch = applyWorkflowPrefillGroups(context, step.documentKind, ['payee', 'purpose', 'lines']);
  // This path uses human-confirmed invoice quantities and VAT, unlike ordinary unreviewed sibling prefill.
  if (step.documentKind === 'goods_receipt') patch.lines = patch.lines.map((line, index) => ({
    ...line,
    vatAmount: context.lines[index].vatAmount
  }));
  return {
    ...patch,
    documentKind: step.documentKind,
    accountingMonth: i.accountingMonth,
    documentDate: i.expenseDate,
    expenseDate: i.expenseDate,
    receiptDate: i.expenseDate,
    receivedDate: i.receivedDate,
    requestType: 'reimbursement',
    requesterName: context.parties?.requesterName,
    requesterRole: context.parties?.requesterRole,
    receiptType: step.receiptType || 'general_expense',
    paymentChannel: i.paymentChannel,
    paymentReference: i.paymentReference,
    receiptTitle: context.purpose?.title,
    evidenceFiles: {
      otherEvidence: [{
        storedName: 'pending-evidence'
      }]
    }
  };
}
function validateReviewedWorkflowContext({
  context,
  template,
  mode
}) {
  const errors = [];
  const i = context.invoice || {};
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(i.accountingMonth || '')) errors.push('ระบุเดือนบัญชี');
  if (!validDate(i.expenseDate)) errors.push('ระบุวันที่ใบกำกับภาษี');
  if(i.receivedDate&&!validDate(i.receivedDate))errors.push('ตรวจสอบวันที่รับสินค้า');
  if (!context.payee?.name) errors.push('ระบุผู้ขาย');
  if (!context.lines?.length) errors.push('เพิ่มรายการ');
  for (const [n, l] of (context.lines || []).entries()) {
    if (!l.description) errors.push(`รายการ ${n + 1}: ระบุรายละเอียด`);
    for (const k of ['quantity', 'unitCost', 'amountBeforeVat', 'vatAmount']) if (l[k] === '' || !Number.isFinite(Number(l[k])) || Number(l[k]) < 0) errors.push(`รายการ ${n + 1}: ตรวจสอบ ${k}`);
    if (Number.isFinite(Number(l.quantity)) && Number.isFinite(Number(l.unitCost)) && Math.round(Number(l.quantity) * Number(l.unitCost) * 100) !== cents(l.amountBeforeVat)) errors.push(`รายการ ${n + 1}: ยอดก่อน VAT ต้องตรงกับจำนวนคูณราคาต่อหน่วย`);
    if (Number(l.quantity) <= 0) errors.push(`รายการ ${n + 1}: จำนวนต้องมากกว่า 0`);
    if (!Number.isFinite(cents(l.withholdingTax || '0')) || cents(l.withholdingTax || '0') < 0) errors.push('ตรวจสอบภาษีหัก ณ ที่จ่าย');
  }
  const steps = mode === 'automatic' ? template.documentSteps : template.documentSteps.slice(0, 1);
  for (const step of steps) {
    try {
      const p = payloadForStep(context, step);
      errors.push(...(step.documentKind === 'expense_request' ? validateExpenseRequest(p) : step.documentKind === 'substitute_receipt' ? validateSubstituteReceipt(p) : validateWorkflowDocumentPayload(p)));
      if (step.documentKind === 'substitute_receipt' && step.receiptType === 'stock_purchase' && mode === 'automatic' && !i.receivedDate) errors.push('ระบุวันที่รับสินค้า');
    } catch (e) {
      errors.push(e.message);
    }
  }
  return {
    errors: [...new Set(errors)],
    warnings: [],
    effects: steps.map(s => s.documentKind + (s.receiptType === 'stock_purchase' ? ' (รับสินค้าเข้าคลัง)' : ''))
  };
}
module.exports = {
  normalizeInvoiceExtraction,
  buildReviewedWorkflowContext,
  validateReviewedWorkflowContext,
  payloadForStep
};
