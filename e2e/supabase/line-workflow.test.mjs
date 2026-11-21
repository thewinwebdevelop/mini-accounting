import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createSupabaseRuntime } from '../fixtures/supabase-runtime.fixture.mjs';
const require = createRequire(import.meta.url);
const {
  createSupabaseLineWorkflowStore
} = require('../../forms/line-workflow-store.logic.js');
test('LINE workflow cloud state survives two clients and concurrent confirmation', {
  skip: !process.env.E2E_SUPABASE_CONFIG
}, async () => {
  const runtime = await createSupabaseRuntime();
  const ids = new Set();
  const client = {
    url: 'http://fixture',
    serviceRoleKey: 'test-proxy',
    fetchImpl: async (url, options = {}) => {
      const target = new URL(url);
      const result = await runtime.proxyRequest(target.pathname + target.search, {
        method: options.method || 'GET',
        body: options.body ? JSON.parse(options.body) : undefined
      });
      return new Response(JSON.stringify(result.body), {
        status: result.status
      });
    }
  };
  const first = createSupabaseLineWorkflowStore({
      client
    }),
    second = createSupabaseLineWorkflowStore({
      client
    });
  try {
    const scope = {
      channelId: runtime.runId,
      conversationId: runtime.runId,
      lineUserId: runtime.runId
    };
    let b = await first.begin({
      scope
    });
    ids.add(b.id);
    assert.equal((await second.begin({
      scope
    })).id, b.id);
    b = await first.update({
      id: b.id,
      expectedRevision: b.revision,
      patch: {
        state: 'ready'
      }
    });
    const actor = {
      lineUserId: runtime.runId,
      userId: runtime.userId
    };
    const input = {
      id: b.id,
      expectedRevision: b.revision,
      mode: 'manual',
      context: {
        vendor: 'corrected'
      },
      actor
    };
    const results = await Promise.all([first.confirm(input), second.confirm(input)]);
    assert.equal(results[0].jobId, results[1].jobId);
    assert.equal((await second.getForActor(b.id, actor)).confirmedContext.vendor, 'corrected');
    await assert.rejects(() => second.getForActor(b.id, {
      lineUserId: 'other'
    }));
  } finally {
    try {
      for (let i = 0; i < 20; i++) {
        const [row] = await runtime.db('line_workflow_state?id=eq.1&select=version,data');
        const data = structuredClone(row.data);
        for (const id of ids) delete data.batches?.[id];
        const jobs = new Set(Object.values(data.jobs || {}).filter(j => ids.has(j.batchId)).map(j => j.id));
        for (const id of jobs) delete data.jobs[id];
        for (const key of Object.keys(data.operations || {})) if ([...jobs].some(id => key.startsWith(id + ':'))) delete data.operations[key];
        const result = await runtime.proxyRequest('/rest/v1/rpc/line_workflow_state_cas', {
          body: {
            expected_version: row.version,
            next_data: data
          }
        });
        if (result.body === true) break;
        assert.ok(i < 19, 'Failed to clean exact test-owned batch IDs');
      }
    } finally {
      await runtime.stop();
    }
  }
});
