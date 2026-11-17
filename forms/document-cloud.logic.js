const { createSupabaseDataRepository } = require("./supabase-data.logic.js");

function createDocumentCloudRepository(options = {}) {
  const repository = createSupabaseDataRepository(options);
  return Object.freeze({
    getDocument: repository.getDocument,
    compareAndSwapDocument: repository.compareAndSwapDocument,
    listDocuments: repository.listDocuments,
    upsertDocument: repository.upsertDocument,
    allocateWorkflowTransactionNumber: repository.allocateWorkflowTransactionNumber,
    allocateAccountingDocumentNumber: repository.allocateAccountingDocumentNumber,
    peekWorkflowTransactionNumber: repository.peekWorkflowTransactionNumber,
    getDocumentFile: repository.getDocumentFile,
    upsertDocumentFile: repository.upsertDocumentFile,
  });
}

module.exports = { createDocumentCloudRepository };
