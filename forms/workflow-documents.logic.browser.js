// Controller for /workflow-documents?documentKind=... -- the standalone list
// page for the five lightweight document kinds that share
// forms/workflow-document.html (purchase_order, payment_voucher,
// cash_spend_declaration, payee_acknowledgement, goods_receipt).
//
// Modelled on forms/substitute-receipts.logic.browser.js (filters bar, one
// table row per document rendered with escapeHtml, PDF/Raw file menus). The
// accounting month and status filters are sent to GET /api/workflow-documents,
// which pushes them down to the documents index; the search box filters the
// loaded rows locally, the same way the substitute-receipt list does.
//
// Classic script, loaded after workflow.logic.js (window.WorkflowLogic, for
// kind labels) and workflow-document.logic.js (window.WorkflowDocumentLogic,
// for the kind list and status labels). Wrapped in an IIFE because those two
// scripts declare top-level names (cleanText, money, ...) in the same global
// scope.
(function () {
  const workflowLogic = window.WorkflowLogic;
  const documentLogic = window.WorkflowDocumentLogic;
  const DOCUMENT_KINDS = documentLogic.LIGHTWEIGHT_DOCUMENT_KINDS;
  const STATUS_LABELS = documentLogic.WORKFLOW_DOCUMENT_STATUS_LABELS;
  const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
  const LIST_PATH = "/workflow-documents";

  const rows = document.querySelector("#workflowDocumentRows");
  const kindTabs = document.querySelector("#documentKindTabs");
  const monthFilter = document.querySelector("#accountingMonthFilter");
  const statusFilter = document.querySelector("#statusFilter");
  const searchText = document.querySelector("#searchText");
  const listStatus = document.querySelector("#listStatus");
  const emptyState = document.querySelector("#emptyState");
  const errorState = document.querySelector("#errorState");
  const pageTitle = document.querySelector("#pageTitle");
  const createLink = document.querySelector("#createDocumentLink");

  const query = new URLSearchParams(location.search);
  const requestedKind = query.get("documentKind") || "";
  const documentKind = DOCUMENT_KINDS.includes(requestedKind) ? requestedKind : DOCUMENT_KINDS[0];
  let allDocuments = [];
  let latestRequest = 0;

  function escapeHtml(value = "") {
    return String(value).replace(/[&<>"']/g, (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#39;",
    })[character]);
  }

  function kindLabel(kind) {
    return workflowLogic?.getDocumentTypeDefinition?.(kind)?.label || kind;
  }

  function isKnownStatus(status) {
    return Object.prototype.hasOwnProperty.call(STATUS_LABELS, status);
  }

  function statusLabel(doc) {
    return doc.statusLabel || STATUS_LABELS[doc.status] || doc.status || "-";
  }

  function formatAmount(value) {
    if (value === undefined || value === null || value === "") return "-";
    return Number(value).toLocaleString("th-TH", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  function currentFilters() {
    return {
      accountingMonth: MONTH_PATTERN.test(monthFilter.value) ? monthFilter.value : "",
      status: isKnownStatus(statusFilter.value) ? statusFilter.value : "",
    };
  }

  function filterParams(kind) {
    const params = new URLSearchParams();
    params.set("documentKind", kind);
    const { accountingMonth, status } = currentFilters();
    if (accountingMonth) params.set("accountingMonth", accountingMonth);
    if (status) params.set("status", status);
    return params;
  }

  // Keeps the address bar deep-linkable: reloading or sharing the URL
  // reopens the same kind with the same month/status filters.
  function syncUrl() {
    try {
      window.history?.replaceState?.(null, "", `${LIST_PATH}?${filterParams(documentKind).toString()}`);
    } catch {
      // Some embedded browsers refuse replaceState; the page still works.
    }
  }

  // One link per kind. Switching kind is a real navigation to that kind's
  // own URL, carrying the current month/status filters along.
  function renderKindTabs() {
    kindTabs.replaceChildren();
    for (const kind of DOCUMENT_KINDS) {
      const tab = document.createElement("a");
      tab.className = kind === documentKind ? "kind-tab active" : "kind-tab";
      tab.setAttribute("href", `${LIST_PATH}?${filterParams(kind).toString()}`);
      if (kind === documentKind) tab.setAttribute("aria-current", "page");
      tab.textContent = kindLabel(kind);
      kindTabs.append(tab);
    }
  }

  function applyPageHeading() {
    const label = kindLabel(documentKind);
    pageTitle.textContent = `รายการ${label}`;
    document.title = `รายการ${label} - หจก.สวีทเฮาส์`;
    // A blank standalone form of this kind: no documentNo, no transactionNo.
    createLink.setAttribute("href", `/workflow-document?documentKind=${encodeURIComponent(documentKind)}`);
    createLink.textContent = `สร้าง${label}ใหม่`;
  }

  function matchesSearch(doc, term) {
    if (!term) return true;
    const haystack = [
      doc.documentNo,
      doc.title,
      doc.payeeName,
      doc.requesterName,
      doc.transactionNo,
      doc.accountingMonth,
      doc.documentDate,
    ].join(" ").toLowerCase();
    return haystack.includes(term);
  }

  function fileMenu(label, files) {
    if (!Array.isArray(files) || !files.length) return `<span class="muted">ไม่มี ${escapeHtml(label)}</span>`;
    return `
      <details class="file-menu">
        <summary class="button secondary small">${escapeHtml(label)} (${files.length})</summary>
        <div class="file-list">
          ${files.map((file) => `<a class="file-link" href="${escapeHtml(file.url)}" target="_blank" rel="noreferrer">${escapeHtml(file.name || file.path || "file")}</a>`).join("")}
        </div>
      </details>
    `;
  }

  // Only a document that belongs to a workflow transaction gets a badge.
  function transactionBadge(doc) {
    if (!doc.transactionNo) return "";
    const href = `/workflow-transaction?transactionNo=${encodeURIComponent(doc.transactionNo)}`;
    return `<a class="transaction-badge" href="${escapeHtml(href)}">Workflow ${escapeHtml(doc.transactionNo)}</a>`;
  }

  function actionHtml(doc) {
    const openUrl = `/workflow-document?documentKind=${encodeURIComponent(doc.documentKind || documentKind)}&documentNo=${encodeURIComponent(doc.documentNo || "")}`;
    const openLabel = doc.status === "draft" ? "แก้ไขต่อ" : "ดูเอกสาร";
    return `
      <div class="actions">
        <a class="button primary small" data-open-document href="${escapeHtml(openUrl)}">${openLabel}</a>
        ${fileMenu("PDF", doc.pdfFiles)}
        ${fileMenu("Raw", doc.rawFiles)}
      </div>
    `;
  }

  function render() {
    const term = searchText.value.trim().toLowerCase();
    const documents = allDocuments.filter((doc) => matchesSearch(doc, term));

    rows.innerHTML = "";
    emptyState.hidden = documents.length > 0;
    errorState.hidden = true;
    listStatus.textContent = documents.length ? `พบ ${documents.length} รายการ` : "ไม่พบรายการ";

    for (const doc of documents) {
      const row = document.createElement("tr");
      row.innerHTML = `
        <td data-column="status"><span class="mobile-label">สถานะ</span><span class="status ${escapeHtml(doc.status)}">${escapeHtml(statusLabel(doc))}</span></td>
        <td data-column="documentNo"><span class="mobile-label">เลขเอกสาร</span><div><div class="title">${escapeHtml(doc.documentNo || "-")}</div>${transactionBadge(doc)}</div></td>
        <td data-column="documentDate"><span class="mobile-label">วันที่เอกสาร</span>${escapeHtml(doc.documentDate || "-")}</td>
        <td data-column="title">
          <span class="mobile-label">รายการ</span>
          <div>
            <div class="title">${escapeHtml(doc.title || "ยังไม่ได้ตั้งชื่อ")}</div>
            <div class="muted">${escapeHtml(doc.folderPath || "")}</div>
          </div>
        </td>
        <td data-column="payee"><span class="mobile-label">ผู้รับเงิน</span>${escapeHtml(doc.payeeName || "-")}</td>
        <td data-column="total"><span class="mobile-label">ยอดรวม</span>${formatAmount(doc.totalAmount)}</td>
        <td data-column="actions"><span class="mobile-label">จัดการ</span>${actionHtml(doc)}</td>
      `;
      rows.append(row);
    }
  }

  async function loadDocuments() {
    const requestId = ++latestRequest;
    listStatus.textContent = "กำลังโหลดรายการ...";
    errorState.hidden = true;
    try {
      const response = await fetch(`/api/workflow-documents?${filterParams(documentKind).toString()}`);
      const result = await response.json();
      // A slower response for an older filter must not overwrite a newer one.
      if (requestId !== latestRequest) return;
      if (!response.ok) throw new Error(result.error || "โหลดรายการไม่สำเร็จ");
      allDocuments = Array.isArray(result.documents) ? result.documents : [];
      render();
    } catch {
      if (requestId !== latestRequest) return;
      allDocuments = [];
      rows.innerHTML = "";
      emptyState.hidden = true;
      errorState.hidden = false;
      listStatus.textContent = "โหลดรายการไม่สำเร็จ";
    }
  }

  function onServerFilterChange() {
    syncUrl();
    renderKindTabs();
    loadDocuments();
  }

  const initialMonth = query.get("accountingMonth") || "";
  monthFilter.value = MONTH_PATTERN.test(initialMonth) ? initialMonth : "";
  const initialStatus = query.get("status") || "";
  statusFilter.value = isKnownStatus(initialStatus) ? initialStatus : "all";

  monthFilter.addEventListener("change", onServerFilterChange);
  statusFilter.addEventListener("change", onServerFilterChange);
  searchText.addEventListener("input", render);

  applyPageHeading();
  renderKindTabs();
  syncUrl();
  loadDocuments();
}());
