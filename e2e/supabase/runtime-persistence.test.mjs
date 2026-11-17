import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { createSupabaseRuntime } from '../fixtures/supabase-runtime.fixture.mjs';

test('document drafts and workflow templates survive a fresh Cloud Run runtime and are cleaned up', {
  skip: !process.env.E2E_SUPABASE_CONFIG,
}, async () => {
  const runtime = await createSupabaseRuntime();
  const templateId = `e2e_${runtime.runId.replace(/[^a-z0-9]/gi, '_')}`;
  const templateSourceKey = `document:workflow_template:${templateId}`;
  const accountingMonth = '2199-12';
  const draftPayload = {
    accountingMonth,
    requestTitle: `E2E Supabase ${runtime.runId}`,
    requestType: 'reimbursement',
    requesterName: runtime.runId,
    businessPurpose: 'isolated Supabase persistence check',
    paymentTargetName: runtime.runId,
    auditTag: runtime.runId,
    expenseLines: [{ date: '2199-12-01', category: 'ค่าใช้จ่ายอื่น', description: 'E2E isolated line', vendor: 'E2E', amountBeforeVat: '1', vatAmount: '0', withholdingTax: '0' }],
  };
  let draftSourceKey = '';
  let draftFolderPath = '';

  runtime.track('documents', 'source_key', templateSourceKey);

  try {
    const occupied = await runtime.db(`document_number_sequences?accounting_month=eq.${accountingMonth}&select=accounting_month`);
    assert.deepEqual(occupied, [], `reserved E2E month ${accountingMonth} already has a sequence; refusing to mutate it`);
    runtime.track('document_number_sequences', 'accounting_month', accountingMonth);
    const first = await runtime.startApp();
    await first.request('/api/workflow-templates', {
      method: 'POST',
      body: {
        templateId,
        name: `E2E ${runtime.runId}`,
        description: 'Temporary row for Supabase runtime persistence coverage',
        documentSteps: [{ documentKind: 'purchase_order' }],
      },
    });

    const form = new FormData();
    form.set('payload', JSON.stringify(draftPayload));
    const draft = await first.request('/api/expense-drafts', { method: 'POST', body: form });
    assert.match(draft.requestNo, /^REQ-2199-12-\d{4}$/);
    draftSourceKey = `document:expense_request:${draft.requestNo}`;
    runtime.track('documents', 'source_key', draftSourceKey);

    await first.stop();
    const fresh = await runtime.startApp();
    const templates = await fresh.request('/api/workflow-templates');
    assert.ok(templates.templates.some(item => item.templateId === templateId && item.name === `E2E ${runtime.runId}`));

    const drafts = await fresh.request('/api/expense-drafts');
    assert.ok(drafts.drafts.some(item => item.draftId === draft.requestNo && item.accountingMonth === accountingMonth));
    const resumed = await fresh.request(`/api/expense-drafts/${encodeURIComponent(draft.requestNo)}`);
    assert.equal(resumed.requestNo, draft.requestNo);
    assert.equal(resumed.auditTag, runtime.runId);

    form.set('payload', JSON.stringify({ ...draftPayload, requestNo: draft.requestNo }));
    const submitted = await fresh.request('/api/expense-requests', { method: 'POST', body: form });
    assert.equal(submitted.requestNo, draft.requestNo);
    const concurrent = await runtime.startApp();
    runtime.armDocumentCasBarrier();
    const approve = async app => {
      const response = await fetch(new URL(`/api/expense-requests/${encodeURIComponent(draft.requestNo)}/approve`, app.baseUrl), {
        method: 'POST',
        headers: { cookie: app.cookie, 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      return { status: response.status, body: await response.json() };
    };
    const outcomes = await Promise.all([approve(fresh), approve(concurrent)]);
    assert.equal(outcomes.filter(item => item.status === 200).length, 1, JSON.stringify(outcomes));
    assert.equal(outcomes.filter(item => item.status === 409).length, 1, JSON.stringify(outcomes));
    const latest = await concurrent.request(`/api/expense-requests/${encodeURIComponent(draft.requestNo)}`);
    assert.equal(latest.status, 'approved');
    const [cloudDocument] = await runtime.db(`documents?source_key=eq.${encodeURIComponent(draftSourceKey)}&select=source_hash`);
    const manifest = await runtime.db(`document_files?document_source_key=eq.${encodeURIComponent(draftSourceKey)}&select=document_source_hash,bucket_name,object_path,source_sha256`);
    assert.ok(manifest.length, 'expected at least one published document artifact');
    for (const file of manifest) {
      assert.equal(file.document_source_hash, cloudDocument.source_hash, 'manifest must be committed for the current document version');
      const bytes = await runtime.readObject(file.bucket_name, file.object_path);
      assert.equal(createHash('sha256').update(bytes).digest('hex'), file.source_sha256, 'published artifact bytes must match their manifest hash');
    }
  } finally {
    if (!draftSourceKey) {
      const rows = await runtime.db(
        `documents?document_kind=eq.expense_request&accounting_month=eq.${accountingMonth}&select=source_key,payload`,
      ).catch(() => []);
      for (const row of rows) {
        if (row.payload?.auditTag === runtime.runId) {
          draftSourceKey = row.source_key;
          runtime.track('documents', 'source_key', row.source_key);
        }
      }
    }
    // Query all test-owned attachments before deleting their parent document,
    // so metadata, ledger rows, and actual objects are all explicitly removed.
    if (draftSourceKey) {
      const documents = await runtime.db(`documents?source_key=eq.${encodeURIComponent(draftSourceKey)}&select=folder_path`).catch(() => []);
      draftFolderPath = documents[0]?.folder_path || '';
      const files = await runtime.db(`document_files?document_source_key=eq.${encodeURIComponent(draftSourceKey)}&select=source_key,bucket_name,object_path`).catch(() => []);
      for (const file of files) {
        runtime.track('document_files', 'source_key', file.source_key);
      }
      const ledger = await runtime.db('storage_migration_records?select=migration_name,source_key,bucket_name,object_path').catch(() => []);
      for (const row of ledger.filter(item => draftFolderPath && item.source_key.startsWith(`file:${draftFolderPath}/`))) {
        runtime.trackExact('storage_migration_records', { migration_name: row.migration_name, source_key: row.source_key });
        runtime.trackObject(row.bucket_name, row.object_path);
      }
    }
    await runtime.stop();
    assert.deepEqual(await runtime.db(`documents?source_key=eq.${encodeURIComponent(templateSourceKey)}&select=source_key`), []);
    if (draftSourceKey) assert.deepEqual(await runtime.db(`documents?source_key=eq.${encodeURIComponent(draftSourceKey)}&select=source_key`), []);
    if (draftSourceKey) assert.deepEqual(await runtime.db(`document_files?document_source_key=eq.${encodeURIComponent(draftSourceKey)}&select=source_key`), []);
    if (draftFolderPath) {
      const ledger = await runtime.db('storage_migration_records?select=source_key');
      assert.equal(ledger.some(row => row.source_key.startsWith(`file:${draftFolderPath}/`)), false);
    }
    assert.deepEqual(await runtime.db(`document_number_sequences?accounting_month=eq.${accountingMonth}&select=accounting_month`), []);
    assert.deepEqual(await runtime.db(`document_number_requests?accounting_month=eq.${accountingMonth}&select=request_key`), []);
  }
});
