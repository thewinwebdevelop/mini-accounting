import assert from "node:assert/strict";
import test from "node:test";

import { resolveGoogleOAuthRedirectUri } from "../forms/google-oauth-config.logic.js";

test("public deployments use the configured Google OAuth callback instead of the request Host", () => {
  assert.equal(
    resolveGoogleOAuthRedirectUri({
      configuredRedirectUri: "https://accounting.example.com/api/google-drive/oauth2callback",
      publicDeployment: true,
      requestHost: "192.168.1.129:61800",
      port: 61800,
    }),
    "https://accounting.example.com/api/google-drive/oauth2callback",
  );
});

test("local deployments always use localhost even when opened through a LAN address", () => {
  assert.equal(
    resolveGoogleOAuthRedirectUri({
      configuredRedirectUri: "https://accounting.example.com/api/google-drive/oauth2callback",
      publicDeployment: false,
      requestHost: "192.168.1.129:61800",
      port: 61800,
    }),
    "http://localhost:61800/api/google-drive/oauth2callback",
  );
});
