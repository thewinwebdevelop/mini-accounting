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

    // receiptType only means anything on a substitute_receipt step, where it
    // controls whether stock receiving applies. Native "completed" alone
    // unlocks the next workflow step. The selector stays hidden for every
    // other document kind. A step's receiptType is defaulted here, at render
    // time, to whatever the select is showing (its first option,
    // "stock_purchase", when the step never declared one) so the visible
    // value and the value collectTemplatePayload/saveTemplate actually save
    // always agree -- a template step never silently displays one thing and
    // saves another.
    const receiptTypeSelect = row.querySelector(".step-receipt-type");
    if (receiptTypeSelect) {
      const isSubstituteReceipt = step.documentKind === "substitute_receipt";
      receiptTypeSelect.hidden = !isSubstituteReceipt;
      if (isSubstituteReceipt) {
        if (!step.receiptType) step.receiptType = receiptTypeSelect.value || "stock_purchase";
        receiptTypeSelect.value = step.receiptType;
        receiptTypeSelect.addEventListener("change", () => {
          step.receiptType = receiptTypeSelect.value;
        });
      }
    }

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
// from the DOM/state. Sheets is deliberately absent from templates: it is a
// manual action on a closed transaction, never an automatic template action.
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
    documentSteps: steps.map((step) => {
      const item = { documentKind: step.documentKind };
      if (step.documentKind === "substitute_receipt" && step.receiptType) {
        item.receiptType = step.receiptType;
      }
      return item;
    }),
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
  const newStep = { documentKind };
  // Defaulted here (not left for renderDocumentStepsList to default lazily)
  // so a freshly added step already has a real value the instant it exists,
  // matching what the visible select shows.
  if (documentKind === "substitute_receipt") newStep.receiptType = "stock_purchase";
  state.currentTemplate.documentSteps = [
    ...(state.currentTemplate.documentSteps || []),
    newStep,
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
  cancellation_pending: "รอดำเนินการยกเลิก",
  cancelled: "ยกเลิกแล้ว",
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
let transactionExternalSyncInFlight = false;
let transactionCancellationInFlight = false;

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
      if (transaction.status === "cancellation_pending" || transaction.status === "cancelled") {
        const note = document.createElement("span");
        note.className = "muted parent-cancellation-note";
        note.textContent = normalized.nativeStatus === "completed" || childDoc.status === "completed"
          ? "คงสถานะเสร็จสิ้นจากการยกเลิก Workflow"
          : "อยู่ภายใต้การยกเลิก Workflow";
        row.querySelector(".step-meta").appendChild(note);
      }
    }

    const actionButton = row.querySelector("[data-step-action]");
    const isCurrent = transaction.currentStepId === step.stepId;
    if (step.workflowStatus === "completed") {
      actionButton.textContent = "เสร็จสิ้นแล้ว";
      actionButton.disabled = true;
    } else if (isCurrent) {
      actionButton.textContent = step.workflowStatus === "in_progress" ? "ดำเนินการต่อ" : "เปิดเอกสาร";
      actionButton.disabled = transaction.status === "cancellation_pending" || transaction.status === "cancelled";
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

// The complete button is enabled only once every step is completed and the
// transaction itself is not already completed — the same "every step
// completed" rule completeWorkflowTransaction enforces server-side (this is
// the UI-side half; the server independently refuses a crafted request that
// bypasses this button, the same way start-document's own locked-step guard
// does).
//
// "Already completed" is read from transaction.completedAt, never from
// transaction.status: deriveWorkflowProgress (used by GET/refresh) already
// reports status "completed" the moment every step is done, *before*
// completeWorkflowTransaction has ever been called — status alone cannot
// tell "ready to complete" apart from "already completed". completedAt is
// only ever stamped by completeWorkflowTransaction itself, so it is the
// signal that actually means "the complete button was already pressed".
function renderCompleteButton(button, transaction) {
  if (!button) return;
  const steps = transaction.steps || [];
  const allStepsCompleted = steps.length > 0 && steps.every((step) => step.workflowStatus === "completed");
  const alreadyCompleted = !!transaction.completedAt;
  const cancellationLocked = transaction.status === "cancellation_pending" || transaction.status === "cancelled";
  button.disabled = cancellationLocked || alreadyCompleted || !allStepsCompleted;
  button.textContent = alreadyCompleted ? "ปิดงานธุรกรรมแล้ว" : "ปิดงานธุรกรรม";
}

const DRIVE_SYNC_STATUS_LABELS = {
  not_required: "ไม่ต้องซิงก์ Google Drive สำหรับ Workflow นี้",
  synced: "ซิงก์ Google Drive สำเร็จแล้ว",
  sync_failed: "ซิงก์ Google Drive ไม่สำเร็จ",
};

// A failed sync's `message` (set by syncWorkflowTransactionToDrive) names, in
// Thai, every document that did not make it into Drive and why; `error` is
// only the first underlying error, kept as the fallback for an older record.
function driveSyncStatusText(driveSync) {
  if (!driveSync || !driveSync.syncStatus) return "ยังไม่ได้ซิงก์ Google Drive";
  const label = DRIVE_SYNC_STATUS_LABELS[driveSync.syncStatus] || driveSync.syncStatus;
  if (driveSync.syncStatus === "sync_failed" && (driveSync.message || driveSync.error)) {
    return `${label}: ${driveSync.message || driveSync.error}`;
  }
  return label;
}

const DRIVE_SYNC_ITEM_STATES = {
  synced: { text: "ขึ้น Google Drive แล้ว", className: "completed" },
  already_synced: { text: "มีใน Google Drive อยู่แล้ว (ไม่อัปโหลดซ้ำ)", className: "completed" },
  sync_failed: { text: "ไม่สำเร็จ", className: "sync_failed" },
  waiting_for_documents: { text: "รอเอกสารย่อยขึ้น Google Drive ครบก่อน", className: "not_started" },
};

function driveSyncItemState(entry) {
  if (entry.syncStatus === "synced") return entry.alreadySynced ? "already_synced" : "synced";
  return entry.syncStatus;
}

function driveSyncItem({ title, state, url, detail }) {
  const { text, className } = DRIVE_SYNC_ITEM_STATES[state] || { text: state || "-", className: "" };
  const item = document.createElement("li");
  item.className = "drive-sync-document";

  const heading = document.createElement("span");
  heading.className = "title";
  heading.textContent = title;
  item.appendChild(heading);

  const status = document.createElement("span");
  status.className = `status ${className}`.trim();
  status.textContent = text;
  item.appendChild(status);

  if (url) {
    const link = document.createElement("a");
    link.className = "file-link";
    link.href = url;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = "เปิดใน Google Drive";
    item.appendChild(link);
  }

  if (detail) {
    const note = document.createElement("span");
    note.className = "muted";
    note.textContent = detail;
    item.appendChild(note);
  }
  return item;
}

// One row per child document (in step order, as the server reports them)
// plus the transaction's own folder, so a user can see exactly which document
// did not make it into Drive and why, and open the ones that did.
function renderDriveSyncDocuments(list, transaction) {
  if (!list) return;
  list.replaceChildren();
  const driveSync = transaction.driveSync || {};
  const documents = Array.isArray(driveSync.documents) ? driveSync.documents : null;
  list.hidden = !documents;
  if (!documents) return;

  for (const entry of documents) {
    list.appendChild(driveSyncItem({
      title: `${documentKindLabelFor(entry.documentKind)} ${entry.documentNo || "-"}`,
      state: driveSyncItemState(entry),
      url: entry.syncStatus === "synced" ? entry.driveFolderUrl : "",
      detail: entry.syncStatus === "sync_failed" ? (entry.message || entry.error) : "",
    }));
  }

  const folder = driveSync.transactionFolder || {};
  list.appendChild(driveSyncItem({
    title: `โฟลเดอร์ธุรกรรม ${transaction.transactionNo || "-"} (ชุดรวม PDF และสรุป)`,
    state: driveSyncItemState(folder),
    url: folder.syncStatus === "synced" ? folder.driveFolderUrl : "",
    detail: folder.syncStatus === "sync_failed" ? (folder.message || folder.error) : "",
  }));
}

// Shown only once the transaction is completed (there is nothing to sync
// before then) — again keyed on completedAt, not status, for the same reason
// renderCompleteButton above is: status flips to "completed" the moment
// every step is done, well before completeWorkflowTransaction has actually
// run. Driven by the template snapshot's syncGoogleDrive toggle — captured
// on the transaction at start time, not looked up live — and the
// transaction's own driveSync state: toggle off always shows the manual sync
// button; toggle on already synced automatically at completion, so the button
// appears only when a sync did not get everything into Drive — as the retry,
// which re-attempts only what failed. Sheets has no template toggle: O12 is
// always a manual, parent-only action after O13's persisted completion.
function renderDriveSyncSection(section, statusEl, button, transaction, documentsList) {
  if (!section) return;
  const isCompleted = !!transaction.completedAt;
  section.hidden = !isCompleted;
  if (!isCompleted) {
    if (button) button.hidden = true;
    if (documentsList) documentsList.hidden = true;
    return;
  }

  if (statusEl) statusEl.textContent = driveSyncStatusText(transaction.driveSync);
  renderDriveSyncDocuments(documentsList, transaction);

  const syncGoogleDrive = !!transaction.templateSnapshot?.syncGoogleDrive;
  const failed = transaction.driveSync?.syncStatus === "sync_failed";
  const cancellationLocked = transaction.status === "cancellation_pending" || transaction.status === "cancelled";
  if (button) {
    button.hidden = cancellationLocked || (syncGoogleDrive && !failed);
    button.textContent = failed ? "ลองซิงก์อีกครั้ง (เฉพาะรายการที่ยังไม่สำเร็จ)" : "ซิงก์ Google Drive";
  }
}

function safeSpreadsheetUrl(value) {
  if (typeof value !== "string") return "";
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "docs.google.com" ? url.href : "";
  } catch {
    return "";
  }
}

