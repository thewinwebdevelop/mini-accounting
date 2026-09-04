const rows = document.querySelector("#substituteReceiptRows");
const statusFilter = document.querySelector("#statusFilter");
const searchText = document.querySelector("#searchText");
const listStatus = document.querySelector("#listStatus");
const emptyState = document.querySelector("#emptyState");
const errorState = document.querySelector("#errorState");
let allReceipts = [];

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[character]);
}

function statusLabel(receipt) {
  return receipt.statusLabel || {
    draft: "แบบร่าง",
    pending_approval: "รอตรวจอนุมัติ",
    approved: "อนุมัติแล้ว",
    received: "รับเข้าคลังแล้ว",
    cancelled: "ยกเลิก",
  }[receipt.status] || receipt.status || "-";
}

function formatAmount(value) {
  if (value === undefined || value === null || value === "") return "-";
  return Number(value).toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function matchesSearch(receipt, term) {
  if (!term) return true;
  const haystack = [
    receipt.receiptNo,
    receipt.draftId,
    receipt.receiptTitle,
    receipt.payeeName,
    receipt.accountingMonth,
    receipt.folderPath,
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

function actionHtml(receipt) {
  const editUrl = receipt.editUrl || "/substitute-receipt";
  const actionLabel = receipt.nextAction || "ดูเอกสาร";
  const pdfMenu = fileMenu("PDF", receipt.pdfFiles);
  const rawMenu = fileMenu("Raw", receipt.rawFiles);

  return `
    <div class="actions">
      <a class="button primary small" href="${escapeHtml(editUrl)}">${escapeHtml(actionLabel)}</a>
      ${pdfMenu}
      ${rawMenu}
    </div>
  `;
}

function render() {
  const status = statusFilter.value;
  const term = searchText.value.trim().toLowerCase();
  const receipts = allReceipts.filter((receipt) => {
    const statusMatches = status === "all" || receipt.status === status;
    return statusMatches && matchesSearch(receipt, term);
  });

  rows.innerHTML = "";
  emptyState.hidden = receipts.length > 0;
  errorState.hidden = true;
  listStatus.textContent = receipts.length ? `พบ ${receipts.length} รายการ` : "ไม่พบรายการ";

  for (const receipt of receipts) {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td><span class="mobile-label">สถานะ</span><span class="status ${escapeHtml(receipt.status)}">${escapeHtml(statusLabel(receipt))}</span></td>
      <td><span class="mobile-label">เลข/เดือน</span>${escapeHtml(receipt.receiptNo || receipt.draftId || receipt.accountingMonth || "-")}</td>
      <td>
        <span class="mobile-label">รายการ</span>
        <div class="title">${escapeHtml(receipt.receiptTitle || "ยังไม่ได้ตั้งชื่อ")}</div>
        <div class="muted">${escapeHtml(receipt.folderPath || "")}</div>
      </td>
      <td><span class="mobile-label">ผู้รับเงิน</span>${escapeHtml(receipt.payeeName || "-")}</td>
      <td><span class="mobile-label">ยอดรวม</span>${formatAmount(receipt.totalAmount)}</td>
      <td><span class="mobile-label">จัดการ</span>${actionHtml(receipt)}</td>
    `;
    rows.append(row);
  }
}

async function loadReceipts() {
  listStatus.textContent = "กำลังโหลดรายการ...";
  errorState.hidden = true;
  try {
    const response = await fetch("/api/substitute-receipts");
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Cannot load substitute receipts");
    allReceipts = Array.isArray(result.receipts) ? result.receipts : [];
    render();
  } catch {
    rows.innerHTML = "";
    emptyState.hidden = true;
    errorState.hidden = false;
    listStatus.textContent = "โหลดรายการไม่สำเร็จ";
  }
}

const initialStatus = new URLSearchParams(location.search).get("status");
if (["all", "draft", "pending_approval", "approved", "received", "cancelled"].includes(initialStatus)) {
  statusFilter.value = initialStatus;
}
statusFilter.addEventListener("change", render);
searchText.addEventListener("input", render);
loadReceipts();
