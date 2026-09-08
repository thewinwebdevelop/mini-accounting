window.addEventListener("DOMContentLoaded", () => {
  const logic = window.WorkflowDocumentLogic;
  const workflowLogic = window.WorkflowLogic;
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
  const completeButton = document.querySelector("#completeWorkflowDocument");
  const documentStatusPreview = document.querySelector("#documentStatusPreview");
  const documentNoPreview = document.querySelector("#documentNoPreview");
  const lineCountPreview = document.querySelector("#lineCountPreview");
  const totalAmountPreview = document.querySelector("#totalAmountPreview");
  const pageTitle = document.querySelector("#pageTitle");

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

  function addLine(initial = {}) {
    const fragment = lineTemplate.content.cloneNode(true);
    const row = fragment.querySelector(".line-item");
    row.querySelector('input[name="description"]').value = initial.description || "";
    row.querySelector('input[name="quantity"]').value = initial.quantity || "";
    row.querySelector('input[name="unitCost"]').value = initial.unitCost || "";
    row.addEventListener("input", updatePreview);
    row.querySelector("[data-remove-line]").addEventListener("click", () => {
      if (lineItems.children.length === 1) {
        row.querySelectorAll("input").forEach((field) => { field.value = ""; });
      } else {
        row.remove();
      }
      updatePreview();
    });
    lineItems.appendChild(fragment);
  }

  function collectLineRows() {
    return [...lineItems.querySelectorAll(".line-item")].map((row) => ({
      description: row.querySelector('input[name="description"]').value,
      quantity: row.querySelector('input[name="quantity"]').value,
      unitCost: row.querySelector('input[name="unitCost"]').value,
    }));
  }

  function collectLines() {
    return collectLineRows().filter((line) => line.description || line.quantity || line.unitCost);
  }

  function appendUploads(formData) {
    const input = form.querySelector('[name="evidence_evidence"]');
    for (const file of input?.files || []) {
      formData.append("evidence_evidence", file, file.name);
    }
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
      businessPurpose: form.elements.businessPurpose.value,
      transactionNo: state.transactionNo,
      workflowTemplateId: state.workflowTemplateId,
      workflowStepId: state.workflowStepId,
      lines: collectLines(),
    };
  }

  function setDocumentState(status) {
    state.status = status || "draft";
    documentStatusPreview.textContent = logic.WORKFLOW_DOCUMENT_STATUS_LABELS[state.status] || state.status;
    documentNoPreview.textContent = state.documentNo || "-";
    saveButton.hidden = state.status === "completed";
    completeButton.hidden = !state.documentNo || state.status === "completed";
    form.elements.documentKind.value = state.documentKind;
    form.elements.documentNo.value = state.documentNo;
    form.elements.transactionNo.value = state.transactionNo;
    form.elements.workflowTemplateId.value = state.workflowTemplateId;
    form.elements.workflowStepId.value = state.workflowStepId;
  }

  function updatePreview() {
    const lines = collectLines();
    const total = lines.reduce((sum, line) => sum + (toNumber(line.quantity) * toNumber(line.unitCost)), 0);
    lineCountPreview.textContent = String(lines.length);
    totalAmountPreview.textContent = money(total);
    setDocumentState(state.status);
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

  async function saveWorkflowDocumentSubmission() {
    clearStatus();
    const payload = collectPayload();
    const errors = logic.validateWorkflowDocumentPayload(payload);
    if (errors.length) throw new Error(errors.join("\n"));

    const result = await api("/api/workflow-documents", {
      method: "POST",
      body: buildMultipartPayload(payload),
    });

    state.documentNo = result.documentNo;
    state.status = result.status || "draft";
    setDocumentState(state.status);
    setStatus(`บันทึกเอกสาร ${result.documentNo} แล้ว\nPDF ${result.pdfFiles.length} ไฟล์`, "success");
  }

  async function completeWorkflowDocumentSubmission() {
    if (!state.documentNo) return;
    clearStatus();
    const result = await api(`/api/workflow-documents/${encodeURIComponent(state.documentKind)}/${encodeURIComponent(state.documentNo)}/complete`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ completedBy: "" }),
    });
    state.status = result.status || "completed";
    setDocumentState(state.status);
    setStatus(`เอกสาร ${state.documentNo} เสร็จสิ้นแล้ว`, "success");
  }

  addLineButton.addEventListener("click", () => addLine());
  saveButton.addEventListener("click", () => saveWorkflowDocumentSubmission().catch((error) => setStatus(error.message, "error")));
  completeButton.addEventListener("click", () => completeWorkflowDocumentSubmission().catch((error) => setStatus(error.message, "error")));
  form.addEventListener("input", updatePreview);
  form.addEventListener("change", updatePreview);
  form.addEventListener("submit", (event) => event.preventDefault());

  applyDocumentKindLabel();
  fillForm();

  if (state.documentNo) {
    loadExistingDocument().catch((error) => setStatus(error.message, "error"));
  } else {
    prefillBanner.load();
  }
});
