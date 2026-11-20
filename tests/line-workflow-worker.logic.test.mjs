import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { verifyWorkerToken } from '../forms/line-workflow-worker.logic.js';
const {
  privateKey,
  publicKey
} = generateKeyPairSync('rsa', {
  modulusLength: 2048
});
const jwk = {
  ...publicKey.export({
    format: 'jwk'
  }),
  kid: 'test',
  alg: 'RS256'
};
const token = claims => {
  const h = Buffer.from(JSON.stringify({
    alg: 'RS256',
    kid: 'test'
  })).toString('base64url');
  const p = Buffer.from(JSON.stringify({
    iss: 'https://accounts.google.com',
    aud: 'service',
    email: 'worker@test.iam.gserviceaccount.com',
    email_verified: true,
    sub: 'worker',
    iat: 100,
    exp: 300,
    ...claims
  })).toString('base64url');
  return `${h}.${p}.${sign('RSA-SHA256', Buffer.from(`${h}.${p}`), privateKey).toString('base64url')}`;
};
test('worker verifies signature, exact audience, service identity and expiry', async () => {
  const opts = {
    audience: 'service',
    email: 'worker@test.iam.gserviceaccount.com',
    now: 200,
    fetchImpl: async () => new Response(JSON.stringify({
      keys: [jwk]
    }))
  };
  assert.equal((await verifyWorkerToken(token({}), opts)).sub, 'worker');
  for (const claims of [{
    aud: 'other'
  }, {
    email: 'intruder@test'
  }, {
    exp: 150
  }, {
    iss: 'evil'
  }, {
    email_verified: false
  }]) await assert.rejects(() => verifyWorkerToken(token(claims), opts));
  await assert.rejects(() => verifyWorkerToken('bad', opts));
});
test('durable worker completes confirmed job without a browser request', async t => {
  const {
    mkdtempSync,
    rmSync
  } = await import('node:fs');
  const {
    tmpdir
  } = await import('node:os');
  const {
    join
  } = await import('node:path');
  const {
    createRequire
  } = await import('node:module');
  const require = createRequire(import.meta.url);
  const {
    createLineWorkflowController
  } = require('../forms/line-workflow-controller.logic.js');
  const rootDir = mkdtempSync(join(tmpdir(), 'worker-no-browser-'));
  const actor = {
    userId: 'app',
    lineUserId: 'u',
    role: 'owner'
  };
  const calls = [];
  const c = createLineWorkflowController({
    rootDir,
    env: {
      LINE_WORKFLOW_ENABLED: '1'
    },
    intakeStore: {},
    templates: async () => [],
    resolveActor: async () => actor,
    nativeFactory: () => ({
      ensureTransaction: async () => ({
        transactionNo: 'T'
      }),
      ensureStepDocument: async () => ({
        documentNo: 'D'
      }),
      complete: async () => calls.push('complete'),
      refresh: async () => {}
    })
  });
  t.after(() => {
    c.store.close();
    rmSync(rootDir, {
      recursive: true,
      force: true
    });
  });
  let b = c.store.begin({
    scope: {
      channelId: 'oa',
      conversationId: 'u',
      lineUserId: 'u'
    }
  });
  b = c.store.update({
    id: b.id,
    expectedRevision: b.revision,
    patch: {
      state: 'ready',
      templateSnapshot: {
        documentSteps: [{
          stepId: 'one',
          documentKind: 'purchase_order'
        }]
      }
    }
  });
  c.store.confirm({
    id: b.id,
    expectedRevision: b.revision,
    context: {},
    mode: 'automatic',
    actor
  });
  await c.work();
  assert.equal(c.store.get(b.id).state, 'completed');
  assert.deepEqual(calls, ['complete']);
});
