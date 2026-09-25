(function bootLineIntakeReview() {
  const status = document.querySelector("[data-status]");
  const details = document.querySelector("[data-details]");
  const confirmForm = document.querySelector("[data-confirm-form]");
  const warnings = document.querySelector("[data-warnings]");
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
    confirmForm.hidden = item.status !== "needs_confirmation";
    cancelButton.hidden = item.status !== "needs_confirmation";
    const warningItems = [...(item.ocrWarnings || []), ...(item.ocrError ? [`OCR: ${item.ocrError}`] : [])];
    warnings.textContent = warningItems.join("\n");
    warnings.hidden = warningItems.length === 0;
    const fields = item.extractedPayload?.fields || {};
    for (const [name, value] of Object.entries(fields)) {
      const control = confirmForm.elements.namedItem(name);
      if (control && !control.value) control.value = value || "";
    }
  }

  async function load() {
    if (!intakeId) throw new Error("ไม่พบรหัสรายการไฟล์");
    const response = await fetch(`/api/line-intakes/${encodeURIComponent(intakeId)}`, { credentials: "same-origin" });
    if (response.status === 401) { redirectToLogin(); return; }
    const body = await readJson(response);
    if (!response.ok) throw new Error(body.error || "ไม่สามารถอ่านรายการไฟล์ได้");
    showItem(body.intake);
    setStatus(body.intake.ocrStatus === "needs_review" ? "อ่านข้อมูลเบื้องต้นแล้ว กรุณาตรวจสอบและแก้ไขก่อนยืนยัน" : "ระบบเก็บไฟล์ต้นฉบับแล้ว กรุณาตรวจสอบก่อนดำเนินการต่อ");
  }

  confirmForm.addEventListener("submit", async event => {
    event.preventDefault();
    const submitButton = confirmForm.querySelector("[data-confirm]");
    submitButton.disabled = true;
    const fields = Object.fromEntries(new FormData(confirmForm).entries());
    const response = await fetch(`/api/line-intakes/${encodeURIComponent(intakeId)}/confirm`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...fields, expenseLines: [{ date: fields.expenseDate, description: fields.description, amountBeforeVat: fields.amountBeforeVat, vatAmount: fields.vatAmount, withholdingTax: fields.withholdingTax, vendor: fields.paymentTargetName }] }),
    });
    const body = await readJson(response);
    if (!response.ok) { submitButton.disabled = false; setStatus(body.error || "สร้างแบบร่างไม่สำเร็จ", "error"); return; }
    showItem(body.intake);
    confirmForm.hidden = true;
    cancelButton.hidden = true;
    setStatus(`สร้างแบบร่าง ${body.document.requestNo} แล้ว — เปิดต่อในหน้าใบเบิกจ่ายเพื่อแก้ไขหรือส่งอนุมัติ`);
  });

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
