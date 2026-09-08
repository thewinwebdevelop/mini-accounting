import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";

const htmlPath = new URL("../forms/substitute-receipt.html", import.meta.url);
const browserLogicPath = new URL("../forms/substitute-receipt.logic.browser.js", import.meta.url);
const substituteReceiptLogicPath = new URL("../forms/substitute-receipt.logic.js", import.meta.url);
const returnLinkPath = new URL("../forms/workflow-return-link.browser.js", import.meta.url);
const prefillLogicPath = new URL("../forms/workflow-prefill.logic.js", import.meta.url);

test("substitute receipt page provides stock purchase form, evidence uploads, and summary", async () => {
  const html = await readFile(htmlPath, "utf8");

  assert.match(html, /<title>ใบรับรองแทนใบเสร็จรับเงิน - หจก\.สวีทเฮาส์<\/title>/);
  assert.match(html, /id="substituteReceiptForm"/);
  assert.match(html, /id="receiptNoPreview"/);
  assert.match(html, /name="receiptType"/);
  assert.match(html, /value="stock_purchase"/);
  assert.match(html, /id="vendorPresetSelect"/);
  assert.match(html, /id="stockLineItems"/);
  assert.match(html, /id="addStockLine"/);
  assert.match(html, /name="stockSkuId"/);
  assert.match(html, /name="quantity"/);
  assert.match(html, /name="unitCost"/);
  assert.match(html, /name="evidence_paymentSlip"/);
  assert.match(html, /name="evidence_purchaseOrder"/);
  assert.match(html, /name="evidence_goodsReceived"/);
  assert.match(html, /id="submitSubstituteReceipt"/);
  assert.match(html, /id="saveDraft"/);
  assert.match(html, /id="submitForApproval"/);
  assert.match(html, /id="approveReceipt"/);
  assert.match(html, /id="receiveStock"/);
  assert.match(html, /id="receiptStatus"/);
  assert.match(html, /src="\.\/searchable-select\.logic\.browser\.js"/);
  assert.match(html, /src="\.\/substitute-receipt\.logic\.js"/);
  assert.match(html, /src="\.\/substitute-receipt\.logic\.browser\.js"/);
});

test("substitute receipt stock line template is collapsible with a running summary", async () => {
  const html = await readFile(htmlPath, "utf8");
  const template = html.match(/<template id="stockLineTemplate">([\s\S]*?)<\/template>/)?.[1] ?? "";

  assert.match(template, /<details class="stock-line" open>/);
  assert.match(template, /<summary class="stock-line-summary">/);
  assert.match(template, /data-stock-line-title/);
  assert.match(template, /data-stock-line-total/);
  assert.match(template, /class="stock-line-fields"/);
});

test("substitute receipt line template lets general expenses skip Stock SKU", async () => {
  const html = await readFile(htmlPath, "utf8");
  const template = html.match(/<template id="stockLineTemplate">([\s\S]*?)<\/template>/)?.[1] ?? "";

  assert.match(template, /data-stock-only-field/);
  assert.match(template, /<select name="stockSkuId" data-searchable><\/select>/);
  assert.doesNotMatch(template, /<select name="stockSkuId" required/);
  assert.match(template, /data-description-label>รายละเอียด/);
});

