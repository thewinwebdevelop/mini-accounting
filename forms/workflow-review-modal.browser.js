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
    const summary = `
      <div class="workflow-review-heading"><strong>${escapeHtml(displayValue(model.documentLabel))}</strong><span>${escapeHtml(displayValue(model.documentNo))}</span></div>
      <dl class="workflow-review-fields">${fieldMarkup}</dl>
      ${lineMarkup}
      ${fileMarkup}
    `;
    container.innerHTML = model.mode !== "approve" ? summary : `
      <div class="review-tabs" role="tablist" aria-label="ตรวจสอบเอกสาร">
        <button id="reviewSummaryTab" role="tab" type="button" aria-selected="true" aria-controls="reviewSummary">ข้อมูลสรุป</button>
        <button id="reviewPdfTab" role="tab" type="button" aria-selected="false" aria-controls="reviewPdf" tabindex="-1">PDF ฉบับเต็ม</button>
      </div>
      <div id="reviewSummary" role="tabpanel" aria-labelledby="reviewSummaryTab">${summary}</div>
      <div id="reviewPdf" role="tabpanel" aria-labelledby="reviewPdfTab" hidden>
        <p role="status"></p>
        <button type="button" class="button secondary" data-retry-pdf hidden>ลองโหลด PDF อีกครั้ง</button>
        <a data-open-pdf target="_blank" rel="noopener" hidden>เปิด PDF เต็มจอ</a>
        <div data-pagination hidden>
          <button type="button" class="button secondary" data-previous disabled>หน้าก่อนหน้า</button>
          <button type="button" class="button secondary" data-next disabled>หน้าถัดไป</button>
        </div>
        <canvas role="img" hidden></canvas>
      </div>`;
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

    let preview = null;

    function clearPreview() {
      preview?.abort();
      preview = null;
    }

    async function loadPreview() {
      if (preview || !pending) return;
      const controller = new AbortController();
      preview = controller;
      const panel = content.querySelector("#reviewPdf");
      const status = panel.querySelector('[role="status"]');
      const retry = panel.querySelector("[data-retry-pdf]");
      retry.hidden = true;
      status.textContent = "กำลังโหลด PDF…";
      try {
        const options = { cache: "no-store", signal: controller.signal };
        const response = await fetch(pending.detailUrl, options);
        if (!response.ok) throw new Error();
        const record = await response.json();
        const files = (record.pdfFiles || record.payload?.pdfFiles || []).filter(file => file?.url);
        const file = files.find(file => /audit-packet\.pdf$/i.test(file.name)) || files[0];
        if (!file) throw new Error();
        const url = new URL(file.url, location.origin);
        if (url.origin !== location.origin) throw new Error();
        const pdf = await fetch(url, options);
        if (!pdf.ok) throw new Error();
        const blob = await pdf.blob();
        if (await blob.slice(0, 5).text() !== "%PDF-") throw new Error();
        if (controller.signal.aborted) return;
        const link = panel.querySelector("[data-open-pdf]");
        link.href = url.href;
        link.hidden = false;
        const { showPdf } = await import("/workflow-pdf-preview.mjs");
        await showPdf(panel, blob, controller.signal);
      } catch {
        if (!controller.signal.aborted) {
          status.textContent = "โหลด PDF ไม่สำเร็จ";
          retry.hidden = false;
        }
      }
    }

    function selectTab(tab) {
      const showPdf = tab.id === "reviewPdfTab";
      for (const button of content.querySelectorAll('[role="tab"]')) {
        const selected = tab === button;
        button.setAttribute("aria-selected", String(selected));
        button.tabIndex = selected ? 0 : -1;
        content.querySelector("#" + button.getAttribute("aria-controls")).hidden = !selected;
      }
      if (showPdf) loadPreview();
    }

    content?.addEventListener("click", event => {
      const tab = event.target.closest('[role="tab"]');
      if (tab) selectTab(tab);
      if (event.target.closest("[data-retry-pdf]")) {
        clearPreview();
        loadPreview();
      }
    });
    content?.addEventListener("keydown", event => {
      if (event.target.getAttribute("role") !== "tab") return;
      const tabs = Array.from(content.querySelectorAll('[role="tab"]'));
      let next;
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") next = tabs.find(tab => tab !== event.target);
      if (event.key === "Home") next = tabs[0];
      if (event.key === "End") next = tabs[1];
      if (next) {
        event.preventDefault();
        next.focus();
        selectTab(next);
      }
    });

    function close() {
      clearPreview();
      if (dialog) dialog.hidden = true;
      if (reasonField) reasonField.hidden = true;
      if (reasonInput) reasonInput.value = "";
      if (reasonError) reasonError.textContent = "";
      pending = null;
    }

    function open(model) {
      clearPreview();
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
