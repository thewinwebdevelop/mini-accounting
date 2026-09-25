const { createSupabaseDataRepository } = require("./supabase-data.logic.js");

function createDocumentCloudRepository(options = {}) {
  const repository = createSupabaseDataRepository(options);
  return Object.freeze({
    getDocument: repository.getDocument,
    listDocuments: repository.listDocuments,
    upsertDocument: repository.upsertDocument,
    getDocumentFile: repository.getDocumentFile,
    upsertDocumentFile: repository.upsertDocumentFile,
  });
}

module.exports = { createDocumentCloudRepository };
