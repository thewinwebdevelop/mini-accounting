function createCloudDocumentReader({
  cloudRun = false,
  documentDataAdapter,
  documentFileSynchronizer,
  rebuildIndex = async () => {},
} = {}) {
  async function ensure({ documentKind, documentNo, localLoad }) {
    try {
      return await localLoad();
    } catch (error) {
      if (!cloudRun || !documentFileSynchronizer) throw error;

      const cloudRecord = await documentDataAdapter.get({
        localResult: null,
        documentKind,
        documentNo,
      });
      if (!cloudRecord) throw error;

      await documentFileSynchronizer.materialize({ record: cloudRecord });
      await rebuildIndex();
      return localLoad();
    }
  }

  return Object.freeze({ ensure });
}

module.exports = { createCloudDocumentReader };
