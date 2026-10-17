(function registerShopeeHeader() {
  const escapeHtml = (value) => String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

  class ShopeeHeader extends HTMLElement {
    connectedCallback() {
      if (this.dataset.rendered === "true") return;
      this.dataset.rendered = "true";
      const title = escapeHtml(this.getAttribute("page-title") || "Shopee");
      const subtitle = escapeHtml(this.getAttribute("page-subtitle") || "");
      const inventoryLink = this.hasAttribute("show-inventory")
        ? '<a class="menu-item" href="/inventory">Stock SKU</a>'
        : "";

      this.innerHTML = `
        <header class="topbar">
          <details class="app-menu">
            <summary class="menu-button" aria-label="เปิดเมนู">☰</summary>
            <nav class="menu-panel" aria-label="เมนู Shopee">
              <div class="menu-group">
                <div class="menu-group-title">Shopee workflow</div>
                <a class="menu-item" href="/shopee-connection">เชื่อมต่อ / Sync</a>
                <a class="menu-item" href="/shopee-orders">Orders</a>
                <a class="menu-item" href="/shopee-mapping">Manual SKU</a>
                <a class="menu-item" href="/shopee-shipment">นัดรับ / ใบปะหน้า</a>
                <a class="menu-item" href="/shopee-custom-label">Custom Label จาก PDF</a>
              </div>
              <div class="menu-group">
                <div class="menu-group-title">ระบบอื่น</div>
                <a class="menu-item" href="/platform-orders">CSV Platform Orders</a>
                ${inventoryLink}
                <a class="menu-item" href="/workflow-transactions">Workflow ธุรกรรมเอกสาร</a>
                <a class="menu-item" href="/workflow-templates">ตั้งค่า Workflow Template</a>
                <a class="menu-item" href="/user-profile">ข้อมูลส่วนตัว</a>
                <a class="menu-item" href="/">หน้าหลัก</a>
              </div>
            </nav>
          </details>
          <div>
            <h1 class="brand-title">${title}</h1>
            <p class="brand-subtitle">${subtitle}</p>
          </div>
        </header>`;
    }
  }

  if (!customElements.get("shopee-header")) {
    customElements.define("shopee-header", ShopeeHeader);
  }
})();
