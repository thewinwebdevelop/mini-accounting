window.addEventListener("DOMContentLoaded", () => {
  const fileNode = document.querySelector("#shopeeCustomLabelFile");
  const uploadButton = document.querySelector("#uploadShopeeCustomLabelButton");
  const pageNode = document.querySelector("#shopeeCustomLabelPages");
  const itemsNode = document.querySelector("#shopeeCustomLabelItems");
  const statusNode = document.querySelector("#shopeeCustomLabelStatus");
  const progressNode = document.querySelector("#shopeeCustomLabelProgress");
  const fileInfoNode = document.querySelector("#shopeeCustomLabelFileInfo");
  const saveButton = document.querySelector("#saveShopeeCustomLabelButton");
  const downloadButton = document.querySelector("#downloadShopeeCustomLabelButton");
  const printButton = document.querySelector("#printShopeeCustomLabelButton");
  const comparisonButton = document.querySelector("#openShopeeCustomLabelComparisonButton");
  const state = { job: null, entries: new Map(), currentPage: 1 };

  const escapeHtml = (value) => String(value ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  const api = async (route, options = {}) => {
    const request = { ...options, headers: { ...(options.headers || {}) } };
    if (request.body && !(request.body instanceof FormData) && typeof request.body !== "string") {
      request.headers["content-type"] = "application/json";
      request.body = JSON.stringify(request.body);
    }
    const response = await fetch(route, request);
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "ดำเนินการ custom label ไม่สำเร็จ");
    return result;
  };
  const setStatus = (message, kind = "") => {
    statusNode.textContent = message;
    statusNode.className = `status-box active ${kind}`;
  };
  const clearStatus = () => { statusNode.textContent = ""; statusNode.className = "status-box"; };
  const pageKey = (pageNumber, itemIndex) => `${pageNumber}:${itemIndex}`;
  const currentPage = () => state.job?.pages?.find((page) => Number(page.pageNumber) === Number(state.currentPage));
  const normalizeText = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
  const mappingKey = (productName, optionName) => `${normalizeText(productName)}::${normalizeText(optionName)}`;
  const downloadUrlFor = (job) => {
    if (!job?.outputUrl || !job.id) return "";
    return job.downloadUrl || `/api/shopee/custom-labels/${encodeURIComponent(job.id)}/download`;
  };

  function entryFor(page, itemIndex) {
    return state.entries.get(pageKey(page.pageNumber, itemIndex));
  }

  function initializeJob(job) {
    state.job = job;
    state.currentPage = Number(job.pages?.[0]?.pageNumber || 1);
    state.entries.clear();
    for (const page of job.pages || []) {
      (page.items || []).forEach((item, index) => {
        const saved = job.autofillMappings?.[item.mappingKey];
        const bundle = Array.isArray(saved) && saved.length
          ? saved.map((row) => ({ sku: row.sku || "", quantity: row.quantity || 1 }))
          : [{ sku: "", quantity: 1 }];
        state.entries.set(pageKey(page.pageNumber, index), {
          productName: item.productName || "",
          optionName: item.optionName || "",
          quantity: item.quantity || 1,
          bundle,
        });
      });
    }
    fileInfoNode.textContent = `${job.originalFileName || "ไฟล์ PDF"} — ${job.pageCount} หน้า`;
    pageNode.disabled = false;
    downloadButton.hidden = true;
    printButton.hidden = true;
    comparisonButton.hidden = false;
    renderPageOptions();
    renderItems();
    updateActions();
  }

  function renderPageOptions() {
    if (!state.job) {
      pageNode.replaceChildren(new Option("อัปโหลดไฟล์ก่อน", ""));
      pageNode.disabled = true;
      progressNode.textContent = "";
      return;
    }
    pageNode.replaceChildren(...(state.job.pages || []).map((page) => {
      const option = new Option(`หน้า ${page.pageNumber} — ${page.orderNo || "อ่านเลขออเดอร์ไม่ได้"}`, page.pageNumber);
      option.selected = Number(page.pageNumber) === Number(state.currentPage);
      return option;
    }));
    const totalItems = (state.job.pages || []).reduce((sum, page) => sum + (page.items || []).length, 0);
    progressNode.textContent = `${state.job.pageCount} หน้า / ${totalItems} รายการสินค้า`;
  }

  function renderBundleRows(entry, pageNumber, itemIndex) {
    return entry.bundle.map((row, bundleIndex) => `<div class="custom-label-bundle-row" data-custom-label-bundle="${pageKey(pageNumber, itemIndex)}:${bundleIndex}">
      <input data-custom-label-sku="${pageKey(pageNumber, itemIndex)}:${bundleIndex}" value="${escapeHtml(row.sku)}" placeholder="เช่น TOP-BLUE" aria-label="Manual SKU">
      <input data-custom-label-quantity="${pageKey(pageNumber, itemIndex)}:${bundleIndex}" type="number" min="1" step="1" value="${escapeHtml(row.quantity)}" aria-label="จำนวน Manual SKU">
      <button class="button secondary small" type="button" data-custom-label-remove="${pageKey(pageNumber, itemIndex)}:${bundleIndex}" aria-label="ลบ Manual SKU">ลบ</button>
    </div>`).join("");
  }

  function renderItems() {
    const page = currentPage();
    if (!page) {
      itemsNode.innerHTML = `<div class="empty-state">อัปโหลด PDF เพื่อเริ่มกรอกข้อมูล</div>`;
      return;
    }
    itemsNode.innerHTML = (page.items || []).map((item, itemIndex) => {
      const entry = entryFor(page, itemIndex);
      const itemId = pageKey(page.pageNumber, itemIndex);
      const warning = page.status === "needs_review" || item.status === "needs_review"
        ? `<div class="custom-label-warning">กรุณาตรวจสอบข้อมูลที่อ่านจาก PDF แล้วแก้ชื่อ/ตัวเลือก/จำนวนให้ถูกต้อง</div>` : "";
      return `<article class="custom-label-item-card" data-custom-label-item="${itemId}">
        <div class="custom-label-item-heading"><strong>รายการที่ ${escapeHtml(item.lineNo || itemIndex + 1)}</strong><span class="muted">จำนวนจาก PDF: ${escapeHtml(item.quantity)}</span></div>
        ${warning}
        <div class="custom-label-product-fields">
          <label class="field"><span>ชื่อสินค้า</span><input data-custom-label-product="${itemId}" value="${escapeHtml(entry.productName)}"></label>
          <label class="field"><span>ตัวเลือกสินค้า</span><input data-custom-label-option="${itemId}" value="${escapeHtml(entry.optionName)}"></label>
          <label class="field"><span>จำนวนรายการ</span><input data-custom-label-item-quantity="${itemId}" type="number" min="1" step="1" value="${escapeHtml(entry.quantity)}"></label>
        </div>
        <div class="custom-label-bundle-editor"><div class="custom-label-bundle-title"><strong>Manual SKU bundle</strong><span class="muted">กรอกได้หลาย SKU และแต่ละ SKU มีจำนวนของตัวเอง</span></div>
          <div class="custom-label-bundle-rows">${renderBundleRows(entry, page.pageNumber, itemIndex)}</div>
          <button class="button secondary small" type="button" data-custom-label-add="${itemId}">+ เพิ่ม Manual SKU</button>
        </div>
      </article>`;
    }).join("") || `<div class="empty-state">หน้านี้ไม่พบรายการสินค้า</div>`;
  }

  function positiveInteger(value) {
    return /^[1-9]\d*$/.test(String(value ?? "").trim());
  }

  function buildPayload() {
    if (!state.job) throw new Error("อัปโหลด PDF ก่อน");
    const mappings = {};
    const pages = state.job.pages.map((page) => ({
      ...page,
      status: "parsed",
      errors: [],
      items: (page.items || []).map((item, itemIndex) => {
        const entry = entryFor(page, itemIndex);
        if (!normalizeText(entry.productName) || !normalizeText(entry.optionName)) {
          throw new Error(`หน้า ${page.pageNumber} รายการที่ ${item.lineNo || itemIndex + 1}: ชื่อสินค้าและตัวเลือกต้องไม่ว่าง`);
        }
        if (!positiveInteger(entry.quantity)) {
          throw new Error(`หน้า ${page.pageNumber} รายการที่ ${item.lineNo || itemIndex + 1}: จำนวนต้องเป็นจำนวนเต็มบวก`);
        }
        const bundle = entry.bundle.map((row) => {
          if (!normalizeText(row.sku)) throw new Error(`หน้า ${page.pageNumber} รายการที่ ${item.lineNo || itemIndex + 1}: SKU ต้องไม่ว่าง`);
          if (!positiveInteger(row.quantity)) throw new Error(`จำนวนของ ${row.sku || "SKU"} ต้องเป็นจำนวนเต็มบวก`);
          return { sku: normalizeText(row.sku), quantity: Number(row.quantity) };
        });
        const key = mappingKey(entry.productName, entry.optionName);
        mappings[key] = { productName: normalizeText(entry.productName), optionName: normalizeText(entry.optionName), bundle };
        return {
          ...item,
          productName: normalizeText(entry.productName),
          optionName: normalizeText(entry.optionName),
          quantity: Number(entry.quantity),
          mappingKey: key,
          status: "parsed",
        };
      }),
    }));
    return { mappings, parsedPayload: { pages } };
  }

  function updateActions() {
    let complete = false;
    try { buildPayload(); complete = true; } catch { complete = false; }
    saveButton.disabled = !state.job || !complete;
    comparisonButton.hidden = !state.job;
    comparisonButton.disabled = !state.job || !complete;
  }

  async function upload() {
    const file = fileNode.files?.[0];
    if (!file) throw new Error("เลือกไฟล์ PDF ก่อน");
    const body = new FormData();
    body.append("file", file, file.name);
    uploadButton.disabled = true;
    try {
      const result = await api("/api/shopee/custom-labels", { method: "POST", body });
      initializeJob(result.job);
      setStatus(`อ่าน PDF สำเร็จ ${result.job.pageCount} หน้า — ตรวจสอบรายการแล้วกรอก SKU ได้เลย`, "success");
    } finally {
      uploadButton.disabled = false;
    }
  }

  async function save() {
    const payload = buildPayload();
    saveButton.disabled = true;
    comparisonButton.disabled = true;
    try {
      const result = await api(`/api/shopee/custom-labels/${encodeURIComponent(state.job.id)}/save`, {
        method: "POST",
        body: payload,
      });
      state.job = result.job;
      downloadButton.hidden = !downloadUrlFor(state.job);
      printButton.hidden = !state.job.outputUrl;
      setStatus("บันทึก mapping และสร้าง PDF ใหม่เรียบร้อยแล้ว", "success");
    } finally {
      updateActions();
    }
  }

  async function openComparison() {
    const payload = buildPayload();
    const reviewWindow = window.open("about:blank", "_blank");
    if (reviewWindow) reviewWindow.opener = null;
    saveButton.disabled = true;
    comparisonButton.disabled = true;
    try {
      const result = await api(`/api/shopee/custom-labels/${encodeURIComponent(state.job.id)}/preview`, {
        method: "POST",
        body: payload,
      });
      state.job = result.job;
      const comparisonUrl = state.job.comparisonUrl;
      if (!comparisonUrl) throw new Error("สร้างไฟล์ PDF เทียบไม่สำเร็จ");
      setStatus("กำลังเปิด PDF เทียบซ้าย-ขวา...", "success");
      if (reviewWindow && !reviewWindow.closed) reviewWindow.location.href = comparisonUrl;
      else window.location.assign(comparisonUrl);
    } catch (error) {
      if (reviewWindow && !reviewWindow.closed) reviewWindow.close();
      throw error;
    } finally {
      updateActions();
    }
  }

  itemsNode.addEventListener("input", (event) => {
    const target = event.target;
    const token = target.dataset.customLabelSku || target.dataset.customLabelQuantity;
    if (token) {
      const [pageNumber, itemIndex, bundleIndex] = token.split(":").map(Number);
      const entry = state.entries.get(pageKey(pageNumber, itemIndex));
      if (entry) entry.bundle[bundleIndex][target.dataset.customLabelSku ? "sku" : "quantity"] = target.value;
    }
    const itemToken = target.dataset.customLabelProduct || target.dataset.customLabelOption || target.dataset.customLabelItemQuantity;
    if (itemToken) {
      const [pageNumber, itemIndex] = itemToken.split(":").map(Number);
      const entry = state.entries.get(pageKey(pageNumber, itemIndex));
      if (entry) {
        if (target.dataset.customLabelProduct) entry.productName = target.value;
        if (target.dataset.customLabelOption) entry.optionName = target.value;
        if (target.dataset.customLabelItemQuantity) entry.quantity = target.value;
      }
    }
    downloadButton.hidden = true;
    printButton.hidden = true;
    updateActions();
  });
  itemsNode.addEventListener("click", (event) => {
    const add = event.target.closest("[data-custom-label-add]");
    const remove = event.target.closest("[data-custom-label-remove]");
    if (add) {
      const [pageNumber, itemIndex] = add.dataset.customLabelAdd.split(":").map(Number);
      const entry = state.entries.get(pageKey(pageNumber, itemIndex));
      entry.bundle.push({ sku: "", quantity: 1 });
      renderItems();
      downloadButton.hidden = true;
      printButton.hidden = true;
      updateActions();
    }
    if (remove) {
      const [pageNumber, itemIndex, bundleIndex] = remove.dataset.customLabelRemove.split(":").map(Number);
      const entry = state.entries.get(pageKey(pageNumber, itemIndex));
      if (entry.bundle.length > 1) entry.bundle.splice(bundleIndex, 1);
      else entry.bundle[0] = { sku: "", quantity: 1 };
      renderItems();
      downloadButton.hidden = true;
      printButton.hidden = true;
      updateActions();
    }
  });
  pageNode.addEventListener("change", () => {
    state.currentPage = Number(pageNode.value);
    renderItems();
  });
  fileNode.addEventListener("change", () => { fileInfoNode.textContent = fileNode.files?.[0]?.name || "ยังไม่ได้เลือกไฟล์"; });
  uploadButton.addEventListener("click", () => upload().catch((error) => setStatus(error.message, "error")));
  saveButton.addEventListener("click", () => save().catch((error) => setStatus(error.message, "error")));
  comparisonButton.addEventListener("click", () => openComparison().catch((error) => setStatus(error.message, "error")));
  downloadButton.addEventListener("click", () => {
    const url = downloadUrlFor(state.job);
    if (!url) {
      setStatus("ไม่มีไฟล์ PDF สำหรับดาวน์โหลด กรุณากด Save และสร้าง PDF ก่อน", "error");
      return;
    }
    window.location.assign(url);
  });
  printButton.addEventListener("click", () => { if (state.job?.outputUrl) window.open(state.job.outputUrl, "_blank", "noopener"); });

  clearStatus();
  renderPageOptions();
  updateActions();
});
