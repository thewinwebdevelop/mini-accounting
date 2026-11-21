import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createLocalLineWorkflowStore } from '../forms/line-workflow-store.logic.js';
import { executeLineWorkflowBatch } from '../forms/line-workflow-execution.logic.js';
for (const mode of ['manual', 'automatic']) test(`${mode} follows sequential native actions without duplicate creation`, async t => {
  const rootDir = mkdtempSync(join(tmpdir(), 'workflow-run-'));
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
  let b = store.begin({
    scope: {
      channelId: 'oa',
      lineUserId: 'u',
      conversationId: 'u'
    }
  });
  b = store.update({
    id: b.id,
    expectedRevision: b.revision,
    patch: {
      state: 'ready',
      templateSnapshot: {
        documentSteps: [{
          stepId: 's1',
          documentKind: 'purchase_order'
        }, {
          stepId: 's2',
          documentKind: 'payment_voucher'
        }]
      }
    }
  });
  const actor = {
    lineUserId: 'u',
    userId: 'a'
  };
  store.confirm({
    id: b.id,
    expectedRevision: b.revision,
    mode,
    context: {},
    actor
  });
  const events = [];
  const native = {
    ensureTransaction: async () => ({
      transactionNo: 'T'
    }),
    ensureStepDocument: async ({
      step
    }) => {
      events.push('create:' + step.stepId);
      return {
        documentNo: step.stepId
      };
    },
    complete: async ({
      step
    }) => {
      events.push('complete:' + step.stepId);
    },
    refresh: async () => {}
  };
  await executeLineWorkflowBatch({
    batchId: b.id,
    store,
    native
  });
  assert.deepEqual(events, mode === 'manual' ? ['create:s1'] : ['create:s1', 'complete:s1', 'create:s2', 'complete:s2']);
  assert.equal(store.getForActor(b.id, actor).state, mode === 'manual' ? 'manual' : 'completed');
  await executeLineWorkflowBatch({
    batchId: b.id,
    store,
    native
  });
  assert.equal(events.length, mode === 'manual' ? 1 : 4);
});
test('native lifecycle resumes after persistence failure without duplicating completed steps', async t => {
  const {
    createRequire
  } = await import('node:module');
  const require = createRequire(import.meta.url);
  const {
    createLineWorkflowNativeServices
  } = require('../forms/line-workflow-native.logic.js');
  const {
    buildReviewedWorkflowContext
  } = require('../forms/line-workflow-review.logic.js');
  const {
    getWorkflowTransactionDetail
  } = require('../forms/local-server.logic.js');
  const rootDir = mkdtempSync(join(tmpdir(), 'native-workflow-resume-'));
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
  const actor = {
    lineUserId: 'u',
    userId: 'app',
    role: 'owner',
    displayName: 'Owner'
  };
  let b = store.begin({
    scope: {
      channelId: 'oa',
      conversationId: 'u',
      lineUserId: 'u'
    }
  });
  const template = {
    templateId: 'resume-test',
    name: 'Resume',
    documentSteps: [{
      stepId: 'step-001',
      documentKind: 'purchase_order'
    }, {
      stepId: 'step-002',
      documentKind: 'payment_voucher'
    }]
  };
  b = store.update({
    id: b.id,
    expectedRevision: b.revision,
    patch: {
      state: 'ready',
      templateSnapshot: template,
      evidenceIds: ['e']
    }
  });
  const context = buildReviewedWorkflowContext({
    edits: {
      accountingMonth: '2026-11',
      expenseDate: '2026-11-20',
      vendorName: 'Vendor',
      requesterName: 'Owner',
      businessPurpose: 'Supplies',
      documentNo: 'INV-RESUME',
      lines: [{
        description: 'Paper',
        quantity: '1',
        unitCost: '100',
        amountBeforeVat: '100',
        vatAmount: '0',
        withholdingTax: '0'
      }]
    }
  });
  store.confirm({
    id: b.id,
    expectedRevision: b.revision,
    mode: 'automatic',
    context,
    actor
  });
  let failOnce = true;
  const native = createLineWorkflowNativeServices({
    rootDir,
    store,
    actor,
    intakeStore: {
      getForUser: async () => ({}),
      readOriginal: async () => ({
        fileName: 'evidence.txt',
        contentType: 'text/plain',
        bytes: Buffer.from('test evidence')
      })
    },
    companySettingsResolver: async () => ({
      legalName: 'Test Company'
    }),
    persistDocument: async ({
      documentKind,
      result
    }) => {
      if (failOnce && documentKind === 'payment_voucher' && result.status === 'approved') {
        failOnce = false;
        throw new Error('Injected persistence failure');
      }
    }
  });
  await executeLineWorkflowBatch({
    batchId: b.id,
    store,
    native
  });
  const paused = store.get(b.id);
  assert.equal(paused.state, 'paused');
  assert.equal(paused.steps[0].status, 'completed');
  const firstNumbers = paused.steps.map(s => s.documentNo);
  store.resume({
    id: b.id,
    actor
  });
  await executeLineWorkflowBatch({
    batchId: b.id,
    store,
    native
  });
  const done = store.get(b.id);
  assert.equal(done.state, 'completed');
  assert.deepEqual(done.steps.map(s => s.documentNo), firstNumbers);
  const detail = await getWorkflowTransactionDetail(rootDir, done.transactionNo);
  assert.equal(detail.childDocuments.length, 2);
  assert.ok(detail.childDocuments.every(d => d.status === 'completed'));
});
