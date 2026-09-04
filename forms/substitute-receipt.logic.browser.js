window.addEventListener("DOMContentLoaded", () => {
  const logic = window.SubstituteReceiptLogic;
  const evidenceKeys = ["paymentSlip", "purchaseOrder", "goodsReceived", "otherEvidence"];
  const state = {
    stockSkus: [],
    nextReceipt: null,
  };

  const form = document.querySelector("#substituteReceiptForm");
  const statusBox = document.querySelector("#substituteReceiptStatus");
  const lineItems = document.querySelector("#stockLineItems");
  const lineTemplate = document.querySelector("#stockLineTemplate");
  const addLineButton = document.querySelector("#addStockLine");
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

  function applyReceiptTypeState() {
    const isStockPurchase = form.elements.receiptType.value === "stock_purchase";
    stockReceiptNotice.style.display = isStockPurchase ? "block" : "none";
    lineItems.querySelectorAll('select[name="stockSkuId"]').forEach((select) => {
      select.required = isStockPurchase;
    });
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
      const files = [...(input?.files || [])].map((file, index) => ({
        evidenceKey: key,
        originalName: file.name,
        storedName: logic.buildSubstituteReceiptRawFileName(key, file.name, index),
        size: file.size,
        type: file.type || "application/octet-stream",
      }));
      return [key, files];
    }));
  }

  function collectPayload() {
    return {
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
      return sum + (input?.files?.length || 0);
    }, 0);

    receiptNoPreview.textContent = state.nextReceipt?.receiptNo || "-";
    lineCountPreview.textContent = String(lines.length);
    totalAmountPreview.textContent = money(total);
    evidenceCountPreview.textContent = String(evidenceCount);
  }

  async function refreshNextReceipt() {
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

  addLineButton.addEventListener("click", () => addStockLine());
  form.elements.accountingMonth.addEventListener("change", () => refreshNextReceipt().catch((error) => setStatus(error.message, "error")));
  form.elements.receiptType.addEventListener("change", () => {
    applyReceiptTypeState();
    updatePreview();
  });
  form.addEventListener("input", updatePreview);
  form.addEventListener("change", updatePreview);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearStatus();
    try {
      const payload = collectPayload();
      const errors = logic.validateSubstituteReceipt(payload);
      if (errors.length) throw new Error(errors.join("\n"));

      const body = new FormData();
      body.append("payload", JSON.stringify(payload));
      appendUploads(body);

      const result = await api("/api/substitute-receipts", {
        method: "POST",
        body,
      });

      form.reset();
      form.elements.accountingMonth.value = currentMonthValue();
      form.elements.receiptDate.value = todayInputValue();
      form.elements.receiptType.value = "stock_purchase";
      form.elements.paymentChannel.value = "โอนผ่านบัญชีบริษัท";
      form.elements.businessPurpose.value = "ซื้อสินค้าเพื่อขาย";
      lineItems.replaceChildren();
      addStockLine();
      await refreshNextReceipt();
      setStatus(
        `บันทึก ${escapeHtml(result.receiptNo)} แล้ว\nPDF ${result.pdfFiles.length} ไฟล์, raw ${result.rawFiles.length} ไฟล์, รับเข้าคลัง ${result.stockMovements.length} รายการ`,
        "success",
      );
    } catch (error) {
      setStatus(error.message, "error");
    }
  });

  form.addEventListener("reset", () => {
    setTimeout(() => {
      form.elements.accountingMonth.value = currentMonthValue();
      form.elements.receiptDate.value = todayInputValue();
      form.elements.receiptType.value = "stock_purchase";
      form.elements.paymentChannel.value = "โอนผ่านบัญชีบริษัท";
      form.elements.businessPurpose.value = "ซื้อสินค้าเพื่อขาย";
      lineItems.replaceChildren();
      addStockLine();
      refreshNextReceipt().catch((error) => setStatus(error.message, "error"));
      clearStatus();
    });
  });

  form.elements.accountingMonth.value = currentMonthValue();
  form.elements.receiptDate.value = todayInputValue();
  addStockLine();
  Promise.all([refreshStockSkus(), refreshNextReceipt()])
    .then(updatePreview)
    .catch((error) => setStatus(error.message, "error"));
});
