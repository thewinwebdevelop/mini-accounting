import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeInvoiceExtraction, buildReviewedWorkflowContext, validateReviewedWorkflowContext } from '../forms/line-workflow-review.logic.js';
test('scalar OCR is backward compatible and zero differs from missing', () => {
  const a = normalizeInvoiceExtraction({
    fields: {
      vendorName: 'Vendor',
      amountBeforeVat: '100',
      vatAmount: '0'
    }
  });
  assert.equal(a.lines[0].vatAmount, '0');
  assert.equal(normalizeInvoiceExtraction({
    fields: {
      amountBeforeVat: '100'
    }
  }).lines[0].vatAmount, '');
});
test('reviewed lines replace OCR and preserve canonical totals', () => {
  const c = buildReviewedWorkflowContext({
    edits: {
      vendorName: 'Corrected',
      requesterName: 'Owner',
      businessPurpose: 'Purchase',
      documentNo: 'INV-1',
      accountingMonth: '2026-11',
      expenseDate: '2026-11-19',
      lines: [{
        description: 'Product',
        quantity: '2',
        unitCost: '50',
        amountBeforeVat: '100',
        vatAmount: '7',
        withholdingTax: '0'
      }]
    }
  });
  assert.equal(c.payee.name, 'Corrected');
  assert.equal(c.lines[0].lineTotal, '107.00');
  assert.deepEqual(validateReviewedWorkflowContext({
    context: c,
    template: {
      documentSteps: [{
        documentKind: 'purchase_order'
      }]
    },
    mode: 'automatic'
  }).errors, []);
});
test('automatic stock workflow requires SKU and receiving date', () => {
  const c = buildReviewedWorkflowContext({
    edits: {}
  });
  assert.ok(validateReviewedWorkflowContext({
    context: c,
    template: {
      documentSteps: [{
        documentKind: 'substitute_receipt',
        receiptType: 'stock_purchase'
      }]
    },
    mode: 'automatic'
  }).errors.length);
});
test('inconsistent reviewed quantity/unit price and base amount is rejected before creation', () => {
  const context = buildReviewedWorkflowContext({
    edits: {
      accountingMonth: '2026-11',
      expenseDate: '2026-11-19',
      vendorName: 'Vendor',
      requesterName: 'Owner',
      businessPurpose: 'Purchase',
      documentNo: 'I',
      lines: [{
        description: 'Product',
        quantity: '2',
        unitCost: '50',
        amountBeforeVat: '900',
        vatAmount: '7'
      }]
    }
  });
  assert.ok(validateReviewedWorkflowContext({
    context,
    template: {
      documentSteps: [{
        documentKind: 'purchase_order'
      }]
    },
    mode: 'automatic'
  }).errors.some(x => x.includes('คูณ')));
});
