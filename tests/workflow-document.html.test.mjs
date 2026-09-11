import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";
import { buildFakeDomFromHtml } from "./support/fake-dom.mjs";

const htmlPath = new URL("../forms/workflow-document.html", import.meta.url);
const browserLogicPath = new URL("../forms/workflow-document.logic.browser.js", import.meta.url);
const returnLinkPath = new URL("../forms/workflow-return-link.browser.js", import.meta.url);
const workflowLogicPath = new URL("../forms/workflow.logic.js", import.meta.url);
const workflowDocumentLogicPath = new URL("../forms/workflow-document.logic.js", import.meta.url);
const workflowPrefillLogicPath = new URL("../forms/workflow-prefill.logic.js", import.meta.url);
const workflowPrefillBannerPath = new URL("../forms/workflow-prefill-banner.browser.js", import.meta.url);
const substituteReceiptLogicPath = new URL("../forms/substitute-receipt.logic.js", import.meta.url);
const expenseRequestLogicPath = new URL("../forms/expense-request.logic.js", import.meta.url);

// Runs a dual-mode "*.logic.js" file the way an actual browser would: no
// require, no module — just a window global to hang the export off of. This is
// what previously caught nothing, because every existing HTML/browser test in
// this file only string-matched file contents rather than actually executing
// the script. A file with a stray top-level `require(...)` (module-load-time,
// not lazily inside a function) throws ReferenceError here exactly like it
// would in a real browser tab.
function runAsClassicScriptInBrowserSandbox(source) {
  const context = vm.createContext({ window: {} });
  vm.runInContext(source, context);
  return context.window;
}

// Sets up forms/workflow-document.logic.browser.js in a require-less sandbox
// against a fake DOM derived from the real forms/workflow-document.html (see
// tests/support/fake-dom.mjs) — not a hand-typed elementsById list — then
// runs its DOMContentLoaded handler for real, then (since the
// transactionNo/workflowStepId query params are set and documentNo is not)
// drives it through loadWorkflowPrefill with a stubbed fetch so a prefill
// banner with checkable groups gets rendered — the exact path
// applyPrefillPatch is reached through in the real page. Returns the elements
// a test needs to drive and inspect the per-group prefill checkboxes.
async function setupWorkflowDocumentPrefillSandbox(prefillResponse, options = {}) {
  const { documentKind = "purchase_order", loadRealPrefillLogic = false } = options;

  const realHtml = await readFile(htmlPath, "utf8");
  const { elementsById, document: fakeDocument } = buildFakeDomFromHtml(realHtml);
  const form = elementsById.workflowDocumentForm;

  const stubFetch = async () => ({ ok: true, json: async () => prefillResponse });
  const window = { fetch: stubFetch };
  window.addEventListener = (type, handler) => {
    (window._handlers ??= {})[type] = handler;
  };

  const context = vm.createContext({
    window,
    document: fakeDocument,
    location: { search: `?documentKind=${documentKind}&transactionNo=TXN-2026-09-0001&workflowStepId=step-1` },
    URLSearchParams,
    // The script calls bare `fetch(...)`, which in a real browser resolves
    // through the global object (== window). In this vm context the sandbox
    // object itself is the global object, distinct from our `window` property,
    // so `fetch` must also be defined here directly or fetchWorkflowPrefill's
    // try/catch silently swallows a ReferenceError and prefill never loads.
    fetch: stubFetch,
  });

  vm.runInContext(await readFile(workflowLogicPath, "utf8"), context);
  vm.runInContext(await readFile(workflowDocumentLogicPath, "utf8"), context);
  if (loadRealPrefillLogic) {
    // Matches real page order: workflow-prefill.logic.js loads before the
    // page controller (forms/workflow-document.html). Loading the actual
    // module here — rather than the stubbed window.WorkflowPrefillLogic the
    // other tests in this file use — is what would have caught the missing
    // <script> tag: with it absent, window.WorkflowPrefillLogic is undefined
    // and the controller's optional-chained call silently resolves to {}.
    vm.runInContext(await readFile(workflowPrefillLogicPath, "utf8"), context);
  }
  // The shared prefill banner controller (Item 4 followup) is required
  // regardless of loadRealPrefillLogic: it is what defines
  // window.WorkflowPrefillBanner and wires up the apply/dismiss buttons,
  // independent of whether window.WorkflowPrefillLogic is the real module or
  // a per-test stub.
  vm.runInContext(await readFile(workflowPrefillBannerPath, "utf8"), context);
  vm.runInContext(await readFile(browserLogicPath, "utf8"), context);

  context.window._handlers.DOMContentLoaded();

  // loadWorkflowPrefill() is fired-and-forgotten (not awaited) at the end of
  // the DOMContentLoaded handler; let its fetch -> json -> renderPrefillBanner
  // microtask chain fully settle before the test touches the resulting DOM.
  await new Promise((resolve) => setTimeout(resolve, 10));

  return { context, elements: elementsById };
}

