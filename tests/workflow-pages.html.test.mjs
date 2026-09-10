import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";

import workflowLogic from "../forms/workflow.logic.js";
import workflowDocumentLogic from "../forms/workflow-document.logic.js";
import { buildFakeDomFromHtml, parseHtml } from "./support/fake-dom.mjs";

const templatesHtmlPath = new URL("../forms/workflow-templates.html", import.meta.url);
const transactionsHtmlPath = new URL("../forms/workflow-transactions.html", import.meta.url);
const transactionHtmlPath = new URL("../forms/workflow-transaction.html", import.meta.url);
const browserLogicPath = new URL("../forms/workflow.logic.browser.js", import.meta.url);
const workflowLogicPath = new URL("../forms/workflow.logic.js", import.meta.url);

// ---------------------------------------------------------------------------
// FakeNode and the HTML-to-fake-DOM derivation used to live here as this
// file's own hand-typed copy (a fourth one, alongside
// tests/workflow-document.html.test.mjs, tests/substitute-receipt.html.test.mjs,
// and tests/expense-request.html.test.mjs). They now live once in
// tests/support/fake-dom.mjs (Item 7 followup): elements, `.dataset` (the
// data-templates-url/data-transactions-url/data-document-types-url the
// controller reads its API endpoints from), and the two <template> bodies
// below all come from actually parsing the real
// forms/workflow-templates.html / workflow-transactions.html /
// workflow-transaction.html, not from a hand-typed literal that could
// silently drift from the real markup.
// ---------------------------------------------------------------------------
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
          ...(step.documentKind === "substitute_receipt" && step.receiptType ? { receiptType: step.receiptType } : {}),
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

