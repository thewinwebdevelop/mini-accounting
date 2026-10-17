export const selectors = Object.freeze({
  appShell: '[data-e2e="app-shell"]',
  runId: '[data-e2e="run-id"]',
  error: '[data-e2e="error"]',
});

export function byTestId(id) { return `[data-e2e="${String(id).replace(/"/g, "\\\"")}"]`; }