function getPrefillCheckbox(prefillGroupsContainer, group) {
  return prefillGroupsContainer
    .querySelectorAll('input[type="checkbox"]')
    .find((checkbox) => checkbox.value === group);
}

function lineDescriptions(lineItems) {
  return lineItems.querySelectorAll(".line-item").map((row) => row.querySelector('input[name="description"]').value);
}

function lineQuantities(lineItems) {
  return lineItems.querySelectorAll(".line-item").map((row) => row.querySelector('input[name="quantity"]').value);
}

test("workflow document shell provides the generic document form", async () => {
  const html = await readFile(htmlPath, "utf8");

  assert.match(html, /id="workflowDocumentForm"/);
  assert.match(html, /name="documentKind"/);
  assert.match(html, /name="transactionNo"/);
  assert.match(html, /name="workflowTemplateId"/);
  assert.match(html, /name="workflowStepId"/);
  assert.match(html, /name="accountingMonth"/);
  assert.match(html, /name="documentDate"/);
  assert.match(html, /name="title"/);
  assert.match(html, /name="requesterName"/);
  assert.match(html, /name="payeeName"/);
  assert.match(html, /name="businessPurpose"/);
  assert.match(html, /id="lineItems"/);
  assert.match(html, /id="addLine"/);
  assert.match(html, /<template id="lineTemplate">/);
  assert.match(html, /name="evidence_evidence"/);
  assert.match(html, /id="saveWorkflowDocument"/);
  assert.match(html, /id="completeWorkflowDocument"/);
  assert.match(html, /src="\.\/workflow-document\.logic\.js"/);
  assert.match(html, /src="\.\/workflow-document\.logic\.browser\.js"/);
});

test("workflow document shell validates returnTo before showing the return link", async () => {
  const html = await readFile(htmlPath, "utf8");
  assert.match(html, /workflow-return-link\.browser\.js/);
  assert.match(html, /sanitizeWorkflowReturnTo/);
});

test("workflow document shell hides the return link until a valid returnTo is resolved", async () => {
  const html = await readFile(htmlPath, "utf8");
  const returnLinkMatch = html.match(/<a[^>]*id="workflowReturnLink"[^>]*>/);
  assert.ok(returnLinkMatch, "expected a #workflowReturnLink anchor");
  assert.match(returnLinkMatch[0], /hidden/);
});

test("workflow document shell shows a prefill banner with apply/dismiss actions", async () => {
  const html = await readFile(htmlPath, "utf8");
  // workflow-prefill.logic.js now exists and must be loaded: without it,
  // window.WorkflowPrefillLogic is undefined and clicking "ใช้ข้อมูลเดิม" is a
  // silent no-op (the controller's optional-chained call just resolves to {}).
  assert.match(html, /src="\.\/workflow-prefill\.logic\.js"/);
  assert.match(html, /id="workflowPrefillBanner"/);
  assert.match(html, /id="workflowPrefillApply"/);
  assert.match(html, /id="workflowPrefillDismiss"/);
  assert.match(html, /ใช้ข้อมูลเดิม/);
  assert.match(html, /กรอกใหม่/);
  assert.match(html, /id="workflowPrefillGroups"/);
});