function sheetConflictDocumentNos(conflicts) {
  if (!Array.isArray(conflicts)) return [];
  return [...new Set(conflicts.map((conflict) => {
    const key = typeof conflict?.sourceKey === "string" ? conflict.sourceKey : "";
    const match = key.match(/^(?:expense_request|substitute_receipt):(.+)$/);
    return match?.[1] || "";
  }).filter(Boolean))];
}

function sheetSyncStatusText(sheetSync, transaction) {
  if (!sheetSync || sheetSync.syncStatus === "synced" && !validSheetSyncResult(sheetSync, transaction.transactionNo, transaction)) {
    return "ยังไม่ได้ซิงก์ Google Sheets";
  }
  if (sheetSync.syncStatus === "synced") {
    return `ซิงก์ Google Sheets สำเร็จแล้ว${sheetSync.sourceDocumentNo ? ` (${sheetSync.sourceDocumentNo})` : ""}`;
  }
  if (sheetSync.syncStatus === "blocked_child_rows") {
    const documentNos = sheetConflictDocumentNos(sheetSync.conflicts);
    return `${sheetSync.error || "พบรายการเอกสารย่อยใน Google Sheets"}${documentNos.length ? `: ${documentNos.join(", ")}` : ""}`;
  }
  if (sheetSync.syncStatus === "sync_failed") return sheetSync.error || "ไม่สามารถซิงก์ Google Sheets ได้";
  return "ยังไม่ได้ซิงก์ Google Sheets";
}

