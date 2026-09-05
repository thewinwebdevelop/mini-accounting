window.addEventListener("DOMContentLoaded", () => {
  const state = {
    imports: [],
    selectedImport: null,
  };

  const form = document.querySelector("#platformOrderUploadForm");
  const platformSelect = document.querySelector("#platformOrderPlatform");
  const fileInput = document.querySelector("#platformOrderFile");
  const rowsNode = document.querySelector("#platformOrderImportRows");
  const detailNode = document.querySelector("#platformOrderDetail");
  const postButton = document.querySelector("#postPlatformOrderImport");
  const statusBox = document.querySelector("#platformOrderStatusBox");
  const refreshButton = document.querySelector("#refreshPlatformOrders");

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function numberText(value) {
    return Number(value || 0).toLocaleString("th-TH");
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
    if (!response.ok) throw new Error(result.error || "ดำเนินการไม่สำเร็จ");
    return result;
  }

  function statusLabel(status) {
    const labels = {
      imported: "นำเข้าแล้ว",
      ready: "พร้อมตัดสต๊อก",
      has_issues: "ต้องแก้ไข",
      posted: "ตัดสต๊อกแล้ว",
    };
    return labels[status] || status;
  }

  function renderImports() {
    rowsNode.innerHTML = state.imports.map((item) => `
      <tr>
        <td><span class="mobile-label">Import</span><span><strong>${escapeHtml(item.importNo)}</strong><div class="muted">${escapeHtml(item.fileName)}</div></span></td>
        <td><span class="mobile-label">Platform</span><span>${escapeHtml(item.platform)}</span></td>
        <td><span class="mobile-label">Status</span><span class="pill ${escapeHtml(item.status)}">${statusLabel(item.status)}</span></td>
        <td><span class="mobile-label">Rows</span><span>${numberText(item.rowCount)}</span></td>
        <td><span class="mobile-label">Issues</span><span>${numberText(item.issueCount)}</span></td>
        <td><span class="mobile-label"></span><button class="button secondary small" type="button" data-import-id="${item.id}">ดู</button></td>
      </tr>
    `).join("") || `<tr><td colspan="6">ยังไม่มี import</td></tr>`;
  }

  function renderComponents(line) {
    return (line.components || []).map((component) => `
      <div class="component-line">
        <strong>${escapeHtml(component.sku)}</strong>
        <span>${escapeHtml(component.productName)} ${escapeHtml(component.color)} ${escapeHtml(component.size)}</span>
        <span>ตัด ${numberText(component.requiredQuantity)} / คงเหลือ ${numberText(component.quantityOnHand)}</span>
      </div>
    `).join("") || `<span class="muted">ยังไม่มี component</span>`;
  }

  function renderDetail() {
    const detail = state.selectedImport;
    postButton.disabled = !detail || detail.import.status !== "ready";
    if (!detail) {
      detailNode.innerHTML = `<div class="section-body"><div class="muted">เลือก import เพื่อดูรายละเอียด</div></div>`;
      return;
    }

    detailNode.innerHTML = `
      <div class="section-header">
        <h2 class="section-title">${escapeHtml(detail.import.importNo)}</h2>
      </div>
      <div class="section-body">
        <div class="metric-row">
          <div><span>Rows</span><strong>${numberText(detail.import.rowCount)}</strong></div>
          <div><span>Matched</span><strong>${numberText(detail.import.matchedLineCount)}</strong></div>
          <div><span>Issues</span><strong>${numberText(detail.import.issueCount)}</strong></div>
          <div><span>Status</span><strong>${statusLabel(detail.import.status)}</strong></div>
        </div>
        <div class="order-lines">
          ${detail.lines.map((line) => `
            <article class="order-line">
              <header>
                <strong>${escapeHtml(line.orderNo)} / ${escapeHtml(line.saleSku)}</strong>
                <span class="pill ${escapeHtml(line.matchStatus)}">${escapeHtml(line.matchStatus)}</span>
              </header>
              <div class="muted">${escapeHtml(line.displayName || line.buyerName || "")}</div>
              <div>จำนวนขาย: ${numberText(line.quantity)}</div>
              ${line.issueMessage ? `<div class="issue">${escapeHtml(line.issueMessage)}</div>` : ""}
              <div class="components">${renderComponents(line)}</div>
              ${line.matchStatus === "missing_sale_sku" ? `<a class="button secondary small" href="/sale-skus">แก้ Sale SKU</a>` : ""}
            </article>
          `).join("") || `<div class="muted">ยังไม่มีรายการ order</div>`}
        </div>
      </div>
    `;
  }

  async function loadImports() {
    const { imports } = await api("/api/platform-orders/imports");
    state.imports = imports;
    renderImports();
    if (!state.selectedImport && imports[0]) await loadDetail(imports[0].id);
    if (!imports[0]) renderDetail();
  }

  async function loadDetail(importId) {
    state.selectedImport = await api(`/api/platform-orders/imports/${encodeURIComponent(importId)}`);
    renderDetail();
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearStatus();
    const file = fileInput.files[0];
    if (!file) {
      setStatus("เลือกไฟล์ก่อน import", "error");
      return;
    }
    try {
      const body = new FormData();
      body.append("platform", platformSelect.value);
      body.append("file", file);
      const detail = await api("/api/platform-orders/imports", {
        method: "POST",
        body,
      });
      state.selectedImport = detail;
      setStatus("Import สำเร็จ", "success");
      fileInput.value = "";
      await loadImports();
      renderDetail();
    } catch (error) {
      setStatus(error.message, "error");
    }
  });

  rowsNode.addEventListener("click", (event) => {
    const button = event.target.closest("[data-import-id]");
    if (!button) return;
    loadDetail(button.dataset.importId).catch((error) => setStatus(error.message, "error"));
  });

  postButton.addEventListener("click", async () => {
    if (!state.selectedImport) return;
    try {
      const detail = await api(`/api/platform-orders/imports/${encodeURIComponent(state.selectedImport.import.id)}/post`, {
        method: "POST",
      });
      state.selectedImport = detail;
      setStatus("ตัดสต๊อกแล้ว", "success");
      await loadImports();
      renderDetail();
    } catch (error) {
      setStatus(error.message, "error");
    }
  });

  refreshButton.addEventListener("click", () => {
    loadImports().catch((error) => setStatus(error.message, "error"));
  });

  loadImports().catch((error) => setStatus(error.message, "error"));
});
