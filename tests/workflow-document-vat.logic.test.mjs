import assert from 'node:assert/strict';
import test from 'node:test';
import logic from '../forms/workflow-document.logic.js';
import prefill from '../forms/workflow-prefill.logic.js';

const valid = (lines) => ({ documentKind: 'purchase_order', accountingMonth: '2026-09', documentDate: '2026-09-24', title: 'ซื้อสินค้า', businessPurpose: 'ซื้อเข้าคลัง', lines });
const line = (fields = {}) => ({ description: 'สินค้า', quantity: '2', unitCost: '100.00', ...fields });

test('exclusive VAT adds tax and retains separate withholding and net', () => {
  const p = logic.buildWorkflowDocumentPayload(valid([line({vatMode:'exclusive',vatRate:'7',withholdingTax:'6'})]));
  assert.equal(p.lines[0].amountBeforeVat,'200.00');
  assert.equal(p.lines[0].vatAmount,'14.00');
  assert.equal(p.lines[0].lineTotal,'214.00');
  assert.equal(p.totals.grossAmount,'214.00');
  assert.equal(p.totals.withholdingTax,'6.00');
  assert.equal(p.totals.netPayment,'208.00');
});
test('inclusive VAT separates tax without adding it again; repeated save is stable', () => {
  const p = logic.buildWorkflowDocumentPayload(valid([line({unitCost:'107',vatMode:'inclusive',vatRate:'7'})]));
  assert.equal(p.totals.amountBeforeVat,'200.00');assert.equal(p.totals.vatAmount,'14.00');assert.equal(p.totals.grossAmount,'214.00');
  assert.deepEqual(logic.buildWorkflowDocumentPayload(p).totals,p.totals);
});
test('legacy price stays unclassified, distinct from explicit no VAT', () => {
  const p=logic.buildWorkflowDocumentPayload(valid([line()]));
  assert.equal(p.totals.grossAmount,'200.00');assert.equal(p.totals.vatAmount,null);assert.equal(p.totals.amountBeforeVat,null);assert.equal(p.totals.vatStatus,'unspecified');
  const n=logic.buildWorkflowDocumentPayload(valid([line({vatMode:'none'})]));
  assert.equal(n.totals.amountBeforeVat,'200.00');assert.equal(n.totals.vatAmount,'0.00');assert.equal(n.totals.vatStatus,'specified');
});
test('partial tax classification never labels the entire gross as tax exclusive', () => {
  const p=logic.calculateWorkflowAmounts([line({vatMode:'exclusive',vatRate:'7'}),line()]);
  assert.equal(p.totals.grossAmount,'414.00');assert.equal(p.totals.vatAmount,null);assert.equal(p.totals.vatStatus,'partial');
});
test('rounds per line in cents, including half-cent tax, and allows explicit zero rate', () => {
  const p=logic.calculateWorkflowAmounts([line({quantity:'1',unitCost:'0.50',vatMode:'exclusive',vatRate:'7'}),line({quantity:'3',unitCost:'0.05',vatMode:'inclusive',vatRate:'7'})]);
  assert.equal(p.lines[0].vatAmount,'0.04');assert.equal(p.lines[1].amountBeforeVat,'0.14');assert.equal(p.lines[1].vatAmount,'0.01');assert.equal(p.totals.grossAmount,'0.69');
  assert.equal(logic.calculateWorkflowAmounts([line({vatMode:'exclusive',vatRate:'0'})]).totals.vatAmount,'0.00');
});
test('manual VAT uses the actual supplied tax, not an inferred percentage', () => {
  const p=logic.calculateWorkflowAmounts([line({vatMode:'manual',vatAmount:'13.99'})]);
  assert.equal(p.totals.grossAmount,'213.99');assert.equal(p.totals.vatAmount,'13.99');assert.equal(p.lines[0].vatRate,null);
});
test('VAT validation rejects malformed modes, rates, amounts, and excessive withholding', () => {
  for(const fields of [{vatMode:'oops'},{vatMode:'exclusive',vatRate:'-1'},{vatMode:'exclusive',vatRate:'101'},{vatMode:'inclusive',vatRate:'abc'},{vatMode:'manual',vatAmount:'-2'},{vatMode:'manual',vatAmount:''},{vatMode:'manual',vatAmount:'3.456'},{withholdingTax:'201'},{withholdingTax:'abc'},{unitCost:'-1'},{quantity:'2x'}]) {
    assert.ok(logic.validateWorkflowDocumentPayload(valid([line(fields)])).length,JSON.stringify(fields));
    assert.throws(()=>logic.buildWorkflowDocumentPayload(valid([line(fields)])),undefined,JSON.stringify(fields));
  }
});
test('server ignores forged computed totals and recalculates from editable inputs', () => {
  const p=logic.buildWorkflowDocumentPayload({...valid([line({vatMode:'exclusive',vatRate:'7',lineTotal:'1',vatAmount:'999',amountBeforeVat:'1'})]),totals:{grossAmount:'1'}});
  assert.equal(p.totals.grossAmount,'214.00');assert.equal(p.totals.vatAmount,'14.00');
});
test('markdown discloses known tax and legacy uncertainty', () => {
  const p=logic.buildWorkflowDocumentPayload(valid([line({vatMode:'inclusive',unitCost:'107',vatRate:'7',withholdingTax:'6'})]));
  const md=logic.formatWorkflowDocumentMarkdown(p);
  assert.match(md,/ยอดก่อน VAT.*200.00/);assert.match(md,/VAT.*14.00/);assert.match(md,/หัก ณ ที่จ่าย.*6.00/);assert.match(md,/จ่ายสุทธิ.*208.00/);
  assert.match(logic.formatWorkflowDocumentMarkdown(logic.buildWorkflowDocumentPayload(valid([line()]))),/ยังไม่ระบุ VAT/);
});
test('expense VAT and withholding survive prefill into voucher and back', () => {
  const context=prefill.expenseRequestToWorkflowContext({expenseLines:[{description:'ขนส่ง',amountBeforeVat:'250.00',vatAmount:'17.50',withholdingTax:'5.00'}]});
  const patch=prefill.applyWorkflowContextToPaymentVoucher(context,['lines']);
  const p=logic.buildWorkflowDocumentPayload({...valid(patch.lines),documentKind:'payment_voucher'});
  assert.equal(p.totals.amountBeforeVat,'250.00');assert.equal(p.totals.vatAmount,'17.50');assert.equal(p.totals.netPayment,'262.50');
  const back=prefill.applyWorkflowContextToExpenseRequest(prefill.paymentVoucherToWorkflowContext(p),['lines']);
  assert.equal(back.expenseLines[0].amountBeforeVat,'250.00');assert.equal(back.expenseLines[0].vatAmount,'17.50');assert.equal(back.expenseLines[0].withholdingTax,'5.00');
});
test('purchase order VAT mode survives goods receipt partial quantity without copying old VAT amount', () => {
  const p=logic.buildWorkflowDocumentPayload(valid([line({quantity:'10',vatMode:'exclusive',vatRate:'7',stockSkuId:'SKU-1'})]));
  const patch=prefill.applyWorkflowContextToGoodsReceipt(prefill.purchaseOrderToWorkflowContext(p),['lines']);
  assert.equal(patch.lines[0].quantity,'');assert.equal(patch.lines[0].vatMode,'exclusive');assert.equal(patch.lines[0].stockSkuId,'SKU-1');
  patch.lines[0].quantity='3';
  const gr=logic.buildWorkflowDocumentPayload({...valid(patch.lines),documentKind:'goods_receipt'});
  assert.equal(gr.totals.grossAmount,'321.00');assert.equal(gr.totals.vatAmount,'21.00');
});