function renderSheetSyncSection(section, statusEl, link, button, transaction) {
  if (!section) return;
  const isCompleted = !!transaction.completedAt;
  section.hidden = !isCompleted;
  if (!isCompleted) {
    if (button) button.hidden = true;
    if (link) { link.hidden = true; link.href = "#"; }
    return;
  }
  const sheetSync = transaction.sheetSync;
  const validSynced = sheetSync?.syncStatus === "synced" && validSheetSyncResult(sheetSync, transaction.transactionNo, transaction);
  if (statusEl) statusEl.textContent = sheetSyncStatusText(sheetSync, transaction);
  const syncedUrl = validSynced ? safeSpreadsheetUrl(sheetSync.spreadsheetUrl) : "";
  if (link) {
    link.hidden = !syncedUrl;
    link.href = syncedUrl || "#";
  }
  if (button) {
    button.hidden = transaction.status === "cancellation_pending" || transaction.status === "cancelled";
    button.textContent = validSynced ? "ซิงก์ Google Sheets อีกครั้ง"
      : sheetSync?.syncStatus === "blocked_child_rows" ? "ตรวจสอบแล้วลองอีกครั้ง"
        : sheetSync?.syncStatus === "sync_failed" ? "ลองซิงก์ Google Sheets อีกครั้ง" : "ซิงก์ Google Sheets";
  }
}

