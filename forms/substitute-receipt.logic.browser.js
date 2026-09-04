window.addEventListener("DOMContentLoaded", () => {
  const logic = window.SubstituteReceiptLogic;
  const evidenceKeys = ["paymentSlip", "purchaseOrder", "goodsReceived", "otherEvidence"];
  const statusLabels = {
    draft: "แบบร่าง",
    pending_approval: "รอตรวจอนุมัติ",
    approved: "อนุมัติแล้ว",
    received: "รับเข้าคลังแล้ว",
    cancelled: "ยกเลิก",
  };
  const state = {
    stockSkus: [],
    nextReceipt: null,
    draftId: "",
    receiptNo: "",
    status: "draft",
    existingEvidenceFiles: {},
  };

  const queryDraftId = new URLSearchParams(location.search).get("draftId");
  const queryReceiptNo = new URLSearchParams(location.search).get("receiptNo");
  const form = document.querySelector("#substituteReceiptForm");
  const statusBox = document.querySelector("#substituteReceiptStatus");
  const lineItems = document.querySelector("#stockLineItems");
  const lineTemplate = document.querySelector("#stockLineTemplate");
  const addLineButton = document.querySelector("#addStockLine");
  const saveDraftButton = document.querySelector("#saveDraft");
  const submitForApprovalButton = document.querySelector("#submitForApproval");
  const approveReceiptButton = document.querySelector("#approveReceipt");
  const receiveStockButton = document.querySelector("#receiveStock");
  const receiptStatus = document.querySelector("#receiptStatus");
  const receiptNoPreview = document.querySelector("#receiptNoPreview");
  const lineCountPreview = document.querySelector("#lineCountPreview");
  const totalAmountPreview = document.querySelector("#totalAmountPreview");
  const evidenceCountPreview = document.querySelector("#evidenceCountPreview");
  const stockReceiptNotice = document.querySelector("#stockReceiptNotice");

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

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

  function skuLabel(sku) {
    return `${sku.sku} - ${sku.productName} ${sku.color || ""} ${sku.size || ""}`.trim();
  }

  function option(label, value, sku = null) {
    const node = document.createElement("option");
    node.value = value;
    node.textContent = label;
    if (sku) {
      node.dataset.sku = sku.sku;
      node.dataset.description = `${sku.productName} ${sku.color || ""} ${sku.size || ""}`.trim();
      node.dataset.unitCost = sku.defaultUnitCost || "";
    }
    return node;
  }

  function renderSkuOptions(select) {
    const activeSkus = state.stockSkus.filter((sku) => sku.status !== "inactive");
    select.replaceChildren(
      option("เลือก Stock SKU", ""),
      ...activeSkus.map((sku) => option(skuLabel(sku), sku.id, sku)),
    );
  }

  function refreshAllSkuSelects() {
    lineItems.querySelectorAll('select[name="stockSkuId"]').forEach((select) => {
      const currentValue = select.value;
      renderSkuOptions(select);
      select.value = currentValue;
    });
  }

  function stockLinesLocked() {
    return ["approved", "received"].includes(state.status);
  }

  function applyStockLineLock() {
    const locked = stockLinesLocked();
    addLineButton.disabled = locked;
    form.elements.receiptType.disabled = locked;
    lineItems.querySelectorAll(".stock-line").forEach((row) => {
      row.querySelector('select[name="stockSkuId"]').disabled = locked;
      row.querySelector('input[name="quantity"]').disabled = locked;
      row.querySelector('input[name="unitCost"]').disabled = locked;
      row.querySelector("[data-remove-line]").disabled = locked;
    });
  }

  function applyReceiptTypeState() {
    const isStockPurchase = form.elements.receiptType.value === "stock_purchase";
    stockReceiptNotice.style.display = isStockPurchase ? "block" : "none";
    lineItems.querySelectorAll('select[name="stockSkuId"]').forEach((select) => {
      select.required = isStockPurchase;
    });
    applyStockLineLock();
  }

  function setReceiptState(status) {
    state.status = status || "draft";
    receiptStatus.textContent = statusLabels[state.status] || state.status;
    saveDraftButton.hidden = state.status !== "draft";
    submitForApprovalButton.hidden = state.status !== "draft";
    approveReceiptButton.hidden = state.status !== "pending_approval";
    receiveStockButton.hidden = state.status !== "approved" || form.elements.receiptType.value !== "stock_purchase";
    receiptNoPreview.textContent = state.receiptNo || state.nextReceipt?.receiptNo || "-";
    applyReceiptTypeState();
  }

  function addStockLine(initial = {}) {
    const fragment = lineTemplate.content.cloneNode(true);
    const row = fragment.querySelector(".stock-line");
    const select = row.querySelector('select[name="stockSkuId"]');
    const description = row.querySelector('input[name="description"]');
    const skuInput = row.querySelector('input[name="sku"]');
    const quantity = row.querySelector('input[name="quantity"]');
    const unitCost = row.querySelector('input[name="unitCost"]');

    renderSkuOptions(select);
    select.value = initial.stockSkuId || "";
    description.value = initial.description || "";
    skuInput.value = initial.sku || "";
    quantity.value = initial.quantity || "";
    unitCost.value = initial.unitCost || "";

    select.addEventListener("change", () => {
      const selected = select.selectedOptions[0];
      skuInput.value = selected?.dataset.sku || "";
      if (selected?.dataset.description && !description.value) description.value = selected.dataset.description;
      if (selected?.dataset.unitCost && !unitCost.value) unitCost.value = selected.dataset.unitCost;
      updatePreview();
    });

    row.addEventListener("input", updatePreview);
    row.querySelector("[data-remove-line]").addEventListener("click", () => {
      if (stockLinesLocked()) return;
      if (lineItems.children.length === 1) {
        row.querySelectorAll("input, select").forEach((field) => {
          field.value = "";
        });
      } else {
        row.remove();
      }
      updatePreview();
    });

    lineItems.appendChild(fragment);
    applyReceiptTypeState();
    updatePreview();
  }

  function collectLines() {
    return [...lineItems.querySelectorAll(".stock-line")].map((row) => {
      const select = row.querySelector('select[name="stockSkuId"]');
      const selected = select.selectedOptions[0];
      return {
        stockSkuId: select.value,
        sku: row.querySelector('input[name="sku"]').value || selected?.dataset.sku || "",
        description: row.querySelector('input[name="description"]').value || selected?.dataset.description || "",
        quantity: row.querySelector('input[name="quantity"]').value,
        unitCost: row.querySelector('input[name="unitCost"]').value,
      };
    }).filter((line) => line.stockSkuId || line.description || line.quantity || line.unitCost);
  }

  function collectEvidenceFilesForValidation() {
    return Object.fromEntries(evidenceKeys.map((key) => {
      const input = form.querySelector(`[name="evidence_${key}"]`);
      const existing = Array.isArray(state.existingEvidenceFiles[key]) ? state.existingEvidenceFiles[key] : [];
      const files = [...(input?.files || [])].map((file, index) => ({
        evidenceKey: key,
        originalName: file.name,
        storedName: logic.buildSubstituteReceiptRawFileName(key, file.name, existing.length + index),
        size: file.size,
        type: file.type || "application/octet-stream",
      }));
      return [key, [...existing, ...files]];
    }));
  }

  function collectPayload() {
    return {
      draftId: state.draftId,
      receiptNo: state.receiptNo,
      accountingMonth: form.elements.accountingMonth.value,
      receiptDate: form.elements.receiptDate.value,
      receiptTitle: form.elements.receiptTitle.value,
      receiptType: form.elements.receiptType.value,
      payeeName: form.elements.payeeName.value,
      payeeTaxId: form.elements.payeeTaxId.value,
      paymentChannel: form.elements.paymentChannel.value,
      paymentReference: form.elements.paymentReference.value,
      businessPurpose: form.elements.businessPurpose.value,
      lines: collectLines(),
      evidenceFiles: collectEvidenceFilesForValidation(),
    };
  }

  function appendUploads(formData) {
    for (const key of evidenceKeys) {
      const input = form.querySelector(`[name="evidence_${key}"]`);
      for (const file of input?.files || []) {
        formData.append(`evidence_${key}`, file, file.name);
      }
    }
  }

  function updatePreview() {
    const lines = collectLines();
    const total = lines.reduce((sum, line) => sum + (toNumber(line.quantity) * toNumber(line.unitCost)), 0);
    const evidenceCount = evidenceKeys.reduce((sum, key) => {
      const input = form.querySelector(`[name="evidence_${key}"]`);
      const existing = Array.isArray(state.existingEvidenceFiles[key]) ? state.existingEvidenceFiles[key].length : 0;
      return sum + existing + (input?.files?.length || 0);
    }, 0);

    receiptNoPreview.textContent = state.receiptNo || state.nextReceipt?.receiptNo || "-";
    lineCountPreview.textContent = String(lines.length);
    totalAmountPreview.textContent = money(total);
    evidenceCountPreview.textContent = String(evidenceCount);
    setReceiptState(state.status);
  }

  async function refreshNextReceipt() {
    if (state.receiptNo) return;
    const accountingMonth = form.elements.accountingMonth.value;
    if (!accountingMonth) return;
    state.nextReceipt = await api(`/api/substitute-receipts/next?accountingMonth=${encodeURIComponent(accountingMonth)}`);
    updatePreview();
  }

  async function refreshStockSkus() {
    const { stockSkus } = await api("/api/inventory/stock-skus");
    state.stockSkus = stockSkus;
    refreshAllSkuSelects();
  }

  function fillForm(payload = {}) {
    form.elements.accountingMonth.value = payload.accountingMonth || currentMonthValue();
    form.elements.receiptDate.value = payload.receiptDate || todayInputValue();
    form.elements.receiptType.disabled = false;
    form.elements.receiptType.value = payload.receiptType || "stock_purchase";
    form.elements.receiptTitle.value = payload.receiptTitle || "";
    form.elements.payeeName.value = payload.payeeName || "";
    form.elements.payeeTaxId.value = payload.payeeTaxId || "";
    form.elements.paymentChannel.value = payload.paymentChannel || "โอนผ่านบัญชีบริษัท";
    form.elements.paymentReference.value = payload.paymentReference || "";
    form.elements.businessPurpose.value = payload.businessPurpose || "ซื้อสินค้าเพื่อขาย";
    state.existingEvidenceFiles = payload.evidenceFiles || {};
    lineItems.replaceChildren();
    const lines = Array.isArray(payload.lines) && payload.lines.length ? payload.lines : [{}];
    for (const line of lines) addStockLine(line);
    setReceiptState(payload.status || state.status || "draft");
    updatePreview();
  }

  async function loadDraft(draftId) {
    const draft = await api(`/api/substitute-receipt-drafts/${encodeURIComponent(draftId)}`);
    state.draftId = draft.draftId;
    state.receiptNo = "";
    state.status = "draft";
    fillForm({
      ...(draft.payload || {}),
      status: "draft",
      evidenceFiles: draft.evidenceFiles || draft.payload?.evidenceFiles || {},
    });
    setStatus(`โหลดแบบร่าง ${escapeHtml(draft.draftId)} แล้ว`, "success");
  }

  async function loadReceipt(receiptNo) {
    const receipt = await api(`/api/substitute-receipts/${encodeURIComponent(receiptNo)}`);
    const payload = receipt.payload || {};
    state.draftId = "";
    state.receiptNo = receipt.receiptNo || payload.receiptNo || receiptNo;
    state.status = receipt.status || payload.status || "pending_approval";
    fillForm({
      ...payload,
      receiptNo: state.receiptNo,
      status: state.status,
      evidenceFiles: payload.evidenceFiles || receipt.evidenceFiles || {},
    });
    setStatus(`โหลดเอกสาร ${escapeHtml(state.receiptNo)} แล้ว`, "success");
  }

  function buildMultipartPayload(payload) {
    const body = new FormData();
    body.append("payload", JSON.stringify(payload));
    appendUploads(body);
    return body;
  }

  async function saveDraft() {
    clearStatus();
    const payload = collectPayload();
    delete payload.receiptNo;
    const result = await api("/api/substitute-receipt-drafts", {
      method: "POST",
      body: buildMultipartPayload(payload),
    });
    state.draftId = result.draftId;
    state.receiptNo = "";
    state.status = "draft";
    state.existingEvidenceFiles = collectEvidenceFilesForValidation();
    setReceiptState("draft");
    setStatus(`บันทึกแบบร่าง ${escapeHtml(result.draftId)} แล้ว`, "success");
  }

  async function submitForApproval() {
    clearStatus();
    const payload = collectPayload();
    delete payload.receiptNo;
    const errors = logic.validateSubstituteReceipt(payload);
    if (errors.length) throw new Error(errors.join("\n"));

    const result = await api("/api/substitute-receipts", {
      method: "POST",
      body: buildMultipartPayload(payload),
    });

    state.draftId = "";
    state.receiptNo = result.receiptNo;
    state.status = result.status || "pending_approval";
    state.existingEvidenceFiles = collectEvidenceFilesForValidation();
    setReceiptState(state.status);
    setStatus(`ส่งตรวจอนุมัติ ${escapeHtml(result.receiptNo)} แล้ว\nPDF ${result.pdfFiles.length} ไฟล์, raw ${result.rawFiles.length} ไฟล์`, "success");
  }

  async function approveReceipt() {
    if (!state.receiptNo) return;
    clearStatus();
    const result = await api(`/api/substitute-receipts/${encodeURIComponent(state.receiptNo)}/approve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ approvedBy: "" }),
    });
    state.status = result.status || "approved";
    setReceiptState(state.status);
    setStatus(`อนุมัติ ${escapeHtml(state.receiptNo)} แล้ว`, "success");
  }

  async function receiveStock() {
    if (!state.receiptNo) return;
    const receivedDate = window.prompt("วันที่รับสินค้า", todayInputValue());
    if (!receivedDate) return;
    clearStatus();
    const result = await api(`/api/substitute-receipts/${encodeURIComponent(state.receiptNo)}/receive-stock`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ receivedDate, receivedBy: "" }),
    });
    state.status = result.status || "received";
    setReceiptState(state.status);
    setStatus(`รับสินค้าเข้าคลัง ${escapeHtml(state.receiptNo)} แล้ว ${result.stockMovements.length} รายการ`, "success");
  }

  function resetFormState() {
    state.draftId = "";
    state.receiptNo = "";
    state.status = "draft";
    state.existingEvidenceFiles = {};
    state.nextReceipt = null;
    fillForm();
    refreshNextReceipt().catch((error) => setStatus(error.message, "error"));
    clearStatus();
  }

  addLineButton.addEventListener("click", () => addStockLine());
  saveDraftButton.addEventListener("click", () => saveDraft().catch((error) => setStatus(error.message, "error")));
  approveReceiptButton.addEventListener("click", () => approveReceipt().catch((error) => setStatus(error.message, "error")));
  receiveStockButton.addEventListener("click", () => receiveStock().catch((error) => setStatus(error.message, "error")));
  form.elements.accountingMonth.addEventListener("change", () => refreshNextReceipt().catch((error) => setStatus(error.message, "error")));
  form.elements.receiptType.addEventListener("change", () => {
    applyReceiptTypeState();
    updatePreview();
  });
  form.addEventListener("input", updatePreview);
  form.addEventListener("change", updatePreview);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    submitForApproval().catch((error) => setStatus(error.message, "error"));
  });
  form.addEventListener("reset", () => {
    setTimeout(resetFormState);
  });

  fillForm();
  Promise.all([refreshStockSkus(), refreshNextReceipt()])
    .then(async () => {
      if (queryDraftId) {
        await loadDraft(queryDraftId);
      } else if (queryReceiptNo) {
        await loadReceipt(queryReceiptNo);
      }
      updatePreview();
    })
    .catch((error) => setStatus(error.message, "error"));
});