test("workflow document shell loads workflow-prefill.logic.js before its own controller", async () => {
  const html = await readFile(htmlPath, "utf8");
  const prefillLogicIndex = html.indexOf("workflow-prefill.logic.js");
  const controllerIndex = html.indexOf("workflow-document.logic.browser.js");
  assert.ok(prefillLogicIndex !== -1 && controllerIndex !== -1);
  assert.ok(prefillLogicIndex < controllerIndex, "workflow-prefill.logic.js must load before the page controller");
});

test("workflow document shell loads the shared prefill banner module before its own controller", async () => {
  // Item 4 followup: without this <script> tag, window.WorkflowPrefillBanner
  // is undefined and the controller's `.create(...)` call throws during
  // DOMContentLoaded, exactly the dead-page bug a missing/misordered
  // dependency script tag has already caused on this branch once.
  const html = await readFile(htmlPath, "utf8");
  const prefillBannerIndex = html.indexOf("workflow-prefill-banner.browser.js");
  const controllerIndex = html.indexOf("workflow-document.logic.browser.js");
  assert.ok(prefillBannerIndex !== -1 && controllerIndex !== -1);
  assert.ok(prefillBannerIndex < controllerIndex, "workflow-prefill-banner.browser.js must load before the page controller");
});

test("workflow document shell loads the return-link helper before its own controller", async () => {
  const html = await readFile(htmlPath, "utf8");
  const returnLinkIndex = html.indexOf("workflow-return-link.browser.js");
  const controllerIndex = html.indexOf("workflow-document.logic.browser.js");
  assert.ok(returnLinkIndex !== -1 && controllerIndex !== -1);
  assert.ok(returnLinkIndex < controllerIndex, "return-link helper must load before the page controller");
});

test("workflow-return-link helper is a plain classic script with no module wrapper", async () => {
  const script = await readFile(returnLinkPath, "utf8");
  assert.match(script, /function sanitizeWorkflowReturnTo\(value\)/);
  assert.doesNotMatch(script, /module\.exports/);
  assert.doesNotMatch(script, /window\./);
});

test("sanitizeWorkflowReturnTo rejects every unsafe branch and round-trips a real internal path", async () => {
  // The previous test coverage for this shared guard only string-matched the
  // helper's name inside the HTML — none of its actual branches ran. This is the
  // guard against `link.href = value` regressing into an open redirect, shared
  // by three pages today (and two more later), so it is worth exercising for
  // real rather than trusting the source text alone.
  const script = await readFile(returnLinkPath, "utf8");
  const context = vm.createContext({});
  vm.runInContext(script, context);
  const sanitize = context.sanitizeWorkflowReturnTo;
  assert.equal(typeof sanitize, "function");

  assert.equal(sanitize("//evil.com"), "", "protocol-relative URLs must be rejected");
  assert.equal(sanitize("https://evil.com"), "", "absolute URLs must be rejected");
  assert.equal(sanitize("/a\\b"), "", "backslashes must be rejected");
  assert.equal(sanitize(""), "", "empty string must be rejected");
  assert.equal(sanitize(null), "", "a non-string must be rejected");
  assert.equal(sanitize(undefined), "", "a non-string must be rejected");
  assert.equal(sanitize(42), "", "a non-string must be rejected");

  assert.equal(
    sanitize("/workflow-transactions/TXN-2026-09-0001"),
    "/workflow-transactions/TXN-2026-09-0001",
    "a legitimate internal path must round-trip unchanged",
  );
});

// The fetch/render prefill mechanics used to live inline in this file's own
// browserLogic; Item 4's dedup moved them into the one shared
// forms/workflow-prefill-banner.browser.js all three prefillable pages now
// load (see the script-order test below), so that is what these two checks
// read from. The page still wires it up: `window.WorkflowPrefillBanner.create`
// is invoked once during boot (verified end to end by the "applyPrefillPatch"
// and "real workflow-prefill.logic.js" tests further down, which actually
// execute the click path rather than string-matching source).
test("shared workflow-prefill-banner.browser.js fetches prefill data and fails silently", async () => {
  const prefillBannerSource = await readFile(workflowPrefillBannerPath, "utf8");
  assert.match(prefillBannerSource, /function fetchWorkflowPrefill/);
  assert.match(prefillBannerSource, /\/api\/workflow-transactions\/.*\/prefill/);
  assert.match(prefillBannerSource, /catch/);
});

