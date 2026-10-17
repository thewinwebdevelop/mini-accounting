function resolveGoogleOAuthRedirectUri({
  configuredRedirectUri = "",
  publicDeployment = false,
  requestHost = "",
  port = 8787,
} = {}) {
  const configured = String(configuredRedirectUri || "").trim();
  if (publicDeployment && configured) return configured;

  // A LAN address is not a valid Web OAuth redirect host. Local development
  // must complete the callback on the same machine that runs the server.
  const localPort = Number(port) > 0 ? Number(port) : 8787;
  return `http://localhost:${localPort}/api/google-drive/oauth2callback`;
}

module.exports = { resolveGoogleOAuthRedirectUri };
