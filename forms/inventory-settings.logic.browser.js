window.addEventListener("DOMContentLoaded", () => {
  const state = {
    categories: [],
  };

  const categoryForm = document.querySelector("#categoryForm");
  const categoryRows = document.querySelector("#categoryRows");
  const statusBox = document.querySelector("#categoryStatusBox");
  const categorySubmitLabel = document.querySelector("#categorySubmitLabel");

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

  function renderCategories() {
    categoryRows.innerHTML = state.categories.map((category) => `
      <tr>
        <td>${escapeHtml(category.name)}</td>
        <td class="number">${category.sortOrder}</td>
        <td>${renderStatus(category.status)}</td>
        <td><button class="icon-button" type="button" title="แก้ไขหมวด" data-edit-category="${category.id}">✎</button></td>
      </tr>
    `).join("") || `<tr><td colspan="4">ยังไม่มีหมวดสินค้า</td></tr>`;
  }

  function resetCategoryForm() {
    categoryForm.reset();
    categoryForm.elements.id.value = "";
    categoryForm.elements.status.value = "active";
    categorySubmitLabel.textContent = "บันทึกหมวด";
  }

  function fillCategoryForm(category) {
    categoryForm.elements.id.value = category.id;
    categoryForm.elements.name.value = category.name;
    categoryForm.elements.sortOrder.value = category.sortOrder;
    categoryForm.elements.status.value = category.status;
    categorySubmitLabel.textContent = "บันทึกการแก้ไข";
    categoryForm.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function refreshCategories() {
    const { categories } = await api("/api/inventory/categories?includeInactive=1");
    state.categories = categories;
    renderCategories();
  }

  categoryForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearStatus();
    try {
      const payload = formPayload(categoryForm);
      const id = payload.id;
      delete payload.id;
      const route = id ? `/api/inventory/categories/${encodeURIComponent(id)}` : "/api/inventory/categories";
      const method = id ? "PUT" : "POST";
      await api(route, { method, body: JSON.stringify(payload) });
      resetCategoryForm();
      await refreshCategories();
      setStatus("บันทึกหมวดสินค้าแล้ว", "success");
    } catch (error) {
      setStatus(error.message, "error");
    }
  });

  categoryRows.addEventListener("click", (event) => {
    const button = event.target.closest("[data-edit-category]");
    if (!button) return;
    const category = state.categories.find((item) => String(item.id) === button.dataset.editCategory);
    if (category) fillCategoryForm(category);
  });

  document.querySelector("#refreshCategories").addEventListener("click", () => {
    refreshCategories().catch((error) => setStatus(error.message, "error"));
  });
  document.querySelector("#cancelCategoryEdit").addEventListener("click", resetCategoryForm);

  resetCategoryForm();
  refreshCategories().catch((error) => setStatus(error.message, "error"));
});
