window.addEventListener("DOMContentLoaded", () => {
  const logic = window.SubstituteReceiptLogic;
  const evidenceKeys = ["paymentSlip", "purchaseOrder", "goodsReceived", "otherEvidence"];
  const lifecycleLogic = window.DocumentLifecycleLogic;
  const state = {
    stockSkus: [],
    vendors: [],
    nextReceipt: null,
    draftId: "",
    receiptNo: "",
    status: "draft",
    existingEvidenceFiles: {},
    mutationInFlight: false,
    modalOpen: false,
    legacyReadOnly: false,
  };

  const queryDraftId = new URLSearchParams(location.search).get("draftId");
  const queryReceiptNo = new URLSearchParams(location.search).get("receiptNo");
  const form = document.querySelector("#substituteReceiptForm");
  const statusBox = document.querySelector("#substituteReceiptStatus");
  const reloadSavedReceiptButton = document.querySelector("#reloadSavedReceipt");
  const legacyEvidenceLinks = document.querySelector("#legacyEvidenceLinks");
  const lineItems = document.querySelector("#stockLineItems");
  const lineTemplate = document.querySelector("#stockLineTemplate");
  const addLineButton = document.querySelector("#addStockLine");
  const saveDraftButton = document.querySelector("#saveDraft");
  const submitForApprovalButton = document.querySelector("#submitForApproval");
  const approveReceiptButton = document.querySelector("#approveReceipt");
  const receiveStockButton = document.querySelector("#receiveStock");
  const completeReceiptButton = document.querySelector("#completeReceipt");
  const stockBeforeCompleteDialog = document.querySelector("#stockBeforeCompleteDialog");
  const confirmReceiveBeforeCompleteButton = document.querySelector("#confirmReceiveBeforeComplete");
  const declineReceiveBeforeCompleteButton = document.querySelector("#declineReceiveBeforeComplete");
  const receiptStatus = document.querySelector("#receiptStatus");
  const receiptNoPreview = document.querySelector("#receiptNoPreview");
  const lineCountPreview = document.querySelector("#lineCountPreview");
  const totalAmountPreview = document.querySelector("#totalAmountPreview");
  const evidenceCountPreview = document.querySelector("#evidenceCountPreview");
  const stockReceiptNotice = document.querySelector("#stockReceiptNotice");
  const vendorPresetSelect = document.querySelector("#vendorPresetSelect");
  const saveVendorPresetCheckbox = document.querySelector("#saveVendorPreset");
  const vendorPicker = window.SharedVendorPicker?.create({
    form,
    select: vendorPresetSelect,
    checkbox: saveVendorPresetCheckbox,
    mapping: { name: ["payeeName"], taxId: ["payeeTaxId"], paymentChannel: ["paymentChannel"], paymentReference: ["paymentReference"], defaultBusinessPurpose: ["businessPurpose"] },
    onError: (error) => setStatus(error.message || "โหลดรายชื่อผู้ขายไม่สำเร็จ", "error"),
  });

  // --- Workflow context (Task 9) ---------------------------------------
  // transactionNo/workflowTemplateId/workflowStepId/returnTo arrive as query
  // params only when this page is opened from a workflow transaction step
  // (see /api/workflow-transactions/:transactionNo/start-document/:stepId).
  // Opened standalone (no query params), everything below stays inert: the
  // hidden fields stay blank, the return link stays hidden, and no prefill
  // fetch fires.
  const workflowSearchParams = new URLSearchParams(location.search);
  const workflowContext = {
    transactionNo: workflowSearchParams.get("transactionNo") || "",
    workflowTemplateId: workflowSearchParams.get("workflowTemplateId") || "",
    workflowStepId: workflowSearchParams.get("workflowStepId") || "",
    returnTo: workflowSearchParams.get("returnTo") || "",
    // Present only when this page was opened via start-document for a
    // substitute_receipt step whose *snapshotted* workflow template declared
    // a receiptType (see handleWorkflowTransactionStartDocument in
    // local-server.mjs and buildWorkflowStepOpenUrl). The type controls whether
    // stock receiving applies; native "completed" alone unlocks the next
    // workflow step. Once the workflow has declared the type for this step it
    // must not be changeable from this form. Absent (both
    // for standalone use and for a workflow step whose template never
    // declared one), the field stays exactly as free as it always was.
    receiptType: workflowSearchParams.get("receiptType") || "",
  };
  const receiptTypeWorkflowNote = document.querySelector("#receiptTypeWorkflowNote");
  const workflowReturnLink = document.querySelector("#workflowReturnLink");

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

  function showReloadSavedReceipt(show) {
    if (reloadSavedReceiptButton) reloadSavedReceiptButton.hidden = !show;
  }

  async function reloadSavedReceipt() {
    if (!state.receiptNo || !reloadSavedReceiptButton) return;
    reloadSavedReceiptButton.disabled = true;
    try {
      await loadReceipt(state.receiptNo);
      showReloadSavedReceipt(false);
    } catch (error) {
      setStatus("บันทึกสำเร็จแต่โหลดรายละเอียดไม่สำเร็จ; กดโหลดซ้ำ", "error");
      showReloadSavedReceipt(true);
    } finally {
      reloadSavedReceiptButton.disabled = false;
    }
  }

  function renderLegacyEvidence(filesByKey = {}, rawFiles = []) {
    if (!legacyEvidenceLinks) return;
    const files = [...Object.values(filesByKey).flat(), ...(Array.isArray(rawFiles) ? rawFiles : [])].filter((file) => file && file.url);
    legacyEvidenceLinks.hidden = !files.length;
    legacyEvidenceLinks.innerHTML = files.length
      ? `ไฟล์แนบแบบร่างเก่า: ${files.map((file) => `<a href="${escapeHtml(file.url)}" target="_blank" rel="noreferrer">${escapeHtml(file.storedName || file.originalName || "ดาวน์โหลด")}</a>`).join(" · ")}`
      : "";
  }

  async function api(route, options = {}) {
    const response = await fetch(route, options);
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "บันทึกข้อมูลไม่สำเร็จ");
    return result;
  }

  function adoptAuthoritativeStatus(result) {
    if (!Object.prototype.hasOwnProperty.call(result, "status")) {
      throw new Error("เซิร์ฟเวอร์ส่งสถานะเอกสารไม่ครบถ้วน");
    }
    return lifecycleLogic.normalizeDocumentStatus("substitute_receipt", result.status);
  }

  function adoptExpectedStatus(result, expectedStatus) {
    const status = adoptAuthoritativeStatus(result);
    if (status !== expectedStatus) {
      throw new Error("เซิร์ฟเวอร์ส่งสถานะเอกสารไม่ถูกต้อง");
    }
    return status;
  }

  function setMutationControlsDisabled(disabled) {
    [saveDraftButton, submitForApprovalButton, approveReceiptButton, receiveStockButton, completeReceiptButton, confirmReceiveBeforeCompleteButton, declineReceiveBeforeCompleteButton, reloadSavedReceiptButton, form.querySelector("button[type=reset]")]
      .forEach((button) => { if (button) button.disabled = disabled; });
  }

  function setLegacyReadOnly(readOnly) {
    state.legacyReadOnly = !!readOnly;
    const controls = [addLineButton, saveDraftButton, submitForApprovalButton, approveReceiptButton, receiveStockButton, completeReceiptButton, confirmReceiveBeforeCompleteButton, ...form.querySelectorAll("input, select, textarea")];
    controls.forEach((control) => { if (control) control.disabled = state.legacyReadOnly || state.mutationInFlight; });
  }

  function applyRecordFieldLock() {
    const locked = state.legacyReadOnly || state.status !== "draft" || state.mutationInFlight;
    form.querySelectorAll("input, select, textarea").forEach((control) => { control.disabled = locked; });
    addLineButton.disabled = locked;
  }

  function replaceReceiptUrl(receiptNo) {
    if (window.history?.replaceState) {
      const params = new URLSearchParams({ receiptNo });
      for (const key of ["transactionNo", "workflowTemplateId", "workflowStepId", "returnTo"]) if (workflowContext[key]) params.set(key, workflowContext[key]);
      window.history.replaceState({}, "", `?${params}`);
    }
  }

  async function runMutation(work, { allowWhileModalOpen = false } = {}) {
    if (state.mutationInFlight || (state.modalOpen && !allowWhileModalOpen)) return;
    state.mutationInFlight = true;
    setMutationControlsDisabled(true);
    form.querySelectorAll("input, select, textarea, button").forEach((control) => { control.disabled = true; });
    try {
      await work();
    } finally {
      state.mutationInFlight = false;
      setReceiptState(state.status);
    }
  }

  function closeStockBeforeCompleteDialog() {
    if (!state.modalOpen) return;
    state.modalOpen = false;
    stockBeforeCompleteDialog.hidden = true;
    completeReceiptButton.focus();
  }

  function openStockBeforeCompleteDialog() {
    if (state.mutationInFlight || state.modalOpen) return;
    state.modalOpen = true;
    stockBeforeCompleteDialog.hidden = false;
    confirmReceiveBeforeCompleteButton.focus();
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
    window.SearchableSelect?.enhance(select);
  }

  function vendorLabel(vendor) {
    return vendor.taxId ? `${vendor.name} (${vendor.taxId})` : vendor.name;
  }

  function renderVendorOptions() {
    if (!vendorPresetSelect) return;
    vendorPresetSelect.replaceChildren(
      option("กรอกเอง / ไม่ใช้ preset", ""),
      ...state.vendors.map((vendor) => option(vendorLabel(vendor), vendor.id)),
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
    return state.legacyReadOnly || state.mutationInFlight || state.status !== "draft";
  }

  function applyStockLineLock() {
    const locked = stockLinesLocked();
    addLineButton.disabled = locked;
    // A workflow-declared receiptType (see workflowContext.receiptType
    // above) stays locked regardless of the receipt's own approved/received
    // status -- it must never be re-enabled just because the document is
    // still a fresh draft.
    form.elements.receiptType.disabled = locked || !!workflowContext.receiptType;
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
    lineItems.querySelectorAll(".stock-line").forEach((row) => {
      const stockField = row.querySelector("[data-stock-only-field]");
      const select = row.querySelector('select[name="stockSkuId"]');
      const skuInput = row.querySelector('input[name="sku"]');
      const descriptionLabel = row.querySelector("[data-description-label]");
      const amountLabel = row.querySelector("[data-amount-label]");

      if (stockField) stockField.hidden = !isStockPurchase;
      if (descriptionLabel) descriptionLabel.textContent = isStockPurchase ? "รายละเอียด" : "รายละเอียดค่าใช้จ่าย *";
      if (amountLabel) amountLabel.textContent = isStockPurchase ? "ต้นทุน/หน่วย *" : "ราคา/หน่วย *";
      if (select) {
        select.required = isStockPurchase;
        if (!isStockPurchase) select.value = "";
      }
      if (!isStockPurchase && skuInput) skuInput.value = "";
    });
    applyStockLineLock();
  }

  function availableActions() {
    return lifecycleLogic.availableDocumentActions("substitute_receipt", state.status, {
      receiptType: form.elements.receiptType.value,
    });
  }

  function setReceiptState(status) {
    state.status = lifecycleLogic.normalizeDocumentStatus("substitute_receipt", status || "draft");
    const actions = availableActions();
    receiptStatus.textContent = lifecycleLogic.DOCUMENT_STATUS_LABELS[state.status];
    saveDraftButton.hidden = state.status !== "draft" || state.legacyReadOnly;
    submitForApprovalButton.hidden = state.legacyReadOnly || !actions.includes("submit");
    approveReceiptButton.hidden = !actions.includes("approve");
    receiveStockButton.hidden = !actions.includes("receive_stock");
    completeReceiptButton.hidden = !actions.includes("complete");
    setMutationControlsDisabled(state.mutationInFlight || state.legacyReadOnly);
    applyRecordFieldLock();
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

  function collectLineRows() {
    const isStockPurchase = form.elements.receiptType.value === "stock_purchase";
    return [...lineItems.querySelectorAll(".stock-line")].map((row) => {
      const select = row.querySelector('select[name="stockSkuId"]');
      const selected = select.selectedOptions[0];
      return {
        stockSkuId: isStockPurchase ? select.value : "",
        sku: isStockPurchase ? row.querySelector('input[name="sku"]').value || selected?.dataset.sku || "" : "",
        description: row.querySelector('input[name="description"]').value || selected?.dataset.description || "",
        quantity: row.querySelector('input[name="quantity"]').value,
        unitCost: row.querySelector('input[name="unitCost"]').value,
      };
    });
  }

  function collectLines() {
    return collectLineRows().filter((line) => line.stockSkuId || line.description || line.quantity || line.unitCost);
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
      vendorId: form.dataset.vendorId || "",
      vendorSnapshot: (() => { try { return JSON.parse(form.dataset.vendorSnapshot || "null") || undefined; } catch { return undefined; } })(),
      paymentChannel: form.elements.paymentChannel.value,
      paymentReference: form.elements.paymentReference.value,
      paymentNote: form.elements.paymentNote.value,
      businessPurpose: form.elements.businessPurpose.value,
      transactionNo: form.elements.transactionNo.value,
      workflowTemplateId: form.elements.workflowTemplateId.value,
      workflowStepId: form.elements.workflowStepId.value,
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

  function updateStockLineSummaries(lines) {
    [...lineItems.querySelectorAll(".stock-line")].forEach((row, index) => {
      const line = lines[index] || {};
      const titleText = [line.sku, line.description].filter(Boolean).join(" - ");
      const lineTotal = toNumber(line.quantity) * toNumber(line.unitCost);
      const title = row.querySelector("[data-stock-line-title]");
      const total = row.querySelector("[data-stock-line-total]");
      if (title) title.textContent = `รายการ ${index + 1} - ${titleText || "ยังไม่ได้กรอก"}`;
      if (total) total.textContent = `${money(lineTotal)} บาท`;
    });
  }

  function updatePreview() {
    const lineRows = collectLineRows();
    const lines = lineRows.filter((line) => line.stockSkuId || line.description || line.quantity || line.unitCost);
    const total = lines.reduce((sum, line) => sum + (toNumber(line.quantity) * toNumber(line.unitCost)), 0);
    const evidenceCount = evidenceKeys.reduce((sum, key) => {
      const input = form.querySelector(`[name="evidence_${key}"]`);
      const existing = Array.isArray(state.existingEvidenceFiles[key]) ? state.existingEvidenceFiles[key].length : 0;
      return sum + existing + (input?.files?.length || 0);
    }, 0);

    updateStockLineSummaries(lineRows);
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

  async function refreshVendors() {
    if (vendorPicker) {
      state.vendors = await vendorPicker.load();
      // Keep the legacy route as a compatibility fallback for older local data.
      if (!state.vendors.length) {
        try {
          const legacy = await api("/api/substitute-receipt-vendors");
          state.vendors = (legacy.vendors || []).filter((vendor) => vendor.status === "active");
          renderVendorOptions();
        } catch {
          // The shared picker already left the form usable for document-only entry.
        }
      }
      return;
    }
    const { vendors } = await api("/api/vendors");
    state.vendors = (vendors || []).filter((vendor) => vendor.status === "active");
    renderVendorOptions();
  }

  function applyVendorPreset(vendorId) {
    const vendor = state.vendors.find((item) => item.id === vendorId);
    if (!vendor) return;
    form.elements.payeeName.value = vendor.name || "";
    form.elements.payeeTaxId.value = vendor.taxId || "";
    form.elements.paymentChannel.value = vendor.paymentChannel || "โอนผ่านบัญชีบริษัท";
    form.elements.paymentReference.value = vendor.paymentReference || "";
    if (vendor.defaultBusinessPurpose) {
      form.elements.businessPurpose.value = vendor.defaultBusinessPurpose;
    }
    updatePreview();
  }

  function applyWorkflowHiddenFields() {
    form.elements.transactionNo.value = workflowContext.transactionNo;
    form.elements.workflowTemplateId.value = workflowContext.workflowTemplateId;
    form.elements.workflowStepId.value = workflowContext.workflowStepId;
  }

  function applyWorkflowReturnLink() {
    const safeReturnTo = window.sanitizeWorkflowReturnTo(workflowContext.returnTo);
    if (safeReturnTo && workflowReturnLink) {
      workflowReturnLink.href = safeReturnTo;
      workflowReturnLink.hidden = false;
    }
  }

  // Cross-document prefill (Task 4/Task 6/Task 7, Item 4 followup): the
  // fetch/render/apply/badge mechanics are shared with
  // forms/workflow-document.logic.browser.js and forms/expense-request.html
  // via forms/workflow-prefill-banner.browser.js. Only this form's own field
  // names differ per group. substitute_receipt has no requester field at
  // all, so `fields.parties` is omitted -- the shared controller then never
  // has a parties field to apply here.
  const workflowPrefillBanner = window.WorkflowPrefillBanner.create({
    documentKind: "substitute_receipt",
    transactionNo: workflowContext.transactionNo,
    workflowStepId: workflowContext.workflowStepId,
    form,
    fields: {
      payee: ["payeeName", "payeeTaxId"],
      purpose: ["receiptTitle", "businessPurpose"],
    },
    applyLines(lines) {
      lineItems.replaceChildren();
      for (const line of lines) addStockLine(line);
    },
    onApplied: () => updatePreview(),
  });

  function applyWorkflowReceiptTypeLock() {
    if (!workflowContext.receiptType) return;
    form.elements.receiptType.value = workflowContext.receiptType;
    form.elements.receiptType.disabled = true;
    if (receiptTypeWorkflowNote) receiptTypeWorkflowNote.hidden = false;
  }

  function fillForm(payload = {}) {
    form.elements.accountingMonth.value = payload.accountingMonth || currentMonthValue();
    form.elements.receiptDate.value = payload.receiptDate || todayInputValue();
    form.elements.receiptType.disabled = false;
    form.elements.receiptType.value = payload.receiptType || "stock_purchase";
    // Overrides the value/disabled state above when this page was opened
    // from a workflow step that declared a receiptType -- the workflow's
    // decision always wins over whatever a reloaded draft/receipt payload
    // carries. A no-op for standalone use and for a workflow step whose
    // template never declared one (workflowContext.receiptType is "").
    applyWorkflowReceiptTypeLock();
    form.elements.receiptTitle.value = payload.receiptTitle || "";
    form.elements.payeeName.value = payload.payeeName || "";
    if (payload.vendorId) form.dataset.vendorId = payload.vendorId; else delete form.dataset.vendorId;
    if (payload.vendorSnapshot) form.dataset.vendorSnapshot = JSON.stringify(payload.vendorSnapshot); else delete form.dataset.vendorSnapshot;
    form.elements.payeeTaxId.value = payload.payeeTaxId || "";
    form.elements.paymentChannel.value = payload.paymentChannel || "โอนผ่านบัญชีบริษัท";
    form.elements.paymentReference.value = payload.paymentReference || "";
    form.elements.paymentNote.value = payload.paymentNote || "";
    form.elements.businessPurpose.value = payload.businessPurpose || "ซื้อสินค้าเพื่อขาย";
    if (vendorPresetSelect) vendorPresetSelect.value = "";
    // A draft/receipt saved earlier from within a workflow already carries
    // its own transactionNo/workflowTemplateId/workflowStepId; preserve
    // those on reload even if this particular URL no longer carries the
    // query params (e.g. opened again later from a plain list link).
    workflowContext.transactionNo = payload.transactionNo || workflowContext.transactionNo;
    workflowContext.workflowTemplateId = payload.workflowTemplateId || workflowContext.workflowTemplateId;
    workflowContext.workflowStepId = payload.workflowStepId || workflowContext.workflowStepId;
    applyWorkflowHiddenFields();
    state.existingEvidenceFiles = payload.evidenceFiles || {};
    lineItems.replaceChildren();
    const lines = Array.isArray(payload.lines) && payload.lines.length ? payload.lines : [{}];
    for (const line of lines) addStockLine(line);
    setReceiptState(payload.status || state.status || "draft");
    updatePreview();
  }

  async function loadDraft(draftId) {
    const draft = await api(`/api/substitute-receipt-drafts/${encodeURIComponent(draftId)}`);
    if (draft.legacyReadOnly !== true) throw new Error("ข้อมูลแบบร่างเก่าไม่ครบถ้วน");
    state.draftId = draft.draftId;
    state.legacyReadOnly = true;
    state.receiptNo = "";
    state.status = "draft";
    fillForm({
      ...(draft.payload || {}),
      status: "draft",
      evidenceFiles: draft.evidenceFiles || draft.payload?.evidenceFiles || {},
    });
    renderLegacyEvidence(draft.evidenceFiles || draft.payload?.evidenceFiles || {}, draft.rawFiles || []);
    setLegacyReadOnly(true);
    setStatus(`โหลดแบบร่าง ${escapeHtml(draft.draftId)} แล้ว`, "success");
  }

  async function loadReceipt(receiptNo) {
    const receipt = await api(`/api/substitute-receipts/${encodeURIComponent(receiptNo)}`);
    const payload = receipt.payload || {};
    state.draftId = "";
    state.legacyReadOnly = false;
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
    if (state.legacyReadOnly || state.status !== "draft") throw new Error("เอกสารนี้ไม่อยู่ในสถานะแบบร่าง");
    clearStatus();
    const payload = collectPayload();
    delete payload.draftId;
    const result = await api("/api/substitute-receipt-drafts", {
      method: "POST",
      body: buildMultipartPayload(payload),
    });
    if (!/^SR-\d{4}-(0[1-9]|1[0-2])-\d{4}$/.test(String(result.receiptNo || "")) || (state.receiptNo && result.receiptNo !== state.receiptNo) || result.status !== "draft") throw new Error("เซิร์ฟเวอร์ส่งข้อมูลเอกสารไม่ถูกต้อง");
    if (!result.evidenceFiles || typeof result.evidenceFiles !== "object" || !Array.isArray(result.rawFiles) || (result.pdfFiles !== undefined && !Array.isArray(result.pdfFiles))) throw new Error("เซิร์ฟเวอร์ส่งข้อมูลเอกสารไม่ครบถ้วน");
    state.receiptNo = result.receiptNo;
    let vendorPresetError = "";
    try { await vendorPicker?.saveVendorPresetIfRequested(); } catch (error) { vendorPresetError = `บันทึกเอกสารแล้ว แต่บันทึกผู้ขายไม่สำเร็จ: ${error.message}`; }
    state.status = "draft";
    state.existingEvidenceFiles = result.evidenceFiles;
    for (const key of evidenceKeys) form.querySelector(`[name="evidence_${key}"]`).value = "";
    replaceReceiptUrl(state.receiptNo);
    setReceiptState(state.status);
    try {
      await loadReceipt(result.receiptNo);
      showReloadSavedReceipt(false);
    } catch (error) {
      setStatus("บันทึกสำเร็จแต่โหลดรายละเอียดไม่สำเร็จ; กดโหลดซ้ำ", "error");
      showReloadSavedReceipt(true);
      return;
    }
    setReceiptState("draft");
    setStatus(vendorPresetError || `บันทึกแบบร่าง ${escapeHtml(result.receiptNo)} แล้ว`, vendorPresetError ? "error" : "success");
  }

  async function submitForApproval() {
    if (state.legacyReadOnly || state.status !== "draft") throw new Error("เอกสารนี้ไม่อยู่ในสถานะแบบร่าง");
    clearStatus();
    const payload = collectPayload();
    delete payload.draftId;
    const errors = logic.validateSubstituteReceipt(payload);
    if (errors.length) throw new Error(errors.join("\n"));

    const result = await api("/api/substitute-receipts", {
      method: "POST",
      body: buildMultipartPayload(payload),
    });
    const status = adoptExpectedStatus(result, "pending_approval");

    if (!/^SR-\d{4}-(0[1-9]|1[0-2])-\d{4}$/.test(String(result.receiptNo || "")) || (result.receiptNo !== state.receiptNo && state.receiptNo)) throw new Error("เซิร์ฟเวอร์ส่งเลขเอกสารไม่ตรงกัน");
    if (!result.evidenceFiles || typeof result.evidenceFiles !== "object" || !Array.isArray(result.rawFiles) || !Array.isArray(result.pdfFiles)) throw new Error("เซิร์ฟเวอร์ส่งข้อมูลเอกสารไม่ครบถ้วน");
    state.receiptNo = result.receiptNo;
    let vendorPresetError = "";
    try { await vendorPicker?.saveVendorPresetIfRequested(); } catch (error) { vendorPresetError = `บันทึกเอกสารแล้ว แต่บันทึกผู้ขายไม่สำเร็จ: ${error.message}`; }
    state.status = status;
    state.existingEvidenceFiles = result.evidenceFiles;
    for (const key of evidenceKeys) form.querySelector(`[name="evidence_${key}"]`).value = "";
    replaceReceiptUrl(state.receiptNo);
    setReceiptState(state.status);
    try {
      await loadReceipt(result.receiptNo);
      showReloadSavedReceipt(false);
    } catch (error) {
      setStatus("บันทึกสำเร็จแต่โหลดรายละเอียดไม่สำเร็จ; กดโหลดซ้ำ", "error");
      showReloadSavedReceipt(true);
      return;
    }
    setReceiptState(state.status);
    setStatus(vendorPresetError || `ส่งตรวจอนุมัติ ${escapeHtml(result.receiptNo)} แล้ว\nPDF ${result.pdfFiles.length} ไฟล์, raw ${result.rawFiles.length} ไฟล์`, vendorPresetError ? "error" : "success");
  }

  async function approveReceipt() {
    if (!state.receiptNo) return;
    clearStatus();
    const result = await api(`/api/substitute-receipts/${encodeURIComponent(state.receiptNo)}/approve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ approvedBy: "" }),
    });
    state.status = adoptExpectedStatus(result, "approved");
    setReceiptState(state.status);
    setStatus(`อนุมัติ ${escapeHtml(state.receiptNo)} แล้ว`, "success");
  }

  async function receiveStock({ closeDialogAfterSuccess = false } = {}) {
    if (!state.receiptNo) return;
    const receivedDate = window.prompt("วันที่รับสินค้า", todayInputValue());
    if (!receivedDate) return;
    clearStatus();
    const result = await api(`/api/substitute-receipts/${encodeURIComponent(state.receiptNo)}/receive-stock`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ receivedDate, receivedBy: "" }),
    });
    state.status = adoptExpectedStatus(result, "received");
    setReceiptState(state.status);
    setStatus(`รับสินค้าเข้าคลัง ${escapeHtml(state.receiptNo)} แล้ว ${(result.stockMovements || []).length} รายการ`, "success");
    if (closeDialogAfterSuccess) closeStockBeforeCompleteDialog();
  }

  async function completeReceipt() {
    if (!state.receiptNo) return;
    clearStatus();
    const result = await api(`/api/substitute-receipts/${encodeURIComponent(state.receiptNo)}/complete`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ completedBy: "" }),
    });
    state.status = adoptExpectedStatus(result, "completed");
    setReceiptState(state.status);
    setStatus(`เสร็จสิ้นเอกสาร ${escapeHtml(state.receiptNo)} แล้ว`, "success");
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

  addLineButton.addEventListener("click", () => { if (!state.legacyReadOnly && state.status === "draft" && !state.mutationInFlight) addStockLine(); });
  saveDraftButton.addEventListener("click", () => runMutation(saveDraft).catch((error) => setStatus(error.message, "error")));
  reloadSavedReceiptButton?.addEventListener("click", reloadSavedReceipt);
  approveReceiptButton.addEventListener("click", () => runMutation(approveReceipt).catch((error) => setStatus(error.message, "error")));
  receiveStockButton.addEventListener("click", () => runMutation(receiveStock).catch((error) => setStatus(error.message, "error")));
  completeReceiptButton.addEventListener("click", () => {
    if (state.status === "approved" && form.elements.receiptType.value === "stock_purchase") {
      openStockBeforeCompleteDialog();
      return;
    }
    runMutation(completeReceipt).catch((error) => setStatus(error.message, "error"));
  });
  confirmReceiveBeforeCompleteButton.addEventListener("click", () => {
    runMutation(() => receiveStock({ closeDialogAfterSuccess: true }), { allowWhileModalOpen: true })
      .catch((error) => setStatus(error.message, "error"));
  });
  declineReceiveBeforeCompleteButton.addEventListener("click", closeStockBeforeCompleteDialog);
  stockBeforeCompleteDialog.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeStockBeforeCompleteDialog();
      return;
    }
    if (event.key !== "Tab") return;
    event.preventDefault();
    if (event.shiftKey) {
      (document.activeElement === confirmReceiveBeforeCompleteButton
        ? declineReceiveBeforeCompleteButton
        : confirmReceiveBeforeCompleteButton).focus();
    } else {
      (document.activeElement === declineReceiveBeforeCompleteButton
        ? confirmReceiveBeforeCompleteButton
        : declineReceiveBeforeCompleteButton).focus();
    }
  });
  form.elements.accountingMonth.addEventListener("change", () => refreshNextReceipt().catch((error) => setStatus(error.message, "error")));
  form.elements.receiptType.addEventListener("change", () => {
    applyReceiptTypeState();
    updatePreview();
  });
  vendorPresetSelect?.addEventListener("change", () => applyVendorPreset(vendorPresetSelect.value));
  form.addEventListener("input", updatePreview);
  form.addEventListener("change", updatePreview);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    runMutation(submitForApproval).catch((error) => setStatus(error.message, "error"));
  });
  form.addEventListener("reset", (event) => {
    if (state.modalOpen || state.mutationInFlight || state.legacyReadOnly || state.status !== "draft") {
      event.preventDefault();
      return;
    }
    setTimeout(resetFormState);
  });

  applyWorkflowHiddenFields();
  applyWorkflowReturnLink();

  fillForm();
  Promise.all([refreshStockSkus(), refreshVendors(), refreshNextReceipt()])
    .then(async () => {
      if (queryDraftId) {
        await loadDraft(queryDraftId);
      } else if (queryReceiptNo) {
        await loadReceipt(queryReceiptNo);
      } else {
        // Only fetch cross-document prefill for a brand-new, never-saved
        // document: an existing draft/receipt already has its own real
        // data, so offering to overwrite it with an earlier document's data
        // would be wrong.
        workflowPrefillBanner.load();
      }
      updatePreview();
    })
    .catch((error) => setStatus(error.message, "error"));
});
