"use strict";

async function executeLineWorkflowBatch({
  batchId,
  store,
  native
}) {
  const job = await store.claimJob({
    workerId: 'invoice-worker',
    kind: 'execute',
    batchId,
    leaseMs: 600000
  });
  if (!job) return null;
  const lease = {
    jobId: job.id,
    leaseToken: job.leaseToken
  };
  let b = job.batch;
  try {
    const tx = await native.ensureTransaction({
      batch: b,
      operationKey: 'transaction',
      lease
    });
    b = await store.progress({
      ...lease,
      patch: {
        transactionNo: tx.transactionNo,
        error: ''
      }
    });
    for (const step of b.templateSnapshot.documentSteps) {
      await store.renew({
        ...lease,
        leaseMs: 600000
      });
      const document = await native.ensureStepDocument({
        batch: b,
        step,
        context: b.confirmedContext,
        operationKey: step.stepId,
        lease
      });
      const progress = {
        ...step,
        documentNo: document.documentNo || document.requestNo || document.receiptNo,
        status: document.status || 'draft'
      };
      const steps = [...b.steps.filter(s => s.stepId !== step.stepId), progress];
      b = await store.progress({
        ...lease,
        patch: {
          steps
        }
      });
      if (b.mode === 'manual') {
        await native.refresh({
          batch: b
        });
        return await store.finishJob({
          ...lease,
          result: {
            state: 'manual',
            transactionNo: b.transactionNo,
            steps: b.steps
          }
        });
      }
      await native.complete({
        batch: b,
        step: progress,
        lease
      });
      progress.status = 'completed';
      await native.refresh({
        batch: b
      });
      b = await store.progress({
        ...lease,
        patch: {
          steps: [...b.steps.filter(s => s.stepId !== step.stepId), progress]
        }
      });
    }
    return await store.finishJob({
      ...lease,
      result: {
        state: 'completed',
        transactionNo: b.transactionNo,
        steps: b.steps
      }
    });
  } catch (error) {
    await store.failJob({
      ...lease,
      error: error.message
    });
    return await store.get(batchId);
  }
}
module.exports = {
  executeLineWorkflowBatch
};