test("shared workflow-prefill-banner.browser.js renders prefill groups with source document badges", async () => {
  const prefillBannerSource = await readFile(workflowPrefillBannerPath, "utf8");
  assert.match(prefillBannerSource, /function renderPrefillBanner/);
  assert.match(prefillBannerSource, /availableGroups/);
  assert.match(prefillBannerSource, /ผู้รับเงิน\/คู่ค้า/);
  assert.match(prefillBannerSource, /วัตถุประสงค์/);
  assert.match(prefillBannerSource, /รายการ/);
  assert.match(prefillBannerSource, /applyWorkflowPrefillGroups/);
});

test("workflow document controller loads the shared prefill banner module and wires it up during boot", async () => {
  const browserLogic = await readFile(browserLogicPath, "utf8");
  assert.match(browserLogic, /window\.WorkflowPrefillBanner\.create/);
});

test("workflow document browser controller posts saves and completions to the workflow document API", async () => {
  const browserLogic = await readFile(browserLogicPath, "utf8");
  assert.match(browserLogic, /\/api\/workflow-documents/);
  assert.match(browserLogic, /\/complete/);
});

test("workflow-document.logic.js runs as a classic script in a require-less browser sandbox and populates window.WorkflowDocumentLogic", async () => {
  // This is the actual bug reproduction for Critical 1: forms/workflow-document.html
  // loads this file with a plain <script> tag, but the file used to open with a
  // top-level `require("./workflow.logic.js")`. In a real browser (or here, a vm
  // sandbox with no `require`/`module` globals) that throws
  // "ReferenceError: require is not defined" before window.WorkflowDocumentLogic
  // is ever assigned, and the page controller silently binds `logic = undefined`.
  const source = await readFile(workflowDocumentLogicPath, "utf8");
  const window = runAsClassicScriptInBrowserSandbox(source);

  const exported = window.WorkflowDocumentLogic;
  assert.ok(exported, "window.WorkflowDocumentLogic must be populated");
  // Spread into a plain (outer-realm) array first: values crossing a vm sandbox
  // boundary are structurally identical but not reference-equal across realms,
  // which trips assert.deepEqual's strict prototype check even though the data
  // is correct.
  assert.deepEqual([...exported.LIGHTWEIGHT_DOCUMENT_KINDS], [
    "purchase_order",
    "payment_voucher",
    "cash_spend_declaration",
    "payee_acknowledgement",
    "goods_receipt",
  ]);
  assert.equal(typeof exported.buildWorkflowDocumentPayload, "function");
  assert.equal(typeof exported.validateWorkflowDocumentPayload, "function");
  assert.equal(typeof exported.buildWorkflowDocumentRawFileName, "function");
  assert.equal(typeof exported.formatWorkflowDocumentMarkdown, "function");
});

test("workflow-document.logic.js resolves document type labels through window.WorkflowLogic when loaded in real page order", async () => {
  // forms/workflow-document.html loads workflow.logic.js before
  // workflow-document.logic.js, exactly like this. buildWorkflowDocumentPayload's
  // documentKindLabel lookup must work through the resulting window.WorkflowLogic
  // global rather than a module-level require.
  const context = vm.createContext({ window: {} });
  vm.runInContext(await readFile(workflowLogicPath, "utf8"), context);
  vm.runInContext(await readFile(workflowDocumentLogicPath, "utf8"), context);

  const payload = context.window.WorkflowDocumentLogic.buildWorkflowDocumentPayload({
    documentKind: "purchase_order",
    sequence: "1",
    accountingMonth: "2026-09",
    documentDate: "2026-09-06",
    title: "ทดสอบ",
    businessPurpose: "ทดสอบ",
    lines: [{ description: "รายการ", quantity: "1", unitCost: "10" }],
  }, { now: () => "2026-09-06T12:00:00.000Z" });

  assert.equal(payload.documentKindLabel, "ใบสั่งซื้อ");
});

