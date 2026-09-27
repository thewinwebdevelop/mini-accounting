(function exposeWorkflowReviewModal(root) {
  "use strict";

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>\"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;",
    }[character]));
  }

  function displayValue(value) {
    return String(value ?? "").trim() || "-";
  }

  function renderReview(container, model) {
    const fields = Array.isArray(model.fields) ? model.fields : [];
    const lines = Array.isArray(model.lines) ? model.lines : [];
    const files = Array.isArray(model.files) ? model.files : [];
    const fieldMarkup = fields.map((field) => `
      <div class="workflow-review-field"><dt>${escapeHtml(field.label)}</dt><dd>${escapeHtml(displayValue(field.value))}</dd></div>
    `).join("");
    const lineMarkup = lines.length
      ? `<div class="workflow-review-section"><h3>รายการ</h3><ol class="workflow-review-lines">${lines.map((line) => `
          <li><strong>${escapeHtml(displayValue(line.description))}</strong><span>จำนวน ${escapeHtml(displayValue(line.quantity))} × ${escapeHtml(displayValue(line.unitCost))}</span></li>
        `).join("")}</ol></div>`
      : '<div class="workflow-review-section"><h3>รายการ</h3><p>ยังไม่มีรายการ</p></div>';
    const fileMarkup = files.length
      ? `<div class="workflow-review-section"><h3>ไฟล์แนบ (${files.length})</h3><ul class="workflow-review-files">${files.map((file) => {
          const name = typeof file === "string" ? file : file?.name || file?.path || "ไฟล์แนบ";
          const url = typeof file === "object" ? file?.url : "";
          return `<li>${url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(name)}</a>` : escapeHtml(name)}</li>`;
        }).join("")}</ul></div>`
      : '<div class="workflow-review-section"><h3>ไฟล์แนบ</h3><p>ไม่มีไฟล์แนบ</p></div>';
    container.innerHTML = `
      <div class="workflow-review-heading"><strong>${escapeHtml(displayValue(model.documentLabel))}</strong><span>${escapeHtml(displayValue(model.documentNo))}</span></div>
      <dl class="workflow-review-fields">${fieldMarkup}</dl>
      ${lineMarkup}
      ${fileMarkup}
    `;
  }

  function create(options = {}) {
    const dialog = options.dialog;
    const content = options.content;
    const title = options.title;
    const confirm = options.confirm;
    const reject = options.reject;
    const cancel = options.cancel;
    const reasonField = options.reasonField;
    const reasonInput = options.reasonInput;
    const reasonError = options.reasonError;
    let pending = null;

    function close() {
      if (dialog) dialog.hidden = true;
      if (reasonField) reasonField.hidden = true;
      if (reasonInput) reasonInput.value = "";
      if (reasonError) reasonError.textContent = "";
      pending = null;
    }

    function open(model) {
      pending = model;
      if (title) title.textContent = model.mode === "approve" ? "ตรวจสอบเอกสารก่อนอนุมัติ" : "ตรวจสอบเอกสารก่อนส่งตรวจอนุมัติ";
      renderReview(content, model);
      const approving = model.mode === "approve";
      if (reject) reject.hidden = !approving;
      if (confirm) confirm.textContent = approving ? "ยืนยันอนุมัติ" : "ยืนยันส่งตรวจอนุมัติ";
      if (reasonField) reasonField.hidden = true;
      if (reasonInput) reasonInput.value = "";
      if (reasonError) reasonError.textContent = "";
      if (dialog) dialog.hidden = false;
      if (typeof confirm?.focus === "function") confirm.focus();
    }

    confirm?.addEventListener("click", async () => {
      if (!pending?.onConfirm) return;
      const action = pending.onConfirm;
      close();
      await action();
    });
    reject?.addEventListener("click", async () => {
      if (!pending?.onReject) return;
      const reason = String(reasonInput?.value || "").trim();
      if (!reason) {
        if (reasonField) reasonField.hidden = false;
        if (reasonError) reasonError.textContent = "กรุณาระบุเหตุผลที่ไม่อนุมัติ";
        reasonInput?.focus?.();
        return;
      }
      const action = pending.onReject;
      close();
      await action(reason);
    });
    cancel?.addEventListener("click", close);
    dialog?.addEventListener("click", (event) => { if (event.target === dialog) close(); });
    dialog?.addEventListener("keydown", (event) => { if (event.key === "Escape") close(); });

    return { open, close, isOpen: () => !!dialog && !dialog.hidden };
  }

  root.WorkflowReviewModal = { create };
}(typeof window !== "undefined" ? window : globalThis));
