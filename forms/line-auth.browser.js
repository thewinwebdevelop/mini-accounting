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
    if (authGate) return;
    window.location.replace(safeReturnPath());
  }

  window.SweetHouseAuth = Object.freeze({ boot, safeReturnPath });
  boot().catch(error => setStatus(error.message || "ไม่สามารถเข้าสู่ระบบได้", "error"));
}());
