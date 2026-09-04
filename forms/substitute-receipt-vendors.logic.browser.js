window.addEventListener("DOMContentLoaded", () => {
  const state = {
    vendors: [],
  };

  const vendorForm = document.querySelector("#vendorForm");
  const vendorRows = document.querySelector("#vendorRows");
  const statusBox = document.querySelector("#vendorStatusBox");
  const vendorSubmitLabel = document.querySelector("#vendorSubmitLabel");

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function formPayload(form) {
    return Object.fromEntries(new FormData(form).entries());
  }

  async function api(route, options = {}) {
    const response = await fetch(route, {
      ...options,
      headers: {
        "content-type": "application/json",
        ...(options.headers || {}),
      },
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "บันทึกข้อมูลไม่สำเร็จ");
    return result;
  }

  function statusLabel(status) {
    return status === "inactive" ? "ปิดใช้" : "ใช้งาน";
  }

  function renderStatus(status) {
    const css = status === "inactive" ? "status-pill inactive" : "status-pill";
    return `<span class="${css}">${statusLabel(status)}</span>`;
  }

  function setStatus(message, kind = "") {
    statusBox.className = `status-box active ${kind}`;
    statusBox.textContent = message;
  }

  function clearStatus() {
    statusBox.className = "status-box";
    statusBox.textContent = "";
  }

  function renderVendors() {
    vendorRows.innerHTML = state.vendors.map((vendor) => `
      <tr>
        <td>
          <strong>${escapeHtml(vendor.name)}</strong>
          <div class="muted">${escapeHtml(vendor.taxId || "-")}</div>
        </td>
        <td>
          ${escapeHtml(vendor.paymentChannel || "-")}
          <div class="muted">${escapeHtml(vendor.paymentReference || "")}</div>
        </td>
        <td>${escapeHtml(vendor.defaultBusinessPurpose || "-")}</td>
        <td>${renderStatus(vendor.status)}</td>
        <td><button class="icon-button" type="button" title="แก้ไขผู้ขาย" data-edit-vendor="${vendor.id}">✎</button></td>
      </tr>
    `).join("") || `<tr><td colspan="5">ยังไม่มี preset ผู้ขาย</td></tr>`;
  }

  function resetVendorForm() {
    vendorForm.reset();
    vendorForm.elements.id.value = "";
    vendorForm.elements.paymentChannel.value = "โอนผ่านบัญชีบริษัท";
    vendorForm.elements.status.value = "active";
    vendorSubmitLabel.textContent = "บันทึกผู้ขาย";
  }

  function fillVendorForm(vendor) {
    vendorForm.elements.id.value = vendor.id;
    vendorForm.elements.name.value = vendor.name;
    vendorForm.elements.taxId.value = vendor.taxId || "";
    vendorForm.elements.paymentChannel.value = vendor.paymentChannel || "โอนผ่านบัญชีบริษัท";
    vendorForm.elements.paymentReference.value = vendor.paymentReference || "";
    vendorForm.elements.defaultBusinessPurpose.value = vendor.defaultBusinessPurpose || "";
    vendorForm.elements.note.value = vendor.note || "";
    vendorForm.elements.status.value = vendor.status || "active";
    vendorSubmitLabel.textContent = "บันทึกการแก้ไข";
    vendorForm.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function refreshVendors() {
    const { vendors } = await api("/api/substitute-receipt-vendors?includeInactive=1");
    state.vendors = vendors;
    renderVendors();
  }

  vendorForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearStatus();
    try {
      const payload = formPayload(vendorForm);
      const id = payload.id;
      delete payload.id;
      const route = id ? `/api/substitute-receipt-vendors/${encodeURIComponent(id)}` : "/api/substitute-receipt-vendors";
      const method = id ? "PUT" : "POST";
      await api(route, { method, body: JSON.stringify(payload) });
      resetVendorForm();
      await refreshVendors();
      setStatus("บันทึกผู้ขายแล้ว", "success");
    } catch (error) {
      setStatus(error.message, "error");
    }
  });

  vendorRows.addEventListener("click", (event) => {
    const button = event.target.closest("[data-edit-vendor]");
    if (!button) return;
    const vendor = state.vendors.find((item) => item.id === button.dataset.editVendor);
    if (vendor) fillVendorForm(vendor);
  });

  document.querySelector("#refreshVendors").addEventListener("click", () => {
    refreshVendors().catch((error) => setStatus(error.message, "error"));
  });
  document.querySelector("#cancelVendorEdit").addEventListener("click", resetVendorForm);

  resetVendorForm();
  refreshVendors().catch((error) => setStatus(error.message, "error"));
});
