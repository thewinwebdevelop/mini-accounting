import { appendFileSync } from "node:fs";

const allowedHosts = new Set(String(process.env.E2E_ALLOWED_HOSTS || "")
  .split(",")
  .map(value => value.trim())
  .filter(Boolean));
const nativeFetch = globalThis.fetch;

export function assertAllowedOutboundUrl(input) {
  const url = new URL(input instanceof URL ? input : String(input));
  if (!allowedHosts.has(url.host)) {
    if (process.env.E2E_OUTBOUND_GUARD_LOG) appendFileSync(process.env.E2E_OUTBOUND_GUARD_LOG, `${url.host}\n`);
    throw new Error(`E2E outbound host blocked: ${url.host}`);
  }
  return url;
}

globalThis.fetch = async function guardedFetch(input, init) {
  assertAllowedOutboundUrl(input instanceof Request ? input.url : input);
  // Reject redirects even when init or a Request explicitly opts into following them.
  return nativeFetch(input, { ...init, redirect: "error" });
};