test("sibling dual-mode logic modules also survive the require-less browser sandbox", async () => {
  // The convention workflow-document.logic.js broke (a stray top-level require)
  // was copied from these siblings, which have none. Confirming they still pass
  // the same sandbox check is cheap insurance against the same regression
  // recurring there. Per task instructions: if any of these ever fails, that is
  // reported rather than silently patched here, since these files are out of
  // scope for this change.
  const siblings = [
    { name: "workflow.logic.js", path: workflowLogicPath, globalName: "WorkflowLogic" },
    { name: "substitute-receipt.logic.js", path: substituteReceiptLogicPath, globalName: "SubstituteReceiptLogic" },
    { name: "expense-request.logic.js", path: expenseRequestLogicPath, globalName: "ExpenseRequestLogic" },
  ];

  for (const sibling of siblings) {
    const source = await readFile(sibling.path, "utf8");
    const window = runAsClassicScriptInBrowserSandbox(source);
    assert.ok(
      window[sibling.globalName] && Object.keys(window[sibling.globalName]).length > 0,
      `${sibling.name} must populate window.${sibling.globalName} in a require-less sandbox`,
    );
  }
});

test("applyPrefillPatch fills only payee fields when just the payee group is ticked", async () => {
  // Reproduces the product ask directly: the user ticks which prefill groups
  // (payee/purpose/lines) to reuse from an earlier document in the same
  // workflow, and unticking a group must mean that group's fields are left
  // alone. applyPrefillPatch (forms/workflow-document.logic.browser.js:189-205)
  // is a private closure with no export, so this drives it through the real
  // integration path — the prefill-apply button's click handler — with
  // window.WorkflowPrefillLogic stubbed to hand back a fixed patch, and only
  // the checkbox checked-state varied per scenario.
  const prefillResponse = {
    availableGroups: ["payee", "purpose", "lines"],
    sources: { payee: "PO-2026-09-0001", purpose: "PO-2026-09-0001", lines: "PO-2026-09-0001" },
    context: {},
  };
  const { context, elements } = await setupWorkflowDocumentPrefillSandbox(prefillResponse);
  const { workflowDocumentForm: form, lineItems, workflowPrefillGroups, workflowPrefillApply } = elements;

  const testPatch = {
    payeeName: "ร้านค้าทดสอบ",
    businessPurpose: "วัตถุประสงค์ทดสอบ",
    lines: [{ description: "สินค้าทดสอบ", quantity: "3", unitCost: "99" }],
  };
  context.window.WorkflowPrefillLogic = { applyWorkflowPrefillGroups: () => testPatch };

  getPrefillCheckbox(workflowPrefillGroups, "payee").checked = true;
  getPrefillCheckbox(workflowPrefillGroups, "purpose").checked = false;
  getPrefillCheckbox(workflowPrefillGroups, "lines").checked = false;

  workflowPrefillApply.dispatch("click");

  assert.equal(form.elements.payeeName.value, "ร้านค้าทดสอบ", "the ticked payee group must be applied");
  assert.equal(form.elements.businessPurpose.value, "", "an unticked purpose group must be left untouched");
  assert.deepEqual(lineDescriptions(lineItems), [""], "an unticked lines group must leave the original blank line alone");
});