function cancellationLocked(transaction = transactionPageState.transaction) {
  return transaction?.status === "cancellation_pending" || transaction?.status === "cancelled";
}

function renderCancellationSummary(transaction) {
  const summary = document.querySelector("#cancellationSummary");
  const title = document.querySelector("#cancellationSummaryTitle");
  const details = document.querySelector("#cancellationSummaryDetails");
  const retry = document.querySelector("#retryCancellationButton");
  const cancelButton = document.querySelector("#cancelTransactionButton");
  if (!summary || !title || !details) return;
  const isPending = transaction.status === "cancellation_pending";
  const isCancelled = transaction.status === "cancelled";
  summary.hidden = !isPending && !isCancelled;
  summary.className = `status-box active ${isPending ? "" : "success"}`.trim();
  title.textContent = isPending ? "การยกเลิกอยู่ระหว่างดำเนินการ" : "ยกเลิก Workflow แล้ว";
  const cancellation = transaction.cancellation || {};
  const pending = Array.isArray(cancellation.pendingEffects) ? cancellation.pendingEffects : [];
  const pendingText = pending.length
    ? `รายการที่รอดำเนินการ: ${pending.map((effect) => [effect.type, effect.documentNo, effect.code].filter(Boolean).join(" ")).join(", ")}`
    : "ดำเนินการชดเชยครบถ้วนแล้ว";
  details.textContent = [
    transaction.baseStatus ? `สถานะเดิม: ${transactionStatusLabel(transaction.baseStatus)}` : "",
    transaction.completedAt ? `เสร็จสิ้นเดิมเมื่อ: ${transaction.completedAt}` : "",
    cancellation.requestedBy ? `ผู้ขอยกเลิก: ${cancellation.requestedBy}` : "",
    cancellation.requestedAt ? `ขอเมื่อ: ${cancellation.requestedAt}` : "",
    cancellation.cancelledAt ? `ยกเลิกเมื่อ: ${cancellation.cancelledAt}` : "",
    pendingText,
  ].filter(Boolean).join("\n");
  if (retry) retry.hidden = !isPending;
  if (cancelButton) cancelButton.hidden = isPending || isCancelled;
}

function setTransactionMutationControlsDisabled(disabled) {
  [
    document.querySelector("#refreshTransactionButton"),
    document.querySelector("#cancelTransactionButton"),
    document.querySelector("#retryCancellationButton"),
    document.querySelector("#completeTransactionButton"),
    document.querySelector("#syncDriveButton"),
    document.querySelector("#syncSheetsButton"),
    ...document.querySelectorAll("[data-step-action]"),
  ].forEach((control) => { if (control) control.disabled = disabled; });
}

function restoreTransactionControlsFromState() {
  if (transactionCancellationInFlight) {
    setTransactionMutationControlsDisabled(true);
    return;
  }
  [
    document.querySelector("#refreshTransactionButton"),
    document.querySelector("#cancelTransactionButton"),
    document.querySelector("#retryCancellationButton"),
    document.querySelector("#syncDriveButton"),
    document.querySelector("#syncSheetsButton"),
  ].forEach((control) => { if (control) control.disabled = false; });
  const transaction = transactionPageState.transaction;
  if (cancellationLocked(transaction)) {
    [
      document.querySelector("#cancelTransactionButton"),
      document.querySelector("#completeTransactionButton"),
      document.querySelector("#syncDriveButton"),
      document.querySelector("#syncSheetsButton"),
      ...document.querySelectorAll("[data-step-action]"),
    ].forEach((control) => { if (control) control.disabled = true; });
  }
  const retry = document.querySelector("#retryCancellationButton");
  if (retry) retry.disabled = transactionCancellationInFlight;
}

