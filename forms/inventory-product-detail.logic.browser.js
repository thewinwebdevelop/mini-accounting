window.addEventListener("DOMContentLoaded", () => {
  const state = {
    categories: [],
    detail: null,
    productId: new URLSearchParams(window.location.search).get("productId"),
  };

  const statusBox = document.querySelector("#productDetailStatus");
  const productForm = document.querySelector("#productDetailForm");
  const productImageForm = document.querySelector("#productImageForm");
  let productImagePreview = document.querySelector("#productImagePreview");
  const categorySelect = document.querySelector("#detailProductCategory");
  const skuRows = document.querySelector("#skuDetailRows");
  const movementRows = document.querySelector("#movementHistoryRows");

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function money(value) {
    return Number(String(value ?? "0").replace(/,/g, "") || 0).toLocaleString("th-TH", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  function formPayload(form) {
    return Object.fromEntries(new FormData(form).entries());
  }

  async function api(route, options = {}) {
    const bodyIsFormData = options.body instanceof FormData;
    const response = await fetch(route, {
      ...options,
      headers: {
        ...(bodyIsFormData ? {} : { "content-type": "application/json" }),
        ...(options.headers || {}),
      },
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "โหลดข้อมูลไม่สำเร็จ");
    return result;
  }

  function setStatus(message, kind = "") {
    statusBox.className = `status-box active ${kind}`;
    statusBox.textContent = message;
  }

  function clearStatus() {
    statusBox.className = "status-box";
    statusBox.textContent = "";
  }

  function option(label, value) {
    const node = document.createElement("option");
    node.value = value;
    node.textContent = label;
    return node;
  }

  function renderCategoryOptions(selected = "") {
    categorySelect.replaceChildren(
      option("เลือกหมวดสินค้า", ""),
      ...state.categories
        .filter((category) => category.status !== "inactive" || category.name === selected)
        .map((category) => option(category.name, category.name)),
    );
    categorySelect.value = selected;
  }

  function renderImagePreview(target, imageUrl, altText, className) {
    if (imageUrl) {
      target.outerHTML = `<img id="${target.id}" class="${className}" src="${escapeHtml(imageUrl)}" alt="${escapeHtml(altText)}">`;
      return document.querySelector(`#${target.id}`);
    }
    target.outerHTML = `<div id="${target.id}" class="${className} image-placeholder">IMG</div>`;
    return document.querySelector(`#${target.id}`);
  }

  function fillProductForm(product) {
    productForm.elements.id.value = product.id;
    productForm.elements.productCode.value = product.productCode;
    productForm.elements.name.value = product.name;
    productForm.elements.description.value = product.description;
    productForm.elements.status.value = product.status;
    renderCategoryOptions(product.category);
  }

  function renderSummary(detail) {
    document.querySelector("#detailTitle").textContent = `${detail.product.productCode} - ${detail.product.name}`;
    document.querySelector("#summaryProductCode").textContent = detail.product.productCode;
    document.querySelector("#summaryChildCount").textContent = detail.summary.childCount;
    document.querySelector("#summaryQuantity").textContent = detail.summary.totalQuantityOnHand;
    document.querySelector("#summaryValue").textContent = `${money(detail.summary.totalInventoryValue)} บาท`;
    productImagePreview = renderImagePreview(productImagePreview, detail.product.imageUrl, detail.product.productCode, "product-image-preview");
  }

  function renderSkuEditors(detail) {
    skuRows.innerHTML = detail.children.map((sku) => `
      <form class="sku-editor" data-sku-form="${sku.id}">
        <input name="id" type="hidden" value="${escapeHtml(sku.id)}">
        <input name="productId" type="hidden" value="${escapeHtml(detail.product.id)}">
        <div class="sku-editor-header">
          <span>${escapeHtml(sku.sku)}</span>
          <span class="muted">คงเหลือ ${sku.quantityOnHand} | มูลค่า ${money(sku.inventoryValue)} บาท</span>
        </div>
        <div class="image-editor">
          ${sku.imageUrl
            ? `<img class="sku-image-preview" src="${escapeHtml(sku.imageUrl)}" alt="${escapeHtml(sku.sku)}">`
            : `<div class="sku-image-preview image-placeholder" aria-hidden="true">IMG</div>`}
          <div class="field">
            <label for="skuImage${sku.id}">รูป Stock SKU</label>
            <input id="skuImage${sku.id}" name="image" type="file" accept="image/png,image/jpeg,image/webp,image/gif">
            <div class="actions">
              <button class="button secondary" type="button" data-sku-image-upload="${sku.id}">อัปโหลดรูป SKU</button>
            </div>
          </div>
        </div>
        <div class="grid">
          <div class="field span-4">
            <label for="skuCode${sku.id}">SKU *</label>
            <input id="skuCode${sku.id}" name="sku" value="${escapeHtml(sku.sku)}" required>
          </div>
          <div class="field span-4">
            <label for="skuBarcode${sku.id}">บาร์โค้ด</label>
            <input id="skuBarcode${sku.id}" name="barcode" value="${escapeHtml(sku.barcode)}">
          </div>
          <div class="field span-4">
            <label for="skuDefaultCost${sku.id}">ต้นทุนตั้งต้น</label>
            <input id="skuDefaultCost${sku.id}" name="defaultUnitCost" inputmode="decimal" value="${escapeHtml(sku.defaultUnitCost)}">
          </div>
          <div class="field span-4">
            <label for="skuColor${sku.id}">สี</label>
            <input id="skuColor${sku.id}" name="color" value="${escapeHtml(sku.color)}">
          </div>
          <div class="field span-4">
            <label for="skuSize${sku.id}">ไซซ์</label>
            <input id="skuSize${sku.id}" name="size" value="${escapeHtml(sku.size)}">
          </div>
          <div class="field span-4">
            <label for="skuStatus${sku.id}">สถานะ</label>
            <select id="skuStatus${sku.id}" name="status">
              <option value="active"${sku.status === "active" ? " selected" : ""}>ใช้งาน</option>
              <option value="inactive"${sku.status === "inactive" ? " selected" : ""}>ปิดใช้</option>
            </select>
          </div>
        </div>
        <div class="actions">
          <button class="button secondary" type="submit">บันทึก SKU</button>
        </div>
      </form>
    `).join("") || `<div class="section-body muted">ยังไม่มี child SKU</div>`;
  }

  function movementTypeLabel(type) {
    const labels = {
      purchase_in: "รับเข้า",
      return_in: "คืนเข้า",
      adjustment_in: "ปรับเพิ่ม",
      sale_out: "ขายออก",
      adjustment_out: "ปรับลด",
    };
    return labels[type] || type;
  }

  function renderMovements(detail) {
    movementRows.innerHTML = detail.movements.map((movement) => `
      <tr>
        <td>${escapeHtml(movement.movementDate)}</td>
        <td>${escapeHtml(movement.movementNo)}</td>
        <td>
          <strong>${escapeHtml(movement.sku)}</strong>
          <div class="muted">${escapeHtml([movement.color, movement.size].filter(Boolean).join(" / ") || "-")}</div>
        </td>
        <td>${escapeHtml(movementTypeLabel(movement.movementType))}</td>
        <td class="number">${movement.quantity}</td>
        <td class="number">${money(movement.unitCost)}</td>
        <td class="number">${money(movement.totalCost)}</td>
        <td>
          ${escapeHtml(movement.referenceNo || "-")}
          <div class="muted">${escapeHtml(movement.referenceType || "")}</div>
        </td>
      </tr>
    `).join("") || `<tr><td colspan="8">ยังไม่มี movement ของสินค้านี้</td></tr>`;
  }

  async function loadCategories() {
    const { categories } = await api("/api/inventory/categories?includeInactive=1");
    state.categories = categories;
  }

  async function loadDetail() {
    if (!state.productId) throw new Error("ไม่พบ productId สำหรับเปิดรายละเอียดสินค้า");
    clearStatus();
    state.detail = await api(`/api/inventory/products/${encodeURIComponent(state.productId)}/detail`);
    fillProductForm(state.detail.product);
    renderSummary(state.detail);
    renderSkuEditors(state.detail);
    renderMovements(state.detail);
  }

  productForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearStatus();
    try {
      const payload = formPayload(productForm);
      const id = payload.id;
      delete payload.id;
      await api(`/api/inventory/products/${encodeURIComponent(id)}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      await loadDetail();
      setStatus("บันทึกสินค้าแม่แล้ว", "success");
    } catch (error) {
      setStatus(error.message, "error");
    }
  });

  productImageForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearStatus();
    try {
      const formData = new FormData(productImageForm);
      await api(`/api/inventory/products/${encodeURIComponent(state.productId)}/image`, {
        method: "POST",
        body: formData,
      });
      productImageForm.reset();
      await loadDetail();
      setStatus("อัปโหลดรูปสินค้าแม่แล้ว", "success");
    } catch (error) {
      setStatus(error.message, "error");
    }
  });

  skuRows.addEventListener("submit", async (event) => {
    const form = event.target.closest("[data-sku-form]");
    if (!form) return;
    event.preventDefault();
    clearStatus();
    try {
      const payload = formPayload(form);
      const id = payload.id;
      delete payload.id;
      await api(`/api/inventory/stock-skus/${encodeURIComponent(id)}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      await loadDetail();
      setStatus("บันทึก SKU แล้ว", "success");
    } catch (error) {
      setStatus(error.message, "error");
    }
  });

  skuRows.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-sku-image-upload]");
    if (!button) return;
    clearStatus();
    try {
      const form = button.closest("[data-sku-form]");
      const formData = new FormData();
      const imageInput = form.querySelector('input[type="file"][name="image"]');
      if (imageInput.files[0]) formData.append("image", imageInput.files[0]);
      await api(`/api/inventory/stock-skus/${encodeURIComponent(button.dataset.skuImageUpload)}/image`, {
        method: "POST",
        body: formData,
      });
      await loadDetail();
      setStatus("อัปโหลดรูป SKU แล้ว", "success");
    } catch (error) {
      setStatus(error.message, "error");
    }
  });

  document.querySelector("#refreshProductDetail").addEventListener("click", () => {
    loadDetail().catch((error) => setStatus(error.message, "error"));
  });

  loadCategories()
    .then(loadDetail)
    .catch((error) => setStatus(error.message, "error"));
});
