export function assertSyntheticRun(value, runId) {
  if (!value || value.runId !== runId) throw new Error("fixture run identity mismatch");
  return value;
}

export async function assertHealth(baseUrl, runId) {
  const response = await fetch(new URL("__e2e__/health", baseUrl));
  if (!response.ok) throw new Error(`fixture health failed: ${response.status}`);
  return assertSyntheticRun(await response.json(), runId);
}