function setTransactionSyncButtonsDisabled(disabled) {
  const driveButton = document.querySelector("#syncDriveButton");
  const sheetButton = document.querySelector("#syncSheetsButton");
  if (driveButton) driveButton.disabled = disabled;
  if (sheetButton) sheetButton.disabled = disabled;
  const cancelButton = document.querySelector("#cancelTransactionButton");
  if (cancelButton) cancelButton.disabled = disabled || transactionCancellationInFlight || cancellationLocked();
}

function renderTransaction(transaction, childDocuments = []) {
  transactionPageState.transaction = transaction;
  transactionPageState.childDocuments = childDocuments;

  renderTransactionHeader(transaction);
  renderWorkflowPacketLink(document.querySelector("#workflowPacketLink"), transaction);
  renderWorkflowProgress(document.querySelector("#workflowProgress"), transaction);
  renderCompleteButton(document.querySelector("#completeTransactionButton"), transaction);
  renderDriveSyncSection(
    document.querySelector("#driveSyncSection"),
    document.querySelector("#driveSyncStatus"),
    document.querySelector("#syncDriveButton"),
    transaction,
    document.querySelector("#driveSyncDocuments"),
  );
  renderSheetSyncSection(
    document.querySelector("#sheetSyncSection"),
    document.querySelector("#sheetSyncStatus"),
    document.querySelector("#sheetSyncLink"),
    document.querySelector("#syncSheetsButton"),
    transaction,
  );
  renderChecklist(
    document.querySelector("#documentChecklist"),
    document.querySelector("#documentChecklistItemTemplate"),
    transaction,
    childDocuments,
  );
  renderChildDocumentFiles(document.querySelector("#childDocumentFiles"), transaction, childDocuments);
  renderCancellationSummary(transaction);
  restoreTransactionControlsFromState();
}

// Refreshes the transaction the same way POST start-document already does
// server-side before checking currentStepId (see handleWorkflowTransactionStartDocument
// in local-server.mjs) — recomputing step statuses from the actual child
// documents on disk and persisting them — rather than a bare GET, which would
// still show yesterday's stale steps immediately after a document is
// completed since completing a document never itself touches the transaction
// record.
//
// regeneratePacket defaults to true, matching the server route's own
// default, so the manual "รีเฟรชสถานะ" button (which calls this with no
// options) keeps regenerating the packet PDF exactly as before. The one
// caller that opts out is the self-refresh on page load, below — a page load
// has no reason to spawn the packet's Python subprocess before anyone has
// actually asked to download it, so it passes regeneratePacket:false.
async function refreshTransaction({ regeneratePacket = true } = {}) {
  const transactionNo = transactionNoFromQuery();
  if (!transactionNo) throw new Error("ไม่พบเลขที่ธุรกรรม");

  const root = document.querySelector("#transactionPage");
  const transactionsUrl = (root && root.dataset.transactionsUrl) || "/api/workflow-transactions";

  const transaction = await fetchJson(`${transactionsUrl}/${encodeURIComponent(transactionNo)}/refresh`, {
    method: "POST",
    body: JSON.stringify({ regeneratePacket }),
  });

  renderTransaction(transaction, transaction.childDocuments || []);
  return transaction;
}

async function loadTransactionDetail() {
  const transactionNo = transactionNoFromQuery();
  if (!transactionNo) throw new Error("ไม่พบเลขที่ธุรกรรม");
  const root = document.querySelector("#transactionPage");
  const transactionsUrl = (root && root.dataset.transactionsUrl) || "/api/workflow-transactions";
  const transaction = await fetchJson(`${transactionsUrl}/${encodeURIComponent(transactionNo)}`);
  if (!transaction || transaction.transactionNo !== transactionNo || !Array.isArray(transaction.childDocuments)) {
    throw new Error("ข้อมูลธุรกรรมไม่ถูกต้อง");
  }
  renderTransaction(transaction, transaction.childDocuments);
  return transaction;
}

