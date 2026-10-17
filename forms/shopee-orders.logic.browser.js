window.addEventListener("DOMContentLoaded", () => {
  const shopIdNode = document.querySelector("#shopeeShopId");
  const rowsNode = document.querySelector("#shopeeOrderRows");
  const countNode = document.querySelector("#shopeeSelectedCount");
  const statusNode = document.querySelector("#shopeeOrderStatus");
  const mappingButton = document.querySelector("#openShopeeMappingButton");
  const shipmentButton = document.querySelector("#openShopeeShipmentButton");
  const selected = new Set();
  const params = new URLSearchParams(window.location.search);
  shopIdNode.value = params.get("shopId") || localStorage.getItem("shopeeShopId") || "";
  const state = { orders: [] };

  const escapeHtml = (value) => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  const api = async (route, options = {}) => {
    const request = { ...options, headers: { ...(options.headers || {}) } };
    if (request.body && typeof request.body !== "string") { request.headers["content-type"] = "application/json"; request.body = JSON.stringify(request.body); }
    const response = await fetch(route, request);
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "โหลด Shopee orders ไม่สำเร็จ");
    return result;
  };
  const shopId = () => { const value = shopIdNode.value.trim(); if (value) localStorage.setItem("shopeeShopId", value); return value; };
  const setStatus = (message, kind = "") => { statusNode.textContent = message; statusNode.className = `status-box active ${kind}`; };
  const selectedQuery = () => [...selected].join(",");
  const updateActions = () => {
    countNode.textContent = `${selected.size} รายการที่เลือก`;
    mappingButton.disabled = selected.size === 0;
    shipmentButton.disabled = selected.size === 0;
    const suffix = `?shopId=${encodeURIComponent(shopId())}&orderIds=${encodeURIComponent(selectedQuery())}`;
    mappingButton.dataset.href = `/shopee-mapping${suffix}`;
    shipmentButton.dataset.href = `/shopee-shipment${suffix}`;
  };
  const render = () => {
    rowsNode.innerHTML = state.orders.map((order) => `<tr class="shopee-order-row ${selected.has(String(order.id)) ? "selected" : ""}"><td><input type="checkbox" data-shopee-order="${escapeHtml(order.id)}" ${selected.has(String(order.id)) ? "checked" : ""}></td><td><strong>${escapeHtml(order.orderNo)}</strong><div class="muted">${escapeHtml(order.buyerName)}</div></td><td><span class="pill">${escapeHtml(order.shippingStatus || order.orderStatus)}</span><div class="muted">${escapeHtml(order.shipmentActionStatus)}</div></td><td><span class="pill ${order.mappingStatus === "mapped" ? "matched" : "missing_sale_sku"}">${order.mappingStatus === "mapped" ? "mapped" : "ต้อง map"}</span></td><td>${escapeHtml(order.trackingNumber || order.shipmentTrackingNumber || "ยังไม่มี")}</td></tr>`).join("") || `<tr><td colspan="5" class="empty-state">ยังไม่มี Shopee orders กด Sync orders ที่หน้า Connection ก่อน</td></tr>`;
    updateActions();
  };
  async function loadOrders() {
    if (!shopId()) { setStatus("ระบุ Shop ID เพื่อโหลด orders", "error"); return; }
    const result = await api(`/api/platform-orders?shopId=${encodeURIComponent(shopId())}`);
    state.orders = result.orders || [];
    [...selected].forEach((id) => { if (!state.orders.some((order) => String(order.id) === id)) selected.delete(id); });
    render();
    setStatus(`โหลด ${state.orders.length} orders แล้ว`, "success");
  }
  rowsNode.addEventListener("change", (event) => { const checkbox = event.target.closest("[data-shopee-order]"); if (!checkbox) return; const id = String(checkbox.dataset.shopeeOrder); if (checkbox.checked) selected.add(id); else selected.delete(id); render(); });
  mappingButton.addEventListener("click", () => { if (mappingButton.dataset.href) window.location.href = mappingButton.dataset.href; });
  shipmentButton.addEventListener("click", () => { if (shipmentButton.dataset.href) window.location.href = shipmentButton.dataset.href; });
  document.querySelector("#refreshShopeeOrdersButton").addEventListener("click", () => loadOrders().catch((error) => setStatus(error.message, "error")));
  loadOrders().catch((error) => setStatus(error.message, "error"));
});
