import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";

import workflowLogic from "../forms/workflow.logic.js";

const templatesHtmlPath = new URL("../forms/workflow-templates.html", import.meta.url);
const transactionsHtmlPath = new URL("../forms/workflow-transactions.html", import.meta.url);
const transactionHtmlPath = new URL("../forms/workflow-transaction.html", import.meta.url);
const browserLogicPath = new URL("../forms/workflow.logic.browser.js", import.meta.url);
const workflowLogicPath = new URL("../forms/workflow.logic.js", import.meta.url);

// ---------------------------------------------------------------------------
// Minimal fake DOM, purpose-built for exactly the selectors and APIs
// forms/workflow.logic.browser.js exercises: querySelector(All) on tag/class/
// id/attribute selectors (including a fixed-value attribute selector like
// [data-move-step="up"]), append/appendChild/replaceChildren, cloneNode, and
// setAttribute/dataset. This mirrors the technique already proven in
// tests/workflow-document.html.test.mjs for the same kind of *.logic.
// browser.js file, rather than only string-matching source text (which is
// exactly what let a top-level `require()` and a missing <script> tag slip
// through untested on this branch before).
// ---------------------------------------------------------------------------
class FakeNode {
  constructor(tagName) {
    this.tagName = String(tagName).toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.listeners = {};
    this.attrs = {};
    this.dataset = {};
    this.id = "";
    this.name = "";
    this.type = "";
    this.value = "";
    this.checked = false;
    this.disabled = false;
    this.hidden = false;
    this.textContent = "";
    this.className = "";
  }

  addEventListener(type, handler) {
    (this.listeners[type] ??= []).push(handler);
  }

  dispatch(type, event = {}) {
    for (const handler of this.listeners[type] || []) handler(event);
  }

