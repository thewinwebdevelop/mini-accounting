import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";

import workflowLogic from "../forms/workflow.logic.js";

const templatesHtmlPath = new URL("../forms/workflow-templates.html", import.meta.url);
const browserLogicPath = new URL("../forms/workflow.logic.browser.js", import.meta.url);

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
