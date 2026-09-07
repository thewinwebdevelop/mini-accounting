// Shared browser controller for the workflow feature.
//
// This one file is loaded by every workflow page: the template settings page
// (forms/workflow-templates.html) built here, and the transaction list /
// transaction detail pages (forms/workflow-transactions.html,
// forms/workflow-transaction.html) that a later pass adds on top of it.
// `initPage()` at the bottom looks for the page-specific root element that is
// actually present in the DOM and wires up only that page, so multiple pages
// can share this one script without stepping on each other. `state` and the
// shared helpers (fetchJson, getQueryParam, escapeHtml, status-box helpers)
// live at module scope so the sections added later can reuse them instead of
// duplicating fetch/error handling.
//
// Functions still to come from later tasks, extending this same file:
//   - initTransactionsPage() / startTransaction() (transaction list page)
//   - initTransactionPage() / loadTransaction() / refreshTransaction() /
//     startDocument(stepId) / renderTransaction(transaction) (transaction
//     detail page)
//   - completeTransaction() and syncTransactionDrive() (Task 11) and
//     packet-link rendering (Task 10), added to renderTransaction() once
//     transaction completion, Drive sync, and packet PDFs exist server-side.

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
// Page dispatch
// ---------------------------------------------------------------------------

window.addEventListener("DOMContentLoaded", () => {
  if (document.querySelector("#templatePage")) {
    initTemplatePage();
  }
});
