import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalLineWorkflowStore } from '../forms/line-workflow-store.logic.js';
function fixture(t) {
  const rootDir = mkdtempSync(join(tmpdir(), 'line-workflow-'));
  const store = createLocalLineWorkflowStore({
    rootDir
  });
  t.after(() => {
    store.close();
    rmSync(rootDir, {
      recursive: true,
      force: true
    });
  });
  return {
    store,
    rootDir
  };
}
const scope = {
  channelId: 'oa',
  conversationId: 'u1',
  lineUserId: 'u1'
};
const actor = {
  lineUserId: 'u1',
  userId: 'app1'
};
test('persists one active batch per scope and protects ownership', async t => {
  const {
    store,
    rootDir
  } = fixture(t);
  const a = store.begin({
    scope,
    eventId: 'e1'
  });
  assert.equal(store.begin({
    scope,
    eventId: 'e2'
  }).id, a.id);
  assert.throws(() => store.getForActor(a.id, {
    lineUserId: 'u2'
  }), {
    statusCode: 403
  });
  const other = createLocalLineWorkflowStore({
    rootDir
  });
  try {
    assert.equal(other.getForActor(a.id, actor).id, a.id);
  } finally {
    other.close();
  }
});
test('confirmation is revision checked, immutable and idempotent', async t => {
  const {
    store
  } = fixture(t);
  const b = store.begin({
    scope,
    eventId: 'e1'
  });
  const ready = store.update({
    id: b.id,
    expectedRevision: b.revision,
    patch: {
      state: 'ready'
    }
  });
  const input = {
    id: b.id,
    expectedRevision: ready.revision,
    mode: 'automatic',
    context: {
      vendor: 'corrected'
    },
    actor
  };
  const a = store.confirm(input);
  const repeat = store.confirm(input);
  assert.equal(a.jobId, repeat.jobId);
  assert.equal(repeat.idempotent, true);
  assert.throws(() => store.confirm({
    ...input,
    mode: 'manual'
  }), {
    statusCode: 409
  });
  assert.throws(() => store.update({
    id: b.id,
    expectedRevision: ready.revision,
    patch: {
      state: 'cancelled'
    }
  }), {
    statusCode: 409
  });
});
test('leases expire, are fenced, and operation checkpoints survive reopen', async t => {
  const {
    store
  } = fixture(t);
  const b = store.begin({
    scope,
    eventId: 'e1'
  });
  const ready = store.update({
    id: b.id,
    expectedRevision: b.revision,
    patch: {
      state: 'ready'
    }
  });
  store.confirm({
    id: b.id,
    expectedRevision: ready.revision,
    mode: 'manual',
    context: {},
    actor
  });
  const first = store.claimJob({
    workerId: 'a',
    now: 1000,
    leaseMs: 100
  });
  assert.equal(store.claimJob({
    workerId: 'b',
    now: 1050,
    leaseMs: 100
  }), null);
  const next = store.claimJob({
    workerId: 'b',
    now: 1101,
    leaseMs: 100
  });
  assert.throws(() => store.checkpoint({
    jobId: first.id,
    leaseToken: first.leaseToken,
    operationKey: 'step1',
    result: {
      documentNo: 'X'
    },
    now: 1102
  }), {
    statusCode: 409
  });
  store.checkpoint({
    jobId: next.id,
    leaseToken: next.leaseToken,
    operationKey: 'step1',
    result: {
      documentNo: 'X'
    },
    now: 1102
  });
  assert.deepEqual(store.getCheckpoint(next.id, 'step1'), {
    documentNo: 'X'
  });
});
test('events can retry after failure but completed deliveries are deduplicated', async t => {
  const {
    store
  } = fixture(t);
  const input = {
    scope,
    eventId: 'e1',
    messageId: 'm1'
  };
  assert.equal(store.acceptEvent(input).accepted, true);
  assert.equal(store.acceptEvent(input).accepted, false);
  store.finishEvent({
    ...input,
    status: 'retryable'
  });
  assert.equal(store.acceptEvent(input).accepted, true);
  store.finishEvent({
    ...input,
    status: 'completed'
  });
  assert.equal(store.acceptEvent(input).accepted, false);
});
test('concurrent upload append retains both identities without stale revision loss', t => {
  const {
    store
  } = fixture(t);
  let b = store.begin({
    scope
  });
  b = store.update({
    id: b.id,
    expectedRevision: b.revision,
    patch: {
      state: 'collecting'
    }
  });
  store.appendEvidence({
    id: b.id,
    evidenceId: 'a',
    hash: 'ha',
    maxFiles: 20
  });
  store.appendEvidence({
    id: b.id,
    evidenceId: 'b',
    hash: 'hb',
    maxFiles: 20
  });
  store.appendEvidence({
    id: b.id,
    evidenceId: 'a2',
    hash: 'ha',
    maxFiles: 20
  });
  assert.deepEqual(store.getForActor(b.id, actor).evidenceIds, ['a', 'b']);
});
test('scan failure is resumable and late scan cannot resurrect cancelled batches', t => {
  const {
    store
  } = fixture(t);
  let b = store.begin({
    scope
  });
  b = store.update({
    id: b.id,
    expectedRevision: b.revision,
    patch: {
      state: 'collecting',
      evidenceIds: ['e'],
      primaryEvidenceId: 'e'
    }
  });
  b = store.queueScan({
    id: b.id
  });
  let j = store.claimJob({
    kind: 'scan',
    workerId: 'a'
  });
  store.failJob({
    jobId: j.id,
    leaseToken: j.leaseToken,
    error: 'OCR failed'
  });
  assert.equal(store.resume({
    id: b.id,
    actor
  }).state, 'scanning');
  j = store.claimJob({
    kind: 'scan',
    workerId: 'b'
  });
  b = store.get(b.id);
  store.update({
    id: b.id,
    expectedRevision: b.revision,
    patch: {
      state: 'cancelled'
    }
  });
  store.finishJob({
    jobId: j.id,
    leaseToken: j.leaseToken,
    result: {
      state: 'needs_review',
      extractedContext: {
        fields: {}
      }
    }
  });
  assert.equal(store.get(b.id).state, 'cancelled');
});
test('late scan failure cannot rewind reviewed or confirmed state', t => {
  const {
    store
  } = fixture(t);
  let b = store.begin({
    scope
  });
  b = store.update({
    id: b.id,
    expectedRevision: b.revision,
    patch: {
      state: 'collecting',
      evidenceIds: ['e'],
      primaryEvidenceId: 'e'
    }
  });
  b = store.queueScan({
    id: b.id
  });
  const job = store.claimJob({
    kind: 'scan',
    workerId: 'scan'
  });
  b = store.update({
    id: b.id,
    expectedRevision: b.revision,
    patch: {
      state: 'ready',
      extractedContext: {
        fields: {
          vendorName: 'Done'
        }
      }
    }
  });
  store.confirm({
    id: b.id,
    expectedRevision: b.revision,
    mode: 'manual',
    context: {},
    actor
  });
  store.failJob({
    jobId: job.id,
    leaseToken: job.leaseToken,
    error: 'late failure'
  });
  assert.equal(store.get(b.id).state, 'running');
});
test('old scan result does not overwrite restarted collection', t => {
  const {
    store
  } = fixture(t);
  let b = store.begin({
    scope
  });
  b = store.update({
    id: b.id,
    expectedRevision: b.revision,
    patch: {
      state: 'collecting',
      evidenceIds: ['e'],
      primaryEvidenceId: 'e'
    }
  });
  b = store.queueScan({
    id: b.id
  });
  const job = store.claimJob({
    kind: 'scan',
    workerId: 'a'
  });
  b = store.update({
    id: b.id,
    expectedRevision: b.revision,
    patch: {
      state: 'selecting'
    }
  });
  store.update({
    id: b.id,
    expectedRevision: b.revision,
    patch: {
      state: 'collecting'
    }
  });
  store.finishJob({
    jobId: job.id,
    leaseToken: job.leaseToken,
    result: {
      state: 'needs_review'
    }
  });
  assert.equal(store.get(b.id).state, 'collecting');
});
