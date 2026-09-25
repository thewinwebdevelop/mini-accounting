window.addEventListener("DOMContentLoaded", () => {
  const shopIdNode = document.querySelector("#shopeeShopId");
  const statusNode = document.querySelector("#shopeeConnectionStatus");
  const connectButton = document.querySelector("#shopeeConnectButton");
  const syncButton = document.querySelector("#syncShopeeOrdersButton");
  const params = new URLSearchParams(window.location.search);
  const savedShopId = localStorage.getItem("shopeeShopId") || "";
  shopIdNode.value = params.get("shopId") || savedShopId;
  if (shopIdNode.value) localStorage.setItem("shopeeShopId", shopIdNode.value);

  const api = async (route, options = {}) => {
    const request = { ...options, headers: { ...(options.headers || {}) } };
    if (request.body && typeof request.body !== "string") {
      request.headers["content-type"] = "application/json";
      request.body = JSON.stringify(request.body);
    }
    const response = await fetch(route, request);
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "ดำเนินการ Shopee ไม่สำเร็จ");
    return result;
  };

  const shopId = () => {
    const value = shopIdNode.value.trim();
    if (value) localStorage.setItem("shopeeShopId", value);
    return value;
  };

  const setStatus = (message, kind = "") => {
    statusNode.textContent = message;
    statusNode.className = `status-box active ${kind}`;
  };

  async function loadConnection() {
    if (!shopId()) return;
    const result = await api(`/api/shopee/connection?shopId=${encodeURIComponent(shopId())}`);
    if (result.connection) setStatus(`เชื่อมต่อแล้ว: Shop ${result.connection.shopId}`, "success");
    else setStatus("ยังไม่มี connection ของ Shop ID นี้");
  }

  connectButton.addEventListener("click", async () => {
    try {
      setStatus("กำลังเปิดหน้า Shopee เพื่อ Login และอนุมัติสิทธิ์...");
      const result = await api("/api/shopee/authorize", { method: "POST", body: { origin: window.location.origin } });
      window.location.href = result.authorizationUrl;
    } catch (error) { setStatus(error.message, "error"); }
  });

  syncButton.addEventListener("click", async () => {
    try {
      if (!shopId()) throw new Error("ระบุ Shop ID ก่อน Sync");
      setStatus("กำลัง Sync orders...");
      const result = await api("/api/shopee/sync", { method: "POST", body: { connectionId: shopId() } });
      setStatus(`Sync orders สำเร็จ ${result.orders?.length || result.syncedCount || ""}`.trim(), "success");
    } catch (error) { setStatus(error.message, "error"); }
  });

  if (params.get("shopee_error")) setStatus(params.get("shopee_error"), "error");
  else if (params.get("connected") === "1") setStatus(`เชื่อมต่อ Shopee สำเร็จ: Shop ${shopId()}`, "success");
  loadConnection().catch((error) => setStatus(error.message, "error"));
});