// Sets up forms/workflow.logic.browser.js in a require-less sandbox against a
// fake DOM derived from the real forms/workflow-templates.html (see
// tests/support/fake-dom.mjs), and runs its DOMContentLoaded handler for
// real. The `data-document-types-url`/`data-templates-url` endpoints on
// #templatePage, and the #documentStepTemplate content, all come straight
// from the real markup now.
async function setupTemplatePageSandbox({ documentTypes, templates, onSave }) {
  const realHtml = await readFile(templatesHtmlPath, "utf8");
  const { elementsById, document: fakeDocument } = buildFakeDomFromHtml(realHtml);

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

// A free-form receiptType dropdown on the substitute_receipt form is exactly
// what breaks the workflow (see forms/workflow.logic.js's
// deriveChildWorkflowStatus): a template must declare, per step, which
// receipt type that step means, so the template editor needs a way to set
// it. The selector only makes sense on a substitute_receipt step -- every
// other document kind has no such distinction.
test("only the substitute_receipt step row shows the receipt-type selector, preset to the template's declared value", async () => {
  const documentTypes = Object.values(workflowLogic.DOCUMENT_TYPE_DEFINITIONS);
  const templates = workflowLogic.getDefaultWorkflowTemplates();
  const target = templates.find((template) => template.templateId === "director_expense_transfer");
  assert.deepEqual(target.documentSteps.map((step) => step.documentKind), ["expense_request", "substitute_receipt", "payment_voucher"]);

  const { elements } = await setupTemplatePageSandbox({ documentTypes, templates });
  selectTemplateByChange(elements.templateSelect, target.templateId);

  const rows = elements.documentStepsList.querySelectorAll(".step-row");
  assert.equal(rows[0].querySelector(".step-receipt-type").hidden, true, "expense_request step must not show the receipt-type selector");
  assert.equal(rows[1].querySelector(".step-receipt-type").hidden, false, "substitute_receipt step must show the receipt-type selector");
  assert.equal(rows[1].querySelector(".step-receipt-type").value, "general_expense", "must preset to the template's declared receiptType");
  assert.equal(rows[2].querySelector(".step-receipt-type").hidden, true, "payment_voucher step must not show the receipt-type selector");
});

test("changing the receipt-type selector on a substitute_receipt step is included in the saved payload", async () => {
  const documentTypes = Object.values(workflowLogic.DOCUMENT_TYPE_DEFINITIONS);
  const templates = workflowLogic.getDefaultWorkflowTemplates();
  const target = templates.find((template) => template.templateId === "stock_no_tax_invoice_company_bank");
  assert.deepEqual(target.documentSteps.map((step) => step.documentKind), ["purchase_order", "substitute_receipt", "payment_voucher", "goods_receipt"]);

  let capturedPayload = null;
  const { elements } = await setupTemplatePageSandbox({
    documentTypes,
    templates,
    onSave: (payload) => { capturedPayload = payload; },
  });
  selectTemplateByChange(elements.templateSelect, target.templateId);

  const receiptRow = elements.documentStepsList.querySelectorAll(".step-row")[1];
  const receiptTypeSelect = receiptRow.querySelector(".step-receipt-type");
  assert.equal(receiptTypeSelect.value, "stock_purchase", "sanity check on the seeded default");
  receiptTypeSelect.value = "general_expense";
  receiptTypeSelect.dispatch("change");

  elements.saveTemplate.dispatch("click");
  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.ok(capturedPayload, "save must POST to the server");
  const savedReceiptStep = capturedPayload.documentSteps.find((step) => step.documentKind === "substitute_receipt");
  assert.equal(savedReceiptStep.receiptType, "general_expense", "the edited receiptType must be part of the saved payload, not silently dropped");
});

test("a newly added substitute_receipt step defaults its receipt-type to stock_purchase and saves it", async () => {
  const documentTypes = Object.values(workflowLogic.DOCUMENT_TYPE_DEFINITIONS);
  const templates = [];

  let capturedPayload = null;
  const { elements } = await setupTemplatePageSandbox({
    documentTypes,
    templates,
    onSave: (payload) => { capturedPayload = payload; },
  });

  elements.templateName.value = "ทดสอบ Template ใหม่ที่มีใบรับรองแทนใบเสร็จ";
  elements.documentKindSelect.value = "substitute_receipt";
  elements.addDocumentStep.dispatch("click");

  const receiptRow = elements.documentStepsList.querySelectorAll(".step-row")[0];
  const receiptTypeSelect = receiptRow.querySelector(".step-receipt-type");
  assert.equal(receiptTypeSelect.hidden, false);
  assert.equal(receiptTypeSelect.value, "stock_purchase", "a newly added substitute_receipt step must default to a real value, not stay unset");

  elements.saveTemplate.dispatch("click");
  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.ok(capturedPayload, "save must POST to the server");
  assert.equal(capturedPayload.documentSteps[0].receiptType, "stock_purchase");
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

// Sets up forms/workflow.logic.browser.js against a fake DOM derived from
// the real forms/workflow-transactions.html (see tests/support/fake-dom.mjs).
async function setupTransactionsPageSandbox({ templates, transactions, onStart }) {
  const realHtml = await readFile(transactionsHtmlPath, "utf8");
  const { elementsById, document: fakeDocument } = buildFakeDomFromHtml(realHtml);

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
  onComplete,
  onSyncDrive,
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
    if (url === `/api/workflow-transactions/${transactionNo}/complete` && options.method === "POST") {
      const result = await onComplete();
      current = result;
      return { ok: true, json: async () => result };
    }
    if (url === `/api/workflow-transactions/${transactionNo}/sync-drive` && options.method === "POST") {
      return onSyncDrive();
    }
    throw new Error(`Unexpected fetch in test stub: ${options.method || "GET"} ${url}`);
  };
}

// Sets up forms/workflow.logic.browser.js against a fake DOM derived from
// the real forms/workflow-transaction.html (see tests/support/fake-dom.mjs):
// initial hidden/disabled states and the #documentChecklistItemTemplate
// content all come from that real markup now.
async function setupTransactionPageSandbox({
  transactionNo = "TXN-2026-09-0001",
  transaction,
  refreshedTransaction,
  onStartDocument = () => { throw new Error("start-document should not be called in this test"); },
  onComplete = () => { throw new Error("complete should not be called in this test"); },
  onSyncDrive = () => { throw new Error("sync-drive should not be called in this test"); },
}) {
  const realHtml = await readFile(transactionHtmlPath, "utf8");
  const { elementsById, document: fakeDocument } = buildFakeDomFromHtml(realHtml);

  const stubFetch = createTransactionStubFetch({
    transactionNo,
    transaction,
    refreshedTransaction,
    onStartDocument,
    onComplete,
    onSyncDrive,
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
});

test("workflow transaction page shows a manual Drive sync button and auto-sync status, and no Sheets sync UI", async () => {
  const html = await readFile(transactionHtmlPath, "utf8");
  assert.match(html, /id="syncDriveButton"/);
  assert.match(html, /id="driveSyncStatus"/);
  assert.match(html, /sync-drive/);
  assert.match(html, /\/complete/);
  assert.doesNotMatch(html, /id="syncSheetsButton"/);
  assert.doesNotMatch(html, /id="sheetSyncStatus"/);
  assert.doesNotMatch(html, /sync-sheets/);
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

// ---------------------------------------------------------------------------
// Complete button and Drive-sync section (Task 11).
// ---------------------------------------------------------------------------

test("the complete button stays disabled and hidden Drive section while any step is incomplete", async () => {
  const transaction = buildFourStepTransaction();

  const { elements } = await setupTransactionPageSandbox({
    transaction,
    refreshedTransaction: transaction,
  });

  assert.equal(elements.completeTransactionButton.disabled, true, "must not be completable while a step is incomplete");
  assert.equal(elements.driveSyncSection.hidden, true, "Drive sync section must stay hidden before completion");
});

function buildCompletedTransaction(overrides = {}) {
  return buildFourStepTransaction({
    status: "completed",
    currentStepId: null,
    completedAt: "2026-09-07T00:00:00.000Z",
    completedBy: "บัญชี",
    steps: [
      { stepId: "step-001", documentKind: "purchase_order", workflowStatus: "completed" },
      { stepId: "step-002", documentKind: "substitute_receipt", workflowStatus: "completed" },
      { stepId: "step-003", documentKind: "payment_voucher", workflowStatus: "completed" },
      { stepId: "step-004", documentKind: "goods_receipt", workflowStatus: "completed" },
    ],
    ...overrides,
  });
}

// This is the exact shape deriveWorkflowProgress (used by GET/refresh) really
// returns the moment every step is done: status already flips to "completed"
// server-side well before anyone has pressed the complete button, so
// completedAt (not status) must be what gates the button and the Drive
// section — verified live against the real server while building this task.
test("the complete button is enabled once every step is completed but the transaction itself is not yet", async () => {
  const allStepsDoneNotYetCompleted = buildFourStepTransaction({
    status: "completed",
    currentStepId: null,
    steps: [
      { stepId: "step-001", documentKind: "purchase_order", workflowStatus: "completed" },
      { stepId: "step-002", documentKind: "substitute_receipt", workflowStatus: "completed" },
      { stepId: "step-003", documentKind: "payment_voucher", workflowStatus: "completed" },
      { stepId: "step-004", documentKind: "goods_receipt", workflowStatus: "completed" },
    ],
  });

  const { elements } = await setupTransactionPageSandbox({
    transaction: allStepsDoneNotYetCompleted,
    refreshedTransaction: allStepsDoneNotYetCompleted,
  });

  assert.equal(elements.completeTransactionButton.disabled, false);
  assert.equal(elements.driveSyncSection.hidden, true, "Drive section must stay hidden until completeWorkflowTransaction has actually run");
});

test("clicking the complete button posts to .../complete and re-renders with the auto-sync Drive status (toggle on: text, no button)", async () => {
  const allStepsDoneNotYetCompleted = buildFourStepTransaction({
    status: "completed",
    currentStepId: null,
    templateSnapshot: { name: "ทดสอบ", syncGoogleDrive: true },
    steps: [
      { stepId: "step-001", documentKind: "purchase_order", workflowStatus: "completed" },
      { stepId: "step-002", documentKind: "substitute_receipt", workflowStatus: "completed" },
      { stepId: "step-003", documentKind: "payment_voucher", workflowStatus: "completed" },
      { stepId: "step-004", documentKind: "goods_receipt", workflowStatus: "completed" },
    ],
  });
  let completeCalls = 0;

  const { elements } = await setupTransactionPageSandbox({
    transaction: allStepsDoneNotYetCompleted,
    refreshedTransaction: allStepsDoneNotYetCompleted,
    onComplete: () => {
      completeCalls += 1;
      return {
        ...buildCompletedTransaction({ templateSnapshot: { name: "ทดสอบ", syncGoogleDrive: true } }),
        driveSync: { syncStatus: "synced", driveFolderUrl: "https://drive/f1" },
      };
    },
  });

  elements.completeTransactionButton.dispatch("click");
  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.equal(completeCalls, 1);
  assert.equal(elements.completeTransactionButton.disabled, true, "must be disabled again once completed");
  assert.equal(elements.driveSyncSection.hidden, false, "Drive sync section must show once completed");
  assert.match(elements.driveSyncStatus.textContent, /สำเร็จ/);
  assert.equal(elements.syncDriveButton.hidden, true, "no manual button when the template toggle is on");
});

test("when the toggle is off, completion shows the manual sync button, and pressing it posts .../sync-drive and updates the status", async () => {
  const allStepsDoneNotYetCompleted = buildFourStepTransaction({
    status: "completed",
    currentStepId: null,
    templateSnapshot: { name: "ทดสอบ", syncGoogleDrive: false },
    steps: [
      { stepId: "step-001", documentKind: "purchase_order", workflowStatus: "completed" },
      { stepId: "step-002", documentKind: "substitute_receipt", workflowStatus: "completed" },
      { stepId: "step-003", documentKind: "payment_voucher", workflowStatus: "completed" },
      { stepId: "step-004", documentKind: "goods_receipt", workflowStatus: "completed" },
    ],
  });
  let syncDriveCalls = 0;

  const { elements } = await setupTransactionPageSandbox({
    transaction: allStepsDoneNotYetCompleted,
    refreshedTransaction: allStepsDoneNotYetCompleted,
    onComplete: () => ({
      ...buildCompletedTransaction({ templateSnapshot: { name: "ทดสอบ", syncGoogleDrive: false } }),
      driveSync: { syncStatus: "not_required" },
    }),
    onSyncDrive: () => {
      syncDriveCalls += 1;
      return { ok: true, json: async () => ({ syncStatus: "synced", driveFolderUrl: "https://drive/f1" }) };
    },
  });

  elements.completeTransactionButton.dispatch("click");
  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.equal(elements.driveSyncSection.hidden, false);
  assert.equal(elements.syncDriveButton.hidden, false, "manual sync button must show when the toggle is off");
  assert.match(elements.driveSyncStatus.textContent, /ไม่ต้องซิงก์|ยังไม่ได้ซิงก์/);

  elements.syncDriveButton.dispatch("click");
  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.equal(syncDriveCalls, 1);
  assert.match(elements.driveSyncStatus.textContent, /สำเร็จ/);
});

test("a manual Drive sync failure (e.g. no Google Drive credentials configured) surfaces the Thai error text instead of throwing silently", async () => {
  const completedNoAutoSync = buildCompletedTransaction({
    templateSnapshot: { name: "ทดสอบ", syncGoogleDrive: false },
    driveSync: { syncStatus: "not_required" },
  });

  const { elements } = await setupTransactionPageSandbox({
    transaction: completedNoAutoSync,
    refreshedTransaction: completedNoAutoSync,
    onSyncDrive: () => ({
      ok: true,
      json: async () => ({ syncStatus: "sync_failed", error: "Google Drive is not configured" }),
    }),
  });

  assert.equal(elements.driveSyncSection.hidden, false);
  assert.equal(elements.syncDriveButton.hidden, false);

  elements.syncDriveButton.dispatch("click");
  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.match(elements.driveSyncStatus.textContent, /ไม่สำเร็จ/);
  assert.match(elements.driveSyncStatus.textContent, /Google Drive is not configured/);
  assert.equal(elements.transactionStatus.className, "status-box active error");
});

// ---------------------------------------------------------------------------
// /workflow-documents?documentKind=... -- the standalone list page for the
// five lightweight document kinds that share forms/workflow-document.html.
// Before this page existed, a user could create one of these documents but
// never find it again without already knowing its URL.
//
// Every test below runs the real forms/workflow-documents.logic.browser.js
// (after the real workflow.logic.js and workflow-document.logic.js, in page
// order) against a fake DOM parsed from the real forms/workflow-documents.html.
// Each per-kind test is generated for ALL five kinds -- an earlier task on
// this branch shipped a six-entry table with one entry asserted and five
// silently wrong.
// ---------------------------------------------------------------------------
const documentsListHtmlPath = new URL("../forms/workflow-documents.html", import.meta.url);
const documentsListLogicPath = new URL("../forms/workflow-documents.logic.browser.js", import.meta.url);
const workflowDocumentLogicPath = new URL("../forms/workflow-document.logic.js", import.meta.url);
const LIST_KINDS = workflowDocumentLogic.LIGHTWEIGHT_DOCUMENT_KINDS;
const LIST_STATUS_LABELS = workflowDocumentLogic.WORKFLOW_DOCUMENT_STATUS_LABELS;

function listKindLabel(documentKind) {
  return workflowLogic.getDocumentTypeDefinition(documentKind).label;
}

function listDocumentNo(documentKind, month, sequence) {
  return `${workflowDocumentLogic.WORKFLOW_DOCUMENT_PREFIXES[documentKind]}-${month}-${String(sequence).padStart(4, "0")}`;
}

// Mirrors one entry of GET /api/workflow-documents -- the top-level summary
// fields asserted against the real server in tests/workflow-document-api.test.mjs.
function listDocumentFixture(documentKind, overrides = {}) {
  const documentNo = overrides.documentNo || listDocumentNo(documentKind, "2026-09", 1);
  const status = overrides.status || "draft";
  const folderPath = `documents/2026/09/${documentKind}/${documentNo}_test`;
  return {
    documentKind,
    documentKindLabel: listKindLabel(documentKind),
    documentNo,
    status,
    statusLabel: LIST_STATUS_LABELS[status],
    title: `เอกสาร ${documentNo}`,
    accountingMonth: "2026-09",
    documentDate: "2026-09-06",
    payeeName: "ร้านค้าตัวอย่าง",
    requesterName: "คุณต้า",
    totalAmount: "1250.00",
    transactionNo: "",
    workflowTemplateId: "",
    workflowStepId: "",
    folderPath,
    pdfFiles: [{
      name: `${documentNo}.pdf`,
      path: `${folderPath}/pdf/${documentNo}.pdf`,
      url: `/workflow-documents/${documentKind}/${documentNo}/pdf/${documentNo}.pdf`,
    }],
    rawFiles: [],
    ...overrides,
  };
}

// Stub for GET /api/workflow-documents that filters by the same three query
// parameters the real handler does, so a filter the page forgets to send
// really does leave the wrong rows on screen.
function createDocumentsListStubFetch(documents, { fail = false } = {}) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    const parsed = new URL(String(url), "http://localhost");
    if (parsed.pathname !== "/api/workflow-documents") {
      throw new Error(`Unexpected fetch in test stub: ${url}`);
    }
    if (fail) return { ok: false, json: async () => ({ error: "โหลดไม่สำเร็จ" }) };
    const documentKind = parsed.searchParams.get("documentKind") || "";
    const accountingMonth = parsed.searchParams.get("accountingMonth") || "";
    const status = parsed.searchParams.get("status") || "";
    const matching = documents.filter((doc) => (
      (!documentKind || doc.documentKind === documentKind)
      && (!accountingMonth || doc.accountingMonth === accountingMonth)
      && (!status || doc.status === status)
    ));
    return { ok: true, json: async () => ({ documents: matching }) };
  };
  return { fetchImpl, calls };
}

async function setupDocumentsListSandbox({ search = "", documents = [], fail = false } = {}) {
  const realHtml = await readFile(documentsListHtmlPath, "utf8");
  const { elementsById, document: fakeDocument } = buildFakeDomFromHtml(realHtml);
  const { fetchImpl, calls } = createDocumentsListStubFetch(documents, { fail });

  const location = { pathname: "/workflow-documents", search };
  const historyCalls = [];
  const history = {
    replaceState(_state, _title, url) {
      historyCalls.push(String(url));
      const queryStart = String(url).indexOf("?");
      location.search = queryStart >= 0 ? String(url).slice(queryStart) : "";
    },
  };
  const window = { fetch: fetchImpl, location, history };
  window.addEventListener = (type, handler) => {
    (window._handlers ??= {})[type] = handler;
  };

  const context = vm.createContext({
    window,
    document: fakeDocument,
    location,
    history,
    URLSearchParams,
    fetch: fetchImpl,
  });

  vm.runInContext(await readFile(workflowLogicPath, "utf8"), context);
  vm.runInContext(await readFile(workflowDocumentLogicPath, "utf8"), context);
  vm.runInContext(await readFile(documentsListLogicPath, "utf8"), context);
  window._handlers?.DOMContentLoaded?.();
  await settleList();

  return { elements: elementsById, calls, historyCalls, document: fakeDocument };
}

function settleList() {
  return new Promise((resolve) => setTimeout(resolve, 10));
}

// Rendered rows are HTML strings (the house style: row.innerHTML with
// escapeHtml, exactly like forms/substitute-receipts.logic.browser.js); split
// each row into its data-column cells so assertions can target one column.
function listRowCells(row) {
  const cells = {};
  for (const match of row.innerHTML.matchAll(/<td data-column="([\w-]+)">([\s\S]*?)<\/td>/g)) {
    cells[match[1]] = match[2];
  }
  return cells;
}

function listRowsByDocumentNo(elements) {
  const byNo = {};
  for (const row of elements.workflowDocumentRows.children) {
    const cells = listRowCells(row);
    const documentNo = cellText(cells.documentNo).split(" ")[0];
    byNo[documentNo] = { row, cells };
  }
  return byNo;
}

function cellText(html = "") {
  return html
    .replace(/<span class="mobile-label">[\s\S]*?<\/span>/g, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodedAttribute(node, name) {
  return String(node?.getAttribute(name) ?? "")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function requestParams(url) {
  return Object.fromEntries(new URL(url, "http://localhost").searchParams.entries());
}

async function changeListFilter(element, value, eventType = "change") {
  element.value = value;
  element.dispatch(eventType, { target: element });
  await settleList();
}

test("the list page covers exactly the five lightweight kinds (sanity check on the generated per-kind tests)", () => {
  assert.deepEqual([...LIST_KINDS], [
    "purchase_order",
    "payment_voucher",
    "cash_spend_declaration",
    "payee_acknowledgement",
    "goods_receipt",
  ]);
});

test("workflow-documents.html loads its shared logic before the page controller, all as classic scripts", async () => {
  const html = await readFile(documentsListHtmlPath, "utf8");
  const scripts = [...html.matchAll(/<script src="\.\/([^"]+)"><\/script>/g)].map((match) => match[1]);
  const workflowLogicIndex = scripts.indexOf("workflow.logic.js");
  const documentLogicIndex = scripts.indexOf("workflow-document.logic.js");
  const controllerIndex = scripts.indexOf("workflow-documents.logic.browser.js");
  assert.ok(workflowLogicIndex >= 0 && documentLogicIndex >= 0 && controllerIndex >= 0, scripts.join(", "));
  assert.ok(workflowLogicIndex < documentLogicIndex && documentLogicIndex < controllerIndex, scripts.join(", "));
  assert.doesNotMatch(html, /type="module"/);

  const controller = await readFile(documentsListLogicPath, "utf8");
  assert.doesNotMatch(controller, /\brequire\(/);
  assert.doesNotMatch(controller, /module\.exports/);
  assert.doesNotMatch(controller, /^\s*(import|export) /m);
});

test("workflow-documents.html status filter offers every lightweight document status, in Thai", async () => {
  const html = await readFile(documentsListHtmlPath, "utf8");
  const { elementsById } = buildFakeDomFromHtml(html);
  const optionValues = elementsById.statusFilter.children.map((option) => option.value);
  assert.deepEqual(optionValues, ["all", ...Object.keys(LIST_STATUS_LABELS)]);
  assert.match(html, /<option value="all">ทั้งหมด<\/option>/);
  for (const [status, label] of Object.entries(LIST_STATUS_LABELS)) {
    assert.ok(html.includes(`<option value="${status}">${label}</option>`), `${status} option must read "${label}"`);
  }
});

for (const documentKind of LIST_KINDS) {
  test(`${documentKind}: the list page shows only this kind, with number, date, title, payee, total, status, open and PDF actions`, async () => {
    const label = listKindLabel(documentKind);
    const standalone = listDocumentFixture(documentKind, {
      documentNo: listDocumentNo(documentKind, "2026-09", 1),
      title: `ซื้อวัสดุ ${documentKind}`,
      payeeName: `ผู้รับเงิน ${documentKind}`,
      totalAmount: "1250.5",
    });
    const linked = listDocumentFixture(documentKind, {
      documentNo: listDocumentNo(documentKind, "2026-09", 2),
      status: "completed",
      documentDate: "2026-09-10",
      transactionNo: "TXN-2026-09-0007",
      workflowTemplateId: "stock_no_tax_invoice_company_bank",
      workflowStepId: "step-001",
    });
    const otherKind = LIST_KINDS.find((kind) => kind !== documentKind);
    const foreign = listDocumentFixture(otherKind, { documentNo: listDocumentNo(otherKind, "2026-09", 99) });

    const { elements, calls, document } = await setupDocumentsListSandbox({
      search: `?documentKind=${documentKind}`,
      documents: [standalone, linked, foreign],
    });

    assert.equal(calls.length, 1, "exactly one list request on load");
    assert.equal(new URL(calls[0], "http://localhost").pathname, "/api/workflow-documents");
    assert.deepEqual(requestParams(calls[0]), { documentKind }, "the request is scoped to this kind and carries no other filter yet");

    assert.equal(elements.pageTitle.textContent, `รายการ${label}`);
    assert.equal(document.title, `รายการ${label} - หจก.สวีทเฮาส์`);
    assert.equal(elements.createDocumentLink.getAttribute("href"), `/workflow-document?documentKind=${documentKind}`,
      "create-new must open a blank standalone form of this kind (no documentNo, no transactionNo)");
    assert.equal(elements.createDocumentLink.textContent, `สร้าง${label}ใหม่`);

    const tabs = elements.documentKindTabs.children;
    assert.deepEqual(tabs.map((tab) => tab.getAttribute("href")), LIST_KINDS.map((kind) => `/workflow-documents?documentKind=${kind}`));
    assert.deepEqual(tabs.map((tab) => tab.textContent), LIST_KINDS.map(listKindLabel));
    assert.deepEqual(
      tabs.filter((tab) => tab.getAttribute("aria-current") === "page").map((tab) => tab.getAttribute("href")),
      [`/workflow-documents?documentKind=${documentKind}`],
    );

    assert.equal(elements.workflowDocumentRows.children.length, 2, "the other kind's document must not be listed");
    assert.equal(elements.listStatus.textContent, "พบ 2 รายการ");
    assert.equal(elements.emptyState.hidden, true);
    assert.equal(elements.errorState.hidden, true);

    const rows = listRowsByDocumentNo(elements);
    assert.deepEqual(Object.keys(rows).sort(), [standalone.documentNo, linked.documentNo].sort());

    const standaloneCells = rows[standalone.documentNo].cells;
    assert.equal(cellText(standaloneCells.documentNo), standalone.documentNo);
    assert.equal(cellText(standaloneCells.documentDate), "2026-09-06");
    assert.equal(cellText(standaloneCells.title).startsWith(standalone.title), true);
    assert.equal(cellText(standaloneCells.payee), standalone.payeeName);
    assert.equal(cellText(standaloneCells.total), "1,250.50");
    assert.equal(cellText(standaloneCells.status), "แบบร่าง");
    const standaloneActions = parseHtml(standaloneCells.actions);
    assert.equal(
      decodedAttribute(standaloneActions.querySelector("[data-open-document]"), "href"),
      `/workflow-document?documentKind=${documentKind}&documentNo=${standalone.documentNo}`,
    );
    assert.equal(decodedAttribute(standaloneActions.querySelector(".file-link"), "href"), standalone.pdfFiles[0].url,
      "the PDF link must be the guarded /workflow-documents/... route the API handed back");
    assert.equal(parseHtml(rows[standalone.documentNo].row.innerHTML).querySelectorAll(".transaction-badge").length, 0,
      "a standalone document must not show a transaction badge");

    const linkedCells = rows[linked.documentNo].cells;
    assert.equal(cellText(linkedCells.status), "เสร็จสิ้น");
    assert.equal(cellText(linkedCells.documentDate), "2026-09-10");
    const badges = parseHtml(rows[linked.documentNo].row.innerHTML).querySelectorAll(".transaction-badge");
    assert.equal(badges.length, 1, "a workflow-linked document shows exactly one transaction badge");
    assert.equal(decodedAttribute(badges[0], "href"), "/workflow-transaction?transactionNo=TXN-2026-09-0007");
    assert.match(linkedCells.documentNo, /TXN-2026-09-0007/);
    assert.equal(
      decodedAttribute(parseHtml(linkedCells.actions).querySelector("[data-open-document]"), "href"),
      `/workflow-document?documentKind=${documentKind}&documentNo=${linked.documentNo}`,
    );
  });

  test(`${documentKind}: accounting month, status, and search filters each narrow the list`, async () => {
    const paper = listDocumentFixture(documentKind, {
      documentNo: listDocumentNo(documentKind, "2026-09", 1),
      title: "ซื้อกระดาษ A4",
      payeeName: "ร้านเครื่องเขียน",
    });
    const shipping = listDocumentFixture(documentKind, {
      documentNo: listDocumentNo(documentKind, "2026-08", 1),
      accountingMonth: "2026-08",
      documentDate: "2026-08-20",
      status: "completed",
      title: "ค่าขนส่งสินค้า",
      payeeName: "บริษัทขนส่งด่วน",
    });
    const ink = listDocumentFixture(documentKind, {
      documentNo: listDocumentNo(documentKind, "2026-09", 2),
      status: "completed",
      title: "ซื้อหมึกพิมพ์",
      payeeName: "ร้านเครื่องเขียน",
      transactionNo: "TXN-2026-09-0003",
    });
    const { elements, calls, historyCalls } = await setupDocumentsListSandbox({
      search: `?documentKind=${documentKind}`,
      documents: [paper, shipping, ink],
    });
    const listed = () => Object.keys(listRowsByDocumentNo(elements)).sort();

    assert.deepEqual(listed(), [paper, shipping, ink].map((doc) => doc.documentNo).sort());

    await changeListFilter(elements.accountingMonthFilter, "2026-09");
    assert.deepEqual(requestParams(calls.at(-1)), { documentKind, accountingMonth: "2026-09" });
    assert.deepEqual(listed(), [paper, ink].map((doc) => doc.documentNo).sort());
    assert.deepEqual(requestParams(historyCalls.at(-1)), { documentKind, accountingMonth: "2026-09" },
      "the filtered view must stay deep-linkable");
    assert.ok(
      elements.documentKindTabs.children.every((tab) => requestParams(tab.getAttribute("href")).accountingMonth === "2026-09"),
      "switching kind keeps the chosen accounting month",
    );

    await changeListFilter(elements.statusFilter, "completed");
    assert.deepEqual(requestParams(calls.at(-1)), { documentKind, accountingMonth: "2026-09", status: "completed" });
    assert.deepEqual(listed(), [ink.documentNo]);

    await changeListFilter(elements.statusFilter, "all");
    assert.deepEqual(requestParams(calls.at(-1)), { documentKind, accountingMonth: "2026-09" }, "\"all\" sends no status filter");
    assert.deepEqual(listed(), [paper, ink].map((doc) => doc.documentNo).sort());

    await changeListFilter(elements.accountingMonthFilter, "");
    assert.deepEqual(requestParams(calls.at(-1)), { documentKind }, "clearing the month sends no month filter");
    assert.deepEqual(listed(), [paper, shipping, ink].map((doc) => doc.documentNo).sort());

    const requestsBeforeSearch = calls.length;
    await changeListFilter(elements.searchText, "หมึก", "input");
    assert.deepEqual(listed(), [ink.documentNo], "search matches the title");
    await changeListFilter(elements.searchText, "ขนส่งด่วน", "input");
    assert.deepEqual(listed(), [shipping.documentNo], "search matches the payee");
    await changeListFilter(elements.searchText, paper.documentNo.toLowerCase(), "input");
    assert.deepEqual(listed(), [paper.documentNo], "search matches the document number, case-insensitively");
    await changeListFilter(elements.searchText, "TXN-2026-09-0003", "input");
    assert.deepEqual(listed(), [ink.documentNo], "search matches the transaction number");
    await changeListFilter(elements.searchText, "ไม่มีเอกสารนี้", "input");
    assert.deepEqual(listed(), []);
    assert.equal(elements.emptyState.hidden, false);
    assert.equal(elements.listStatus.textContent, "ไม่พบรายการ");
    assert.equal(calls.length, requestsBeforeSearch, "search filters the loaded rows without another request");

    await changeListFilter(elements.searchText, "", "input");
    assert.equal(elements.workflowDocumentRows.children.length, 3);
    assert.equal(elements.emptyState.hidden, true);
  });

  test(`${documentKind}: an empty result shows the empty state and still offers create-new`, async () => {
    const { elements, calls } = await setupDocumentsListSandbox({ search: `?documentKind=${documentKind}`, documents: [] });
    assert.deepEqual(requestParams(calls[0]), { documentKind });
    assert.equal(elements.workflowDocumentRows.children.length, 0);
    assert.equal(elements.emptyState.hidden, false);
    assert.equal(elements.errorState.hidden, true);
    assert.equal(elements.listStatus.textContent, "ไม่พบรายการ");
    assert.equal(elements.createDocumentLink.getAttribute("href"), `/workflow-document?documentKind=${documentKind}`);
  });
}

test("the list page restores valid month/status filters from the URL and ignores values it does not recognise", async () => {
  for (const documentKind of LIST_KINDS) {
    const august = listDocumentFixture(documentKind, {
      documentNo: listDocumentNo(documentKind, "2026-08", 1),
      accountingMonth: "2026-08",
      status: "completed",
    });
    const september = listDocumentFixture(documentKind, { documentNo: listDocumentNo(documentKind, "2026-09", 1) });

    const restored = await setupDocumentsListSandbox({
      search: `?documentKind=${documentKind}&accountingMonth=2026-08&status=completed`,
      documents: [august, september],
    });
    assert.deepEqual(requestParams(restored.calls[0]), { documentKind, accountingMonth: "2026-08", status: "completed" }, documentKind);
    assert.equal(restored.elements.accountingMonthFilter.value, "2026-08", documentKind);
    assert.equal(restored.elements.statusFilter.value, "completed", documentKind);
    assert.deepEqual(Object.keys(listRowsByDocumentNo(restored.elements)), [august.documentNo], documentKind);

    const ignored = await setupDocumentsListSandbox({
      search: `?documentKind=${documentKind}&accountingMonth=${encodeURIComponent("2026-13' OR 1=1")}&status=hacked`,
      documents: [august, september],
    });
    assert.deepEqual(requestParams(ignored.calls[0]), { documentKind }, `${documentKind}: invalid URL filters must not be sent`);
    assert.equal(ignored.elements.accountingMonthFilter.value, "", documentKind);
    assert.equal(ignored.elements.statusFilter.value, "all", documentKind);
  }
});

test("the list page falls back to ใบสั่งซื้อ when documentKind is missing or not one of the five kinds", async () => {
  for (const search of ["", "?documentKind=expense_request", "?documentKind=substitute_receipt", "?documentKind=%3Cscript%3E"]) {
    const { elements, calls } = await setupDocumentsListSandbox({ search, documents: [] });
    assert.deepEqual(requestParams(calls[0]), { documentKind: "purchase_order" }, search);
    assert.equal(elements.pageTitle.textContent, `รายการ${listKindLabel("purchase_order")}`, search);
    assert.equal(elements.createDocumentLink.getAttribute("href"), "/workflow-document?documentKind=purchase_order", search);
  }
});

test("a failed list request shows the error state instead of an empty list", async () => {
  const { elements } = await setupDocumentsListSandbox({ search: "?documentKind=goods_receipt", fail: true });
  assert.equal(elements.errorState.hidden, false);
  assert.equal(elements.emptyState.hidden, true);
  assert.equal(elements.workflowDocumentRows.children.length, 0);
  assert.equal(elements.listStatus.textContent, "โหลดรายการไม่สำเร็จ");
});

test("document fields are HTML-escaped in the rendered rows", async () => {
  const hostile = listDocumentFixture("payment_voucher", {
    title: "<img src=x onerror=alert(1)>",
    payeeName: "\"><script>alert(2)</script>",
  });
  const { elements } = await setupDocumentsListSandbox({ search: "?documentKind=payment_voucher", documents: [hostile] });
  const html = elements.workflowDocumentRows.children[0].innerHTML;
  assert.doesNotMatch(html, /<img src=x/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
});
