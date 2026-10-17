import { createE2EEnvironment } from "./app-server.fixture.mjs";
import { createTestSession } from "./auth.fixture.mjs";

const SECRET = "e2e-test-session-secret-012345678901234567890123";

export async function createCloudRuntimeMock(options = {}) {
  const cloudState = { runId: "cloud-runtime", documents: new Map(), reservations: new Map(), responseScript: [] };
  const first = await createE2EEnvironment({ ...options, providerState: cloudState, profile: "cloud-runtime-mocked" });
  return {
    ...first,
    cloudState,
    sessionToken: createTestSession({ ...first.users.employeeA, secret: SECRET }),
    restartApp: async () => {
      await first.stop();
      const next = await createE2EEnvironment({ ...options, providerState: cloudState, profile: "cloud-runtime-mocked" });
      return { ...next, cloudState, sessionToken: createTestSession({ ...next.users.employeeA, secret: SECRET }) };
    },
  };
}
