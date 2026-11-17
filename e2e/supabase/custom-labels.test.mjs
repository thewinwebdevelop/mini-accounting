import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createSupabaseRuntime } from '../fixtures/supabase-runtime.fixture.mjs';
import customLabel from '../../forms/shopee-custom-label.logic.js';

test('custom label metadata, preview, save and PDFs survive fresh instances', { skip: !process.env.E2E_SUPABASE_CONFIG }, async () => {
  const runtime = await createSupabaseRuntime();
  let jobId;
  try {
    const first = await runtime.startApp();
    const body = new FormData();
    body.set('file', new Blob([await readFile(new URL('../../tests/fixtures/shopee-custom-label-sample.pdf', import.meta.url))], { type: 'application/pdf' }), `${runtime.runId}.pdf`);
    const { job } = await first.request('/api/shopee/custom-labels', { method: 'POST', body });
    jobId = job.id;
    runtime.trackExact('commerce_records', { record_type: 'custom_label_job', identity_key: jobId });
    for (const kind of ['source', 'preview', 'output', 'comparison']) runtime.trackObject('sweet-house-files', customLabel.customLabelStorageObjectPath(jobId, kind));
    const second = await runtime.startApp();
    const read = await second.request(`/api/shopee/custom-labels/${jobId}`);
    assert.equal(read.job.pageCount, job.pageCount);
    const mappings = {};
    for (const page of job.pages) for (const item of page.items || []) {
      const key = customLabel.normalizeMappingKey(item.productName, item.optionName);
      const { productName: productNameKey, optionName: optionNameKey } = key;
      assert.deepEqual(await runtime.db(`shopee_custom_label_mappings?product_name_key=eq.${encodeURIComponent(productNameKey)}&option_name_key=eq.${encodeURIComponent(optionNameKey)}`), [], 'Existing fixture mapping must not be overwritten');
      runtime.trackExact('shopee_custom_label_mappings', { product_name_key: productNameKey, option_name_key: optionNameKey });
      mappings[item.mappingKey] = { productName: item.productName, optionName: item.optionName, bundle: [{ sku: runtime.runId, quantity: 1 }] };
    }
    assert.ok(Object.keys(mappings).length);
    const preview = await second.request(`/api/shopee/custom-labels/${jobId}/preview`, { method: 'POST', body: { mappings } });
    assert.equal(preview.job.status, 'previewed');
    const saved = await first.request(`/api/shopee/custom-labels/${jobId}/save`, { method: 'POST', body: { mappings } });
    assert.equal(saved.job.status, 'saved');
    const third = await runtime.startApp();
    assert.equal((await third.request(`/api/shopee/custom-labels/${jobId}`)).job.status, 'saved');
    for (const kind of ['source', 'preview-file', 'output', 'download', 'comparison']) {
      const response = await fetch(new URL(`/api/shopee/custom-labels/${jobId}/${kind}`, third.baseUrl), { headers: { cookie: third.cookie } });
      assert.equal(response.status, 200, kind);
      assert.equal(Buffer.from(await response.arrayBuffer()).subarray(0, 4).toString(), '%PDF');
    }
  } finally {
    if (!jobId) {
      const rows = await runtime.db('commerce_records?record_type=eq.custom_label_job');
      for (const row of rows.filter(row => row.payload.originalFileName === `${runtime.runId}.pdf`)) {
        runtime.trackExact('commerce_records', { record_type: 'custom_label_job', identity_key: row.identity_key });
        runtime.trackObject('sweet-house-files', customLabel.customLabelStorageObjectPath(row.identity_key, 'source'));
      }
    }
    await runtime.stop();
  }
});