function validatedCancellationResponse(result, transactionNo, httpStatus) {
  if (httpStatus !== 200 && httpStatus !== 202) throw new Error(result?.error || "ยกเลิก Workflow ไม่สำเร็จ");
  if (!result || result.transactionNo !== transactionNo || !["cancellation_pending", "cancelled"].includes(result.status)) {
    throw new Error("ข้อมูลการยกเลิก Workflow ไม่ถูกต้อง");
  }
  if ((httpStatus === 200 && result.status !== "cancelled")
    || (httpStatus === 202 && (result.status !== "cancellation_pending" || result.code !== "WORKFLOW_CANCELLATION_PENDING"))) {
    throw new Error("ข้อมูลการยกเลิก Workflow ไม่ตรงกับผลลัพธ์");
  }
  if (!result.cancellation || typeof result.cancellation !== "object" || !Array.isArray(result.cancellation.pendingEffects)) {
    throw new Error("ข้อมูลการยกเลิก Workflow ไม่ครบถ้วน");
  }
  if (!Array.isArray(result.childDocuments)) throw new Error("ข้อมูลเอกสารย่อยไม่ถูกต้อง");
  return result;
}

async function cancelWorkflowTransaction() {
  const transactionNo = transactionNoFromQuery();
  if (!transactionNo) throw new Error("ไม่พบเลขที่ธุรกรรม");
  const root = document.querySelector("#transactionPage");
  const transactionsUrl = (root && root.dataset.transactionsUrl) || "/api/workflow-transactions";
  let response;
  let result = {};
  try {
    response = await fetch(`${transactionsUrl}/${encodeURIComponent(transactionNo)}/cancel`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirmed: true, cancelledBy: "" }),
    });
    result = await response.json();
  } catch (error) {
    throw new Error("ไม่สามารถเชื่อมต่อเพื่อยกเลิก Workflow ได้");
  }
  const validated = validatedCancellationResponse(result, transactionNo, response.status);
  renderTransaction(validated, validated.childDocuments);
  return validated;
}

// Refuses server-side unless every step is completed (see
// completeWorkflowTransaction in forms/local-server.logic.js), which auto-
// syncs Google Drive per the transaction's snapshotted syncGoogleDrive
// toggle and attaches the result as driveSync on the response used to
// re-render this page.
async function completeTransaction() {
  const transactionNo = transactionNoFromQuery();
  if (!transactionNo) throw new Error("ไม่พบเลขที่ธุรกรรม");

  const root = document.querySelector("#transactionPage");
  const transactionsUrl = (root && root.dataset.transactionsUrl) || "/api/workflow-transactions";

  const transaction = await fetchJson(`${transactionsUrl}/${encodeURIComponent(transactionNo)}/complete`, {
    method: "POST",
    body: JSON.stringify({}),
  });

  renderTransaction(transaction, transaction.childDocuments || []);
  return transaction;
}

// The manual fallback the drive-sync section shows when the template's
// syncGoogleDrive toggle is off. Stays callable after completion regardless
// of the toggle, and calls the exact same server function completion's
// auto-sync path calls — there is no separate "manual" implementation.
async function syncTransactionDrive() {
  const transactionNo = transactionNoFromQuery();
  if (!transactionNo) throw new Error("ไม่พบเลขที่ธุรกรรม");

  const root = document.querySelector("#transactionPage");
  const transactionsUrl = (root && root.dataset.transactionsUrl) || "/api/workflow-transactions";

  const driveSync = await fetchJson(`${transactionsUrl}/${encodeURIComponent(transactionNo)}/sync-drive`, {
    method: "POST",
  });

  const transaction = { ...(transactionPageState.transaction || {}), driveSync };
  renderTransaction(transaction, transactionPageState.childDocuments || []);
  return driveSync;
}

function validSheetSyncResult(value, transactionNo, transaction) {
  return value && value.syncStatus === "synced"
    && value.sourceKey === `workflow_transaction:${transactionNo}`
    && value.sheetName === transaction.accountingMonth
    && Number.isInteger(value.rowNumber) && value.rowNumber > 0
    && !!safeSpreadsheetUrl(value.spreadsheetUrl);
}