test("applyPrefillPatch applies every group when payee, purpose, and lines are all ticked", async () => {
  const prefillResponse = {
    availableGroups: ["payee", "purpose", "lines"],
    sources: { payee: "PO-2026-09-0001", purpose: "PO-2026-09-0001", lines: "PO-2026-09-0001" },
    context: {},
  };
  const { context, elements } = await setupWorkflowDocumentPrefillSandbox(prefillResponse);
  const { workflowDocumentForm: form, lineItems, workflowPrefillGroups, workflowPrefillApply } = elements;

  const testPatch = {
    payeeName: "ร้านค้าทดสอบ",
    businessPurpose: "วัตถุประสงค์ทดสอบ",
    lines: [{ description: "สินค้าทดสอบ", quantity: "3", unitCost: "99" }],
  };
  context.window.WorkflowPrefillLogic = { applyWorkflowPrefillGroups: () => testPatch };

  getPrefillCheckbox(workflowPrefillGroups, "payee").checked = true;
  getPrefillCheckbox(workflowPrefillGroups, "purpose").checked = true;
  getPrefillCheckbox(workflowPrefillGroups, "lines").checked = true;

  workflowPrefillApply.dispatch("click");

  assert.equal(form.elements.payeeName.value, "ร้านค้าทดสอบ", "the ticked payee group must be applied");
  assert.equal(form.elements.businessPurpose.value, "วัตถุประสงค์ทดสอบ", "the ticked purpose group must be applied");
  assert.deepEqual(lineDescriptions(lineItems), ["สินค้าทดสอบ"], "the ticked lines group must replace the line items");
});

test("applyPrefillPatch changes nothing when no prefill group is ticked", async () => {
  const prefillResponse = {
    availableGroups: ["payee", "purpose", "lines"],
    sources: { payee: "PO-2026-09-0001", purpose: "PO-2026-09-0001", lines: "PO-2026-09-0001" },
    context: {},
  };
  const { context, elements } = await setupWorkflowDocumentPrefillSandbox(prefillResponse);
  const { workflowDocumentForm: form, lineItems, workflowPrefillGroups, workflowPrefillApply } = elements;

  const testPatch = {
    payeeName: "ร้านค้าทดสอบ",
    businessPurpose: "วัตถุประสงค์ทดสอบ",
    lines: [{ description: "สินค้าทดสอบ", quantity: "3", unitCost: "99" }],
  };
  context.window.WorkflowPrefillLogic = { applyWorkflowPrefillGroups: () => testPatch };

  getPrefillCheckbox(workflowPrefillGroups, "payee").checked = false;
  getPrefillCheckbox(workflowPrefillGroups, "purpose").checked = false;
  getPrefillCheckbox(workflowPrefillGroups, "lines").checked = false;

  workflowPrefillApply.dispatch("click");

  assert.equal(form.elements.payeeName.value, "", "untick must mean untick: payee must stay untouched");
  assert.equal(form.elements.businessPurpose.value, "", "untick must mean untick: purpose must stay untouched");
  assert.deepEqual(lineDescriptions(lineItems), [""], "untick must mean untick: lines must stay untouched");
});

