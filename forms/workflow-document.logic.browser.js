window.addEventListener("DOMContentLoaded", () => {
  const logic = window.WorkflowDocumentLogic;
  const workflowLogic = window.WorkflowLogic;
  const lifecycleLogic = window.DocumentLifecycleLogic;
  const query = new URLSearchParams(location.search);

  const state = {
    documentKind: query.get("documentKind") || "",
    documentNo: query.get("documentNo") || "",
    transactionNo: query.get("transactionNo") || "",
    workflowTemplateId: query.get("workflowTemplateId") || "",
    workflowStepId: query.get("workflowStepId") || "",
    status: "draft",
  };

  const form = document.querySelector("#workflowDocumentForm");
  const statusBox = document.querySelector("#workflowDocumentStatus");
  const lineItems = document.querySelector("#lineItems");
  const lineTemplate = document.querySelector("#lineTemplate");
  const addLineButton = document.querySelector("#addLine");
  const saveButton = document.querySelector("#saveWorkflowDocument");
  const submitButton = document.querySelector("#submitWorkflowDocument");
  const approveButton = document.querySelector("#approveWorkflowDocument");
  const completeButton = document.querySelector("#completeWorkflowDocument");
  const documentStatusPreview = document.querySelector("#documentStatusPreview");
  const documentNoPreview = document.querySelector("#documentNoPreview");
  const lineCountPreview = document.querySelector("#lineCountPreview");
  const totalAmountPreview = document.querySelector("#totalAmountPreview");
  const amountBeforeVatPreview = document.querySelector("#amountBeforeVatPreview");
  const vatAmountPreview = document.querySelector("#vatAmountPreview");
  const withholdingTaxPreview = document.querySelector("#withholdingTaxPreview");
  const netPaymentPreview = document.querySelector("#netPaymentPreview");
  const pageTitle = document.querySelector("#pageTitle");
  const documentListLink = document.querySelector("#workflowDocumentListLink");
  const mutationButtons = [saveButton, submitButton, approveButton, completeButton].filter(Boolean);
  const vendorPresetSelect = document.querySelector("#vendorPresetSelect");
  const saveVendorPresetCheckbox = document.querySelector("#saveVendorPreset");
  const vendorPicker = window.SharedVendorPicker?.create({
    form,
    select: vendorPresetSelect,
    checkbox: saveVendorPresetCheckbox,
    mapping: { name: ["payeeName"], taxId: ["payeeTaxId"], address: ["payeeAddress"], bankName: ["paymentBankName", "bankName"], accountNo: ["paymentAccountNo", "accountNo"], defaultBusinessPurpose: ["businessPurpose"] },
    onError: (error) => setStatus(error.message || "โหลดรายชื่อผู้ขายไม่สำเร็จ", "error"),
  });
  let mutationInFlight = false;
  const implementedActions = new Set(["submit", "approve", "complete"]);

  function todayInputValue() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function currentMonthValue() {
    return todayInputValue().slice(0, 7);
  }

  function toNumber(value) {
    const parsed = Number(String(value ?? "").replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function money(value) {
    return toNumber(value).toLocaleString("th-TH", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  function setStatus(message, kind = "") {
    statusBox.className = `status-box active ${kind}`;
    statusBox.textContent = message;
  }

  function clearStatus() {
    statusBox.className = "status-box";
    statusBox.textContent = "";
  }

  async function api(route, options = {}) {
    const response = await fetch(route, options);
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "บันทึกข้อมูลไม่สำเร็จ");
    return result;
  }

  function applyDocumentKindLabel() {
    const definition = workflowLogic?.getDocumentTypeDefinition?.(state.documentKind);
    if (definition?.label && pageTitle) pageTitle.textContent = definition.label;
  }

  function applyDocumentListLink() {
    if (logic?.LIGHTWEIGHT_DOCUMENT_KINDS?.includes(state.documentKind)) {
      documentListLink?.setAttribute("href", `/workflow-documents?documentKind=${encodeURIComponent(state.documentKind)}`);
    }
  }

  function updateLineSummary(row) {
    const index = [...lineItems.querySelectorAll(".line-item")].indexOf(row) + 1;
    const description = row.querySelector('input[name="description"]')?.value.trim() || "ยังไม่ได้กรอก";
    const title = row.querySelector("[data-line-title]");
    const total = row.querySelector("[data-line-total]");
    const summary = row.querySelector("[data-line-tax-summary]");
    const line = collectLineRow(row);
    const rated = ["exclusive", "inclusive"].includes(line.vatMode);
    row.querySelector("[data-vat-rate]").hidden = !rated;
    row.querySelector("[data-vat-manual]").hidden = line.vatMode !== "manual";
    row.querySelector("[data-unit-cost-label]").textContent = line.vatMode === "inclusive"
      ? "ราคา/หน่วยรวม VAT *"
      : ["exclusive", "manual"].includes(line.vatMode) ? "ราคา/หน่วยก่อน VAT *" : "ราคา/หน่วย *";
    if (title) title.textContent = `รายการ ${index} - ${description}`;
    try {
      const amounts = calculatePreviewTotals(hasLineContent(line) ? [line] : []);
      if (total) total.textContent = `${money(amounts.grossAmount)} บาท`;
      summary.textContent = `ก่อน VAT ${vatMoney(amounts.amountBeforeVat)} · VAT ${vatMoney(amounts.vatAmount)} · หัก ณ ที่จ่าย ${money(amounts.withholdingTax)} · สุทธิ ${money(amounts.netPayment)} บาท`;
    } catch {
      if (total) total.textContent = "ตรวจสอบจำนวนเงิน";
      summary.textContent = "ตรวจสอบจำนวน ราคา และข้อมูลภาษีของรายการ";
    }
  }

  function updateLineSummaries() {
    lineItems.querySelectorAll(".line-item").forEach(updateLineSummary);
  }

  function addLine(initial = {}) {
    const fragment = lineTemplate.content.cloneNode(true);
    const row = fragment.querySelector(".line-item");
    row.querySelector('input[name="description"]').value = initial.description || "";
    row.querySelector('input[name="quantity"]').value = initial.quantity || "";
    row.querySelector('input[name="unitCost"]').value = initial.unitCost || "";
    row.dataset.stockSkuId = initial.stockSkuId || "";
    row.querySelector('[name="vatMode"]').value = initial.vatMode || "unspecified";
    row.querySelector('[name="vatRate"]').value = initial.vatRate ?? "7";
    row.querySelector('[name="vatAmount"]').value = initial.vatAmount ?? "";
    row.querySelector('[name="withholdingTax"]').value = initial.withholdingTax ?? "";
    row.addEventListener("input", updatePreview);
    row.addEventListener("change", updatePreview);
    row.querySelector("[data-remove-line]").addEventListener("click", () => {
      if (lineItems.children.length === 1) {
        row.querySelectorAll("input").forEach((field) => { field.value = ""; });
        row.querySelector('[name="vatMode"]').value = "unspecified";
        row.querySelector('[name="vatRate"]').value = "7";
        row.dataset.stockSkuId = "";
      } else {
        row.remove();
      }
      updateLineSummaries();
      updatePreview();
    });
    lineItems.appendChild(fragment);
    updateLineSummary(row);
  }

  function collectLineRow(row) {
    const vatMode = row.querySelector('[name="vatMode"]').value;
    return {
      description: row.querySelector('input[name="description"]').value,
      quantity: row.querySelector('input[name="quantity"]').value,
      unitCost: row.querySelector('input[name="unitCost"]').value,
      stockSkuId: row.dataset.stockSkuId || "",
      vatMode,
      vatRate: ["exclusive", "inclusive"].includes(vatMode) ? row.querySelector('[name="vatRate"]').value : null,
      vatAmount: vatMode === "manual" ? row.querySelector('[name="vatAmount"]').value : null,
      withholdingTax: row.querySelector('[name="withholdingTax"]').value,
    };
  }

  function hasLineContent(line) {
    return line.description || line.quantity || line.unitCost || line.stockSkuId || line.vatMode !== "unspecified" || line.withholdingTax;
  }

  function collectLines() {
    return [...lineItems.querySelectorAll(".line-item")].map(collectLineRow).filter(hasLineContent);
  }

  function appendUploads(formData) {
    const input = form.querySelector('[name="evidence_evidence"]');
    for (const file of input?.files || []) {
      formData.append("evidence_evidence", file, file.name);
    }
  }

  function clearSubmittedUploads() {
    const input = form.querySelector('[name="evidence_evidence"]');
    if (!input) return;
    input.value = "";
    // The browser clears FileList when value is reset. The array branch keeps
    // the real-HTML VM harness faithful without attempting to assign to a
    // browser's read-only FileList.
    if (Array.isArray(input.files)) input.files = [];
  }

  function collectPayload() {
    return {
      documentKind: state.documentKind,
      documentNo: state.documentNo,
      accountingMonth: form.elements.accountingMonth.value,
      documentDate: form.elements.documentDate.value,
      title: form.elements.title.value,
      requesterName: form.elements.requesterName.value,
      payeeName: form.elements.payeeName.value,
      vendorId: form.dataset.vendorId || "",
      vendorSnapshot: (() => { try { return JSON.parse(form.dataset.vendorSnapshot || "null") || undefined; } catch { return undefined; } })(),
      businessPurpose: form.elements.businessPurpose.value,
      transactionNo: state.transactionNo,
      workflowTemplateId: state.workflowTemplateId,
      workflowStepId: state.workflowStepId,
      lines: collectLines(),
    };
  }

  function setDocumentState(status) {
    const supportsLifecycle = lifecycleLogic?.DOCUMENT_KINDS?.includes(state.documentKind);
    state.status = supportsLifecycle ? lifecycleLogic.normalizeDocumentStatus(state.documentKind, status || "draft") : (status || "draft");
    documentStatusPreview.textContent = lifecycleLogic?.DOCUMENT_STATUS_LABELS?.[state.status] || state.status;
    documentNoPreview.textContent = state.documentNo || "-";
    saveButton.hidden = state.status === "completed";
    const actions = supportsLifecycle && state.documentNo
      ? lifecycleLogic.availableDocumentActions(state.documentKind, state.status).filter((action) => implementedActions.has(action))
      : [];
    submitButton.hidden = !actions.includes("submit");
    approveButton.hidden = !actions.includes("approve");
    completeButton.hidden = !actions.includes("complete");
    form.elements.documentKind.value = state.documentKind;
    form.elements.documentNo.value = state.documentNo;
    form.elements.transactionNo.value = state.transactionNo;
    form.elements.workflowTemplateId.value = state.workflowTemplateId;
    form.elements.workflowStepId.value = state.workflowStepId;
  }

  function updatePreview() {
    const lines = collectLines();
    lineCountPreview.textContent = String(lines.length);
    try {
      const totals = calculatePreviewTotals(lines);
      amountBeforeVatPreview.textContent = vatMoney(totals.amountBeforeVat);
      vatAmountPreview.textContent = vatMoney(totals.vatAmount);
      totalAmountPreview.textContent = money(totals.grossAmount);
      withholdingTaxPreview.textContent = money(totals.withholdingTax);
      netPaymentPreview.textContent = money(totals.netPayment);
    } catch {
      // Transient input (e.g. a decimal separator while typing) must not
      // break the form or leave a stale, apparently authoritative total.
      [amountBeforeVatPreview, vatAmountPreview, totalAmountPreview, withholdingTaxPreview, netPaymentPreview]
        .forEach((field) => { field.textContent = "ตรวจสอบจำนวนเงิน"; });
    }
    updateLineSummaries();
    setDocumentState(state.status);
  }

  function vatMoney(value) {
    return value == null ? "ยังไม่ระบุครบ" : money(value);
  }

  function calculatePreviewTotals(lines) {
    const errors = logic.validateWorkflowAmounts(lines);
    if (errors.length) throw new Error(errors.join("\n"));
    return logic.calculateWorkflowAmounts(lines).totals;
  }

  // Cross-document prefill (Task 4/Task 6/Task 7, Item 4 followup): the
  // fetch/render/apply/badge mechanics are shared with
  // forms/substitute-receipt.logic.browser.js and forms/expense-request.html
  // via forms/workflow-prefill-banner.browser.js. Only this shell's own field
  // names differ per group.
  const prefillBanner = window.WorkflowPrefillBanner.create({
    documentKind: state.documentKind,
    transactionNo: state.transactionNo,
    workflowStepId: state.workflowStepId,
    form,
    fields: {
      payee: ["payeeName"],
      // The purpose adapter (applyWorkflowContextToWorkflowDocumentShell)
      // maps both `title` (ชื่อเอกสาร) and `businessPurpose` from the
      // `purpose` group — the HTML already carries a badge slot for both
      // (data-badge-for="title" and "businessPurpose"), so both must be
      // applied, not just businessPurpose.
      purpose: ["title", "businessPurpose"],
      parties: ["requesterName"],
    },
    applyLines(lines) {
      lineItems.replaceChildren();
      for (const line of lines) addLine(line);
    },
    onApplied: () => updatePreview(),
  });

  function fillForm(payload = {}) {
    form.elements.accountingMonth.value = payload.accountingMonth || currentMonthValue();
    form.elements.documentDate.value = payload.documentDate || todayInputValue();
    form.elements.title.value = payload.title || "";
    form.elements.requesterName.value = payload.requesterName || "";
    form.elements.payeeName.value = payload.payeeName || "";
    if (payload.vendorId) form.dataset.vendorId = payload.vendorId;
    if (payload.vendorSnapshot) form.dataset.vendorSnapshot = JSON.stringify(payload.vendorSnapshot);
    form.elements.businessPurpose.value = payload.businessPurpose || "";
    lineItems.replaceChildren();
    const lines = Array.isArray(payload.lines) && payload.lines.length ? payload.lines : [{}];
    for (const line of lines) addLine(line);
    setDocumentState(payload.status || state.status);
    updatePreview();
  }

  async function loadExistingDocument() {
    if (!state.documentKind || !state.documentNo) return;
    const record = await api(`/api/workflow-documents/${encodeURIComponent(state.documentKind)}/${encodeURIComponent(state.documentNo)}`);
    const payload = record.payload || {};
    state.status = record.status || payload.status || "draft";
    state.transactionNo = payload.transactionNo || state.transactionNo;
    state.workflowTemplateId = payload.workflowTemplateId || state.workflowTemplateId;
    state.workflowStepId = payload.workflowStepId || state.workflowStepId;
    fillForm(payload);
    setStatus(`โหลดเอกสาร ${state.documentNo} แล้ว`, "success");
  }

  function buildMultipartPayload(payload) {
    const body = new FormData();
    body.append("payload", JSON.stringify(payload));
    appendUploads(body);
    return body;
  }

  function adoptAuthoritativeResult(result) {
    if (!result || !Object.prototype.hasOwnProperty.call(result, "status")) {
      throw new Error("การตอบกลับจากเซิร์ฟเวอร์ไม่มีสถานะเอกสารที่ยืนยันได้");
    }
    const status = lifecycleLogic.normalizeDocumentStatus(state.documentKind, result.status);
    if (!result.documentNo && !state.documentNo) {
      throw new Error("การตอบกลับจากเซิร์ฟเวอร์ไม่มีเลขที่เอกสารที่ยืนยันได้");
    }
    state.documentNo = result.documentNo || state.documentNo;
    setDocumentState(status);
  }

  function setMutationControls(disabled) {
    mutationButtons.forEach((button) => { button.disabled = disabled; });
  }

  async function runMutation(work) {
    if (mutationInFlight) return;
    mutationInFlight = true;
    setMutationControls(true);
    try {
      await work();
    } catch (error) {
      setStatus(error.message, "error");
    } finally {
      mutationInFlight = false;
      setMutationControls(false);
    }
  }

  async function saveWorkflowDocumentSubmission() {
    clearStatus();
    const payload = collectPayload();
    const errors = logic.validateWorkflowDocumentPayload(payload);
    if (errors.length) throw new Error(errors.join("\n"));

    const result = await api("/api/workflow-documents", {
      method: "POST",
      body: buildMultipartPayload(payload),
    });

    adoptAuthoritativeResult(result);
    let vendorPresetError = "";
    try { await vendorPicker?.saveVendorPresetIfRequested(); } catch (error) { vendorPresetError = `บันทึกเอกสารแล้ว แต่บันทึกผู้ขายไม่สำเร็จ: ${error.message}`; }
    clearSubmittedUploads();
    setStatus(vendorPresetError || `บันทึกเอกสาร ${state.documentNo} แล้ว\nPDF ${(result.pdfFiles || []).length} ไฟล์`, vendorPresetError ? "error" : "success");
  }

  async function transitionWorkflowDocument(action) {
    if (!state.documentNo) return;
    clearStatus();
    const body = action === "complete" ? { completedBy: "" } : {};
    const result = await api(`/api/workflow-documents/${encodeURIComponent(state.documentKind)}/${encodeURIComponent(state.documentNo)}/${action}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    adoptAuthoritativeResult(result);
    const messages = {
      submit: `ส่งเอกสาร ${state.documentNo} ตรวจอนุมัติแล้ว`,
      approve: `อนุมัติเอกสาร ${state.documentNo} แล้ว`,
      complete: `เอกสาร ${state.documentNo} เสร็จสิ้นแล้ว`,
    };
    setStatus(messages[action], "success");
  }

  addLineButton.addEventListener("click", () => addLine());
  saveButton.addEventListener("click", () => runMutation(saveWorkflowDocumentSubmission));
  submitButton.addEventListener("click", () => runMutation(() => transitionWorkflowDocument("submit")));
  approveButton.addEventListener("click", () => runMutation(() => transitionWorkflowDocument("approve")));
  completeButton.addEventListener("click", () => runMutation(() => transitionWorkflowDocument("complete")));
  form.addEventListener("input", updatePreview);
  form.addEventListener("change", updatePreview);
  form.addEventListener("submit", (event) => event.preventDefault());

  applyDocumentKindLabel();
  applyDocumentListLink();
  vendorPicker?.load();
  fillForm();

  if (state.documentNo) {
    loadExistingDocument().catch((error) => setStatus(error.message, "error"));
  } else {
    prefillBanner.load();
  }
});
