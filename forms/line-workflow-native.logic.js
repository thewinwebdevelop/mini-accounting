"use strict";

const logic = require('./local-server.logic.js');
const {
  buildWorkflowDocumentPayload
} = require('./workflow-document.logic.js');
const {
  payloadForStep
} = require('./line-workflow-review.logic.js');
const {
  ACTIONS,
  assertPermission,
  assertDocumentAccess,
  actorLabel
} = require('./authorization.logic.js');
const {
  withDocumentIndexDatabase,
  allocateDocumentNumber
} = require('./document-index.logic.js');
function createLineWorkflowNativeServices(options) {
  const {
    rootDir,
    store,
    actor,
    intakeStore,
    documentDataAdapter,
    cloudRun = false,
    hydrate = async () => null,
    hydrateTransaction = async () => null,
    persistTransaction = async () => {},
    persistDocument = async () => {},
    companySettingsResolver,
    vendorResolver,
    inventoryCloudRepository,
    validateStock = async () => {}
  } = options;
  const auth = action => assertPermission(actor, action);
  async function allocate(kind, month, key, lease) {
    let value = await store.getCheckpoint(lease.jobId, key);
    if (value) return value;
    value = cloudRun ? kind === 'workflow_transaction' ? await documentDataAdapter.allocateWorkflowTransactionNumber({
      accountingMonth: month,
      requestKey: `line:${lease.jobId}:${key}`
    }) : await documentDataAdapter.allocateAccountingDocumentNumber({
      documentKind: kind,
      accountingMonth: month,
      requestKey: `line:${lease.jobId}:${key}`
    }) : withDocumentIndexDatabase(rootDir, db => allocateDocumentNumber(db, {
      documentKind: kind,
      accountingMonth: month
    }));
    return store.checkpoint({
      ...lease,
      operationKey: key,
      result: {
        ...value,
        documentNo: value.documentNo || value.transactionNo
      }
    });
  }
  const load = (kind, no) => kind === 'expense_request' ? logic.getSubmittedExpenseRequest(rootDir, no) : kind === 'substitute_receipt' ? logic.getSubmittedSubstituteReceipt(rootDir, no) : logic.getWorkflowDocument(rootDir, kind, no);
  async function get(kind, no) {
    try {
      await hydrate({
        documentKind: kind,
        documentNo: no,
        localLoad: () => load(kind, no)
      });
      return await load(kind, no);
    } catch (e) {
      if (e.message.includes('not found') || e.code === 'ENOENT') return null;
      throw e;
    }
  }
  async function persist(kind, no, result) {
    await persistDocument({
      documentKind: kind,
      documentNo: no,
      result,
      localLoad: () => load(kind, no)
    });
  }
  return {
    async ensureTransaction({
      batch,
      lease
    }) {
      auth(ACTIONS.DOCUMENT_CREATE);
      const n = await allocate('workflow_transaction', batch.confirmedContext.invoice.accountingMonth, 'transaction-number', lease);
      const no = n.transactionNo || n.documentNo;
      await hydrateTransaction(no);
      let tx = await logic.getWorkflowTransaction(rootDir, no);
      if (!tx) tx = await logic.startWorkflowTransaction({
        rootDir,
        templateId: batch.templateSnapshot.templateId,
        templateSnapshot: batch.templateSnapshot,
        accountingMonth: batch.confirmedContext.invoice.accountingMonth,
        title: batch.confirmedContext.purpose.title,
        ownerUserId: actor.userId,
        allocation: {
          ...n,
          transactionNo: no
        }
      });
      assertDocumentAccess(actor, tx, ACTIONS.DOCUMENT_EDIT);
      await persistTransaction(no);
      return tx;
    },
    async ensureStepDocument({
      batch,
      step,
      context,
      lease
    }) {
      auth(ACTIONS.DOCUMENT_CREATE);
      const tx = await logic.getWorkflowTransactionDetail(rootDir, batch.transactionNo);
      assertDocumentAccess(actor, tx, ACTIONS.DOCUMENT_EDIT);
      const position = tx.steps.findIndex(s => s.stepId === step.stepId);
      if (position < 0 || tx.steps.slice(0, position).some(s => s.workflowStatus !== 'completed')) throw new Error('ขั้นตอนก่อนหน้ายังไม่เสร็จสิ้น');
      const n = await allocate(step.documentKind, context.invoice.accountingMonth, step.stepId + ':number', lease);
      const no = n.documentNo;
      const existing = await get(step.documentKind, no);
      if (existing) {
        await persist(step.documentKind, no, existing);
        return {
          ...existing,
          documentNo: no
        };
      }
      const data = {
        ...payloadForStep(context, step),
        transactionNo: batch.transactionNo,
        workflowTemplateId: batch.templateSnapshot.templateId,
        workflowStepId: step.stepId,
        ownerUserId: actor.userId,
        idempotencyKey: `line:${batch.id}:${step.stepId}`
      };
      delete data.evidenceFiles;
      await validateStock(data.lines || data.expenseLines || []);
      const uploads = [];
      for (const id of batch.evidenceIds) {
        const item = await intakeStore.getForUser(id, batch.lineUserId);
        const f = await intakeStore.readOriginal(item);
        uploads.push({
          evidenceKey: step.documentKind === 'substitute_receipt' ? 'otherEvidence' : 'receipt',
          originalName: f.fileName,
          type: f.contentType,
          buffer: f.bytes
        });
      }
      const common = {
        rootDir,
        payload: data,
        uploads,
        vendorResolver,
        companySettingsResolver,
        numberAllocator: async () => n
      };
      let result;
      if (step.documentKind === 'expense_request') result = await logic.saveExpenseDraft(common);else if (step.documentKind === 'substitute_receipt') result = await logic.saveSubstituteReceiptDraft(common);else result = await logic.saveWorkflowDocument({
        ...common,
        payload: buildWorkflowDocumentPayload({
          ...data,
          documentNo: no,
          sequence: n.sequence,
          status: 'draft',
          company: await companySettingsResolver()
        })
      });
      await persist(step.documentKind, no, result);
      return {
        ...result,
        documentNo: no
      };
    },
    async complete({
      batch,
      step,
      lease
    }) {
      const kind = step.documentKind,
        no = step.documentNo;
      const who = actorLabel(actor);
      let record = await get(kind, no);
      assertDocumentAccess(actor, record?.payload || record, ACTIONS.DOCUMENT_COMPLETE);
      const run = async (action, permission, fn) => {
        auth(permission);
        await hydrateTransaction(batch.transactionNo);
        record = await get(kind, no);
        assertDocumentAccess(actor, record?.payload || record, permission);
        await store.renew({
          ...lease,
          leaseMs: 600000
        });
        const result = await fn();
        await persist(kind, no, result);
        record = await load(kind, no);
      };
      let status = record.status || record.payload?.status;
      if (status === 'draft') {
        await run('submit', ACTIONS.DOCUMENT_SUBMIT, () => kind === 'expense_request' ? logic.saveExpenseSubmission({
          rootDir,
          payload: {
            requestNo: no
          }
        }) : kind === 'substitute_receipt' ? logic.saveSubstituteReceiptSubmission({
          rootDir,
          payload: {
            receiptNo: no
          },
          createStockMovements: false
        }) : logic.submitWorkflowDocument({
          rootDir,
          documentKind: kind,
          documentNo: no,
          submittedBy: who
        }));
        status = record.status;
      }
      if (['submitted', 'pending_approval'].includes(status)) {
        await run('approve', ACTIONS.DOCUMENT_APPROVE, () => kind === 'expense_request' ? logic.approveExpenseRequest({
          rootDir,
          requestNo: no,
          approvedBy: who
        }) : kind === 'substitute_receipt' ? logic.approveSubstituteReceipt({
          rootDir,
          receiptNo: no,
          approvedBy: who
        }) : logic.approveWorkflowDocument({
          rootDir,
          documentKind: kind,
          documentNo: no,
          approvedBy: who
        }));
        status = record.status;
      }
      if (kind === 'substitute_receipt' && step.receiptType === 'stock_purchase' && status === 'approved') {
        await run('receive', ACTIONS.STOCK_RECEIVE, () => logic.receiveSubstituteReceiptStock({
          rootDir,
          receiptNo: no,
          receivedDate: batch.confirmedContext.invoice.receivedDate,
          receivedBy: who,
          inventoryCloudRepository
        }));
        status = record.status;
      }
      if (status !== 'completed') await run('complete', ACTIONS.DOCUMENT_COMPLETE, () => kind === 'expense_request' ? logic.completeExpenseRequest({
        rootDir,
        requestNo: no,
        completedBy: who
      }) : kind === 'substitute_receipt' ? logic.completeSubstituteReceipt({
        rootDir,
        receiptNo: no,
        completedBy: who
      }) : logic.completeWorkflowDocument({
        rootDir,
        documentKind: kind,
        documentNo: no,
        completedBy: who
      }));
    },
    async refresh({
      batch
    }) {
      await logic.refreshWorkflowTransaction({
        rootDir,
        transactionNo: batch.transactionNo,
        regeneratePacket: false
      });
      await persistTransaction(batch.transactionNo);
    }
  };
}
module.exports = {
  createLineWorkflowNativeServices
};
