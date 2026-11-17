import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createSupabaseRuntime } from '../fixtures/supabase-runtime.fixture.mjs';

test('signed LINE ingestion deduplicates across instances and cancellation persists', { skip: !process.env.E2E_SUPABASE_CONFIG }, async () => {
  const runtime = await createSupabaseRuntime();
  runtime.track('line_intake_items', 'event_id', runtime.runId);
  try {
    const first = await runtime.startApp();
    const second = await runtime.startApp();
    const body = JSON.stringify({ events: [{ webhookEventId: runtime.runId, type: 'message', source: { userId: runtime.runId }, replyToken: 'reply', message: { id: runtime.runId, type: 'image' } }] });
    const send = async app => {
      const response = await fetch(new URL('/api/webhooks/line', app.baseUrl), { method: 'POST', headers: { 'content-type': 'application/json', 'x-line-signature': createHmac('sha256', 'e2e-line-channel-secret').update(body).digest('base64') }, body });
      assert.equal(response.status, 200);
      return response.json();
    };
    const responses = await Promise.all([send(first), send(second)]);
    assert.ok(responses.some(accepted => accepted.accepted.length === 1), JSON.stringify(responses));
    const rows = await runtime.db(`line_intake_items?event_id=eq.${runtime.runId}`);
    assert.equal(rows.length, 1);
    const id = rows[0].id;
    const reviewed = await second.request(`/api/line-intakes/${id}`);
    assert.equal(reviewed.intake.id, id);
    await second.request(`/api/line-intakes/${id}/cancel`, { method: 'POST', body: {} });
    const persisted = await first.request(`/api/line-intakes/${id}`);
    assert.equal(persisted.intake.status, 'cancelled');
  } finally {
    // Discover the exact object from the test-owned row even if an assertion failed.
    try {
      const rows = await runtime.db(`line_intake_items?event_id=eq.${runtime.runId}`);
      for (const row of rows) runtime.trackObject(row.storage_bucket, row.object_path);
    } finally { await runtime.stop(); }
  }
});

test('LINE confirmation retries across instances keep one draft and its evidence', { skip: !process.env.E2E_SUPABASE_CONFIG }, async () => {
  const runtime = await createSupabaseRuntime();
  const month = '2199-10';
  let intakeId;
  runtime.track('line_intake_items', 'event_id', runtime.runId);
  try {
    assert.deepEqual(await runtime.db(`document_number_sequences?accounting_month=eq.${month}`), [], 'Use an isolated test month');
    runtime.trackExact('document_number_sequences', { document_kind: 'expense_request', accounting_month: month });
    const first = await runtime.startApp();
    const body = JSON.stringify({ events: [{ webhookEventId: runtime.runId, type: 'message', source: { userId: runtime.runId }, message: { id: runtime.runId, type: 'image' } }] });
    const response = await fetch(new URL('/api/webhooks/line', first.baseUrl), { method: 'POST', headers: { 'content-type': 'application/json', 'x-line-signature': createHmac('sha256', 'e2e-line-channel-secret').update(body).digest('base64') }, body });
    assert.equal(response.status, 200);
    intakeId = (await response.json()).accepted[0].intakeId;
    runtime.track('document_number_requests', 'request_key', `line-intake:${intakeId}`);
    const payload = { accountingMonth: month, requesterName: runtime.runId, paymentTargetName: 'E2E', businessPurpose: 'E2E confirmation', description: 'E2E receipt', amountBeforeVat: '100', vatAmount: '7', withholdingTax: '0', expenseLines: [{ description: 'E2E receipt', vendor: 'E2E', amountBeforeVat: '100', vatAmount: '7', withholdingTax: '0' }] };
    const second = await runtime.startApp();
    const confirm = async app => {
      const response = await fetch(new URL(`/api/line-intakes/${intakeId}/confirm`, app.baseUrl), {
        method: 'POST', headers: { cookie: app.cookie, 'content-type': 'application/json' }, body: JSON.stringify(payload),
      });
      return { status: response.status, body: await response.json() };
    };
    const outcomes = await Promise.all([confirm(first), confirm(second)]);
    assert.ok(outcomes.some(item => item.status === 200), JSON.stringify(outcomes));
    assert.ok(outcomes.every(item => [200, 409].includes(item.status)), JSON.stringify(outcomes));
    const confirmed = outcomes.find(item => item.status === 200).body;
    assert.ok(confirmed.document.requestNo);
    const repeated = await second.request(`/api/line-intakes/${intakeId}/confirm`, { method: 'POST', body: payload });
    assert.equal(repeated.idempotent, true);
    assert.equal(repeated.document.requestNo, confirmed.document.requestNo);
    const docs = await runtime.db(`documents?document_kind=eq.expense_request&accounting_month=eq.${month}`);
    assert.equal(docs.length, 1);
    const fresh = await second.request(`/api/expense-drafts/${confirmed.document.requestNo}`);
    assert.equal(fresh.requestNo, confirmed.document.requestNo);
  } finally {
    try {
      const rows = await runtime.db(`line_intake_items?event_id=eq.${runtime.runId}`);
      for (const row of rows) runtime.trackObject(row.storage_bucket, row.object_path);
      const docs = await runtime.db(`documents?document_kind=eq.expense_request&accounting_month=eq.${month}&owner_user_id=eq.${runtime.userId}`);
      for (const doc of docs) {
        runtime.track('documents', 'source_key', doc.source_key);
        const files = await runtime.db(`document_files?document_source_key=eq.${encodeURIComponent(doc.source_key)}`);
        for (const file of files) {
          runtime.track('document_files', 'source_key', file.source_key);
          runtime.trackObject(file.bucket_name, file.object_path);
          const ledger = await runtime.db(`storage_migration_records?object_path=eq.${encodeURIComponent(file.object_path)}&bucket_name=eq.${encodeURIComponent(file.bucket_name)}`);
          for (const row of ledger) runtime.trackExact('storage_migration_records', { migration_name: row.migration_name, source_key: row.source_key });
        }
      }
    } finally { await runtime.stop(); }
  }
});
