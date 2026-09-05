window.addEventListener("DOMContentLoaded", () => {
  const state = {
    categories: [],
    groups: [],
  };

  const filtersForm = document.querySelector("#stockListFilters");
  const searchInput = document.querySelector("#stockListSearch");
  const categorySelect = document.querySelector("#stockListCategory");
  const statusSelect = document.querySelector("#stockListStatus");
  const modeSelect = document.querySelector("#stockListMode");
  const statusBox = document.querySelector("#stockListStatusBox");
  const parentPanel = document.querySelector("#parentStockPanel");
  const allPanel = document.querySelector("#allStockPanel");
  const parentRows = document.querySelector("#parentStockRows");
  const groupRows = document.querySelector("#stockGroupRows");
  const countNode = document.querySelector("#stockListCount");

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

  async function api(route) {
    const response = await fetch(route);
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

  function statusLabel(status) {
    return status === "inactive" ? "ปิดใช้" : "ใช้งาน";
  }

  function renderStatus(status) {
    const css = status === "inactive" ? "status-pill inactive" : "status-pill";
    return `<span class="${css}">${statusLabel(status)}</span>`;
  }

  function renderProductThumb(group) {
    if (group.imageUrl) {
      return `<img class="product-image-thumb" src="${escapeHtml(group.imageUrl)}" alt="${escapeHtml(group.productCode)}">`;
    }
    return `<div class="product-image-thumb product-image-placeholder" aria-hidden="true">IMG</div>`;
  }

  function renderCategoryOptions() {
    categorySelect.replaceChildren(
      option("ทุกหมวด", ""),
      ...state.categories
        .filter((category) => category.status !== "inactive")
        .map((category) => option(category.name, category.name)),
    );
    window.SearchableSelect?.enhance(categorySelect);
  }

  function renderParentRows() {
    countNode.textContent = state.groups.length;
    parentRows.innerHTML = state.groups.map((group) => `
      <tr>
        <td>
          <div class="product-cell">
            ${renderProductThumb(group)}
            <div>
              <strong>${escapeHtml(group.productCode)}</strong>
              <div class="muted">${escapeHtml(group.name)}</div>
            </div>
          </div>
        </td>
        <td>${escapeHtml(group.category || "-")}</td>
        <td class="number">${group.childCount}</td>
        <td class="number">${group.totalQuantityOnHand}</td>
        <td class="number">${group.totalReservedQuantity || 0}</td>
        <td class="number">${group.totalAvailableQuantity || 0}</td>
        <td class="number">${money(group.totalInventoryValue)}</td>
        <td>${renderStatus(group.status)}</td>
        <td><a class="button secondary" href="/inventory-product-detail?productId=${encodeURIComponent(group.id)}">รายละเอียด</a></td>
      </tr>
    `).join("") || `<tr><td colspan="9">ไม่พบรายการสต๊อก</td></tr>`;
  }

  function renderChildRows(group) {
    return group.children.map((sku) => `
      <tr>
        <td>
          <strong>${escapeHtml(sku.sku)}</strong>
          <div class="muted">${escapeHtml(sku.barcode || "")}</div>
        </td>
        <td>${escapeHtml(sku.color || "-")}</td>
        <td>${escapeHtml(sku.size || "-")}</td>
        <td class="number">${sku.quantityOnHand}</td>
        <td class="number">${sku.reservedQuantity || 0}</td>
        <td class="number">${sku.availableQuantity || 0}</td>
        <td class="number">${money(sku.averageUnitCost)}</td>
        <td class="number">${money(sku.inventoryValue)}</td>
        <td>${renderStatus(sku.status)}</td>
      </tr>
    `).join("") || `<tr><td colspan="9">ยังไม่มี child SKU</td></tr>`;
  }

  function renderGroups() {
    groupRows.innerHTML = state.groups.map((group) => `
      <details class="stock-group">
        <summary>
          <div class="product-heading">
            <div class="product-cell">
              ${renderProductThumb(group)}
              <div>
                <strong>${escapeHtml(group.productCode)} - ${escapeHtml(group.name)}</strong>
                <span class="muted">${escapeHtml(group.category || "-")}</span>
              </div>
            </div>
          </div>
          <div class="group-metric"><span>SKU</span><strong>${group.childCount}</strong></div>
          <div class="group-metric"><span>คงเหลือจริง</span><strong>${group.totalQuantityOnHand}</strong></div>
          <div class="group-metric"><span>จองแล้ว</span><strong>${group.totalReservedQuantity || 0}</strong></div>
          <div class="group-metric"><span>พร้อมขาย</span><strong>${group.totalAvailableQuantity || 0}</strong></div>
          <div class="group-metric"><span>มูลค่า</span><strong>${money(group.totalInventoryValue)}</strong></div>
          <a class="button secondary" href="/inventory-product-detail?productId=${encodeURIComponent(group.id)}">รายละเอียด</a>
        </summary>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Stock SKU</th>
                <th>สี</th>
                <th>ไซซ์</th>
                <th class="number">คงเหลือจริง</th>
                <th class="number">จองแล้ว</th>
                <th class="number">พร้อมขาย</th>
                <th class="number">ต้นทุนเฉลี่ย</th>
                <th class="number">มูลค่า</th>
                <th>สถานะ</th>
              </tr>
            </thead>
            <tbody>${renderChildRows(group)}</tbody>
          </table>
        </div>
      </details>
    `).join("") || `<div class="muted">ไม่พบรายการสต๊อก</div>`;
  }

  function renderMode() {
    const parentMode = modeSelect.value === "parent";
    parentPanel.hidden = !parentMode;
    allPanel.hidden = parentMode;
  }

  function queryString() {
    const params = new URLSearchParams();
    if (searchInput.value.trim()) params.set("search", searchInput.value.trim());
    if (categorySelect.value) params.set("category", categorySelect.value);
    if (statusSelect.value && statusSelect.value !== "all") params.set("stockStatus", statusSelect.value);
    return params.toString();
  }

  async function loadCategories() {
    const { categories } = await api("/api/inventory/categories");
    state.categories = categories;
    renderCategoryOptions();
  }

  async function loadStockList() {
    clearStatus();
    const qs = queryString();
    const { groups } = await api(`/api/inventory/stock-list${qs ? `?${qs}` : ""}`);
    state.groups = groups;
    renderParentRows();
    renderGroups();
    renderMode();
  }

  let searchTimer = null;
  function scheduleLoad() {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      loadStockList().catch((error) => setStatus(error.message, "error"));
    }, 180);
  }

  filtersForm.addEventListener("submit", (event) => event.preventDefault());
  searchInput.addEventListener("input", scheduleLoad);
  categorySelect.addEventListener("change", () => loadStockList().catch((error) => setStatus(error.message, "error")));
  statusSelect.addEventListener("change", () => loadStockList().catch((error) => setStatus(error.message, "error")));
  modeSelect.addEventListener("change", renderMode);
  document.querySelector("#refreshStockList").addEventListener("click", () => {
    loadStockList().catch((error) => setStatus(error.message, "error"));
  });

  loadCategories()
    .then(loadStockList)
    .catch((error) => setStatus(error.message, "error"));
});
