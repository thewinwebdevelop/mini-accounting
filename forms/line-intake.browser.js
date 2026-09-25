(function bootLineIntakeReview() {
  const status = document.querySelector("[data-status]");
  const details = document.querySelector("[data-details]");
  const cancelButton = document.querySelector("[data-cancel]");
  const intakeId = new URLSearchParams(window.location.search).get("intakeId") || "";

  function setStatus(message, kind = "info") {
    status.textContent = message;
    status.dataset.kind = kind;
  }

  async function readJson(response) {
    try { return await response.json(); } catch { return {}; }
  }

  function redirectToLogin() {
    const returnTo = `${window.location.pathname}?intakeId=${encodeURIComponent(intakeId)}`;
    window.location.assign(`/line-auth?returnTo=${encodeURIComponent(returnTo)}`);
  }

  function showItem(item) {
    document.querySelector("[data-name]").textContent = item.originalName;
    document.querySelector("[data-type]").textContent = item.mediaKind === "pdf" ? "PDF" : "รูปภาพ";
    document.querySelector("[data-size]").textContent = `${item.byteSize.toLocaleString()} bytes`;
    document.querySelector("[data-state]").textContent = item.status === "needs_confirmation" ? "รอตรวจสอบ" : item.status;
    details.hidden = false;
    cancelButton.hidden = item.status !== "needs_confirmation";
  }

  async function load() {
    if (!intakeId) throw new Error("ไม่พบรหัสรายการไฟล์");
    const response = await fetch(`/api/line-intakes/${encodeURIComponent(intakeId)}`, { credentials: "same-origin" });
    if (response.status === 401) { redirectToLogin(); return; }
    const body = await readJson(response);
    if (!response.ok) throw new Error(body.error || "ไม่สามารถอ่านรายการไฟล์ได้");
    showItem(body.intake);
    setStatus("ระบบเก็บไฟล์ต้นฉบับแล้ว กรุณาตรวจสอบก่อนดำเนินการต่อ");
  }

  cancelButton.addEventListener("click", async () => {
    cancelButton.disabled = true;
    const response = await fetch(`/api/line-intakes/${encodeURIComponent(intakeId)}/cancel`, { method: "POST", credentials: "same-origin" });
    const body = await readJson(response);
    if (!response.ok) { cancelButton.disabled = false; setStatus(body.error || "ยกเลิกรายการไม่สำเร็จ", "error"); return; }
    showItem(body.intake);
    setStatus("ยกเลิกรายการแล้ว");
  });

  load().catch(error => setStatus(error.message || "ไม่สามารถโหลดรายการได้", "error"));
}());