test('unknown source VAT needs confirmation in expense form rather than defaulting to zero', () => {
  const p=logic.buildWorkflowDocumentPayload(valid([line()]));
  const patch=prefill.applyWorkflowContextToExpenseRequest(prefill.purchaseOrderToWorkflowContext(p),['lines']);
  assert.equal(patch.expenseLines[0].vatAmount,'');assert.equal(patch.expenseLines[0].vatConfirmationRequired,true);
});
test('taxed purchase copied to substitute receipt keeps gross money with original quantity', () => {
  const p=logic.buildWorkflowDocumentPayload(valid([line({vatMode:'exclusive',vatRate:'7'})]));
  const patch=prefill.applyWorkflowContextToSubstituteReceipt(prefill.purchaseOrderToWorkflowContext(p),['lines']);
  assert.equal(patch.lines[0].quantity,'2');assert.equal(patch.lines[0].unitCost,'107.00');assert.equal(patch.lines[0].lineTotal,'214.00');
  assert.equal(patch.lines[0].vatMode,undefined);
});
test('substitute prefill refuses a gross price that cannot divide into exact satang per unit', () => {
  const p=logic.buildWorkflowDocumentPayload(valid([line({quantity:'3',unitCost:'0.05',vatMode:'exclusive',vatRate:'7'})]));
  assert.throws(()=>prefill.applyWorkflowContextToSubstituteReceipt(prefill.purchaseOrderToWorkflowContext(p),['lines']),/กรอก.*ยอด.*จริง/);
});
test('manual tax amount must be re-entered when received quantity is not copied', () => {
  const p=logic.buildWorkflowDocumentPayload(valid([line({vatMode:'manual',vatAmount:'14',withholdingTax:'6'})]));
  const patch=prefill.applyWorkflowContextToGoodsReceipt(prefill.purchaseOrderToWorkflowContext(p),['lines']);
  assert.equal(patch.lines[0].quantity,'');assert.equal(patch.lines[0].vatAmount,'');assert.equal(patch.lines[0].withholdingTax,'0.00');
});
