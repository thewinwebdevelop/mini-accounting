"use strict";

(function () {
  const $ = s => document.querySelector(s);
  const id = new URLSearchParams(location.search).get('batchId');
  let model,
    busy = false,
    stockSkus = [];
  const fields = [['accountingMonth', 'เดือนบัญชี', 'month'], ['expenseDate', 'วันที่ใบกำกับภาษี', 'date'], ['documentNo', 'เลขที่ใบกำกับภาษี'], ['vendorName', 'ผู้ขาย / ผู้รับเงิน'], ['taxId', 'เลขประจำตัวผู้เสียภาษี'], ['requesterName', 'ผู้ขอ / ผู้จัดทำ'], ['requesterRole', 'ตำแหน่ง'], ['businessPurpose', 'วัตถุประสงค์ทางธุรกิจ'], ['description', 'คำอธิบาย'], ['receivedDate', 'วันที่รับสินค้าเข้าคลัง', 'date'], ['paymentChannel', 'ช่องทางชำระเงิน'], ['paymentReference', 'เลขอ้างอิงการชำระเงิน']];
  const names = {
    purchase_order: 'ใบสั่งซื้อ',
    expense_request: 'ใบเบิกค่าใช้จ่าย',
    substitute_receipt: 'ใบรับรองแทนใบเสร็จรับเงิน',
    payment_voucher: 'ใบสำคัญจ่าย',
    goods_receipt: 'ใบรับสินค้า',
    cash_spend_declaration: 'ใบรับรองการจ่ายเงินสดส่วนตัว',
    payee_acknowledgement: 'ใบรับเงินของผู้รับเงิน'
  };
  const lineLabels = ['รายละเอียด', 'จำนวน', 'ราคาต่อหน่วย', 'ยอดก่อน VAT', 'VAT', 'หัก ณ ที่จ่าย', 'สินค้าในคลัง'];
  const lineFields = ['description', 'quantity', 'unitCost', 'amountBeforeVat', 'vatAmount', 'withholdingTax', 'stockSkuId'];
  function status(text, error = false) {
    $('#status').textContent = text;
    $('#status').dataset.kind = error ? 'error' : 'info';
  }
  async function api(action = '', data, method) {
    const r = await fetch(`/api/line-workflow-batches/${encodeURIComponent(id)}${action ? '/' + action : ''}`, {
      method: method || (data ? 'POST' : 'GET'),
      headers: {
        'content-type': 'application/json'
      },
      credentials: 'same-origin',
      ...(data ? {
        body: JSON.stringify(data)
      } : {})
    });
    if (r.status === 401) {
      location.assign('/line-auth?returnTo=' + encodeURIComponent(location.pathname + location.search));
      throw new Error('กรุณาเข้าสู่ระบบ');
    }
    const b = await r.json();
    if (!r.ok) throw new Error(b.error || 'ดำเนินการไม่สำเร็จ');
    return b;
  }
  function line(values = {}) {
    const tr = document.createElement('tr');
    for (const name of lineFields) {
      const td = document.createElement('td');
      td.dataset.label = lineLabels[lineFields.indexOf(name)];
      const input = document.createElement(name === 'stockSkuId' ? 'select' : 'input');
      input.name = name;
      if (name === 'stockSkuId') {
        const blank = document.createElement('option');
        blank.value = '';
        blank.textContent = 'เลือกสินค้า';
        input.append(blank);
        for (const sku of stockSkus) {
          const option = document.createElement('option');
          option.value = sku.id;
          option.textContent = [sku.sku, sku.productName].filter(Boolean).join(' · ');
          input.append(option);
        }
      }
      input.value = values[name] ?? '';
      input.setAttribute('aria-label', name);
      td.append(input);
      tr.append(td);
    }
    const td = document.createElement('td');
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = 'ลบ';
    remove.onclick = () => tr.remove();
    td.append(remove);
    tr.append(td);
    $('#lines').append(tr);
  }
  function edits() {
    return {
      ...Object.fromEntries(fields.map(([name]) => [name, $(`[name="${name}"]`).value])),
      lines: [...$('#lines').rows].map(row => Object.fromEntries(lineFields.map(name => [name, row.querySelector(`[name="${name}"]`).value])))
    };
  }
  function show(m) {
    model = m;
    const b = m.batch;
    $('#workflow').textContent = b.templateSnapshot?.name || '';
    $('#warnings').textContent = (b.extractedContext?.warnings || []).join('\n');
    $('#review').hidden = b.confirmedRevision !== undefined;
    $('#result').hidden = b.confirmedRevision === undefined;
    $('#fields').replaceChildren();
    for (const [name, label, type] of fields) {
      const el = document.createElement('label');
      el.textContent = label;
      const input = document.createElement('input');
      input.name = name;
      input.type = type || 'text';
      input.value = m.edits[name] || '';
      el.append(input);
      $('#fields').append(el);
    }
    $('#lines').replaceChildren();
    for (const row of m.edits.lines || []) line(row);
    $('#primary').replaceChildren();
    $('#files').replaceChildren();
    for (const file of m.files) {
      const option = document.createElement('option');
      option.value = file.id;
      option.textContent = file.name;
      $('#primary').append(option);
      const p = document.createElement('p');
      const a = document.createElement('a');
      a.textContent = file.name;
      a.href = file.url;
      a.target = '_blank';
      a.rel = 'noopener';
      p.append(a);
      $('#files').append(p);
    }
    $('#primary').value = b.primaryEvidenceId;
    $('#primary').disabled = b.confirmedRevision !== undefined;
    preview();
    $('#steps').replaceChildren();
    for (const step of b.templateSnapshot?.documentSteps || []) {
      const li = document.createElement('li');
      li.textContent = (names[step.documentKind] || step.documentKind) + (step.receiptType === 'stock_purchase' ? ' — รับสินค้าเข้าคลัง' : '');
      $('#steps').append(li);
    }
    $('#automatic').hidden = !m.canAutomatic;
    $('#progress').replaceChildren();
    for (const step of b.steps) {
      const li = document.createElement('li');
      li.textContent = `${names[step.documentKind] || step.documentKind} · ${step.documentNo} · ${step.status === 'completed' ? 'เสร็จสิ้น' : step.status === 'draft' ? 'แบบร่าง' : step.status}`;
      $('#progress').append(li);
    }
    $('#workflow-link').href = m.workflowUrl || '#';
    $('#workflow-link').hidden = !m.workflowUrl;
    $('#resume').hidden = b.state !== 'paused';
    if (b.state === 'completed') status('สร้างเอกสารและ Complete ครบทุกขั้นตอนแล้ว');else if (b.state === 'manual') status('สร้างเอกสารขั้นตอนแรกแล้ว พร้อมให้คุณดำเนินการเอง');else if (b.state === 'paused') status('หยุดที่ขั้นตอนที่ต้องตรวจสอบ: ' + b.error, true);else if (b.state === 'running') status('กำลังสร้างเอกสารตามลำดับ…');else status('ตรวจสอบและแก้ไขข้อมูล แล้วเลือกวิธีสร้างเอกสาร');
  }
  function preview() {
    const f = model.files.find(f => f.id === $('#primary').value);
    $('#preview').replaceChildren();
    if (!f) return;
    const p = document.createElement(f.type === 'application/pdf' ? 'iframe' : 'img');
    p.src = f.url;
    p.title = 'ใบกำกับภาษีต้นฉบับ';
    if (p.tagName === 'IMG') p.alt = f.name;
    $('#preview').append(p);
  }
  async function save() {
    await api('review', {
      expectedRevision: model.batch.revision,
      edits: edits(),
      primaryEvidenceId: $('#primary').value
    }, 'PATCH');
    show(await api());
    status('บันทึกแล้ว');
  }
  async function run() {
    let m = await api('run', {});
    show(m);
    if (m.batch.state === 'running') setTimeout(() => guard(run), 3000);
  }
  async function confirm(mode) {
    await save();
    await api('confirm', {
      expectedRevision: model.batch.revision,
      mode
    });
    show(await api());
    await run();
  }
  async function guard(fn) {
    if (busy) return;
    busy = true;
    document.querySelectorAll('button').forEach(b => b.disabled = true);
    try {
      await fn();
    } catch (e) {
      status(e.message, true);
    } finally {
      busy = false;
      document.querySelectorAll('button').forEach(b => b.disabled = false);
    }
  }
  $('#save').onclick = () => guard(save);
  $('#automatic').onclick = () => guard(() => confirm('automatic'));
  $('#manual').onclick = () => guard(() => confirm('manual'));
  $('#add-line').onclick = () => line();
  $('#primary').onchange = () => guard(async () => {
    const m = await api('primary', {
      expectedRevision: model.batch.revision,
      primaryEvidenceId: $('#primary').value
    });
    show(m);
    status('อ่านใบกำกับภาษีหลักใหม่แล้ว กรุณาตรวจสอบข้อมูลอีกครั้ง');
  });
  $('#review').onsubmit = e => e.preventDefault();
  $('#resume').onclick = () => guard(async () => {
    await api('resume', {});
    await run();
  });
  guard(async () => {
    if (!id) throw new Error('กรุณาเปิดลิงก์ตรวจสอบจาก LINE');
    const inventory = await fetch('/api/inventory/stock-skus', {
      credentials: 'same-origin'
    });
    if (inventory.ok) {
      stockSkus = (await inventory.json()).stockSkus || [];
    }
    const m = await api();
    show(m);
    if (m.batch.state === 'running') await run();
  });
})();
