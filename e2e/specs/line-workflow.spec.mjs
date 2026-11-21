import crypto from 'node:crypto';
import { test, expect } from '../fixtures/playwright.fixture.mjs';
async function event(app, source, message) {
  const body = JSON.stringify({
    events: [{
      webhookEventId: crypto.randomUUID(),
      type: 'message',
      source: {
        type: 'user',
        userId: source
      },
      replyToken: 'reply',
      message: {
        id: crypto.randomUUID(),
        ...message
      }
    }]
  });
  const res = await fetch(app.baseUrl + 'api/webhooks/line', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-line-signature': crypto.createHmac('sha256', 'e2e-line-channel-secret').update(body).digest('base64')
    },
    body
  });
  expect(res.status).toBe(200);
  return res.json();
}
for (const mode of ['manual', 'automatic']) test(`invoice workflow ${mode}: review corrected values and reopen saved document`, async ({
  ownerPage: page,
  localApp: app,
  mock
}) => {
  await event(app, 'owner-1', {
    type: 'text',
    text: 'สร้างเอกสารด้วยใบกำกับภาษี'
  });
  const replies = mock.requests.filter(r => r.path === '/v2/bot/message/reply');
  expect(JSON.parse(replies.at(-1).body).messages[0].quickReply.items.length).toBeLessThanOrEqual(13);
  await event(app, 'owner-1', {
    type: 'text',
    text: '3'
  });
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAACgAAAAoCAIAAAADnC86AAAATElEQVR4nO3NsQHAMAzDMIf//+yu0QPMUOEBnN2dF3iyTmMRZnZrrMGrUmMNXpUaa/Cq1FiDV6XGGrwqNdbgVamxBq9KjTV41fw8/gCD6wNNCJl4CAAAAABJRU5ErkJggg==', 'base64');
  mock.scriptResponse({
    provider: 'line',
    endpoint: '/content',
    bytes: png,
    contentType: 'image/png'
  });
  await event(app, 'owner-1', {
    type: 'image'
  });
  const done = await event(app, 'owner-1', {
    type: 'text',
    text: 'ส่งครบแล้ว'
  });
  expect(done.workflowEvents.at(-1).batchId).toBeTruthy();
  const id = done.workflowEvents.at(-1).batchId;
  mock.scriptResponse({
    provider: 'ocr',
    endpoint: '/',
    body: {
      fields: {
        vendorName: 'OCR vendor',
        expenseDate: '2026-11-19',
        accountingMonth: '2026-11',
        documentNo: 'INV-101',
        description: 'Paper',
        amountBeforeVat: '100',
        vatAmount: '7',
        withholdingTax: '0'
      },
      confidence: 0.9
    }
  });
  await page.goto(`/line-workflow-review?batchId=${id}`);
  await expect(page.locator('[name=vendorName]')).toHaveValue('OCR vendor');
  await page.locator('[name=vendorName]').fill('Corrected Vendor');
  await page.locator('[name=requesterName]').fill('Owner');
  await page.locator('[name=businessPurpose]').fill('Office supplies');
  await page.getByRole('button', {
    name: 'บันทึกข้อมูล'
  }).click();
  await expect(page.locator('[data-status]')).toContainText('บันทึกแล้ว');
  await page.reload();
  await expect(page.locator('[name=vendorName]')).toHaveValue('Corrected Vendor');
  await page.getByRole('button', {
    name: mode === 'manual' ? 'ยืนยันและดำเนินการเอง' : 'ยืนยันและทำทุกขั้นตอนอัตโนมัติ',
    exact: true
  }).click();
  await expect.poll(async () => {
    const r = await page.request.get(`/api/line-workflow-batches/${id}`);
    const x = await r.json();
    return x.batch.state;
  }, {
    timeout: 20000
  }).toMatch(/manual|completed|paused/);
  const checkpoint = await page.request.get(`/api/line-workflow-batches/${id}`).then(r => r.json());
  expect(checkpoint.batch.error || '').toBe('');
  await expect(page.locator('[data-status]')).toContainText(mode === 'manual' ? 'ดำเนินการเอง' : 'ครบทุกขั้นตอน');
  const response = await page.request.get(`/api/line-workflow-batches/${id}`);
  const b = (await response.json()).batch;
  expect(b.state).toBe(mode === 'manual' ? 'manual' : 'completed');
  expect(b.notificationSent).toBe(true);
  expect(mock.requests.some(r => r.path === '/v2/bot/message/push')).toBe(true);
  expect(b.steps).toHaveLength(mode === 'manual' ? 1 : 3);
  // Reopen the actual saved document with the flattened cloud response shape.
  await page.route(`**/api/expense-requests/${b.steps[0].documentNo}`, async route => {
    const response = await route.fetch();
    const record = await response.json();
    const {
      payload,
      ...metadata
    } = record;
    await route.fulfill({
      response,
      json: payload ? {
        ...payload,
        ...metadata
      } : record
    });
  });
  await page.goto(`/expense-request?requestNo=${b.steps[0].documentNo}&transactionNo=${b.transactionNo}&workflowStepId=${b.steps[0].stepId}`);
  await expect(page.locator('[name=paymentTargetName]')).toHaveValue('Corrected Vendor');
  await page.reload();
  await expect(page.locator('[name=paymentTargetName]')).toHaveValue('Corrected Vendor');
  if (mode === 'manual') {
    const no = b.steps[0].documentNo;
    expect((await page.request.post('/api/expense-requests', {
      multipart: {
        payload: JSON.stringify({
          requestNo: no
        })
      }
    })).ok()).toBe(true);
    expect((await page.request.post(`/api/expense-requests/${no}/approve`, {
      data: {}
    })).ok()).toBe(true);
    expect((await page.request.post(`/api/expense-requests/${no}/complete`, {
      data: {}
    })).ok()).toBe(true);
    const next = await page.request.post(`/api/workflow-transactions/${b.transactionNo}/start-document/step-002`, {
      data: {}
    }).then(r => r.json());
    await page.goto(next.url);
    await expect(page.locator('[name=payeeName]')).toHaveValue('Corrected Vendor');
    await expect(page.locator('[name=businessPurpose]')).toHaveValue('Office supplies');
    const savedPromise = page.waitForResponse(r => r.url().endsWith('/api/substitute-receipt-drafts') && r.request().method() === 'POST');
    await page.locator('#saveDraft').click();
    const savedResponse = await savedPromise;
    expect(savedResponse.ok()).toBe(true);
    const saved = await savedResponse.json();
    expect(saved.rawFiles.length).toBeGreaterThan(0);
    await page.goto(`/substitute-receipt?receiptNo=${saved.receiptNo}&transactionNo=${b.transactionNo}&workflowStepId=step-002`);
    await expect(page.locator('[name=payeeName]')).toHaveValue('Corrected Vendor');
    await page.reload();
    await expect(page.locator('[name=payeeName]')).toHaveValue('Corrected Vendor');
  }
});
test('invoice workflow PDF evidence, cross-user denial, mode permission and replay', async ({
  ownerPage: page,
  authenticatedPage: employee,
  localApp: app,
  mock
}) => {
  const {
    readFile
  } = await import('node:fs/promises');
  await event(app, 'owner-1', {
    type: 'text',
    text: 'สร้างเอกสารด้วยใบกำกับภาษี'
  });
  await event(app, 'owner-1', {
    type: 'text',
    text: '3'
  });
  const pdf = await readFile('output/pdf/document-examples-2026-09-23/generated/99_workflow_packet.pdf');
  mock.scriptResponse({
    provider: 'line',
    endpoint: '/content',
    bytes: pdf,
    contentType: 'application/pdf'
  });
  const added = await event(app, 'owner-1', {
    type: 'file',
    fileName: 'invoice.pdf'
  });
  expect(added.skipped).toHaveLength(0);
  const done = await event(app, 'owner-1', {
    type: 'text',
    text: 'ส่งครบแล้ว'
  });
  const id = done.workflowEvents[0].batchId;
  expect((await employee.request.get(`/api/line-workflow-batches/${id}`)).status()).toBe(403);
  mock.scriptResponse({
    provider: 'ocr',
    endpoint: '/',
    body: {
      fields: {
        vendorName: 'PDF Vendor',
        expenseDate: '2026-11-19',
        accountingMonth: '2026-11',
        documentNo: 'PDF-1',
        description: 'Paper',
        amountBeforeVat: '100',
        vatAmount: '0',
        withholdingTax: '0'
      },
      confidence: 0.9
    }
  });
  await page.goto(`/line-workflow-review?batchId=${id}`);
  await expect(page.locator('[name=vendorName]')).toHaveValue('PDF Vendor');
  await expect(page.locator('#preview iframe')).toBeVisible();
  let b = (await page.request.get(`/api/line-workflow-batches/${id}`).then(r => r.json())).batch;
  const edits = {
    ...b.extractedContext.fields,
    requesterName: 'Owner',
    businessPurpose: 'Office supplies',
    lines: b.extractedContext.lines
  };
  const saved = await page.request.patch(`/api/line-workflow-batches/${id}/review`, {
    data: {
      expectedRevision: b.revision,
      edits,
      primaryEvidenceId: b.primaryEvidenceId
    }
  });
  expect(saved.ok()).toBeTruthy();
  b = (await saved.json()).batch;
  const input = {
    expectedRevision: b.revision,
    mode: 'manual'
  };
  const first = await page.request.post(`/api/line-workflow-batches/${id}/confirm`, {
    data: input
  }).then(r => r.json());
  const second = await page.request.post(`/api/line-workflow-batches/${id}/confirm`, {
    data: input
  }).then(r => r.json());
  expect(second.jobId).toBe(first.jobId);
  expect(second.idempotent).toBe(true);
  expect((await page.request.post(`/api/line-workflow-batches/${id}/confirm`, {
    data: {
      ...input,
      mode: 'automatic'
    }
  })).status()).toBe(409);
  const run = await page.request.post(`/api/line-workflow-batches/${id}/run`, {
    data: {}
  });
  expect(run.ok()).toBeTruthy();
  b = (await run.json()).batch;
  expect(b.state).toBe('manual');
  const evidence = await page.request.get(`/api/line-workflow-batches/${id}/evidence/${b.evidenceIds[0]}`);
  expect(evidence.status()).toBe(200);
  expect(Buffer.from(await evidence.body())).toEqual(pdf);
  expect((await page.request.post('/api/internal/line-workflow/run', {
    data: {}
  })).status()).toBe(401);
});
test('invoice workflow employee cannot auto approve and invalid media retries', async ({
  authenticatedPage: page,
  localApp: app,
  mock
}) => {
  await event(app, 'employee-a', {
    type: 'text',
    text: 'สร้างเอกสารด้วยใบกำกับภาษี'
  });
  const selected = await event(app, 'employee-a', {
    type: 'text',
    text: '3'
  });
  const id = selected.workflowEvents[0].batchId;
  expect((await page.request.post(`/api/line-workflow-batches/${id}/confirm`, {
    data: {
      expectedRevision: 2,
      mode: 'automatic'
    }
  })).status()).toBe(403);
  mock.scriptResponse({
    provider: 'line',
    endpoint: '/content',
    bytes: Buffer.from('not a real image'),
    contentType: 'image/png'
  });
  const body = JSON.stringify({
    events: [{
      webhookEventId: crypto.randomUUID(),
      type: 'message',
      source: {
        type: 'user',
        userId: 'employee-a'
      },
      replyToken: 'reply',
      message: {
        id: crypto.randomUUID(),
        type: 'image'
      }
    }]
  });
  const r = await fetch(app.baseUrl + 'api/webhooks/line', {
    method: 'POST',
    headers: {
      'x-line-signature': crypto.createHmac('sha256', 'e2e-line-channel-secret').update(body).digest('base64')
    },
    body
  });
  expect(r.status).toBe(503);
  expect((await page.request.get(`/api/line-workflow-batches/${id}`).then(r => r.json())).batch.evidenceIds).toHaveLength(0);
});
test('invoice workflow stock receipt completes in order and repeated run does not receive twice', async ({
  ownerPage: page,
  localApp: app,
  mock
}) => {
  test.setTimeout(90000);
  const {
    SubstituteReceiptPage
  } = await import('../pages/substitute-receipt.page.mjs');
  const stockPage = new SubstituteReceiptPage(page, null, {
    runId: app.runId
  });
  const [sku] = await stockPage.ensureStockSku();
  const logic = (await import('../../forms/workflow.logic.js')).default;
  const template = {
    ...logic.getDefaultWorkflowTemplates()[0],
    templateId: 'line_stock_' + crypto.randomUUID(),
    name: 'Invoice stock fixture'
  };
  expect((await page.request.post('/api/workflow-templates', {
    data: template
  })).ok()).toBe(true);
  const catalog = await page.request.get('/api/workflow-templates').then(r => r.json());
  const choice = catalog.templates.findIndex(t => t.templateId === template.templateId) + 1;
  await event(app, 'owner-1', {
    type: 'text',
    text: 'สร้างเอกสารด้วยใบกำกับภาษี'
  });
  await event(app, 'owner-1', {
    type: 'text',
    text: String(choice)
  });
  const {
    readFile
  } = await import('node:fs/promises');
  const pdf = await readFile('output/pdf/document-examples-2026-09-23/generated/99_workflow_packet.pdf');
  mock.scriptResponse({
    provider: 'line',
    endpoint: '/content',
    bytes: pdf,
    contentType: 'application/pdf'
  });
  await event(app, 'owner-1', {
    type: 'file',
    fileName: 'stock-invoice.pdf'
  });
  const done = await event(app, 'owner-1', {
    type: 'text',
    text: 'ส่งครบแล้ว'
  });
  const id = done.workflowEvents[0].batchId;
  mock.scriptResponse({
    provider: 'ocr',
    endpoint: '/',
    body: {
      fields: {
        vendorName: 'Stock Vendor',
        expenseDate: '2026-11-20',
        accountingMonth: '2026-11',
        documentNo: 'STOCK-1',
        description: 'Paper',
        amountBeforeVat: '100',
        vatAmount: '0',
        withholdingTax: '0'
      },
      confidence: 0.9
    }
  });
  await page.goto(`/line-workflow-review?batchId=${id}`);
  await expect(page.locator('[name=vendorName]')).toHaveValue('Stock Vendor');
  await page.locator('[name=requesterName]').fill('Owner');
  await page.locator('[name=businessPurpose]').fill('Stock purchase');
  await page.locator('[name=receivedDate]').fill('2026-11-20');
  await page.locator('#lines [name=stockSkuId]').selectOption(String(sku.id));
  await page.getByRole('button', {
    name: 'ยืนยันและทำทุกขั้นตอนอัตโนมัติ',
    exact: true
  }).click();
  await expect.poll(async () => {
    const b = await page.request.get(`/api/line-workflow-batches/${id}`).then(r => r.json());
    return b.batch.state;
  }, {
    timeout: 60000
  }).toMatch(/completed|paused/);
  let b = (await page.request.get(`/api/line-workflow-batches/${id}`).then(r => r.json())).batch;
  expect(b.error || '').toBe('');
  expect(b.state).toBe('completed');
  expect(b.steps).toHaveLength(4);
  const before = await page.request.get('/api/inventory/balances').then(r => r.json());
  await page.request.post(`/api/line-workflow-batches/${id}/run`, {
    data: {}
  });
  const after = await page.request.get('/api/inventory/balances').then(r => r.json());
  expect(after).toEqual(before);
  const receipt = b.steps.find(s => s.documentKind === 'substitute_receipt');
  await page.goto(`/substitute-receipt?receiptNo=${receipt.documentNo}&transactionNo=${b.transactionNo}&workflowStepId=${receipt.stepId}`);
  await expect(page.locator('[name=payeeName]')).toHaveValue('Stock Vendor');
  await page.reload();
  await expect(page.locator('[name=payeeName]')).toHaveValue('Stock Vendor');
});
test('invoice workflow concurrent uploads are retained and changing primary rereads OCR', async ({
  ownerPage: page,
  localApp: app,
  mock
}) => {
  const {
    readFile
  } = await import('node:fs/promises');
  const pdf = await readFile('output/pdf/document-examples-2026-09-23/generated/99_workflow_packet.pdf');
  await event(app, 'owner-1', {
    type: 'text',
    text: 'สร้างเอกสารด้วยใบกำกับภาษี'
  });
  await event(app, 'owner-1', {
    type: 'text',
    text: '3'
  });
  mock.scriptResponse({
    provider: 'line',
    endpoint: '/content',
    bytes: pdf,
    contentType: 'application/pdf'
  });
  mock.scriptResponse({
    provider: 'line',
    endpoint: '/content',
    bytes: Buffer.concat([pdf, Buffer.from('\n%Second fixture')]),
    contentType: 'application/pdf'
  });
  const attachments = await Promise.all([event(app, 'owner-1', {
    type: 'file',
    fileName: 'a.pdf'
  }), event(app, 'owner-1', {
    type: 'file',
    fileName: 'b.pdf'
  })]);
  expect(attachments.every(a => a.skipped.length === 0)).toBe(true);
  const done = await event(app, 'owner-1', {
    type: 'text',
    text: 'ส่งครบแล้ว'
  });
  const id = done.workflowEvents[0].batchId;
  mock.scriptResponse({
    provider: 'ocr',
    endpoint: '/',
    body: {
      fields: {
        vendorName: 'First Vendor',
        amountBeforeVat: '100',
        vatAmount: '0'
      },
      confidence: 0.9
    }
  });
  await page.goto(`/line-workflow-review?batchId=${id}`);
  await expect(page.locator('[name=vendorName]')).toHaveValue('First Vendor');
  const m = await page.request.get(`/api/line-workflow-batches/${id}`).then(r => r.json());
  expect(m.batch.evidenceIds).toHaveLength(2);
  const other = m.batch.evidenceIds.find(x => x !== m.batch.primaryEvidenceId);
  mock.scriptResponse({
    provider: 'ocr',
    endpoint: '/',
    body: {
      fields: {
        vendorName: 'Second Vendor',
        amountBeforeVat: '200',
        vatAmount: '0'
      },
      confidence: 0.9
    }
  });
  await page.locator('#primary').selectOption(other);
  await expect(page.locator('[name=vendorName]')).toHaveValue('Second Vendor');
  await page.reload();
  await expect(page.locator('[name=vendorName]')).toHaveValue('Second Vendor');
});
