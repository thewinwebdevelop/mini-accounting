import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSupabaseLineWorkflowStore } from '../forms/line-workflow-store.logic.js';
test('cloud compare-and-swap retries contention without losing confirmed identity', async () => {
  let state = {
    version: 0,
    data: {}
  };
  let collisions = 1;
  const client = {
    url: 'http://localhost',
    serviceRoleKey: 'test',
    fetchImpl: async (url, opts) => {
      if (url.includes('/rpc/')) {
        const input = JSON.parse(opts.body);
        if (collisions-- > 0) return new Response('false');
        if (input.expected_version !== state.version) return new Response('false');
        state = {
          version: state.version + 1,
          data: input.next_data
        };
        return new Response('true');
      }
      return new Response(JSON.stringify([state]));
    }
  };
  const store = createSupabaseLineWorkflowStore({
    client
  });
  const scope = {
    channelId: 'oa',
    conversationId: 'u',
    lineUserId: 'u'
  };
  let b = await store.begin({
    scope
  });
  b = await store.update({
    id: b.id,
    expectedRevision: b.revision,
    patch: {
      state: 'ready'
    }
  });
  const input = {
    id: b.id,
    expectedRevision: b.revision,
    mode: 'automatic',
    context: {
      corrected: 1
    },
    actor: {
      lineUserId: 'u',
      userId: 'app'
    }
  };
  const first = await store.confirm(input);
  assert.equal((await store.confirm(input)).jobId, first.jobId);
  assert.equal((await store.getForActor(b.id, input.actor)).confirmedContext.corrected, 1);
});

test('all Cloud Run environment signals require durable Supabase storage',async()=>{
 const {createLineWorkflowStore}=await import('../forms/line-workflow-store.logic.js');const {mkdtempSync,rmSync}=await import('node:fs');const {tmpdir}=await import('node:os');const {join}=await import('node:path');const rootDir=mkdtempSync(join(tmpdir(),'cloud-routing-'));
 try{for(const env of [{K_SERVICE:'invoice-service'},{CLOUD_RUN:'true'},{CLOUD_RUN:'yes'}])assert.throws(()=>{const store=createLineWorkflowStore({rootDir,env});store.close?.();},{code:'SUPABASE_CONFIG_MISSING'});}finally{rmSync(rootDir,{recursive:true,force:true});}
});
