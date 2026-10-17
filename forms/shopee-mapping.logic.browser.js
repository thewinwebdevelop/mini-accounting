window.addEventListener("DOMContentLoaded", () => {
  const contentNode = document.querySelector("#shopeeMappingContent");
  const statusNode = document.querySelector("#shopeeMappingStatus");
  const params = new URLSearchParams(window.location.search);
  const shopId = params.get("shopId") || localStorage.getItem("shopeeShopId") || "";
  const requestedIds = new Set((params.get("orderIds") || "").split(",").filter(Boolean));
  const state = { orders: [], stockSkus: [] };
  const escapeHtml = (value) => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  const api = async (route, options = {}) => { const request = { ...options, headers: { ...(options.headers || {}) } }; if (request.body && typeof request.body !== "string") { request.headers["content-type"] = "application/json"; request.body = JSON.stringify(request.body); } const response = await fetch(route, request); const result = await response.json(); if (!response.ok) throw new Error(result.error || "ดำเนินการ mapping ไม่สำเร็จ"); return result; };
  const setStatus = (message, kind = "") => { statusNode.textContent = message; statusNode.className = `status-box active ${kind}`; };
  const orders = () => requestedIds.size ? state.orders.filter((order) => requestedIds.has(String(order.id))) : state.orders;
  const render = () => {
    contentNode.innerHTML = orders().map((order) => `<article class="section"><div class="section-header"><h3 class="section-title">${escapeHtml(order.orderNo)}</h3><span class="muted">${escapeHtml(order.buyerName)}</span></div><div class="section-body"><div class="shopee-mapping-list">${(order.lines || []).map((line) => `<label class="shopee-mapping-line"><span><strong>${escapeHtml(line.externalModelSku || line.saleSku || line.externalItemId)}</strong><br><span class="muted">${escapeHtml(line.displayName)} × ${escapeHtml(line.quantity)}</span></span><select data-shopee-mapping="${escapeHtml(line.id)}"><option value="">เลือก Stock SKU</option>${state.stockSkus.map((sku) => `<option value="${escapeHtml(sku.id)}" ${String(sku.id) === String(line.mappedStockSkuId) ? "selected" : ""}>${escapeHtml(sku.sku)} — ${escapeHtml(sku.productName)}</option>`).join("")}</select></label>`).join("") || `<div class="muted">ไม่พบรายการสินค้า</div>`}</div></div></article>`).join("") || `<div class="empty-state">ไม่พบ order ที่เลือก กลับไปหน้า Orders แล้วเลือก order ก่อน</div>`;
  };
  contentNode.addEventListener("change", async (event) => { const select = event.target.closest("[data-shopee-mapping]"); if (!select) return; try { await api(`/api/platform-orders/${encodeURIComponent(select.dataset.shopeeMapping)}/sku-mapping`, { method: "POST", body: { stockSkuId: select.value || null } }); setStatus("บันทึก mapping แล้ว", "success"); } catch (error) { setStatus(error.message, "error"); } });
  const shipmentLink = document.querySelector("#continueToShopeeShipmentButton");
  shipmentLink.addEventListener("click", () => { const ids = orders().map((order) => order.id).join(","); window.location.href = `/shopee-shipment?shopId=${encodeURIComponent(shopId)}&orderIds=${encodeURIComponent(ids)}`; });
  document.querySelector("#backToShopeeOrdersButton").href = `/shopee-orders?shopId=${encodeURIComponent(shopId)}`;
  Promise.all([api(`/api/platform-orders?shopId=${encodeURIComponent(shopId)}`), api("/api/inventory/stock-skus")]).then(([orderResult, skuResult]) => { state.orders = orderResult.orders || []; state.stockSkus = skuResult.stockSkus || skuResult.skus || []; render(); }).catch((error) => { contentNode.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`; setStatus(error.message, "error"); });
});
