(function bootstrapLineAuth() {
  const script = document.currentScript;
  const status = document.querySelector("[data-line-auth-status]");
  const liffId = script?.dataset?.lineLiffId || "";
  const authGate = script?.dataset?.authGate === "true";

  function setStatus(message, kind = "info") {
    if (!status) return;
    status.textContent = message;
    status.dataset.kind = kind;
  }

  function safeReturnPath() {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get("returnTo") || params.get("liff.state") || script?.dataset?.returnTo || "/";
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

  function redirectToRequestedPath() {
    const target = safeReturnPath();
    const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (target !== "/" && target !== current) window.location.replace(target);
  }

  async function readJson(response) {
    try {
      return await response.json();
    } catch {
      return {};
    }
  }

  async function boot() {
    if (!liffId) throw new Error("ยังไม่ได้ตั้งค่า LINE LIFF ID");
    if (!window.liff || typeof window.liff.init !== "function") throw new Error("ไม่พบ LIFF SDK");
    if (authGate) {
      const sessionResponse = await fetch("/api/auth/me", { credentials: "same-origin" });
      if (sessionResponse.ok) {
        setStatus("เข้าสู่ระบบแล้ว");
        redirectToRequestedPath();
        return;
      }
    }
    setStatus("กำลังเชื่อมต่อ LINE...");
    await window.liff.init({ liffId });
    if (!window.liff.isLoggedIn()) {
      setStatus("กำลังเปิดหน้าเข้าสู่ระบบ LINE...");
      window.liff.login({ redirectUri: window.location.href });
      return;
    }
    const idToken = window.liff.getIDToken();
    if (!idToken) throw new Error("ไม่พบ LINE ID token");
    setStatus("กำลังตรวจสอบสิทธิ์...");
    const loginResponse = await fetch("/api/auth/line-session", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idToken }),
    });
    if (!loginResponse.ok) {
      const error = await readJson(loginResponse);
      throw new Error(error.error || "ไม่สามารถเข้าสู่ระบบได้");
    }
    const meResponse = await fetch("/api/auth/me", { credentials: "same-origin" });
    if (!meResponse.ok) throw new Error("ไม่สามารถยืนยัน session ได้");
    setStatus("เข้าสู่ระบบสำเร็จ กำลังเปิดระบบ...");
    if (authGate) {
      redirectToRequestedPath();
      return;
    }
    window.location.replace(safeReturnPath());
  }

  // Expose the in-flight bootstrap so protected page controllers can wait for
  // the session cookie before their first API request.  Direct navigation to
  // a protected page loads this script and the page controller in parallel;
  // without a shared promise, the controller can win that race and receive
  // AUTH_REQUIRED even though LINE login is about to succeed.
  const ready = boot();
  window.SweetHouseAuth = Object.freeze({ boot, ready, safeReturnPath });
  ready.catch(error => setStatus(error.message || "ไม่สามารถเข้าสู่ระบบได้", "error"));
}());
