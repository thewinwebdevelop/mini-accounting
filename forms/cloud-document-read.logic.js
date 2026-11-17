function createCloudDocumentReader({
  cloudRun = false,
  documentDataAdapter,
  documentFileSynchronizer,
  rebuildIndex = async () => {},
} = {}) {
  async function ensure({ documentKind, documentNo, localLoad }) {
    let localRecord = null;
    let localError = null;
    try {
      localRecord = await localLoad();
    } catch (error) {
      localError = error;
    }
    if (localRecord) return localRecord;
    if (!cloudRun || !documentFileSynchronizer) {
      if (localError) throw localError;
      return localRecord;
    }

    const cloudRecord = await documentDataAdapter.get({
      localResult: null,
      documentKind,
      documentNo,
    });
    if (!cloudRecord) {
      if (localError) throw localError;
      return null;
    }

    await documentFileSynchronizer.materialize({ record: cloudRecord });
    await rebuildIndex();
    const materializedRecord = await localLoad();
    if (!materializedRecord && localError) throw localError;
    return materializedRecord;
  }

  return Object.freeze({ ensure });
}

module.exports = { createCloudDocumentReader };
