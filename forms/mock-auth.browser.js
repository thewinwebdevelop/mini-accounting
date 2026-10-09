(function bootstrapMockAuth() {
  const status = document.querySelector("#mock-auth-status");

  function safeReturnPath() {
    const raw = new URLSearchParams(window.location.search).get("returnTo") || "/";
    if (!raw.startsWith("/") || raw.startsWith("//")) return "/";
    try {
      const target = new URL(raw, window.location.origin);
      return target.origin === window.location.origin
        ? `${target.pathname}${target.search}${target.hash}`
        : "/";
    } catch {
      return "/";
    }
  }

  async function boot() {
    const response = await fetch("/api/auth/mock-session", {
      method: "POST",
      credentials: "same-origin",
    });
    if (!response.ok) {
      let result = {};
      try { result = await response.json(); } catch {}
      throw new Error(result.error || "Mock auth ใช้งานไม่ได้");
    }
    window.location.replace(safeReturnPath());
  }

  boot().catch(error => {
    if (status) status.textContent = error.message || "Mock auth ใช้งานไม่ได้";
  });
}());
