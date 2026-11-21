import { createTestSession, sessionCookie } from '../fixtures/auth.fixture.mjs';
import { test, expect } from '../fixtures/playwright.fixture.mjs';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAACgAAAAoCAIAAAADnC86AAAATElEQVR4nO3NsQHAMAzDMIf//+yu0QPMUOEBnN2dF3iyTmMRZnZrrMGrUmMNXpUaa/Cq1FiDV6XGGrwqNdbgVamxBq9KjTV41fw8/gCD6wNNCJl4CAAAAABJRU5ErkJggg==', 'base64');
const extraction = {
  fields: {
    vendorName: 'Assistant Vendor',
    accountingMonth: '2026-11',
    expenseDate: '2026-11-20',
    documentNo: 'COW-101',
    description: 'Paper',
    requesterName: 'Owner',
    businessPurpose: 'Office supplies'
  },
  lines: [{
    description: 'Paper',
    quantity: '1',
    unitCost: '100',
    amountBeforeVat: '100',
    vatAmount: '7',
    withholdingTax: '0'
  }],
  warnings: ['ตรวจสอบข้อมูลกับต้นฉบับก่อนยืนยัน']
};
for (const mode of ['manual', 'automatic']) test(`assistant invoice ${mode}: import, review, reload and create existing workflow`, async ({
  ownerPage: page,
  authenticatedPage: other,
  browser,
  localApp: app,
  mock
}) => {
  const ocrBefore = mock.requests.filter(r => r.provider === 'ocr').length;
  const pushesBefore = mock.requests.filter(r => r.path === '/v2/bot/message/push').length;
  await page.goto('/assistant-invoice-import');
  const templates = await page.request.get('/api/workflow-templates').then(r => r.json());
  const template = templates.templates.find(t => t.active !== false && t.documentSteps.length === 3 && t.documentSteps[0].documentType === 'expense_request');
  // Catalog uses documentKind in some existing templates.
  const selected = template || templates.templates.find(t => t.active !== false && t.documentSteps.length === 3 && t.documentSteps[0].documentKind === 'expense_request');
  expect(selected).toBeTruthy();
  await page.getByLabel('Workflow').selectOption(selected.templateId);
  await page.getByLabel('ข้อมูลที่ผู้ช่วยอ่าน (JSON)').setInputFiles({
    name: 'extraction.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(extraction))
  });
  await page.getByLabel('ไฟล์ต้นฉบับและหลักฐาน').setInputFiles({
    name: 'invoice.png',
    mimeType: 'image/png',
    buffer: png
  });
  const importedResponse = page.waitForResponse(r => r.url().endsWith('/api/assistant-invoice-imports') && r.request().method() === 'POST');
  await page.getByRole('button', {
    name: 'นำเข้าเพื่อตรวจสอบ'
  }).click();
  const imported = await importedResponse;
  await expect(page).toHaveURL(/line-workflow-review\?batchId=/);
  const id = new URL(page.url()).searchParams.get('batchId');
  const retried = await page.request.post('/api/assistant-invoice-imports', {
    data: JSON.parse(imported.request().postData())
  }).then(r => r.json());
  expect(retried.batch.id).toBe(id);
  expect(retried.files).toHaveLength(1);
  await expect(page.locator('[name=vendorName]')).toHaveValue('Assistant Vendor');
  await page.locator('[name=vendorName]').fill('Reviewed Cowork Vendor');
  await page.getByRole('button', {
    name: 'บันทึกข้อมูล',
    exact: true
  }).click();
  await expect(page.locator('[data-status]')).toContainText('บันทึกแล้ว');
  await page.reload();
  await expect(page.locator('[name=vendorName]')).toHaveValue('Reviewed Cowork Vendor');
  const before = await page.request.get(`/api/line-workflow-batches/${id}`).then(r => r.json());
  expect(before.batch.transactionNo).toBeUndefined();
  expect((await other.request.get(`/api/line-workflow-batches/${id}`)).status()).toBe(403);
  expect((await other.request.get(before.files[0].url)).status()).toBe(403);
  expect((await page.request.get(before.files[0].url)).ok()).toBe(true);
  const noLine = await browser.newContext({
    baseURL: app.baseUrl
  });
  await noLine.addCookies([{
    ...sessionCookie(createTestSession({
      userId: 'other-app',
      role: 'owner',
      secret: 'e2e-test-session-secret-012345678901234567890123'
    })),
    url: app.baseUrl
  }]);
  const evidenceId = before.files[0].id;
  for (const action of ['', '/confirm', '/cancel']) {
    const response = action ? await noLine.request.post(`/api/line-intakes/${evidenceId}${action}`, {
      data: {}
    }) : await noLine.request.get(`/api/line-intakes/${evidenceId}`);
    expect(response.status()).toBe(403);
  }
  await noLine.close();
  await page.getByRole('button', {
    name: mode === 'manual' ? 'ยืนยันและดำเนินการเอง' : 'ยืนยันและทำทุกขั้นตอนอัตโนมัติ',
    exact: true
  }).click();
  await expect(page.locator('[data-status]')).toContainText(mode === 'manual' ? 'ดำเนินการเอง' : 'ครบทุกขั้นตอน', {
    timeout: 30000
  });
  const b = (await page.request.get(`/api/line-workflow-batches/${id}`).then(r => r.json())).batch;
  expect(b.state).toBe(mode === 'manual' ? 'manual' : 'completed');
  expect(b.steps).toHaveLength(mode === 'manual' ? 1 : 3);
  await page.goto(`/expense-request?requestNo=${b.steps[0].documentNo}&transactionNo=${b.transactionNo}&workflowStepId=${b.steps[0].stepId}`);
  await page.reload();
  await expect(page.locator('[name=paymentTargetName]')).toHaveValue('Reviewed Cowork Vendor');
  expect(mock.requests.filter(r => r.provider === 'ocr').length).toBe(ocrBefore);
  expect(mock.requests.filter(r => r.path === '/v2/bot/message/push').length).toBe(pushesBefore);
});
test('assistant invoice invalid upload stays on import form and can be corrected', async ({
  ownerPage: page
}) => {
  await page.goto('/assistant-invoice-import');
  await page.getByLabel('Workflow').selectOption({
    index: 1
  });
  await page.getByLabel('ข้อมูลที่ผู้ช่วยอ่าน (JSON)').setInputFiles({
    name: 'bad.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{broken')
  });
  await page.getByLabel('ไฟล์ต้นฉบับและหลักฐาน').setInputFiles({
    name: 'invoice.png',
    mimeType: 'image/png',
    buffer: png
  });
  await page.getByRole('button', {
    name: 'นำเข้าเพื่อตรวจสอบ'
  }).click();
  await expect(page.getByRole('status')).toContainText('JSON');
  await page.getByLabel('ข้อมูลที่ผู้ช่วยอ่าน (JSON)').setInputFiles({
    name: 'good.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(extraction))
  });
  await page.getByLabel('ไฟล์ต้นฉบับและหลักฐาน').setInputFiles({
    name: 'invalid.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('invalid')
  });
  await page.getByRole('button', {
    name: 'นำเข้าเพื่อตรวจสอบ'
  }).click();
  await expect(page.getByRole('status')).toContainText('รองรับไฟล์');
  await expect(page).toHaveURL(/assistant-invoice-import/);
});