async function syncTransactionSheets() {
  const transactionNo = transactionNoFromQuery();
  if (!transactionNo) throw new Error("ไม่พบเลขที่ธุรกรรม");
  const root = document.querySelector("#transactionPage");
  const transactionsUrl = (root && root.dataset.transactionsUrl) || "/api/workflow-transactions";
  let response;
  let result = {};
  try {
    response = await fetch(`${transactionsUrl}/${encodeURIComponent(transactionNo)}/sync-sheets`, { method: "POST", headers: { "content-type": "application/json" } });
    result = await response.json();
  } catch (error) {
    throw new Error(error.message || "ไม่สามารถซิงก์ Google Sheets ได้");
  }
  if (!response.ok) {
    const error = new Error(result.error || "ไม่สามารถซิงก์ Google Sheets ได้");
    error.sheetResponse = result;
    throw error;
  }
  const transaction = transactionPageState.transaction || {};
  if (!validSheetSyncResult(result, transactionNo, transaction)) throw new Error("ข้อมูลการซิงก์ Google Sheets ไม่ถูกต้อง");
  renderTransaction({ ...transaction, sheetSync: result }, transactionPageState.childDocuments || []);
  return result;
}

async function startDocument(stepId) {
  const transactionNo = transactionNoFromQuery();
  if (!transactionNo) throw new Error("ไม่พบเลขที่ธุรกรรม");
  if (transactionCancellationInFlight || cancellationLocked()) throw new Error("ธุรกรรมนี้อยู่ระหว่างหรือเสร็จสิ้นการยกเลิก");

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
  const completeButton = document.querySelector("#completeTransactionButton");
  const syncDriveButton = document.querySelector("#syncDriveButton");
  const syncSheetsButton = document.querySelector("#syncSheetsButton");
  const statusBox = document.querySelector("#transactionStatus");
  const cancelButton = document.querySelector("#cancelTransactionButton");
  const retryCancellationButton = document.querySelector("#retryCancellationButton");
  const cancellationDialog = document.querySelector("#cancellationDialog");
  const dismissCancellationButton = document.querySelector("#dismissCancellationButton");
  const confirmCancellationButton = document.querySelector("#confirmCancellationButton");

  function closeCancellationDialog(restoreFocus = true) {
    if (cancellationDialog) cancellationDialog.hidden = true;
    if (restoreFocus && typeof cancelButton?.focus === "function") cancelButton.focus();
  }

  function openCancellationDialog() {
    if (!cancelButton || cancelButton.disabled || cancellationLocked()) return;
    if (cancellationDialog) cancellationDialog.hidden = false;
    if (typeof confirmCancellationButton?.focus === "function") confirmCancellationButton.focus();
  }

  async function runCancellation() {
    if (transactionCancellationInFlight || transactionExternalSyncInFlight || transactionPageState.transaction?.status === "cancelled") return;
    transactionCancellationInFlight = true;
    setTransactionMutationControlsDisabled(true);
    clearStatusBox(statusBox);
    try {
      const result = await cancelWorkflowTransaction();
      setStatusBox(statusBox, result.status === "cancelled" ? "ยกเลิก Workflow เรียบร้อยแล้ว" : "รอดำเนินการยกเลิก", result.status === "cancelled" ? "success" : "");
    } catch (error) {
      setStatusBox(statusBox, error.message, "error");
    } finally {
      transactionCancellationInFlight = false;
      if (transactionPageState.transaction) {
        renderTransaction(transactionPageState.transaction, transactionPageState.childDocuments);
      } else {
        setTransactionMutationControlsDisabled(false);
      }
    }
  }

  cancelButton?.addEventListener("click", openCancellationDialog);
  dismissCancellationButton?.addEventListener("click", () => closeCancellationDialog());
  confirmCancellationButton?.addEventListener("click", () => { closeCancellationDialog(false); runCancellation(); });
  cancellationDialog?.addEventListener("click", (event) => { if (event.target === cancellationDialog) closeCancellationDialog(); });
  cancellationDialog?.addEventListener("keydown", (event) => {
    if (event.key === "Escape") { event.preventDefault(); closeCancellationDialog(); }
    if (event.key === "Tab") {
      event.preventDefault();
      const target = event.shiftKey ? dismissCancellationButton : confirmCancellationButton;
      if (typeof target?.focus === "function") target.focus();
    }
  });
  retryCancellationButton?.addEventListener("click", () => runCancellation());

  if (refreshButton) {
    refreshButton.addEventListener("click", () => {
      clearStatusBox(statusBox);
      if (transactionCancellationInFlight || cancellationLocked()) return;
      refreshTransaction().catch((error) => setStatusBox(statusBox, error.message, "error"));
    });
  }

  if (completeButton) {
    completeButton.addEventListener("click", () => {
      if (completeButton.disabled) return;
      if (transactionCancellationInFlight || cancellationLocked()) return;
      clearStatusBox(statusBox);
      completeTransaction()
        .then(() => setStatusBox(statusBox, "ปิดงานธุรกรรมเรียบร้อยแล้ว", "success"))
        .catch((error) => setStatusBox(statusBox, error.message, "error"));
    });
  }

  if (syncDriveButton) {
    syncDriveButton.addEventListener("click", () => {
      if (syncDriveButton.disabled || syncDriveButton.hidden || transactionExternalSyncInFlight) return;
      if (transactionCancellationInFlight || cancellationLocked()) return;
      clearStatusBox(statusBox);
      // Disabled while the request runs: a second press would start a second
      // upload of the same files (the server also refuses to run two syncs of
      // one transaction at once).
      transactionExternalSyncInFlight = true;
      setTransactionSyncButtonsDisabled(true);
      syncTransactionDrive()
        .then((driveSync) => {
          if (driveSync.syncStatus === "sync_failed") {
            setStatusBox(statusBox, driveSyncStatusText(driveSync), "error");
          } else {
            setStatusBox(statusBox, "ซิงก์ Google Drive เรียบร้อยแล้ว", "success");
          }
        })
        .catch((error) => setStatusBox(statusBox, error.message, "error"))
        .finally(() => { transactionExternalSyncInFlight = false; setTransactionSyncButtonsDisabled(false); });
    });
  }

  if (syncSheetsButton) {
    syncSheetsButton.addEventListener("click", () => {
      if (syncSheetsButton.disabled || syncSheetsButton.hidden || transactionExternalSyncInFlight || !transactionPageState.transaction?.completedAt) return;
      if (transactionCancellationInFlight || cancellationLocked()) return;
      clearStatusBox(statusBox);
      transactionExternalSyncInFlight = true;
      setTransactionSyncButtonsDisabled(true);
      syncTransactionSheets()
        .then(() => setStatusBox(statusBox, "ซิงก์ Google Sheets เรียบร้อยแล้ว", "success"))
        .catch((error) => {
          const response = error.sheetResponse;
          if (response?.code === "workflow_child_sheet_rows_exist") {
            const documentNos = sheetConflictDocumentNos(response.conflicts);
            setStatusBox(statusBox, `${response.error || error.message}${documentNos.length ? `: ${documentNos.join(", ")}` : ""}`, "error");
          } else {
            setStatusBox(statusBox, error.message, "error");
          }
        })
        .finally(() => { transactionExternalSyncInFlight = false; setTransactionSyncButtonsDisabled(false); });
    });
  }

  // Self-refresh on load (not a bare GET) so landing here right after
  // completing a document already shows the unlocked next step, instead of
  // requiring a manual refresh click first. regeneratePacket:false — a page
  // load must not spawn Python to regenerate a packet PDF the user may never
  // download; the packet stays fresh as of the last explicit "รีเฟรชสถานะ"
  // click or completion instead (see refreshTransaction above).
  loadTransactionDetail()
    .then((transaction) => {
      if (!cancellationLocked(transaction)) return refreshTransaction({ regeneratePacket: false });
      return transaction;
    })
    .catch((error) => setStatusBox(statusBox, error.message, "error"));
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
