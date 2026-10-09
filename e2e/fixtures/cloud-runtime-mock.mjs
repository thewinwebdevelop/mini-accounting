import { createE2EEnvironment } from "./app-server.fixture.mjs";

export async function createCloudRuntimeMock(options = {}) {
  const cloudState = { runId: "cloud-runtime", documents: new Map(), reservations: new Map(), responseScript: [] };
  const first = await createE2EEnvironment({ ...options, providerState: cloudState, profile: "cloud-runtime-mocked" });
  return {
    ...first,
    cloudState,
    restartApp: async () => {
      await first.stop();
      const next = await createE2EEnvironment({ ...options, providerState: cloudState, profile: "cloud-runtime-mocked" });
      return { ...next, cloudState };
    },
  };
}