test("substitute receipt browser controller loads draft and submitted receipt query targets", async () => {
  const browserLogic = await readFile(browserLogicPath, "utf8");

  assert.match(browserLogic, /new URLSearchParams\(location\.search\)\.get\("draftId"\)/);
  assert.match(browserLogic, /new URLSearchParams\(location\.search\)\.get\("receiptNo"\)/);
  assert.match(browserLogic, /\/api\/substitute-receipt-drafts\//);
  assert.match(browserLogic, /\/api\/substitute-receipt-vendors/);
  assert.match(browserLogic, /\/api\/substitute-receipts\/.*\/approve/);
  assert.match(browserLogic, /\/api\/substitute-receipts\/.*\/receive-stock/);
});

test("substitute receipt browser controller updates stock line summaries", async () => {
  const browserLogic = await readFile(browserLogicPath, "utf8");

  assert.match(browserLogic, /function updateStockLineSummaries/);
  assert.match(browserLogic, /data-stock-line-title/);
  assert.match(browserLogic, /data-stock-line-total/);
});

// --- Task 9: workflow context wiring --------------------------------------

test("substitute receipt form preserves workflow context query params", async () => {
  const html = await readFile(htmlPath, "utf8");
  // Unlike expense-request.html (whose controller is an inline <script>),
  // substitute-receipt.html's controller lives in the separate
  // forms/substitute-receipt.logic.browser.js file it loads — so the
  // returnTo/sanitizeWorkflowReturnTo wiring lives there, not in the HTML
  // source itself. Check the combined shipped code for this page.
  const browserLogic = await readFile(browserLogicPath, "utf8");
  const combined = html + browserLogic;
  assert.match(html, /transactionNo/);
  assert.match(html, /workflowTemplateId/);
  assert.match(html, /workflowStepId/);
  assert.match(combined, /returnTo/);
  assert.match(html, /กลับไปที่ Workflow/);
  assert.match(html, /workflow-return-link\.browser\.js/);
  assert.match(combined, /sanitizeWorkflowReturnTo/);
});

test("substitute receipt form shows the cross-document prefill banner", async () => {
  const html = await readFile(htmlPath, "utf8");
  assert.match(html, /workflow-prefill\.logic\.js/);
  assert.match(html, /id="workflowPrefillBanner"/);
  assert.match(html, /ใช้ข้อมูลเดิม/);
  assert.match(html, /กรอกใหม่/);
});

test("substitute receipt form hides the return link markup by default", async () => {
  const html = await readFile(htmlPath, "utf8");
  const returnLinkMatch = html.match(/<a[^>]*id="workflowReturnLink"[^>]*>/);
  assert.ok(returnLinkMatch, "expected a #workflowReturnLink anchor");
  assert.match(returnLinkMatch[0], /hidden/);
});

test("substitute receipt form loads workflow-return-link.browser.js and workflow-prefill.logic.js before its own controller", async () => {
  const html = await readFile(htmlPath, "utf8");
  const returnLinkIndex = html.indexOf("workflow-return-link.browser.js");
  const prefillLogicIndex = html.indexOf("workflow-prefill.logic.js");
  const controllerIndex = html.indexOf("substitute-receipt.logic.browser.js");
  assert.ok(returnLinkIndex !== -1 && prefillLogicIndex !== -1 && controllerIndex !== -1);
  assert.ok(returnLinkIndex < controllerIndex, "return-link helper must load before the page controller");
  assert.ok(prefillLogicIndex < controllerIndex, "workflow-prefill.logic.js must load before the page controller");
  assert.ok(returnLinkIndex < prefillLogicIndex, "return-link helper loads before workflow-prefill.logic.js");
});

test("substitute receipt browser controller includes workflow fields in the saved payload", async () => {
  const browserLogic = await readFile(browserLogicPath, "utf8");
  assert.match(browserLogic, /transactionNo: form\.elements\.transactionNo\.value/);
  assert.match(browserLogic, /workflowTemplateId: form\.elements\.workflowTemplateId\.value/);
  assert.match(browserLogic, /workflowStepId: form\.elements\.workflowStepId\.value/);
});

// --- Genuine execution: the real controller module actually runs --------
//
// String-matching the source (above) proves the right tokens exist, but not
// that they are wired together correctly. This is exactly the trap called
// out for this task: a banner whose apply button does nothing, or a
// `groups` argument that is silently ignored, would still pass every
// string-match test above. The tests below execute the real
// forms/substitute-receipt.logic.browser.js as a classic script (no
// require/module) inside a vm sandbox with a minimal fake DOM, the same
// technique tests/workflow-document.html.test.mjs uses for the generic
// shell.

class FakeNode {
  constructor(tagName) {
    this.tagName = String(tagName).toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.listeners = {};
    this.attrs = {};
    this.dataset = {};
    this.classListSet = new Set();
    this.id = "";
    this.name = "";
    this.type = "";
    this.value = "";
    this.checked = false;
    this.hidden = false;
    this.disabled = false;
    this.required = false;
    this.textContent = "";
    this._innerHTML = "";
    this.style = {};
    // Only meaningful on <select>, but harmless everywhere else — avoids a
    // real DOM's automatic "currently selected option" computation, which
    // this fake DOM does not attempt to replicate.
    this.selectedOptions = [];
  }

  get className() {
    return [...this.classListSet].join(" ");
  }

  set className(value) {
    this.classListSet = new Set(String(value).split(/\s+/).filter(Boolean));
  }

  get classList() {
    const self = this;
    return {
      add: (c) => self.classListSet.add(c),
      remove: (c) => self.classListSet.delete(c),
      toggle: (c, force) => {
        if (force === undefined) {
          self.classListSet.has(c) ? self.classListSet.delete(c) : self.classListSet.add(c);
        } else if (force) {
          self.classListSet.add(c);
        } else {
          self.classListSet.delete(c);
        }
      },
      contains: (c) => self.classListSet.has(c),
    };
  }

  get innerHTML() {
    return this._innerHTML;
  }

  set innerHTML(value) {
    this._innerHTML = value;
    if (value === "") {
      this.children.forEach((child) => { child.parentNode = null; });
      this.children = [];
    }
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
    let sel = selector;
    let requireChecked = false;
    if (sel.endsWith(":checked")) {
      requireChecked = true;
      sel = sel.slice(0, -":checked".length);
    }
    if (requireChecked && !this.checked) return false;

    const bracketMatch = sel.match(/^([a-zA-Z0-9]*)\[([\w-]+)(?:="([^"]*)")?\]$/);
    if (bracketMatch) {
      const [, tag, attr, value] = bracketMatch;
      if (tag && this.tagName.toLowerCase() !== tag.toLowerCase()) return false;
      if (attr === "name") {
        return value === undefined ? Boolean(this.name) : this.name === value;
      }
      if (attr === "type") {
        return value === undefined ? Boolean(this.type) : this.type === value;
      }
      const actual = this.attrs[attr];
      return value === undefined ? actual !== undefined : actual === value;
    }

    if (sel.startsWith(".")) {
      return String(this.className).split(/\s+/).filter(Boolean).includes(sel.slice(1));
    }
    if (sel.startsWith("#")) return this.id === sel.slice(1);
    return this.tagName.toLowerCase() === sel.toLowerCase();
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

// Builds a fake equivalent of #stockLineTemplate: a <template> whose
// .content is a fragment containing one ".stock-line" details element with
// the exact name="..." fields and data-* hooks
// forms/substitute-receipt.logic.browser.js's addStockLine()/
// applyReceiptTypeState()/collectLineRows() read from (see the real
// <template id="stockLineTemplate"> in forms/substitute-receipt.html).
function createStockLineTemplate() {
  const template = new FakeNode("template");
  const fragment = new FakeNode("#fragment");
  const details = new FakeNode("details");
  details.className = "stock-line";

  const summary = new FakeNode("summary");
  summary.className = "stock-line-summary";
  const titleSpan = new FakeNode("span");
  titleSpan.setAttribute("data-stock-line-title", "");
  const totalSpan = new FakeNode("span");
  totalSpan.setAttribute("data-stock-line-total", "");
  summary.append(titleSpan, totalSpan);

  const fieldsWrap = new FakeNode("div");
  fieldsWrap.className = "stock-line-fields";

  const stockField = new FakeNode("div");
  stockField.setAttribute("data-stock-only-field", "");
  const select = new FakeNode("select");
  select.setAttribute("name", "stockSkuId");
  stockField.append(select);

  const descriptionField = new FakeNode("div");
  const descriptionLabel = new FakeNode("label");
  descriptionLabel.setAttribute("data-description-label", "");
  const description = new FakeNode("input");
  description.setAttribute("name", "description");
  const sku = new FakeNode("input");
  sku.setAttribute("name", "sku");
  descriptionField.append(descriptionLabel, description, sku);

  const quantityField = new FakeNode("div");
  const quantity = new FakeNode("input");
  quantity.setAttribute("name", "quantity");
  quantityField.append(quantity);

  const amountField = new FakeNode("div");
  const amountLabel = new FakeNode("label");
  amountLabel.setAttribute("data-amount-label", "");
  const unitCost = new FakeNode("input");
  unitCost.setAttribute("name", "unitCost");
  amountField.append(amountLabel, unitCost);

  const removeButton = new FakeNode("button");
  removeButton.setAttribute("data-remove-line", "");

  fieldsWrap.append(stockField, descriptionField, quantityField, amountField, removeButton);
  details.append(summary, fieldsWrap);
  fragment.append(details);
  template.content = fragment;
  return template;
}

function makeSimpleElement(tag = "div") {
  return new FakeNode(tag);
}

// Sets up the real forms/substitute-receipt.logic.browser.js in a
// require-less vm sandbox with a minimal fake DOM covering exactly the
// elements the controller touches, runs its DOMContentLoaded handler, and
// waits for both the boot Promise.all chain and the fire-and-forget
// loadWorkflowPrefill() fetch chain to settle. Evidence file inputs are
// deliberately left absent — the controller already handles a missing
// evidence_* input gracefully via optional chaining, and they are unrelated
// to the workflow wiring under test.
async function setupSubstituteReceiptSandbox({ search = "", prefillResponse = null, nextReceiptNo = "RCT-2026-09-0001" } = {}) {
  const elementsById = {
    substituteReceiptForm: new FakeNode("form"),
    substituteReceiptStatus: makeSimpleElement("div"),
    stockLineItems: new FakeNode("div"),
    stockLineTemplate: createStockLineTemplate(),
    addStockLine: makeSimpleElement("button"),
    saveDraft: makeSimpleElement("button"),
    submitForApproval: makeSimpleElement("button"),
    approveReceipt: makeSimpleElement("button"),
    receiveStock: makeSimpleElement("button"),
    receiptStatus: makeSimpleElement("div"),
    receiptNoPreview: makeSimpleElement("div"),
    lineCountPreview: makeSimpleElement("div"),
    totalAmountPreview: makeSimpleElement("div"),
    evidenceCountPreview: makeSimpleElement("div"),
    stockReceiptNotice: makeSimpleElement("div"),
    vendorPresetSelect: new FakeNode("select"),
    receiptTypeWorkflowNote: makeSimpleElement("span"),
    workflowReturnLink: new FakeNode("a"),
    workflowPrefillBanner: new FakeNode("div"),
    workflowPrefillGroups: new FakeNode("div"),
    workflowPrefillApply: new FakeNode("button"),
    workflowPrefillDismiss: new FakeNode("button"),
  };

  // Mirror the real markup: both start with the `hidden` attribute present
  // (<a ... hidden>, <div ... hidden>), so their `.hidden` property starts
  // true, exactly like a real browser parsing the HTML.
  elementsById.workflowReturnLink.hidden = true;
  elementsById.workflowPrefillBanner.hidden = true;
  elementsById.receiptTypeWorkflowNote.hidden = true;

  const form = elementsById.substituteReceiptForm;
  const formField = (value = "") => ({ value, disabled: false, addEventListener() {} });
  form.elements = {
    accountingMonth: formField(),
    receiptDate: formField(),
    receiptTitle: formField(),
    receiptType: formField("stock_purchase"),
    payeeName: formField(),
    payeeTaxId: formField(),
    paymentChannel: formField(),
    paymentReference: formField(),
    businessPurpose: formField(),
    transactionNo: formField(),
    workflowTemplateId: formField(),
    workflowStepId: formField(),
  };

  // markWorkflowFieldPrefilled looks up `[data-badge-for="<field>"]` inside
  // the form, mirroring the real <span class="field-badge" data-badge-for="...">
  // markup added next to each prefillable field.
  for (const fieldName of ["receiptTitle", "payeeName", "payeeTaxId", "businessPurpose", "lines"]) {
    const badge = new FakeNode("span");
    badge.setAttribute("data-badge-for", fieldName);
    badge.hidden = true;
    form.appendChild(badge);
  }

  const fakeDocument = {
    querySelector(selector) {
      if (selector.startsWith("#")) return elementsById[selector.slice(1)] || null;
      return null;
    },
    querySelectorAll() {
      return [];
    },
    createElement(tag) {
      return new FakeNode(tag);
    },
  };

  const fetchLog = [];
  // Captures whatever the controller last posted as a multipart "payload"
  // field (draft save / submit-for-approval), so a test can assert on the
  // actual JSON that would have reached the server -- specifically, that a
  // workflow-locked (and therefore `disabled`) receiptType select still
  // contributes its value to that payload, since collectPayload() reads
  // form.elements.receiptType.value directly rather than relying on native
  // form/FormData serialization (which *would* silently drop a disabled
  // field).
  const capturedPost = { payload: null };
  const stubFetch = async (url, options = {}) => {
    fetchLog.push(url);
    if (url.includes("/prefill")) {
      return { ok: true, json: async () => prefillResponse ?? { availableGroups: [] } };
    }
    if (url.includes("/api/inventory/stock-skus")) {
      return { ok: true, json: async () => ({ stockSkus: [] }) };
    }
    if (url.includes("/api/substitute-receipt-vendors")) {
      return { ok: true, json: async () => ({ vendors: [] }) };
    }
    if (url.includes("/api/substitute-receipts/next")) {
      return { ok: true, json: async () => ({ sequence: "1", receiptNo: nextReceiptNo }) };
    }
    if (
      options.method === "POST"
      && (url.includes("/api/substitute-receipt-drafts") || url.includes("/api/substitute-receipts"))
      && options.body instanceof FormData
    ) {
      capturedPost.payload = JSON.parse(options.body.get("payload"));
      return { ok: true, json: async () => ({ draftId: "DRAFT-TEST", receiptNo: nextReceiptNo, status: "pending_approval", pdfFiles: [], rawFiles: [] }) };
    }
    return { ok: true, json: async () => ({}) };
  };

  const window = {};
  window.addEventListener = (type, handler) => {
    (window._handlers ??= {})[type] = handler;
  };

  const context = vm.createContext({
    window,
    document: fakeDocument,
    location: { search, protocol: "http:" },
    URLSearchParams,
    FormData,
    // Bare `fetch(...)` resolves through the sandbox's global object, which
    // is this context object itself, not our separate `window` property.
    fetch: stubFetch,
  });

  vm.runInContext(await readFile(substituteReceiptLogicPath, "utf8"), context);
  vm.runInContext(await readFile(returnLinkPath, "utf8"), context);
  // workflow-return-link.browser.js is a plain classic script (no
  // `window.` assignment, per its own test coverage) — in a real browser,
  // top-level function declarations attach to the real global object,
  // which *is* `window`. This vm sandbox uses a separate plain `window`
  // object, so bridge the one function the controller calls through
  // `window.sanitizeWorkflowReturnTo`.
  context.window.sanitizeWorkflowReturnTo = context.sanitizeWorkflowReturnTo;
  vm.runInContext(await readFile(prefillLogicPath, "utf8"), context);
  vm.runInContext(await readFile(browserLogicPath, "utf8"), context);

  context.window._handlers.DOMContentLoaded();
  // Both the Promise.all(...) boot chain and the fire-and-forget
  // loadWorkflowPrefill() fetch -> json -> renderWorkflowPrefillBanner
  // microtask chain need to fully settle before a test touches the DOM.
  await new Promise((resolve) => setTimeout(resolve, 20));

  return { context, elements: elementsById, form, fetchLog, capturedPost };
}

function getPrefillCheckbox(container, group) {
  return container.querySelectorAll('input[type="checkbox"]').find((checkbox) => checkbox.value === group);
}

test("opened with no workflow context: no prefill fetch fires and the return link/banner stay hidden", async () => {
  const { elements, fetchLog } = await setupSubstituteReceiptSandbox({ search: "" });

  assert.equal(elements.workflowReturnLink.hidden, true, "return link must stay hidden with no returnTo");
  assert.equal(elements.workflowPrefillBanner.hidden, true, "prefill banner must stay hidden with no transactionNo/workflowStepId");
  assert.ok(
    !fetchLog.some((url) => url.includes("/prefill")),
    "no prefill request should fire when transactionNo/workflowStepId are absent",
  );
});

test("opened with a workflow transactionNo but an unsafe returnTo: the return link stays hidden", async () => {
  const { elements } = await setupSubstituteReceiptSandbox({
    search: "?transactionNo=TXN-2026-09-0001&workflowTemplateId=tpl-1&workflowStepId=step-2&returnTo=https://evil.example",
    prefillResponse: { availableGroups: [] },
  });

  assert.equal(elements.workflowReturnLink.hidden, true, "an absolute/off-site returnTo must never surface as a clickable link");
});

test("opened from a workflow step: hidden fields are populated and a safe returnTo shows the return link", async () => {
  const { elements, form, fetchLog } = await setupSubstituteReceiptSandbox({
    search: "?transactionNo=TXN-2026-09-0001&workflowTemplateId=tpl-1&workflowStepId=step-2&returnTo=%2Fworkflow-transaction%3FtransactionNo%3DTXN-2026-09-0001",
    prefillResponse: { availableGroups: [] },
  });

  assert.equal(form.elements.transactionNo.value, "TXN-2026-09-0001");
  assert.equal(form.elements.workflowTemplateId.value, "tpl-1");
  assert.equal(form.elements.workflowStepId.value, "step-2");
  assert.equal(elements.workflowReturnLink.hidden, false);
  assert.equal(elements.workflowReturnLink.href, "/workflow-transaction?transactionNo=TXN-2026-09-0001");
  assert.ok(
    fetchLog.some((url) => url.includes("/api/workflow-transactions/TXN-2026-09-0001/prefill") && url.includes("documentKind=substitute_receipt") && url.includes("stepId=step-2")),
    "must fetch the prefill endpoint for the right transaction/documentKind/stepId",
  );
});

// --- receiptType lock: a workflow-declared step locks the field ----------
//
// A free-form receiptType dropdown decides, all by itself, whether a
// workflow step can ever complete (see deriveChildWorkflowStatus's hybrid
// rule in forms/workflow.logic.js). start-document now carries the
// snapshotted template's declared receiptType as a `receiptType` query
// param (see handleWorkflowTransactionStartDocument in local-server.mjs);
// this page must preselect and lock the field when that param is present,
// and leave it completely free otherwise (standalone use, or a workflow
// step whose template never declared one).

test("opened from a workflow step that declares receiptType=stock_purchase: the field is preselected and locked, with the Thai note shown", async () => {
  const { elements, form } = await setupSubstituteReceiptSandbox({
    search: "?transactionNo=TXN-2026-09-0001&workflowTemplateId=tpl-1&workflowStepId=step-2&receiptType=stock_purchase",
    prefillResponse: { availableGroups: [] },
  });

  assert.equal(form.elements.receiptType.value, "stock_purchase");
  assert.equal(form.elements.receiptType.disabled, true, "the select must be locked so the user cannot change it");
  assert.equal(elements.receiptTypeWorkflowNote.hidden, false, "the Thai note explaining the lock must be shown");
});

test("opened from a workflow step that declares receiptType=general_expense: the field is preselected and locked", async () => {
  const { elements, form } = await setupSubstituteReceiptSandbox({
    search: "?transactionNo=TXN-2026-09-0001&workflowTemplateId=tpl-1&workflowStepId=step-2&receiptType=general_expense",
    prefillResponse: { availableGroups: [] },
  });

  assert.equal(form.elements.receiptType.value, "general_expense");
  assert.equal(form.elements.receiptType.disabled, true);
  assert.equal(elements.receiptTypeWorkflowNote.hidden, false);
});

test("opened from a workflow step whose template never declared a receiptType: the field stays free, exactly like standalone use", async () => {
  const { elements, form } = await setupSubstituteReceiptSandbox({
    search: "?transactionNo=TXN-2026-09-0001&workflowTemplateId=tpl-1&workflowStepId=step-2",
    prefillResponse: { availableGroups: [] },
  });

  assert.equal(form.elements.receiptType.disabled, false, "no receiptType param means nothing to lock");
  assert.equal(elements.receiptTypeWorkflowNote.hidden, true);
});

test("opened standalone with no query string at all: the field is fully free and the note stays hidden", async () => {
  const { elements, form } = await setupSubstituteReceiptSandbox({ search: "" });

  assert.equal(form.elements.receiptType.disabled, false);
  assert.equal(form.elements.receiptType.value, "stock_purchase", "standalone default is unchanged: the first option");
  assert.equal(elements.receiptTypeWorkflowNote.hidden, true);
});

test("the workflow lock survives status-based lock/unlock cycling: a locked receiptType stays disabled even while stock lines would otherwise be editable", async () => {
  const { form } = await setupSubstituteReceiptSandbox({
    search: "?transactionNo=TXN-2026-09-0001&workflowTemplateId=tpl-1&workflowStepId=step-2&receiptType=general_expense",
    prefillResponse: { availableGroups: [] },
  });

  // Triggering the normal input/change preview pipeline (applyReceiptTypeState
  // -> applyStockLineLock) must not accidentally re-enable a workflow-locked
  // field just because the receipt is still a fresh draft (draft/pending_
  // approval statuses are not stock-line-locked on their own).
  form.dispatch("input");
  form.dispatch("change");
  assert.equal(form.elements.receiptType.disabled, true);
  assert.equal(form.elements.receiptType.value, "general_expense");
});

test("saved draft payload still carries the workflow-locked receiptType even though the select is disabled", async () => {
  const { elements, capturedPost } = await setupSubstituteReceiptSandbox({
    search: "?transactionNo=TXN-2026-09-0001&workflowTemplateId=tpl-1&workflowStepId=step-2&receiptType=general_expense",
    prefillResponse: { availableGroups: [] },
  });

  elements.saveDraft.dispatch("click");
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.ok(capturedPost.payload, "saveDraft must have posted a payload");
  assert.equal(
    capturedPost.payload.receiptType,
    "general_expense",
    "a disabled <select> submits no value via native form serialization, but this controller reads .value directly (see collectPayload) -- the locked value must still reach the server",
  );
  assert.equal(capturedPost.payload.transactionNo, "TXN-2026-09-0001");
  assert.equal(capturedPost.payload.workflowStepId, "step-2");
});

test("applyWorkflowPrefillPatch fills only ticked groups, leaving unticked fields untouched", async () => {
  const prefillResponse = {
    availableGroups: ["payee", "purpose", "lines"],
    sources: { payee: "PO-2026-09-0001", purpose: "PO-2026-09-0001", lines: "PO-2026-09-0001" },
    context: {},
  };
  const { context, elements, form } = await setupSubstituteReceiptSandbox({
    search: "?transactionNo=TXN-2026-09-0001&workflowTemplateId=tpl-1&workflowStepId=step-2",
    prefillResponse,
  });

  assert.equal(elements.workflowPrefillBanner.hidden, false, "banner must appear when availableGroups is non-empty");

  const testPatch = {
    payeeName: "ร้านค้าทดสอบ",
    businessPurpose: "วัตถุประสงค์ทดสอบ",
    lines: [{ description: "สินค้าทดสอบ", quantity: "2", unitCost: "50.00" }],
  };
  context.window.WorkflowPrefillLogic = { applyWorkflowPrefillGroups: () => testPatch };

  getPrefillCheckbox(elements.workflowPrefillGroups, "payee").checked = true;
  getPrefillCheckbox(elements.workflowPrefillGroups, "purpose").checked = false;
  getPrefillCheckbox(elements.workflowPrefillGroups, "lines").checked = false;

  elements.workflowPrefillApply.dispatch("click");

  assert.equal(form.elements.payeeName.value, "ร้านค้าทดสอบ", "the ticked payee group must be applied");
  // businessPurpose's boot-time default is "ซื้อสินค้าเพื่อขาย" (fillForm's
  // fallback, unrelated to workflow prefill) — an unticked purpose group
  // must leave that default exactly as it was, not blank it out.
  assert.equal(form.elements.businessPurpose.value, "ซื้อสินค้าเพื่อขาย", "an unticked purpose group must be left untouched");
  assert.equal(elements.workflowPrefillBanner.hidden, true, "the banner closes after apply");

  const badge = form.querySelector('[data-badge-for="payeeName"]');
  assert.equal(badge.hidden, false, "a prefilled field must carry a visible source badge");
  assert.match(badge.textContent, /PO-2026-09-0001/);

  const purposeBadge = form.querySelector('[data-badge-for="businessPurpose"]');
  assert.equal(purposeBadge.hidden, true, "an untouched field must not gain a source badge");
});

test("real workflow-prefill.logic.js fills a substitute_receipt end to end through the apply button", async () => {
  const canonicalContext = {
    payee: { name: "ร้านค้าจริง", taxId: "1234567890123" },
    purpose: { title: "หัวข้อจริง", businessPurpose: "วัตถุประสงค์จริงจากเอกสารก่อนหน้า" },
    lines: [{ description: "สินค้า A", quantity: "5", unitCost: "100.00", lineTotal: "500.00", stockSkuId: "" }],
  };
  const prefillResponse = {
    availableGroups: ["payee", "purpose", "lines"],
    sources: { payee: "PO-2026-09-0001", purpose: "PO-2026-09-0001", lines: "PO-2026-09-0001" },
    context: canonicalContext,
  };
  const { elements, form } = await setupSubstituteReceiptSandbox({
    search: "?transactionNo=TXN-2026-09-0001&workflowTemplateId=tpl-1&workflowStepId=step-2",
    prefillResponse,
  });

  getPrefillCheckbox(elements.workflowPrefillGroups, "payee").checked = true;
  getPrefillCheckbox(elements.workflowPrefillGroups, "purpose").checked = true;
  getPrefillCheckbox(elements.workflowPrefillGroups, "lines").checked = true;

  elements.workflowPrefillApply.dispatch("click");

  assert.equal(form.elements.payeeName.value, "ร้านค้าจริง");
  assert.equal(form.elements.payeeTaxId.value, "1234567890123");
  assert.equal(form.elements.businessPurpose.value, "วัตถุประสงค์จริงจากเอกสารก่อนหน้า");
  const lineDescriptions = elements.stockLineItems
    .querySelectorAll(".stock-line")
    .map((row) => row.querySelector('input[name="description"]').value);
  assert.deepEqual(lineDescriptions, ["สินค้า A"], "the lines patch must replace the stock-line rows");
});