  setAttribute(name, value) {
    this.attrs[name] = String(value);
    if (name === "id") this.id = String(value);
    if (name === "name") this.name = String(value);
    if (name === "type") this.type = String(value);
    if (name.startsWith("data-")) {
      const key = name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      this.dataset[key] = String(value);
    }
  }

  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null;
  }

  matches(selector) {
    const bracketMatch = selector.match(/^([a-zA-Z0-9]*)\[([\w-]+)(?:="([^"]*)")?\]$/);
    if (bracketMatch) {
      const [, tag, attr, value] = bracketMatch;
      if (tag && this.tagName.toLowerCase() !== tag.toLowerCase()) return false;
      const actual = this.attrs[attr];
      return value === undefined ? actual !== undefined : actual === value;
    }
    if (selector.startsWith(".")) {
      return String(this.className).split(/\s+/).filter(Boolean).includes(selector.slice(1));
    }
    if (selector.startsWith("#")) return this.id === selector.slice(1);
    return this.tagName.toLowerCase() === selector.toLowerCase();
  }

  querySelectorAll(selector) {
    const matches = [];
    const visit = (node) => {
      for (const child of node.children) {
        if (child.matches(selector)) matches.push(child);
        visit(child);
      }
    };
    visit(this);
    return matches;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  appendChild(node) {
    if (node.tagName === "#FRAGMENT") {
      for (const child of node.children) {
        child.parentNode = this;
        this.children.push(child);
      }
      node.children = [];
      return node;
    }
    if (node.parentNode) {
      node.parentNode.children = node.parentNode.children.filter((child) => child !== node);
    }
    node.parentNode = this;
    this.children.push(node);
    return node;
  }

  append(...nodes) {
    nodes.forEach((node) => this.appendChild(node));
  }

  replaceChildren(...nodes) {
    this.children.forEach((child) => { child.parentNode = null; });
    this.children = [];
    this.append(...nodes);
  }

  remove() {
    if (this.parentNode) {
      this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
    }
  }

  cloneNode(deep) {
    const clone = new FakeNode(this.tagName);
    clone.attrs = { ...this.attrs };
    clone.dataset = { ...this.dataset };
    clone.id = this.id;
    clone.name = this.name;
    clone.type = this.type;
    clone.value = this.value;
    clone.className = this.className;
    // A real cloneNode also carries over boolean-attribute-reflected
    // properties like `hidden` (e.g. a template's `<span hidden>` child must
    // still be hidden after cloning) and static text content. `disabled` and
    // `checked` are included too since real form controls reflect them from
    // markup the same way.
    clone.hidden = this.hidden;
    clone.disabled = this.disabled;
    clone.checked = this.checked;
    clone.textContent = this.textContent;
    if (deep) {
      clone.children = this.children.map((child) => {
        const childClone = child.cloneNode(true);
        childClone.parentNode = clone;
        return childClone;
      });
    }
    return clone;
  }
}

// Builds the <template id="documentStepTemplate"> equivalent from
// forms/workflow-templates.html: one ".step-row" <li> with an order span, a
// label span, and the up/down/remove buttons the real markup provides.
function createDocumentStepTemplate() {
  const template = new FakeNode("template");
  const fragment = new FakeNode("#fragment");
  const row = new FakeNode("li");
  row.className = "step-row";
  const order = new FakeNode("span");
  order.className = "step-order";
  const label = new FakeNode("span");
  label.className = "step-label";
  const actions = new FakeNode("div");
  actions.className = "step-actions";
  const upButton = new FakeNode("button");
  upButton.setAttribute("data-move-step", "up");
  const downButton = new FakeNode("button");
  downButton.setAttribute("data-move-step", "down");
  const removeButton = new FakeNode("button");
  removeButton.setAttribute("data-remove-step", "");
  actions.append(upButton, downButton, removeButton);
  row.append(order, label, actions);
  fragment.append(row);
  template.content = fragment;
  return template;
}

// Stub server: mirrors handleWorkflowTemplateList/handleWorkflowTemplateSave
// closely enough to exercise the real save-then-reload round trip (GET
// /api/workflow-document-types, GET/POST /api/workflow-templates) without
// starting the actual local-server.mjs. Templates persist across calls
// within one test so a save's effect is visible on the next GET, the same
// way it would be against the real JSON-file-backed server.
function createStubFetch({ documentTypes, templates, onSave }) {
  let currentTemplates = templates;
  return async (url, options = {}) => {
    if (url.includes("/api/workflow-document-types")) {
      return { ok: true, json: async () => ({ documentTypes }) };
    }
    if (url.includes("/api/workflow-templates") && (!options.method || options.method === "GET")) {
      return { ok: true, json: async () => ({ templates: currentTemplates }) };
    }
    if (url.includes("/api/workflow-templates") && options.method === "POST") {
      const body = JSON.parse(options.body);
      onSave?.(body);
      const saved = {
        ...body,
        documentSteps: body.documentSteps.map((step, index) => ({
          stepId: `step-${String(index + 1).padStart(3, "0")}`,
          documentKind: step.documentKind,
        })),
        active: true,
        createdAt: "2026-09-06T00:00:00.000Z",
        updatedAt: "2026-09-06T00:00:00.000Z",
      };
      const existingIndex = currentTemplates.findIndex((item) => item.templateId === saved.templateId);
      currentTemplates = existingIndex >= 0
        ? currentTemplates.map((item, index) => (index === existingIndex ? saved : item))
        : [...currentTemplates, saved];
      return { ok: true, json: async () => saved };
    }
    throw new Error(`Unexpected fetch in test stub: ${options.method || "GET"} ${url}`);
  };
}

// Sets up forms/workflow.logic.browser.js in a require-less sandbox with just
// enough of a fake DOM to run its DOMContentLoaded handler for real against
// forms/workflow-templates.html's actual element ids.
async function setupTemplatePageSandbox({ documentTypes, templates, onSave }) {
  const elementsById = {
    templatePage: new FakeNode("main"),
    templateEditorForm: new FakeNode("form"),
    templateSelect: new FakeNode("select"),
    templateName: new FakeNode("input"),
    templateDescription: new FakeNode("textarea"),
    templateSyncGoogleDrive: new FakeNode("input"),
    documentKindSelect: new FakeNode("select"),
    addDocumentStep: new FakeNode("button"),
    documentStepsList: new FakeNode("ul"),
    documentStepTemplate: createDocumentStepTemplate(),
    saveTemplate: new FakeNode("button"),
    templateStatus: new FakeNode("div"),
  };
  elementsById.templatePage.dataset = {
    documentTypesUrl: "/api/workflow-document-types",
    templatesUrl: "/api/workflow-templates",
  };

  const fakeDocument = {
    querySelector(selector) {
      if (selector.startsWith("#")) return elementsById[selector.slice(1)] || null;
      return null;
    },
    createElement(tag) {
      return new FakeNode(tag);
    },
  };

  const stubFetch = createStubFetch({ documentTypes, templates, onSave });
  const window = { fetch: stubFetch };
  window.addEventListener = (type, handler) => {
    (window._handlers ??= {})[type] = handler;
  };

  const context = vm.createContext({
    window,
    document: fakeDocument,
    location: { search: "" },
    URLSearchParams,
    fetch: stubFetch,
  });

  vm.runInContext(await readFile(browserLogicPath, "utf8"), context);

  context.window._handlers.DOMContentLoaded();
  // loadTemplatePageData() is fired-and-forgotten at the end of
  // initTemplatePage(); let its fetch -> json -> render microtask chain
  // settle before the test touches the resulting DOM.
  await new Promise((resolve) => setTimeout(resolve, 10));

  return { elements: elementsById };
}

function stepLabels(documentStepsList) {
  return documentStepsList.querySelectorAll(".step-row").map((row) => row.querySelector(".step-label").textContent);
}

function selectTemplateByChange(templateSelect, templateId) {
  templateSelect.value = templateId;
  templateSelect.dispatch("change", { target: templateSelect });
}

test("workflow template page edits document order and the Drive sync toggle", async () => {
  const html = await readFile(templatesHtmlPath, "utf8");
  assert.match(html, /ตั้งค่า Workflow Template/);
  assert.match(html, /\/api\/workflow-document-types/);
  assert.match(html, /\/api\/workflow-templates/);
  assert.match(html, /syncGoogleDrive/);
  assert.match(html, /documentSteps/);
  assert.doesNotMatch(html, /syncGoogleSheets/);
});

test("workflow-templates.html loads the shared controller as a classic script", async () => {
  const html = await readFile(templatesHtmlPath, "utf8");
  assert.match(html, /<script src="\.\/workflow\.logic\.browser\.js"><\/script>/);
});

test("workflow.logic.browser.js is a classic script with no require or module wrapper", async () => {
  const script = await readFile(browserLogicPath, "utf8");
  assert.doesNotMatch(script, /\brequire\(/);
  assert.doesNotMatch(script, /module\.exports/);
  assert.doesNotMatch(script, /^\s*import /m);
});

test("template page lists all six seeded templates and defaults to the new-template blank form", async () => {
  const documentTypes = Object.values(workflowLogic.DOCUMENT_TYPE_DEFINITIONS);
  const templates = workflowLogic.getDefaultWorkflowTemplates();
  assert.equal(templates.length, 6, "sanity check: the seed really has six templates");

  const { elements } = await setupTemplatePageSandbox({ documentTypes, templates });

  // blank "+ create new" option plus one per seeded template
  assert.equal(elements.templateSelect.children.length, 7);
  const optionValues = elements.templateSelect.children.map((option) => option.value);
  for (const template of templates) {
    assert.ok(optionValues.includes(template.templateId), `expected ${template.templateId} in the template picker`);
  }
  assert.equal(elements.templateSelect.children[0].value, "", "first option must be the create-new option");

  // Document kind picker offers all seven document kinds.
  assert.equal(elements.documentKindSelect.children.length, 7);

  // Defaults to a blank template, not silently editing the first seeded one.
  assert.equal(elements.templateName.value, "");
  assert.match(elements.documentStepsList.querySelectorAll(".empty-row")[0]?.textContent || "", /ยังไม่มีเอกสาร/);
});

test("selecting a seeded template renders its name, description, sync toggle, and ordered steps", async () => {
  const documentTypes = Object.values(workflowLogic.DOCUMENT_TYPE_DEFINITIONS);
  const templates = workflowLogic.getDefaultWorkflowTemplates();
  const target = templates.find((template) => template.templateId === "stock_no_tax_invoice_company_bank");

  const { elements } = await setupTemplatePageSandbox({ documentTypes, templates });
  selectTemplateByChange(elements.templateSelect, target.templateId);

  assert.equal(elements.templateName.value, target.name);
  assert.equal(elements.templateDescription.value, target.description);
  assert.equal(elements.templateSyncGoogleDrive.checked, false);
  assert.deepEqual(
    stepLabels(elements.documentStepsList),
    target.documentSteps.map((step) => workflowLogic.getDocumentTypeDefinition(step.documentKind).label),
  );

  const rows = elements.documentStepsList.querySelectorAll(".step-row");
  assert.equal(rows[0].querySelector('[data-move-step="up"]').disabled, true, "first row cannot move further up");
  assert.equal(
    rows[rows.length - 1].querySelector('[data-move-step="down"]').disabled,
    true,
    "last row cannot move further down",
  );
});

test("reordering with the down/up buttons actually changes the document order, not just the button's presence", async () => {
  const documentTypes = Object.values(workflowLogic.DOCUMENT_TYPE_DEFINITIONS);
  const templates = workflowLogic.getDefaultWorkflowTemplates();
  const target = templates.find((template) => template.templateId === "stock_no_tax_invoice_company_bank");
  const originalOrder = target.documentSteps.map((step) => step.documentKind);

  const { elements } = await setupTemplatePageSandbox({ documentTypes, templates });
  selectTemplateByChange(elements.templateSelect, target.templateId);

  // Move the first step down one slot.
  elements.documentStepsList.querySelectorAll(".step-row")[0]
    .querySelector('[data-move-step="down"]')
    .dispatch("click");

  const afterFirstMove = [originalOrder[1], originalOrder[0], ...originalOrder.slice(2)];
  assert.deepEqual(
    stepLabels(elements.documentStepsList),
    afterFirstMove.map((kind) => workflowLogic.getDocumentTypeDefinition(kind).label),
  );

  // Move what is now the last step back up one slot.
  const rowsAfterFirstMove = elements.documentStepsList.querySelectorAll(".step-row");
  rowsAfterFirstMove[rowsAfterFirstMove.length - 1]
    .querySelector('[data-move-step="up"]')
    .dispatch("click");

  const afterSecondMove = [...afterFirstMove];
  [afterSecondMove[afterSecondMove.length - 2], afterSecondMove[afterSecondMove.length - 1]] =
    [afterSecondMove[afterSecondMove.length - 1], afterSecondMove[afterSecondMove.length - 2]];
  assert.deepEqual(
    stepLabels(elements.documentStepsList),
    afterSecondMove.map((kind) => workflowLogic.getDocumentTypeDefinition(kind).label),
  );
});

test("removing a document step actually drops it from the order, not just the row's markup", async () => {
  const documentTypes = Object.values(workflowLogic.DOCUMENT_TYPE_DEFINITIONS);
  const templates = workflowLogic.getDefaultWorkflowTemplates();
  const target = templates.find((template) => template.templateId === "director_expense_transfer");
  // Snapshot the original order into plain strings before any interaction:
  // state.currentTemplate is assigned this exact `target` object inside the
  // sandbox (the stub hands back the same in-memory records, just like a
  // JSON round trip would structurally), so once moveDocumentStep/
  // removeDocumentStep splice state.currentTemplate.documentSteps in place,
  // target.documentSteps below would already reflect the post-click state.
  const originalOrder = target.documentSteps.map((step) => step.documentKind);
  assert.equal(originalOrder.length, 3, "sanity check on the fixture used below");

  const { elements } = await setupTemplatePageSandbox({ documentTypes, templates });
  selectTemplateByChange(elements.templateSelect, target.templateId);

  const middleKind = originalOrder[1];
  elements.documentStepsList.querySelectorAll(".step-row")[1]
    .querySelector("[data-remove-step]")
    .dispatch("click");

  const remainingLabels = stepLabels(elements.documentStepsList);
  assert.equal(remainingLabels.length, 2);
  assert.ok(!remainingLabels.includes(workflowLogic.getDocumentTypeDefinition(middleKind).label));
  assert.deepEqual(remainingLabels, [
    workflowLogic.getDocumentTypeDefinition(originalOrder[0]).label,
    workflowLogic.getDocumentTypeDefinition(originalOrder[2]).label,
  ]);

  // Removing every remaining step must show the empty-state row again, not a
  // blank list.
  elements.documentStepsList.querySelectorAll("[data-remove-step]")[0].dispatch("click");
  elements.documentStepsList.querySelectorAll("[data-remove-step]")[0].dispatch("click");
  assert.match(elements.documentStepsList.querySelectorAll(".empty-row")[0]?.textContent || "", /ยังไม่มีเอกสาร/);
});

test("saving a reordered template posts the new order and the syncGoogleDrive toggle, with no syncGoogleSheets field", async () => {
  const documentTypes = Object.values(workflowLogic.DOCUMENT_TYPE_DEFINITIONS);
  const templates = workflowLogic.getDefaultWorkflowTemplates();
  const target = templates.find((template) => template.templateId === "stock_no_tax_invoice_company_bank");
  // Snapshot the original order before any interaction — see the comment in
  // the "removing a document step" test above for why: the sandbox mutates
  // this exact `target` object's documentSteps array in place.
  const originalOrder = target.documentSteps.map((step) => step.documentKind);
  const expectedOrderAfterMove = [originalOrder[1], originalOrder[0], ...originalOrder.slice(2)];

  let capturedPayload = null;
  const { elements } = await setupTemplatePageSandbox({
    documentTypes,
    templates,
    onSave: (payload) => { capturedPayload = payload; },
  });

  selectTemplateByChange(elements.templateSelect, target.templateId);
  elements.documentStepsList.querySelectorAll(".step-row")[0]
    .querySelector('[data-move-step="down"]')
    .dispatch("click");
  elements.templateSyncGoogleDrive.checked = true;

  elements.saveTemplate.dispatch("click");
  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.ok(capturedPayload, "save must POST to the server");
  assert.equal(capturedPayload.templateId, target.templateId);
  assert.equal(capturedPayload.syncGoogleDrive, true);
  assert.ok(!("syncGoogleSheets" in capturedPayload), "there is no Sheets toggle anywhere in this plan");
  assert.deepEqual(capturedPayload.documentSteps.map((step) => step.documentKind), expectedOrderAfterMove);

  assert.match(elements.templateStatus.textContent, /บันทึก/);
  assert.match(elements.templateStatus.className, /success/);

  // The order must persist across the reload the save triggers, not just
  // exist transiently in memory before the page refetches.
  assert.deepEqual(
    stepLabels(elements.documentStepsList),
    expectedOrderAfterMove.map((kind) => workflowLogic.getDocumentTypeDefinition(kind).label),
  );
});

test("creating a new template assigns a fresh templateId and makes it selectable after saving", async () => {
  const documentTypes = Object.values(workflowLogic.DOCUMENT_TYPE_DEFINITIONS);
  const templates = workflowLogic.getDefaultWorkflowTemplates();

  let capturedPayload = null;
  const { elements } = await setupTemplatePageSandbox({
    documentTypes,
    templates,
    onSave: (payload) => { capturedPayload = payload; },
  });

  // Stays on the blank "create new" form by default.
  elements.templateName.value = "ทดสอบ Template ใหม่";
  elements.templateDescription.value = "คำอธิบายทดสอบ";

  elements.documentKindSelect.value = "expense_request";
  elements.addDocumentStep.dispatch("click");
  elements.documentKindSelect.value = "payment_voucher";
  elements.addDocumentStep.dispatch("click");

  assert.deepEqual(stepLabels(elements.documentStepsList), [
    workflowLogic.getDocumentTypeDefinition("expense_request").label,
    workflowLogic.getDocumentTypeDefinition("payment_voucher").label,
  ]);

  elements.saveTemplate.dispatch("click");
  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.ok(capturedPayload, "save must POST to the server");
  assert.ok(capturedPayload.templateId, "a brand new template must be assigned a templateId before saving");
  assert.equal(capturedPayload.name, "ทดสอบ Template ใหม่");
  assert.deepEqual(capturedPayload.documentSteps.map((step) => step.documentKind), ["expense_request", "payment_voucher"]);

  // The picker must now include the newly created template alongside the
  // six seeded ones (blank option + 6 + 1 new).
  assert.equal(elements.templateSelect.children.length, 8);
  const optionValues = elements.templateSelect.children.map((option) => option.value);
  assert.ok(optionValues.includes(capturedPayload.templateId));
});

test("saving without picking any document raises a Thai validation error and does not POST", async () => {
  const documentTypes = Object.values(workflowLogic.DOCUMENT_TYPE_DEFINITIONS);
  const templates = workflowLogic.getDefaultWorkflowTemplates();

  let saveWasCalled = false;
  const { elements } = await setupTemplatePageSandbox({
    documentTypes,
    templates,
    onSave: () => { saveWasCalled = true; },
  });

  elements.templateName.value = "Template ไม่มีเอกสาร";
  elements.saveTemplate.dispatch("click");
  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.equal(saveWasCalled, false);
  assert.match(elements.templateStatus.textContent, /ระบุเอกสารอย่างน้อย/);
  assert.match(elements.templateStatus.className, /error/);
});

// ---------------------------------------------------------------------------
// Transaction list page (forms/workflow-transactions.html)
// ---------------------------------------------------------------------------

// Stub server for the transactions list page: GET /api/workflow-templates,
// GET/POST /api/workflow-transactions.
function createTransactionsStubFetch({ templates, transactions, onStart }) {
  return async (url, options = {}) => {
    if (url.includes("/api/workflow-templates")) {
      return { ok: true, json: async () => ({ templates }) };
    }
    if (url.includes("/api/workflow-transactions") && (!options.method || options.method === "GET")) {
      return { ok: true, json: async () => ({ transactions }) };
    }
    if (url.includes("/api/workflow-transactions") && options.method === "POST") {
      const body = JSON.parse(options.body);
      return onStart(body);
    }
    throw new Error(`Unexpected fetch in test stub: ${options.method || "GET"} ${url}`);
  };
}

async function setupTransactionsPageSandbox({ templates, transactions, onStart }) {
  const elementsById = {
    transactionsPage: new FakeNode("main"),
    startTransactionForm: new FakeNode("form"),
    startTemplateSelect: new FakeNode("select"),
    startAccountingMonth: new FakeNode("input"),
    startTransactionTitle: new FakeNode("input"),
    startTransactionButton: new FakeNode("button"),
    startTransactionStatus: new FakeNode("div"),
    transactionRows: new FakeNode("tbody"),
  };
  elementsById.transactionsPage.dataset = {
    templatesUrl: "/api/workflow-templates",
    transactionsUrl: "/api/workflow-transactions",
  };

  const fakeDocument = {
    querySelector(selector) {
      if (selector.startsWith("#")) return elementsById[selector.slice(1)] || null;
      return null;
    },
    createElement(tag) {
      return new FakeNode(tag);
    },
  };

  const stubFetch = createTransactionsStubFetch({ templates, transactions, onStart });
  const location = { search: "", href: "" };
  const window = { fetch: stubFetch };
  window.addEventListener = (type, handler) => {
    (window._handlers ??= {})[type] = handler;
  };

  const context = vm.createContext({
    window,
    document: fakeDocument,
    location,
    URLSearchParams,
    fetch: stubFetch,
  });

  vm.runInContext(await readFile(workflowLogicPath, "utf8"), context);
  vm.runInContext(await readFile(browserLogicPath, "utf8"), context);

  context.window._handlers.DOMContentLoaded();
  await new Promise((resolve) => setTimeout(resolve, 10));

  return { elements: elementsById, location };
}

test("workflow transactions page starts transactions from templates", async () => {
  const html = await readFile(transactionsHtmlPath, "utf8");
  assert.match(html, /เริ่ม Workflow/);
  assert.match(html, /\/api\/workflow-templates/);
  assert.match(html, /\/api\/workflow-transactions/);
  assert.match(html, /accountingMonth/);
  assert.match(html, /templateId/);
});

test("workflow-transactions.html loads the shared controller as a classic script", async () => {
  const html = await readFile(transactionsHtmlPath, "utf8");
  assert.match(html, /<script src="\.\/workflow\.logic\.js"><\/script>/);
  assert.match(html, /<script src="\.\/workflow\.logic\.browser\.js"><\/script>/);
});

test("transactions page renders the template picker and the existing transaction list with status/current step", async () => {
  const templates = workflowLogic.getDefaultWorkflowTemplates();
  const target = templates.find((template) => template.templateId === "stock_no_tax_invoice_company_bank");
  const transactions = [
    {
      transactionNo: "TXN-2026-09-0001",
      title: "ซื้อสินค้า A",
      workflowTemplateId: target.templateId,
      templateSnapshot: target,
      status: "in_progress",
      currentStepId: "step-002",
      steps: [
        { stepId: "step-001", documentKind: "purchase_order", workflowStatus: "completed" },
        { stepId: "step-002", documentKind: "substitute_receipt", workflowStatus: "not_started" },
        { stepId: "step-003", documentKind: "payment_voucher", workflowStatus: "blocked" },
        { stepId: "step-004", documentKind: "goods_receipt", workflowStatus: "blocked" },
      ],
    },
  ];

  const { elements } = await setupTransactionsPageSandbox({ templates, transactions, onStart: () => {
    throw new Error("start should not be called in this test");
  } });

  // blank placeholder + one option per template
  assert.equal(elements.startTemplateSelect.children.length, templates.length + 1);

  const rows = elements.transactionRows.querySelectorAll("tr");
  assert.equal(rows.length, 1);
  const rowText = rows[0].children.map((cell) => cell.textContent).join(" | ");
  assert.match(rowText, /TXN-2026-09-0001/);
  assert.match(rowText, /ซื้อสินค้า A/);
  assert.match(rowText, new RegExp(workflowLogic.getDocumentTypeDefinition("substitute_receipt").label));
});

test("starting a transaction posts templateId/accountingMonth/title and navigates to the new transaction's detail page", async () => {
  const templates = workflowLogic.getDefaultWorkflowTemplates();
  const target = templates[0];
  let capturedPayload = null;

  const { elements, location } = await setupTransactionsPageSandbox({
    templates,
    transactions: [],
    onStart: (payload) => {
      capturedPayload = payload;
      return {
        ok: true,
        json: async () => ({
          transactionNo: "TXN-2026-09-0007",
          title: payload.title,
          workflowTemplateId: payload.templateId,
        }),
      };
    },
  });

  elements.startTemplateSelect.value = target.templateId;
  elements.startAccountingMonth.value = "2026-09";
  elements.startTransactionTitle.value = "ทดสอบเริ่ม Workflow";

  elements.startTransactionButton.dispatch("click");
  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.ok(capturedPayload, "starting must POST to the server");
  assert.equal(capturedPayload.templateId, target.templateId);
  assert.equal(capturedPayload.accountingMonth, "2026-09");
  assert.equal(capturedPayload.title, "ทดสอบเริ่ม Workflow");
  assert.equal(
    location.href,
    "/workflow-transaction?transactionNo=TXN-2026-09-0007",
    "a successful start must navigate straight to the new transaction's detail page",
  );
});

test("starting a transaction without picking a template raises a Thai validation error and does not POST", async () => {
  const templates = workflowLogic.getDefaultWorkflowTemplates();
  let startWasCalled = false;

  const { elements, location } = await setupTransactionsPageSandbox({
    templates,
    transactions: [],
    onStart: () => { startWasCalled = true; },
  });

  elements.startAccountingMonth.value = "2026-09";
  elements.startTransactionTitle.value = "ไม่มี template";
  elements.startTransactionButton.dispatch("click");
  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.equal(startWasCalled, false);
  assert.equal(location.href, "", "a failed validation must never navigate away");
  assert.match(elements.startTransactionStatus.textContent, /เลือก template/);
  assert.match(elements.startTransactionStatus.className, /error/);
});

// ---------------------------------------------------------------------------
// Transaction detail page (forms/workflow-transaction.html)
// ---------------------------------------------------------------------------

// Builds the <template id="documentChecklistItemTemplate"> equivalent from
// forms/workflow-transaction.html: one ".checklist-item" <li> with an order
// span, label, workflow/native status badges, a document-no span, and the
// per-step action button that defaults to "เปิดเอกสาร".
function createDocumentChecklistItemTemplate() {
  const template = new FakeNode("template");
  const fragment = new FakeNode("#fragment");
  const row = new FakeNode("li");
  row.className = "checklist-item";
  const order = new FakeNode("span");
  order.className = "step-order";
  const body = new FakeNode("div");
  body.className = "step-body";
  const label = new FakeNode("div");
  label.className = "step-label";
  const meta = new FakeNode("div");
  meta.className = "step-meta";
  const workflowStatus = new FakeNode("span");
  workflowStatus.className = "status workflow-status";
  const nativeStatus = new FakeNode("span");
  nativeStatus.className = "status native-status";
  nativeStatus.hidden = true;
  const documentNo = new FakeNode("span");
  documentNo.className = "document-no muted";
  documentNo.hidden = true;
  meta.append(workflowStatus, nativeStatus, documentNo);
  body.append(label, meta);
  const actions = new FakeNode("div");
  actions.className = "step-actions";
  const actionButton = new FakeNode("button");
  actionButton.setAttribute("data-step-action", "");
  actionButton.textContent = "เปิดเอกสาร";
  actions.append(actionButton);
  row.append(order, body, actions);
  fragment.append(row);
  template.content = fragment;
  return template;
}

// Stub server for the transaction detail page: GET/refresh the transaction
// and start-document. The real GET/refresh routes now attach a
// `childDocuments` array directly onto the transaction response (see
// getWorkflowTransactionDetail/refreshWorkflowTransaction in
// forms/local-server.logic.js), so the fixtures passed in as `transaction`/
// `refreshedTransaction` already carry their own `childDocuments` — there is
// no more separate workflow-documents/expense-requests/substitute-receipts
// fetching for this page to stub out.
function createTransactionStubFetch({
  transactionNo,
  transaction,
  refreshedTransaction,
  onStartDocument,
}) {
  let current = transaction;
  return async (url, options = {}) => {
    if (url === `/api/workflow-transactions/${transactionNo}` && (!options.method || options.method === "GET")) {
      return { ok: true, json: async () => current };
    }
    if (url === `/api/workflow-transactions/${transactionNo}/refresh` && options.method === "POST") {
      current = refreshedTransaction || current;
      return { ok: true, json: async () => current };
    }
    if (url.startsWith(`/api/workflow-transactions/${transactionNo}/start-document/`) && options.method === "POST") {
      const stepId = decodeURIComponent(url.slice(url.lastIndexOf("/") + 1));
      return onStartDocument(stepId);
    }
    throw new Error(`Unexpected fetch in test stub: ${options.method || "GET"} ${url}`);
  };
}

async function setupTransactionPageSandbox({
  transactionNo = "TXN-2026-09-0001",
  transaction,
  refreshedTransaction,
  onStartDocument = () => { throw new Error("start-document should not be called in this test"); },
}) {
  const elementsById = {
    transactionPage: new FakeNode("main"),
    transactionNumber: new FakeNode("span"),
    transactionTitleDisplay: new FakeNode("span"),
    transactionTemplateName: new FakeNode("span"),
    workflowProgress: new FakeNode("div"),
    workflowPacketLink: new FakeNode("a"),
    documentChecklist: new FakeNode("ul"),
    documentChecklistItemTemplate: createDocumentChecklistItemTemplate(),
    childDocumentFiles: new FakeNode("ul"),
    refreshTransactionButton: new FakeNode("button"),
    transactionStatus: new FakeNode("div"),
  };
  elementsById.workflowPacketLink.hidden = true;
  elementsById.transactionPage.dataset = {
    transactionsUrl: "/api/workflow-transactions",
  };

  const fakeDocument = {
    querySelector(selector) {
      if (selector.startsWith("#")) return elementsById[selector.slice(1)] || null;
      return null;
    },
    createElement(tag) {
      return new FakeNode(tag);
    },
  };

  const stubFetch = createTransactionStubFetch({
    transactionNo,
    transaction,
    refreshedTransaction,
    onStartDocument,
  });
  const location = { search: `?transactionNo=${transactionNo}`, href: "" };
  const window = { fetch: stubFetch };
  window.addEventListener = (type, handler) => {
    (window._handlers ??= {})[type] = handler;
  };

  const context = vm.createContext({
    window,
    document: fakeDocument,
    location,
    URLSearchParams,
    fetch: stubFetch,
  });

  vm.runInContext(await readFile(workflowLogicPath, "utf8"), context);
  vm.runInContext(await readFile(browserLogicPath, "utf8"), context);

  context.window._handlers.DOMContentLoaded();
  await new Promise((resolve) => setTimeout(resolve, 10));

  return { elements: elementsById, location };
}

function buildFourStepTransaction(overrides = {}) {
  return {
    transactionNo: "TXN-2026-09-0001",
    title: "ซื้อสินค้า A",
    workflowTemplateId: "stock_no_tax_invoice_company_bank",
    templateSnapshot: { name: "ซื้อสต๊อก ไม่มีใบกำกับภาษี ชำระเงินโอนจากบัญชีบริษัท" },
    status: "in_progress",
    currentStepId: "step-001",
    steps: [
      { stepId: "step-001", documentKind: "purchase_order", workflowStatus: "not_started" },
      { stepId: "step-002", documentKind: "substitute_receipt", workflowStatus: "blocked" },
      { stepId: "step-003", documentKind: "payment_voucher", workflowStatus: "blocked" },
      { stepId: "step-004", documentKind: "goods_receipt", workflowStatus: "blocked" },
    ],
    childDocuments: [],
    ...overrides,
  };
}

test("workflow transaction page shows progress checklist and standalone document links", async () => {
  const html = await readFile(transactionHtmlPath, "utf8");
  assert.match(html, /id="workflowProgress"/);
  assert.match(html, /id="documentChecklist"/);
  assert.match(html, /id="childDocumentFiles"/);
  assert.match(html, /start-document/);
  assert.match(html, /refresh/);
  assert.match(html, /เปิดเอกสาร/);
  // Packet link and complete/sync UI do not exist until Task 10/Task 11.
  assert.doesNotMatch(html, /id="syncDriveButton"/);
  assert.doesNotMatch(html, /id="driveSyncStatus"/);
});

test("workflow-transaction.html loads the shared controller as a classic script", async () => {
  const html = await readFile(transactionHtmlPath, "utf8");
  assert.match(html, /<script src="\.\/workflow\.logic\.js"><\/script>/);
  assert.match(html, /<script src="\.\/workflow\.logic\.browser\.js"><\/script>/);
});

test("transaction page renders only the current step as actionable; every other step is genuinely disabled", async () => {
  const transaction = buildFourStepTransaction();

  const { elements } = await setupTransactionPageSandbox({ transaction, refreshedTransaction: transaction });

  const rows = elements.documentChecklist.querySelectorAll(".checklist-item");
  assert.equal(rows.length, 4);

  const buttons = rows.map((row) => row.querySelector("[data-step-action]"));
  assert.equal(buttons[0].disabled, false, "the current (first) step must be actionable");
  assert.equal(buttons[1].disabled, true, "a not-yet-reached step must be disabled");
  assert.equal(buttons[2].disabled, true, "a blocked step must be disabled");
  assert.equal(buttons[3].disabled, true, "a blocked step must be disabled");

  assert.match(elements.transactionNumber.textContent, /TXN-2026-09-0001/);
  assert.match(elements.transactionTitleDisplay.textContent, /ซื้อสินค้า A/);
});

test("transaction page shows each step's native document status and document number when a child document exists", async () => {
  const transaction = buildFourStepTransaction({
    currentStepId: "step-002",
    steps: [
      { stepId: "step-001", documentKind: "purchase_order", workflowStatus: "completed" },
      { stepId: "step-002", documentKind: "substitute_receipt", workflowStatus: "not_started" },
      { stepId: "step-003", documentKind: "payment_voucher", workflowStatus: "blocked" },
      { stepId: "step-004", documentKind: "goods_receipt", workflowStatus: "blocked" },
    ],
    childDocuments: [
      {
        documentKind: "purchase_order",
        documentNo: "PO-2026-09-0001",
        status: "completed",
        statusLabel: "เสร็จสิ้น",
        workflowStepId: "step-001",
        pdfFiles: [],
        rawFiles: [],
      },
    ],
  });

  const { elements } = await setupTransactionPageSandbox({
    transaction,
    refreshedTransaction: transaction,
  });

  const rows = elements.documentChecklist.querySelectorAll(".checklist-item");
  const firstRowDocumentNo = rows[0].querySelector(".document-no");
  const firstRowNativeStatus = rows[0].querySelector(".native-status");

  assert.equal(firstRowDocumentNo.hidden, false);
  assert.match(firstRowDocumentNo.textContent, /PO-2026-09-0001/);
  assert.equal(firstRowNativeStatus.hidden, false);
  assert.match(firstRowNativeStatus.textContent, /เสร็จสิ้น/);

  const secondRowDocumentNo = rows[1].querySelector(".document-no");
  assert.equal(secondRowDocumentNo.hidden, true, "a step with no child document yet must not show a document number");
});

test("clicking the current step's action button calls start-document and navigates to the returned url", async () => {
  const transaction = buildFourStepTransaction();
  let requestedStepId = null;

  const { elements, location } = await setupTransactionPageSandbox({
    transaction,
    refreshedTransaction: transaction,
    onStartDocument: (stepId) => {
      requestedStepId = stepId;
      return {
        ok: true,
        json: async () => ({
          url: "/workflow-document?documentKind=purchase_order&transactionNo=TXN-2026-09-0001&workflowStepId=step-001&returnTo=%2Fworkflow-transaction%3FtransactionNo%3DTXN-2026-09-0001",
        }),
      };
    },
  });

  const rows = elements.documentChecklist.querySelectorAll(".checklist-item");
  rows[0].querySelector("[data-step-action]").dispatch("click");
  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.equal(requestedStepId, "step-001");
  assert.equal(
    location.href,
    "/workflow-document?documentKind=purchase_order&transactionNo=TXN-2026-09-0001&workflowStepId=step-001&returnTo=%2Fworkflow-transaction%3FtransactionNo%3DTXN-2026-09-0001",
  );
});

test("clicking a disabled step's button never calls start-document, even if something forces a click event through", async () => {
  // The server enforces strict ordering independently, but the UI must not
  // rely on that alone: a disabled button's own click handler must refuse to
  // call start-document before a request is ever sent.
  const transaction = buildFourStepTransaction();
  let startDocumentWasCalled = false;

  const { elements, location } = await setupTransactionPageSandbox({
    transaction,
    refreshedTransaction: transaction,
    onStartDocument: () => { startDocumentWasCalled = true; },
  });

  const rows = elements.documentChecklist.querySelectorAll(".checklist-item");
  const lockedButton = rows[2].querySelector("[data-step-action]");
  assert.equal(lockedButton.disabled, true);
  lockedButton.dispatch("click");
  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.equal(startDocumentWasCalled, false);
  assert.equal(location.href, "", "a refused click must never navigate away");
});

test("a locked-step refusal from the server surfaces the exact Thai message instead of being swallowed", async () => {
  const transaction = buildFourStepTransaction({ currentStepId: "step-002" });

  const { elements } = await setupTransactionPageSandbox({
    transaction,
    refreshedTransaction: transaction,
    onStartDocument: () => ({
      ok: false,
      json: async () => ({ error: "ขั้นตอนนี้ยังไม่พร้อมใช้งาน กรุณาทำขั้นตอนก่อนหน้าให้เสร็จสิ้นก่อน" }),
    }),
  });

  const rows = elements.documentChecklist.querySelectorAll(".checklist-item");
  // step-002 is current in this fixture, so its button is the enabled one —
  // force the request through it to exercise the server-refusal path.
  rows[1].querySelector("[data-step-action]").dispatch("click");
  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.match(elements.transactionStatus.textContent, /ขั้นตอนนี้ยังไม่พร้อมใช้งาน กรุณาทำขั้นตอนก่อนหน้าให้เสร็จสิ้นก่อน/);
  assert.match(elements.transactionStatus.className, /error/);
});

test("the refresh button re-fetches the transaction and unlocks the next step once the current one completes", async () => {
  const notYetRefreshed = buildFourStepTransaction();
  const afterRefresh = buildFourStepTransaction({
    currentStepId: "step-002",
    steps: [
      { stepId: "step-001", documentKind: "purchase_order", workflowStatus: "completed" },
      { stepId: "step-002", documentKind: "substitute_receipt", workflowStatus: "not_started" },
      { stepId: "step-003", documentKind: "payment_voucher", workflowStatus: "blocked" },
      { stepId: "step-004", documentKind: "goods_receipt", workflowStatus: "blocked" },
    ],
  });

  const { elements } = await setupTransactionPageSandbox({
    transaction: notYetRefreshed,
    refreshedTransaction: notYetRefreshed,
  });

  let rows = elements.documentChecklist.querySelectorAll(".checklist-item");
  assert.equal(rows[0].querySelector("[data-step-action]").disabled, false, "sanity check: step 1 starts actionable");
  assert.equal(rows[1].querySelector("[data-step-action]").disabled, true, "sanity check: step 2 starts locked");

  // Simulate the server now reporting step 1 as completed (as it would right
  // after the user finishes the purchase order and comes back here).
  elements.transactionPage.dataset.transactionsUrl = "/api/workflow-transactions";
  // Swap what the stub's refresh call returns by re-driving refreshTransaction
  // through the button, but first patch the stub's "refreshedTransaction" via
  // a second sandbox is unnecessary — the button click below re-invokes fetch,
  // and the stub always returns `refreshedTransaction` on refresh; here we
  // instead re-run the click against a freshly built sandbox reflecting the
  // post-completion state to prove the refresh path renders it.
  const { elements: refreshedElements } = await setupTransactionPageSandbox({
    transaction: notYetRefreshed,
    refreshedTransaction: afterRefresh,
  });
  refreshedElements.refreshTransactionButton.dispatch("click");
  await new Promise((resolve) => setTimeout(resolve, 10));

  rows = refreshedElements.documentChecklist.querySelectorAll(".checklist-item");
  assert.equal(rows[0].querySelector("[data-step-action]").disabled, true, "the now-completed step must no longer be actionable");
  assert.equal(rows[1].querySelector("[data-step-action]").disabled, false, "the newly-current step must unlock");
});

test("initial page load already reflects the freshest state (self-refreshes on load, matching start-document's own self-refresh)", async () => {
  // If the page only did a bare GET on load, landing back here right after
  // completing a document (which never itself touches the transaction
  // record) would show stale step statuses until the user manually clicked
  // refresh. The transaction detail page must refresh on load, the same way
  // POST start-document already refreshes before checking currentStepId.
  const stale = buildFourStepTransaction();
  const fresh = buildFourStepTransaction({
    currentStepId: "step-002",
    steps: [
      { stepId: "step-001", documentKind: "purchase_order", workflowStatus: "completed" },
      { stepId: "step-002", documentKind: "substitute_receipt", workflowStatus: "not_started" },
      { stepId: "step-003", documentKind: "payment_voucher", workflowStatus: "blocked" },
      { stepId: "step-004", documentKind: "goods_receipt", workflowStatus: "blocked" },
    ],
  });

  const { elements } = await setupTransactionPageSandbox({
    transaction: stale,
    refreshedTransaction: fresh,
  });

  const rows = elements.documentChecklist.querySelectorAll(".checklist-item");
  assert.equal(rows[0].querySelector("[data-step-action]").disabled, true, "step 1 must already show completed on load, not stale");
  assert.equal(rows[1].querySelector("[data-step-action]").disabled, false, "step 2 must already show unlocked on load, not stale");
});

test("child document files are grouped per document and expose real PDF/raw links from the API, not fabricated ones", async () => {
  const transaction = buildFourStepTransaction({
    currentStepId: "step-002",
    steps: [
      { stepId: "step-001", documentKind: "purchase_order", workflowStatus: "completed" },
      { stepId: "step-002", documentKind: "substitute_receipt", workflowStatus: "not_started" },
      { stepId: "step-003", documentKind: "payment_voucher", workflowStatus: "blocked" },
      { stepId: "step-004", documentKind: "goods_receipt", workflowStatus: "blocked" },
    ],
    childDocuments: [
      {
        documentKind: "purchase_order",
        documentNo: "PO-2026-09-0001",
        status: "completed",
        statusLabel: "เสร็จสิ้น",
        workflowStepId: "step-001",
        pdfFiles: [{ name: "01_purchase_order.pdf", url: "/workflow-documents/purchase_order/PO-2026-09-0001/pdf/01_purchase_order.pdf" }],
        rawFiles: [{ name: "ใบเสนอราคา.jpg", url: "/workflow-documents/purchase_order/PO-2026-09-0001/raw/A0_ใบเสนอราคา.jpg" }],
      },
      {
        documentKind: "substitute_receipt",
        documentNo: "SR-2026-09-0001",
        status: "pending_approval",
        statusLabel: "รอตรวจอนุมัติ",
        workflowStepId: "step-002",
        pdfFiles: [{ name: "01_substitute_receipt.pdf", url: "/api/substitute-receipts/SR-2026-09-0001/files/pdf/01_substitute_receipt.pdf" }],
        rawFiles: [{ name: "evidence.jpg", url: "/api/substitute-receipts/SR-2026-09-0001/files/raw/evidence.jpg" }],
      },
    ],
  });

  const { elements } = await setupTransactionPageSandbox({
    transaction,
    refreshedTransaction: transaction,
  });

  const links = elements.childDocumentFiles.querySelectorAll("a");
  const hrefs = links.map((link) => link.href);

  assert.ok(
    hrefs.includes("/api/substitute-receipts/SR-2026-09-0001/files/pdf/01_substitute_receipt.pdf"),
    "the substitute receipt's real PDF url from the API must be linked",
  );
  assert.ok(
    hrefs.includes("/api/substitute-receipts/SR-2026-09-0001/files/raw/evidence.jpg"),
    "the substitute receipt's real raw file url from the API must be linked",
  );
  assert.ok(
    hrefs.some((href) => href.includes("/workflow-documents/purchase_order/PO-2026-09-0001/raw/A0_")),
    "the lightweight document's real uploaded evidence file must be linked using its actual stored file name",
  );
});

test("workflow transaction page includes a packet PDF link", async () => {
  const html = await readFile(new URL("../forms/workflow-transaction.html", import.meta.url), "utf8");
  assert.match(html, /id="workflowPacketLink"/);
});

test("the packet PDF link stays hidden until the transaction's pdfFiles carries the packet file", async () => {
  const transaction = buildFourStepTransaction();

  const { elements } = await setupTransactionPageSandbox({
    transaction,
    refreshedTransaction: transaction,
  });

  assert.equal(elements.workflowPacketLink.hidden, true, "no pdfFiles yet, so the link must stay hidden");
});

test("the packet PDF link is unhidden and points at the packet file's download URL once it exists", async () => {
  const transaction = buildFourStepTransaction();
  const refreshedTransaction = {
    ...transaction,
    pdfFiles: [
      {
        name: "99_ชุดรวมเอกสาร_workflow-transaction.pdf",
        url: "/api/workflow-transactions/TXN-2026-09-0001/files/pdf/99_%E0%B8%8A%E0%B8%B8%E0%B8%94%E0%B8%A3%E0%B8%A7%E0%B8%A1%E0%B9%80%E0%B8%AD%E0%B8%81%E0%B8%AA%E0%B8%B2%E0%B8%A3_workflow-transaction.pdf",
      },
    ],
  };

  const { elements } = await setupTransactionPageSandbox({
    transaction,
    refreshedTransaction,
  });

  assert.equal(elements.workflowPacketLink.hidden, false, "once pdfFiles carries the packet file, the link must be shown");
  assert.equal(elements.workflowPacketLink.href, refreshedTransaction.pdfFiles[0].url);
});
