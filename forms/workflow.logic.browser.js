// Shared browser controller for the workflow feature.
//
// This one file is loaded by every workflow page: the template settings page
// (forms/workflow-templates.html), and the transaction list / transaction
// detail pages (forms/workflow-transactions.html, forms/workflow-transaction.
// html) added in this pass. The DOMContentLoaded dispatch at the bottom looks
// for the page-specific root element that is actually present in the DOM and
// wires up only that page, so multiple pages can share this one script
// without stepping on each other. `state` and the shared helpers (fetchJson,
// getQueryParam, escapeHtml, status-box helpers) live at module scope so
// every page's section can reuse them instead of duplicating fetch/error
// handling.
//
// Functions still to come from later tasks, extending this same file:
//   - completeTransaction() and syncTransactionDrive() (Task 11), added to
//     renderTransaction() once transaction completion and Drive sync exist
//     server-side.

const WORKFLOW_PACKET_PDF_FILE_NAME = "99_ชุดรวมเอกสาร_workflow-transaction.pdf";

const state = {
  documentTypes: [],
  templates: [],
  currentTemplate: null,
};

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers || {}),
    },
  });
  let result = {};
  try {
    result = await response.json();
  } catch (error) {
    result = {};
  }
  if (!response.ok) {
    throw new Error(result.error || "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง");
  }
  return result;
}

