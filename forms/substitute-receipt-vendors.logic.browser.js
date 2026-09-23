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
    if (!response.ok) {
      const error = new Error(result.error || "บันทึกข้อมูลไม่สำเร็จ");
      Object.assign(error, result);
      error.status = response.status;
      throw error;
    }
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
          <div class="muted">${escapeHtml(vendor.address || "")}</div>
        </td>
        <td>
          ${escapeHtml(vendor.contactName || "-")}
          <div class="muted">${escapeHtml(vendor.phone || "")}</div>
          <div class="muted">${escapeHtml(vendor.email || "")}</div>
        </td>
        <td>
          ${escapeHtml(vendor.bankName || vendor.paymentChannel || "-")}
          <div class="muted">${escapeHtml(vendor.accountNo || "")}</div>
          <div class="muted">${escapeHtml(vendor.paymentReference || "")}</div>
        </td>
        <td>${escapeHtml(vendor.defaultBusinessPurpose || "-")}</td>
        <td>${renderStatus(vendor.status)}</td>
        <td>
          <button class="icon-button" type="button" title="แก้ไขผู้ขาย" data-edit-vendor="${vendor.id}">✎</button>
          ${vendor.status === "active" ? `<button class="icon-button" type="button" title="ปิดใช้ผู้ขาย" data-deactivate-vendor="${vendor.id}">×</button>` : ""}
        </td>
      </tr>
    `).join("") || `<tr><td colspan="6">ยังไม่มีผู้ขาย</td></tr>`;
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
    vendorForm.elements.address.value = vendor.address || "";
    vendorForm.elements.contactName.value = vendor.contactName || "";
    vendorForm.elements.phone.value = vendor.phone || "";
    vendorForm.elements.email.value = vendor.email || "";
    vendorForm.elements.bankName.value = vendor.bankName || "";
    vendorForm.elements.accountNo.value = vendor.accountNo || "";
    vendorForm.elements.paymentChannel.value = vendor.paymentChannel || "โอนผ่านบัญชีบริษัท";
    vendorForm.elements.paymentReference.value = vendor.paymentReference || "";
    vendorForm.elements.defaultBusinessPurpose.value = vendor.defaultBusinessPurpose || "";
    vendorForm.elements.note.value = vendor.note || "";
    vendorForm.elements.status.value = vendor.status || "active";
    vendorSubmitLabel.textContent = "บันทึกการแก้ไข";
    vendorForm.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function refreshVendors() {
    const { vendors } = await api("/api/vendors?includeInactive=1");
    state.vendors = vendors;
    renderVendors();
  }

  function duplicateMessage(error) {
    const names = (error.matches || []).map((match) => match.taxId ? `${match.name} (${match.taxId})` : match.name).join(", ");
    return `พบผู้ขายที่อาจซ้ำ: ${names || "รายการเดิม"} ต้องการบันทึกซ้ำหรือไม่`;
  }

  async function saveVendor(payload, id, options = {}) {
    const route = id ? `/api/vendors/${encodeURIComponent(id)}` : "/api/vendors";
    const method = id ? "PATCH" : "POST";
    return api(route, { method, body: JSON.stringify({ ...payload, ...options }) });
  }

  vendorForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearStatus();
    try {
      const payload = formPayload(vendorForm);
      const id = payload.id;
      delete payload.id;
      try {
        await saveVendor(payload, id);
      } catch (error) {
        if (error.code !== "VENDOR_DUPLICATE_CONFIRMATION_REQUIRED" || !window.confirm(duplicateMessage(error))) throw error;
        await saveVendor(payload, id, {
          confirmDuplicate: true,
          expectedMatchIds: (error.matches || []).map((match) => match.id),
          expectedCandidateFingerprint: error.candidateFingerprint,
        });
      }
      resetVendorForm();
      await refreshVendors();
      setStatus("บันทึกผู้ขายแล้ว", "success");
    } catch (error) {
      setStatus(error.message, "error");
    }
  });

  vendorRows.addEventListener("click", (event) => {
    const editButton = event.target.closest("[data-edit-vendor]");
    if (editButton) {
      const vendor = state.vendors.find((item) => item.id === editButton.dataset.editVendor);
      if (vendor) fillVendorForm(vendor);
      return;
    }

    const deactivateButton = event.target.closest("[data-deactivate-vendor]");
    if (!deactivateButton) return;
    const vendor = state.vendors.find((item) => item.id === deactivateButton.dataset.deactivateVendor);
    if (!vendor || !window.confirm(`ปิดใช้ผู้ขาย ${vendor.name} หรือไม่`)) return;
    api(`/api/vendors/${encodeURIComponent(vendor.id)}`, { method: "PATCH", body: JSON.stringify({ status: "inactive" }) })
      .then(refreshVendors)
      .then(() => setStatus("ปิดใช้ผู้ขายแล้ว", "success"))
      .catch((error) => setStatus(error.message, "error"));
  });

  document.querySelector("#refreshVendors").addEventListener("click", () => {
    refreshVendors().catch((error) => setStatus(error.message, "error"));
  });
  document.querySelector("#cancelVendorEdit").addEventListener("click", resetVendorForm);

  resetVendorForm();
  refreshVendors().catch((error) => setStatus(error.message, "error"));
});