test("real workflow-prefill.logic.js fills a purchase_order end to end through the apply button", async () => {
  // Unlike the applyPrefillPatch tests above, this loads the actual
  // forms/workflow-prefill.logic.js module (loadRealPrefillLogic: true)
  // instead of stubbing window.WorkflowPrefillLogic. This is the exact path
  // that broke: forms/workflow-document.html never loaded that module, so
  // window.WorkflowPrefillLogic was undefined and the controller's
  // optional-chained call to applyWorkflowPrefillGroups silently produced an
  // empty patch. A test that stubs WorkflowPrefillLogic can't catch that.
  const canonicalContext = {
    payee: { name: "ร้านค้าจริง" },
    purpose: { title: "หัวข้อจริง", businessPurpose: "วัตถุประสงค์จริงจากเอกสารก่อนหน้า" },
    lines: [
      { description: "สินค้า A", quantity: "5", unitCost: "100.00", lineTotal: "500.00", stockSkuId: "SKU-1" },
    ],
    parties: { requesterName: "คุณสมชาย ผู้จัดทำ" },
  };
  const prefillResponse = {
    availableGroups: ["payee", "purpose", "lines"],
    sources: { payee: "PO-2026-09-0001", purpose: "PO-2026-09-0001", parties: "PO-2026-09-0001", lines: "PO-2026-09-0001" },
    context: canonicalContext,
  };
  const { elements } = await setupWorkflowDocumentPrefillSandbox(prefillResponse, {
    documentKind: "purchase_order",
    loadRealPrefillLogic: true,
  });
  const { workflowDocumentForm: form, lineItems, workflowPrefillGroups, workflowPrefillApply } = elements;

  getPrefillCheckbox(workflowPrefillGroups, "payee").checked = true;
  getPrefillCheckbox(workflowPrefillGroups, "purpose").checked = true;
  getPrefillCheckbox(workflowPrefillGroups, "lines").checked = true;

  workflowPrefillApply.dispatch("click");

  assert.equal(form.elements.payeeName.value, "ร้านค้าจริง");
  assert.equal(form.elements.title.value, "หัวข้อจริง", "the purpose group's title field must also be applied, not just businessPurpose");
  assert.equal(form.elements.businessPurpose.value, "วัตถุประสงค์จริงจากเอกสารก่อนหน้า");
  assert.deepEqual(lineDescriptions(lineItems), ["สินค้า A"]);
  assert.deepEqual(lineQuantities(lineItems), ["5"], "purchase_order carries the source quantity over");
  assert.equal(
    form.elements.requesterName.value,
    "คุณสมชาย ผู้จัดทำ",
    "parties (requesterName) must ride along automatically, independent of the tickable groups",
  );

  const payeeBadge = form.querySelector('[data-badge-for="payeeName"]');
  assert.equal(payeeBadge.hidden, false, "a prefilled field must be visibly marked with its source document");
  assert.match(payeeBadge.textContent, /PO-2026-09-0001/);

  const titleBadge = form.querySelector('[data-badge-for="title"]');
  assert.equal(titleBadge.hidden, false, "the prefilled title field must also carry a source badge");
  assert.match(titleBadge.textContent, /PO-2026-09-0001/);

  const requesterBadge = form.querySelector('[data-badge-for="requesterName"]');
  assert.equal(requesterBadge.hidden, false, "the auto-applied parties field must also carry a source badge");
  assert.match(requesterBadge.textContent, /PO-2026-09-0001/);
});

test("real workflow-prefill.logic.js never prefills goods_receipt line quantities", async () => {
  // Binding rule: a goods_receipt's quantity must reflect what actually
  // arrived, so it must never be prefilled from an earlier document's
  // quantity — a short delivery must stay visible instead of being papered
  // over. Descriptions still carry over.
  const canonicalContext = {
    payee: { name: "ร้านค้าจริง" },
    purpose: { title: "หัวข้อจริง", businessPurpose: "วัตถุประสงค์จริง" },
    lines: [
      { description: "สินค้า A", quantity: "5", unitCost: "100.00", lineTotal: "500.00", stockSkuId: "SKU-1" },
      { description: "สินค้า B", quantity: "2", unitCost: "50.00", lineTotal: "100.00", stockSkuId: "SKU-2" },
    ],
  };
  const prefillResponse = {
    availableGroups: ["payee", "purpose", "lines"],
    sources: { payee: "PO-2026-09-0001", purpose: "PO-2026-09-0001", lines: "PO-2026-09-0001" },
    context: canonicalContext,
  };
  const { elements } = await setupWorkflowDocumentPrefillSandbox(prefillResponse, {
    documentKind: "goods_receipt",
    loadRealPrefillLogic: true,
  });
  const { lineItems, workflowPrefillGroups, workflowPrefillApply } = elements;

  getPrefillCheckbox(workflowPrefillGroups, "payee").checked = true;
  getPrefillCheckbox(workflowPrefillGroups, "purpose").checked = true;
  getPrefillCheckbox(workflowPrefillGroups, "lines").checked = true;

  workflowPrefillApply.dispatch("click");

  assert.deepEqual(
    lineDescriptions(lineItems),
    ["สินค้า A", "สินค้า B"],
    "goods_receipt still carries descriptions over from the purchase order",
  );
  assert.deepEqual(
    lineQuantities(lineItems),
    ["", ""],
    "goods_receipt quantities must never be prefilled, so a short delivery stays visible",
  );
});