function getQueryParam(name) {
  return new URLSearchParams(location.search).get(name);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function setStatusBox(element, message, kind = "") {
  if (!element) return;
  element.className = `status-box active ${kind}`.trim();
  element.textContent = message;
}

function clearStatusBox(element) {
  if (!element) return;
  element.className = "status-box";
  element.textContent = "";
}

// ---------------------------------------------------------------------------
// Template page (forms/workflow-templates.html)
// ---------------------------------------------------------------------------

function documentKindLabel(documentKind) {
  const match = state.documentTypes.find((type) => type.documentKind === documentKind);
  return match ? match.label : documentKind;
}

function blankTemplate() {
  return {
    templateId: "",
    name: "",
    description: "",
    syncGoogleDrive: false,
    documentSteps: [],
  };
}

function generateTemplateId() {
  return `template-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function renderTemplateOptions() {
  const select = document.querySelector("#templateSelect");
  if (!select) return;
  select.replaceChildren();
  const blankOption = document.createElement("option");
  blankOption.value = "";
  blankOption.textContent = "+ สร้าง Template ใหม่";
  select.appendChild(blankOption);
  for (const template of state.templates) {
    const option = document.createElement("option");
    option.value = template.templateId;
    option.textContent = template.name || template.templateId;
    select.appendChild(option);
  }
  select.value = state.currentTemplate?.templateId || "";
}

function renderDocumentKindOptions() {
  const select = document.querySelector("#documentKindSelect");
  if (!select) return;
  select.replaceChildren();
  for (const type of state.documentTypes) {
    const option = document.createElement("option");
    option.value = type.documentKind;
    option.textContent = type.label;
    select.appendChild(option);
  }
}

function renderDocumentStepsList() {
  const list = document.querySelector("#documentStepsList");
  const template = document.querySelector("#documentStepTemplate");
  if (!list || !template) return;

  list.replaceChildren();
  const steps = (state.currentTemplate && state.currentTemplate.documentSteps) || [];

  if (!steps.length) {
    const empty = document.createElement("li");
    empty.className = "empty-row";
    empty.textContent = "ยังไม่มีเอกสารในลำดับ Workflow นี้";
    list.appendChild(empty);
    return;
  }

  steps.forEach((step, index) => {
    const fragment = template.content.cloneNode(true);
    const row = fragment.querySelector(".step-row");
    row.querySelector(".step-order").textContent = String(index + 1);
    row.querySelector(".step-label").textContent = documentKindLabel(step.documentKind);

    const upButton = row.querySelector('[data-move-step="up"]');
    const downButton = row.querySelector('[data-move-step="down"]');
    const removeButton = row.querySelector("[data-remove-step]");

    upButton.disabled = index === 0;
    downButton.disabled = index === steps.length - 1;

    upButton.addEventListener("click", () => moveDocumentStep(index, "up"));
    downButton.addEventListener("click", () => moveDocumentStep(index, "down"));
    removeButton.addEventListener("click", () => removeDocumentStep(index));

    list.appendChild(fragment);
  });
}

function fillTemplateForm() {
  const template = state.currentTemplate || blankTemplate();
  const nameInput = document.querySelector("#templateName");
  const descriptionInput = document.querySelector("#templateDescription");
  const syncInput = document.querySelector("#templateSyncGoogleDrive");
  if (nameInput) nameInput.value = template.name || "";
  if (descriptionInput) descriptionInput.value = template.description || "";
  if (syncInput) syncInput.checked = !!template.syncGoogleDrive;
  renderDocumentStepsList();
}

// Renders the whole template page from server data: the template picker, the
// document-kind picker, and the currently selected (or blank, for "create
// new") template's fields and ordered step list.
function renderTemplateEditor(documentTypes, templates) {
  state.documentTypes = documentTypes || [];
  state.templates = templates || [];
  if (!state.currentTemplate) state.currentTemplate = blankTemplate();
  renderTemplateOptions();
  renderDocumentKindOptions();
  fillTemplateForm();
}

// Reads the ordered document kinds and the syncGoogleDrive toggle straight
// from the DOM/state. There is no syncGoogleSheets field anywhere: the
// workflow layer never writes its own Sheets row (see decision D6) because
// each child document already writes its own row for the real amount, and a
// transaction bundles several of those documents for the same money.
function collectTemplatePayload() {
  const nameInput = document.querySelector("#templateName");
  const descriptionInput = document.querySelector("#templateDescription");
  const syncInput = document.querySelector("#templateSyncGoogleDrive");
  const steps = (state.currentTemplate && state.currentTemplate.documentSteps) || [];

  return {
    templateId: (state.currentTemplate && state.currentTemplate.templateId) || "",
    name: nameInput ? nameInput.value.trim() : "",
    description: descriptionInput ? descriptionInput.value.trim() : "",
    syncGoogleDrive: syncInput ? !!syncInput.checked : false,
    documentSteps: steps.map((step) => ({ documentKind: step.documentKind })),
  };
}

function selectTemplate(templateId) {
  state.currentTemplate = templateId
    ? (state.templates.find((template) => template.templateId === templateId) || blankTemplate())
    : blankTemplate();
  fillTemplateForm();
}

function addDocumentStep(documentKind) {
  if (!documentKind) return;
  if (!state.currentTemplate) state.currentTemplate = blankTemplate();
  state.currentTemplate.documentSteps = [
    ...(state.currentTemplate.documentSteps || []),
    { documentKind },
  ];
  renderDocumentStepsList();
}

function moveDocumentStep(index, direction) {
  const steps = state.currentTemplate && state.currentTemplate.documentSteps;
  if (!steps) return;
  const targetIndex = direction === "up" ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= steps.length) return;
  const [moved] = steps.splice(index, 1);
  steps.splice(targetIndex, 0, moved);
  renderDocumentStepsList();
}

function removeDocumentStep(index) {
  const steps = state.currentTemplate && state.currentTemplate.documentSteps;
  if (!steps) return;
  steps.splice(index, 1);
  renderDocumentStepsList();
}

async function loadTemplatePageData() {
  const root = document.querySelector("#templatePage");
  const documentTypesUrl = (root && root.dataset.documentTypesUrl) || "/api/workflow-document-types";
  const templatesUrl = (root && root.dataset.templatesUrl) || "/api/workflow-templates";

  const [documentTypesResult, templatesResult] = await Promise.all([
    fetchJson(documentTypesUrl),
    fetchJson(templatesUrl),
  ]);
  renderTemplateEditor(documentTypesResult.documentTypes, templatesResult.templates);
}

async function saveTemplate() {
  const payload = collectTemplatePayload();
  if (!payload.name) throw new Error("ระบุชื่อ template");
  if (!payload.documentSteps.length) throw new Error("ระบุเอกสารอย่างน้อย 1 ฉบับ ในลำดับ Workflow");
  if (!payload.templateId) payload.templateId = generateTemplateId();

  const root = document.querySelector("#templatePage");
  const templatesUrl = (root && root.dataset.templatesUrl) || "/api/workflow-templates";

  const saved = await fetchJson(templatesUrl, {
    method: "POST",
    body: JSON.stringify(payload),
  });

  const { templates } = await fetchJson(templatesUrl);
  state.templates = templates;
  state.currentTemplate = templates.find((template) => template.templateId === saved.templateId) || saved;
  renderTemplateOptions();
  fillTemplateForm();
  return saved;
}

function initTemplatePage() {
  const templateSelect = document.querySelector("#templateSelect");
  const addStepButton = document.querySelector("#addDocumentStep");
  const documentKindSelect = document.querySelector("#documentKindSelect");
  const saveButton = document.querySelector("#saveTemplate");
  const statusBox = document.querySelector("#templateStatus");
  const form = document.querySelector("#templateEditorForm");

  if (form) form.addEventListener("submit", (event) => event.preventDefault());

  templateSelect.addEventListener("change", (event) => {
    selectTemplate(event.target.value);
  });

  addStepButton.addEventListener("click", () => {
    addDocumentStep(documentKindSelect.value);
  });

  saveButton.addEventListener("click", () => {
    clearStatusBox(statusBox);
    saveTemplate()
      .then((saved) => setStatusBox(statusBox, `บันทึก template "${saved.name}" แล้ว`, "success"))
      .catch((error) => setStatusBox(statusBox, error.message, "error"));
  });

  loadTemplatePageData().catch((error) => setStatusBox(statusBox, error.message, "error"));
}

// ---------------------------------------------------------------------------
// Shared workflow/transaction status labels
// ---------------------------------------------------------------------------

const WORKFLOW_STEP_STATUS_LABELS = {
  not_started: "ยังไม่เริ่ม",
  in_progress: "กำลังดำเนินการ",
  completed: "เสร็จสิ้น",
  blocked: "รอขั้นตอนก่อนหน้า",
};

const TRANSACTION_STATUS_LABELS = {
  in_progress: "กำลังดำเนินการ",
  completed: "เสร็จสมบูรณ์",
};

function workflowStepStatusLabel(status) {
  return WORKFLOW_STEP_STATUS_LABELS[status] || status || "-";
}

function transactionStatusLabel(status) {
  return TRANSACTION_STATUS_LABELS[status] || status || "-";
}

function documentKindLabelFor(documentKind) {
  return window.WorkflowLogic?.getDocumentTypeDefinition?.(documentKind)?.label || documentKind;
}

// ---------------------------------------------------------------------------
// Transaction list page (forms/workflow-transactions.html)
// ---------------------------------------------------------------------------

const transactionsListState = {
  templates: [],
  transactions: [],
};

function renderStartTemplateOptions(select, templates) {
  select.replaceChildren();
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "เลือก Template";
  select.appendChild(placeholder);
  for (const template of templates) {
    const option = document.createElement("option");
    option.value = template.templateId;
    option.textContent = template.name || template.templateId;
    select.appendChild(option);
  }
}

// Finds the transaction's current step and reports the document kind it is
// waiting on, so the list page can show at a glance what still needs doing
// without the reader having to open every transaction.
function currentStepLabelForTransaction(transaction) {
  const steps = transaction.steps || [];
  const step = steps.find((item) => item.stepId === transaction.currentStepId);
  if (!step) {
    return transaction.status === "completed" ? "เสร็จสมบูรณ์ทุกขั้นตอน" : "-";
  }
  return documentKindLabelFor(step.documentKind);
}

function renderTransactionRows(list, transactions) {
  list.replaceChildren();

  if (!transactions.length) {
    const emptyRow = document.createElement("tr");
    const emptyCell = document.createElement("td");
    emptyCell.className = "empty-row";
    emptyCell.textContent = "ยังไม่มีธุรกรรม";
    emptyRow.appendChild(emptyCell);
    list.appendChild(emptyRow);
    return;
  }

  for (const transaction of transactions) {
    const row = document.createElement("tr");

    const statusCell = document.createElement("td");
    const statusBadge = document.createElement("span");
    statusBadge.className = `status ${transaction.status || ""}`.trim();
    statusBadge.textContent = transactionStatusLabel(transaction.status);
    statusCell.appendChild(statusBadge);

    const noCell = document.createElement("td");
    noCell.textContent = transaction.transactionNo || "-";

    const titleCell = document.createElement("td");
    titleCell.textContent = transaction.title || "-";

    const templateCell = document.createElement("td");
    templateCell.textContent = transaction.templateSnapshot?.name || transaction.workflowTemplateId || "-";

    const currentStepCell = document.createElement("td");
    currentStepCell.textContent = currentStepLabelForTransaction(transaction);

    const actionCell = document.createElement("td");
    const openLink = document.createElement("a");
    openLink.className = "button secondary small";
    openLink.href = `/workflow-transaction?transactionNo=${encodeURIComponent(transaction.transactionNo)}`;
    openLink.textContent = "เปิดธุรกรรม";
    actionCell.appendChild(openLink);

    row.append(statusCell, noCell, titleCell, templateCell, currentStepCell, actionCell);
    list.appendChild(row);
  }
}

function collectStartTransactionPayload() {
  const templateSelect = document.querySelector("#startTemplateSelect");
  const accountingMonthInput = document.querySelector("#startAccountingMonth");
  const titleInput = document.querySelector("#startTransactionTitle");
  return {
    templateId: templateSelect ? templateSelect.value : "",
    accountingMonth: accountingMonthInput ? accountingMonthInput.value : "",
    title: titleInput ? titleInput.value.trim() : "",
  };
}

async function loadTransactionsPageData() {
  const root = document.querySelector("#transactionsPage");
  const templatesUrl = (root && root.dataset.templatesUrl) || "/api/workflow-templates";
  const transactionsUrl = (root && root.dataset.transactionsUrl) || "/api/workflow-transactions";

  const [templatesResult, transactionsResult] = await Promise.all([
    fetchJson(templatesUrl),
    fetchJson(transactionsUrl),
  ]);

  transactionsListState.templates = templatesResult.templates || [];
  transactionsListState.transactions = transactionsResult.transactions || [];

  renderStartTemplateOptions(document.querySelector("#startTemplateSelect"), transactionsListState.templates);
  renderTransactionRows(document.querySelector("#transactionRows"), transactionsListState.transactions);
}

async function startTransaction() {
  const payload = collectStartTransactionPayload();
  if (!payload.templateId) throw new Error("เลือก template ที่ต้องการเริ่ม");
  if (!payload.accountingMonth) throw new Error("ระบุเดือนบัญชี");
  if (!payload.title) throw new Error("ระบุชื่อธุรกรรม");

  const root = document.querySelector("#transactionsPage");
  const transactionsUrl = (root && root.dataset.transactionsUrl) || "/api/workflow-transactions";

  const transaction = await fetchJson(transactionsUrl, {
    method: "POST",
    body: JSON.stringify(payload),
  });

  location.href = `/workflow-transaction?transactionNo=${encodeURIComponent(transaction.transactionNo)}`;
  return transaction;
}

function initTransactionsPage() {
  const form = document.querySelector("#startTransactionForm");
  const startButton = document.querySelector("#startTransactionButton");
  const statusBox = document.querySelector("#startTransactionStatus");

  if (form) form.addEventListener("submit", (event) => event.preventDefault());

  startButton.addEventListener("click", () => {
    clearStatusBox(statusBox);
    startTransaction().catch((error) => setStatusBox(statusBox, error.message, "error"));
  });

  loadTransactionsPageData().catch((error) => setStatusBox(statusBox, error.message, "error"));
}

// ---------------------------------------------------------------------------
// Transaction detail page (forms/workflow-transaction.html)
// ---------------------------------------------------------------------------

const transactionPageState = {
  transaction: null,
  childDocuments: [],
};

function transactionNoFromQuery() {
  return getQueryParam("transactionNo") || "";
}

// The transaction detail/refresh responses (GET /api/workflow-transactions/:id
// and POST .../refresh — see getWorkflowTransactionDetail/refreshWorkflowTransaction
// in forms/local-server.logic.js) now carry a `childDocuments` array directly,
// already normalized (documentKind, documentNo, native status/label,
// workflowStepId, pdfFiles, rawFiles with working URLs) across all three
// storage families (lightweight workflow-documents, expense requests,
// substitute receipts). This page renders straight from that array instead of
// re-fetching and re-normalizing each family itself.
function findChildDocumentForStep(childDocuments, step) {
  return childDocuments.find((doc) => doc.workflowStepId === step.stepId)
    || childDocuments.find((doc) => !doc.workflowStepId && doc.documentKind === step.documentKind);
}

function renderTransactionHeader(transaction) {
  const numberEl = document.querySelector("#transactionNumber");
  const titleEl = document.querySelector("#transactionTitleDisplay");
  const templateEl = document.querySelector("#transactionTemplateName");
  if (numberEl) numberEl.textContent = transaction.transactionNo || "-";
  if (titleEl) titleEl.textContent = transaction.title || "-";
  if (templateEl) templateEl.textContent = transaction.templateSnapshot?.name || transaction.workflowTemplateId || "-";
}

// The packet PDF is a transaction-level summary/index (template, step
// statuses, every child document with its files) — not a replacement for any
// child document's own PDF. It only exists once refreshWorkflowTransaction
// has generated it (see forms/local-server.logic.js), so the link stays
// hidden until transaction.pdfFiles actually carries it, matching how every
// other conditional element on this page already behaves.
function renderWorkflowPacketLink(link, transaction) {
  if (!link) return;
  const packetFile = (transaction.pdfFiles || []).find((file) => file.name === WORKFLOW_PACKET_PDF_FILE_NAME);
  if (packetFile) {
    link.href = packetFile.url;
    link.hidden = false;
  } else {
    link.href = "#";
    link.hidden = true;
  }
}

function renderWorkflowProgress(container, transaction) {
  if (!container) return;
  const steps = transaction.steps || [];
  if (!steps.length) {
    container.textContent = "ไม่มีขั้นตอนใน Workflow นี้";
    return;
  }
  const completedCount = steps.filter((step) => step.workflowStatus === "completed").length;
  container.textContent = `${transactionStatusLabel(transaction.status)} — เสร็จสิ้นแล้ว ${completedCount} จาก ${steps.length} ขั้นตอน`;
}

function renderChecklist(list, template, transaction, childDocuments) {
  if (!list || !template) return;
  list.replaceChildren();

  const steps = transaction.steps || [];
  steps.forEach((step, index) => {
    const fragment = template.content.cloneNode(true);
    const row = fragment.querySelector(".checklist-item");
    row.querySelector(".step-order").textContent = String(index + 1);
    row.querySelector(".step-label").textContent = documentKindLabelFor(step.documentKind);

    const workflowStatusEl = row.querySelector(".workflow-status");
    workflowStatusEl.className = `status workflow-status ${step.workflowStatus || ""}`.trim();
    workflowStatusEl.textContent = workflowStepStatusLabel(step.workflowStatus);

    const childDoc = findChildDocumentForStep(childDocuments, step);
    const nativeStatusEl = row.querySelector(".native-status");
    const documentNoEl = row.querySelector(".document-no");
    if (childDoc) {
      const normalized = window.WorkflowLogic?.normalizeDocumentWorkflowStatus?.(childDoc) || {};
      const nativeLabel = normalized.nativeStatusLabel || childDoc.statusLabel || normalized.nativeStatus || childDoc.status;
      if (nativeLabel) {
        nativeStatusEl.hidden = false;
        nativeStatusEl.textContent = nativeLabel;
      }
      const documentNo = normalized.documentNo || childDoc.documentNo;
      if (documentNo) {
        documentNoEl.hidden = false;
        documentNoEl.textContent = documentNo;
      }
    }

    const actionButton = row.querySelector("[data-step-action]");
    const isCurrent = transaction.currentStepId === step.stepId;
    if (step.workflowStatus === "completed") {
      actionButton.textContent = "เสร็จสิ้นแล้ว";
      actionButton.disabled = true;
    } else if (isCurrent) {
      actionButton.textContent = step.workflowStatus === "in_progress" ? "ดำเนินการต่อ" : "เปิดเอกสาร";
      actionButton.disabled = false;
    } else {
      actionButton.textContent = "ยังไม่พร้อมใช้งาน";
      actionButton.disabled = true;
    }

    // Bound at render time (like the template page's step-row buttons
    // above), not via delegation, so a disabled button's own listener can
    // refuse the click before start-document is ever called — the UI-side
    // half of "not the only guard" (the server independently enforces the
    // same rule against a crafted request for a locked stepId).
    actionButton.addEventListener("click", () => {
      if (actionButton.disabled) return;
      const statusBox = document.querySelector("#transactionStatus");
      clearStatusBox(statusBox);
      startDocument(step.stepId).catch((error) => setStatusBox(statusBox, error.message, "error"));
    });

    list.appendChild(fragment);
  });
}

function fileGroupElements(label, files) {
  const wrapper = document.createElement("div");
  wrapper.className = "file-group";

  const heading = document.createElement("span");
  heading.className = "file-group-label";
  heading.textContent = `${label}:`;
  wrapper.appendChild(heading);

  if (!files || !files.length) {
    const empty = document.createElement("span");
    empty.className = "muted";
    empty.textContent = "ไม่มีไฟล์";
    wrapper.appendChild(empty);
    return wrapper;
  }

  for (const file of files) {
    const link = document.createElement("a");
    link.className = "file-link";
    link.href = file.url;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = file.name || file.path || "file";
    wrapper.appendChild(link);
  }
  return wrapper;
}

function renderChildDocumentFiles(container, transaction, childDocuments) {
  if (!container) return;
  container.replaceChildren();

  const steps = transaction.steps || [];
  const orderedDocs = steps
    .map((step) => findChildDocumentForStep(childDocuments, step))
    .filter(Boolean);

  if (!orderedDocs.length) {
    const empty = document.createElement("li");
    empty.className = "empty-row";
    empty.textContent = "ยังไม่มีเอกสารในธุรกรรมนี้";
    container.appendChild(empty);
    return;
  }

  for (const doc of orderedDocs) {
    const item = document.createElement("li");
    item.className = "child-document-files-item";

    const heading = document.createElement("div");
    heading.className = "title";
    heading.textContent = `${documentKindLabelFor(doc.documentKind)} (${doc.documentNo || "-"})`;
    item.appendChild(heading);

    const filesRow = document.createElement("div");
    filesRow.className = "file-groups";
    filesRow.appendChild(fileGroupElements("PDF", doc.pdfFiles));
    filesRow.appendChild(fileGroupElements("ไฟล์ต้นฉบับ", doc.rawFiles));
    item.appendChild(filesRow);

    container.appendChild(item);
  }
}

function renderTransaction(transaction, childDocuments = []) {
  transactionPageState.transaction = transaction;
  transactionPageState.childDocuments = childDocuments;

  renderTransactionHeader(transaction);
  renderWorkflowPacketLink(document.querySelector("#workflowPacketLink"), transaction);
  renderWorkflowProgress(document.querySelector("#workflowProgress"), transaction);
  renderChecklist(
    document.querySelector("#documentChecklist"),
    document.querySelector("#documentChecklistItemTemplate"),
    transaction,
    childDocuments,
  );
  renderChildDocumentFiles(document.querySelector("#childDocumentFiles"), transaction, childDocuments);
}

async function loadTransaction() {
  const transactionNo = transactionNoFromQuery();
  if (!transactionNo) throw new Error("ไม่พบเลขที่ธุรกรรม");

  const root = document.querySelector("#transactionPage");
  const transactionsUrl = (root && root.dataset.transactionsUrl) || "/api/workflow-transactions";

  const transaction = await fetchJson(`${transactionsUrl}/${encodeURIComponent(transactionNo)}`);

  renderTransaction(transaction, transaction.childDocuments || []);
  return transaction;
}

// Refreshes the transaction the same way POST start-document already does
// server-side before checking currentStepId (see handleWorkflowTransactionStartDocument
// in local-server.mjs) — recomputing step statuses from the actual child
// documents on disk and persisting them — rather than a bare GET, which would
// still show yesterday's stale steps immediately after a document is
// completed since completing a document never itself touches the transaction
// record.
async function refreshTransaction() {
  const transactionNo = transactionNoFromQuery();
  if (!transactionNo) throw new Error("ไม่พบเลขที่ธุรกรรม");

  const root = document.querySelector("#transactionPage");
  const transactionsUrl = (root && root.dataset.transactionsUrl) || "/api/workflow-transactions";

  const transaction = await fetchJson(`${transactionsUrl}/${encodeURIComponent(transactionNo)}/refresh`, { method: "POST" });

  renderTransaction(transaction, transaction.childDocuments || []);
  return transaction;
}

async function startDocument(stepId) {
  const transactionNo = transactionNoFromQuery();
  if (!transactionNo) throw new Error("ไม่พบเลขที่ธุรกรรม");

  const root = document.querySelector("#transactionPage");
  const transactionsUrl = (root && root.dataset.transactionsUrl) || "/api/workflow-transactions";

  const result = await fetchJson(
    `${transactionsUrl}/${encodeURIComponent(transactionNo)}/start-document/${encodeURIComponent(stepId)}`,
    { method: "POST" },
  );

  location.href = result.url;
  return result;
}

function initTransactionPage() {
  const refreshButton = document.querySelector("#refreshTransactionButton");
  const statusBox = document.querySelector("#transactionStatus");

  if (refreshButton) {
    refreshButton.addEventListener("click", () => {
      clearStatusBox(statusBox);
      refreshTransaction().catch((error) => setStatusBox(statusBox, error.message, "error"));
    });
  }

  // Self-refresh on load (not a bare GET) so landing here right after
  // completing a document already shows the unlocked next step, instead of
  // requiring a manual refresh click first.
  refreshTransaction().catch((error) => setStatusBox(statusBox, error.message, "error"));
}

// ---------------------------------------------------------------------------
// Page dispatch
// ---------------------------------------------------------------------------

window.addEventListener("DOMContentLoaded", () => {
  if (document.querySelector("#templatePage")) {
    initTemplatePage();
  }
  if (document.querySelector("#transactionsPage")) {
    initTransactionsPage();
  }
  if (document.querySelector("#transactionPage")) {
    initTransactionPage();
  }
});
