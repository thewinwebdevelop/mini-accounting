window.addEventListener("DOMContentLoaded", () => {
  const latestStockInRows = document.querySelector("#latestStockInRows");
  const stockInRows = document.querySelector("#stockInRows");
  const fullReportPanel = document.querySelector("#fullReportPanel");
  const statusBox = document.querySelector("#dashboardStatus");

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

  function renderSummary(summary) {
    document.querySelector("#totalInventoryValue").textContent = `${money(summary.totalInventoryValue)} บาท`;
    document.querySelector("#stockSkuCount").textContent = summary.stockSkuCount;
    document.querySelector("#totalQuantityOnHand").textContent = summary.totalQuantityOnHand;
    document.querySelector("#totalReservedQuantity").textContent = summary.totalReservedQuantity || 0;
    document.querySelector("#totalAvailableQuantity").textContent = summary.totalAvailableQuantity || 0;
    document.querySelector("#zeroQuantitySkuCount").textContent = summary.zeroQuantitySkuCount;
    document.querySelector("#asOfDate").textContent = summary.asOfDate || "-";
  }

  function renderStockInRows(rows, target, emptyText) {
    target.innerHTML = rows.map((movement) => `
      <tr>
        <td>${escapeHtml(movement.movementDate)}</td>
        <td>
          <strong>${escapeHtml(movement.sku)}</strong>
          <div class="muted">${escapeHtml(movement.productCode)} - ${escapeHtml(movement.productName)}</div>
        </td>
        <td>${escapeHtml([movement.color, movement.size].filter(Boolean).join(" / ") || "-")}</td>
        <td class="number">${escapeHtml(movement.quantity)}</td>
        <td class="number">${money(movement.unitCost)}</td>
        <td class="number">${money(movement.totalCost)}</td>
        <td>
          ${escapeHtml(movement.referenceNo || "-")}
          <div class="muted">${escapeHtml(movement.referenceType || "")}</div>
        </td>
      </tr>
    `).join("") || `<tr><td colspan="7">${emptyText}</td></tr>`;
  }

  async function loadDashboard() {
    clearStatus();
    const { summary, latestStockIn } = await api("/api/inventory/dashboard");
    renderSummary(summary);
    renderStockInRows(latestStockIn, latestStockInRows, "ยังไม่มีรายการสินค้าเข้า");
  }

  async function loadFullStockInReport() {
    clearStatus();
    const { movements } = await api("/api/inventory/stock-in-report?limit=100");
    renderStockInRows(movements, stockInRows, "ยังไม่มีรายการสินค้าเข้า");
    fullReportPanel.hidden = false;
    fullReportPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  document.querySelector("#refreshDashboard").addEventListener("click", () => {
    loadDashboard().catch((error) => setStatus(error.message, "error"));
  });
  document.querySelector("#seeMoreStockIn").addEventListener("click", () => {
    loadFullStockInReport().catch((error) => setStatus(error.message, "error"));
  });

  loadDashboard().catch((error) => setStatus(error.message, "error"));
});
