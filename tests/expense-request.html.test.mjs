import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";
import { buildFakeDomFromHtml } from "./support/fake-dom.mjs";

const htmlPath = new URL("../forms/expense-request.html", import.meta.url);
const returnLinkPath = new URL("../forms/workflow-return-link.browser.js", import.meta.url);
const prefillLogicPath = new URL("../forms/workflow-prefill.logic.js", import.meta.url);
const prefillBannerPath = new URL("../forms/workflow-prefill-banner.browser.js", import.meta.url);
const expenseLogicPath = new URL("../forms/expense-request.logic.js", import.meta.url);

test("expense form keeps copy/export controls in the backup tools section", async () => {
  const html = await readFile(htmlPath, "utf8");
  const topbar = html.match(/<header class="topbar">([\s\S]*?)<\/header>/)?.[1] ?? "";

  assert.doesNotMatch(topbar, /copyJson|copyMarkdown|submitRequest|saveDraft/);
  assert.match(html, /<details class="section backup-tools">/);
  assert.match(html, /<summary[^>]*>เครื่องมือสำรอง \/ สำหรับตรวจสอบ<\/summary>/);
  assert.match(html, /<button class="button warn" type="button" id="copyJson">Copy JSON<\/button>/);
  assert.match(html, /<button class="button secondary" type="button" id="copyMarkdown">Copy Markdown<\/button>/);
});

test("expense form uses placeholders instead of sample values for user-entered fields", async () => {
  const html = await readFile(htmlPath, "utf8");

  assert.doesNotMatch(html, /value="ค่าแพ็คสินค้า"/);
  assert.doesNotMatch(html, /value="คุณตัวอย่าง/);
  assert.doesNotMatch(html, /value="Line: sample-ops"/);
  assert.doesNotMatch(html, /value="กสิกรไทย"/);
  assert.doesNotMatch(html, /value="123-4-56789-0"/);
  assert.doesNotMatch(html, /value="ซองไปรษณีย์ 100 ใบ และถุง OPP 200 ใบ"/);
  assert.doesNotMatch(html, /value="1869\.16"/);
  assert.doesNotMatch(html, /value="130\.84"/);
  assert.doesNotMatch(html, /value="2026-09"/);
  assert.doesNotMatch(html, /value="2026-09-03"/);
  assert.doesNotMatch(html, /<option selected>marketing<\/option>/);
  assert.match(html, /placeholder="เช่น ค่าแพ็คสินค้า"/);
  assert.match(html, /<option value="" selected disabled>เลือกแผนก\/ตำแหน่ง<\/option>/);
});

test("expense form shows automatic document number instead of an editable sequence field", async () => {
  const html = await readFile(htmlPath, "utf8");

  assert.doesNotMatch(html, /name="sequence"/);
  assert.doesNotMatch(html, /ลำดับเอกสาร \*/);
  assert.match(html, /id="requestNoPreview"/);
  assert.match(html, /เลขเอกสารถัดไป/);
  assert.match(html, /refreshRequestNo/);
});

test("expense line template is collapsible with a summary for each item", async () => {
  const html = await readFile(htmlPath, "utf8");
  const template = html.match(/<template id="lineTemplate">([\s\S]*?)<\/template>/)?.[1] ?? "";

  assert.match(template, /<details class="line-row" open>/);
  assert.match(template, /<summary class="line-summary">/);
  assert.match(template, /data-line-title/);
  assert.match(template, /data-line-total/);
  assert.match(html, /function updateLineSummaries/);
});

test("expense form exposes navigation menu and bottom submit bar", async () => {
  const html = await readFile(htmlPath, "utf8");
  const topbar = html.match(/<header class="topbar">([\s\S]*?)<\/header>/)?.[1] ?? "";
  const bottomBar = html.match(/<div class="bottom-action-bar">([\s\S]*?)<\/div>/)?.[1] ?? "";

  assert.match(topbar.trim(), /^<details class="app-menu">/);
  assert.match(topbar, /class="app-menu"/);
  assert.match(topbar, /href="\/expense-requests"/);
  assert.match(topbar, /href="\/expense-request"/);
  assert.match(topbar, /href="\/inventory"/);
  assert.match(topbar, /href="\/inventory-settings"/);
  assert.match(topbar, /href="\/google-drive"/);
  assert.match(topbar, /href="\/company-settings"/);
  assert.match(topbar, /id="resetForm"/);
  assert.match(html, /\.menu-panel \{[\s\S]*?left: 0;/);
  assert.match(bottomBar, /id="saveDraft"/);
  assert.match(bottomBar, /id="submitRequest"/);
  assert.doesNotMatch(topbar, /id="saveDraft"|id="submitRequest"/);
  assert.doesNotMatch(html, /id="draftList"/);
  assert.doesNotMatch(html, /แบบร่างล่าสุด/);
  assert.match(html, /let currentDraftId/);
  assert.match(html, /let currentRequestNo/);
  assert.match(html, /function loadDraft/);
  assert.match(html, /function loadSubmittedRequest/);
  assert.match(html, /\/api\/expense-drafts/);
  assert.match(html, /\/api\/expense-requests\/\$\{encodeURIComponent\(requestNo\)\}/);
  assert.match(html, /new URLSearchParams\(location.search\)\.get\("draftId"\)/);
  assert.match(html, /new URLSearchParams\(location.search\)\.get\("requestNo"\)/);
});

test("expense form submit status reports generated PDF files", async () => {
  const html = await readFile(htmlPath, "utf8");

  assert.match(html, /result\.pdfFiles\?\.length/);
  assert.match(html, /สร้าง PDF/);
});

// --- Task 9: workflow context wiring --------------------------------------

test("expense request form preserves workflow context query params", async () => {
  const html = await readFile(htmlPath, "utf8");
  assert.match(html, /transactionNo/);
  assert.match(html, /workflowTemplateId/);
  assert.match(html, /workflowStepId/);
  assert.match(html, /returnTo/);
  assert.match(html, /กลับไปที่ Workflow/);
  assert.match(html, /workflow-return-link\.browser\.js/);
  assert.match(html, /sanitizeWorkflowReturnTo/);
});

test("expense request form shows the cross-document prefill banner", async () => {
  const html = await readFile(htmlPath, "utf8");
  assert.match(html, /workflow-prefill\.logic\.js/);
  assert.match(html, /id="workflowPrefillBanner"/);
  assert.match(html, /ใช้ข้อมูลเดิม/);
  assert.match(html, /กรอกใหม่/);
});

test("expense request form hides the return link markup by default", async () => {
  const html = await readFile(htmlPath, "utf8");
  const returnLinkMatch = html.match(/<a[^>]*id="workflowReturnLink"[^>]*>/);
  assert.ok(returnLinkMatch, "expected a #workflowReturnLink anchor");
  assert.match(returnLinkMatch[0], /hidden/);
});

test("expense request form loads workflow-return-link.browser.js and workflow-prefill.logic.js before its own controller script", async () => {
  const html = await readFile(htmlPath, "utf8");
  const returnLinkIndex = html.indexOf("workflow-return-link.browser.js");
  const prefillLogicIndex = html.indexOf("workflow-prefill.logic.js");
  const controllerIndex = html.indexOf('window.addEventListener("DOMContentLoaded"');
  assert.ok(returnLinkIndex !== -1 && prefillLogicIndex !== -1 && controllerIndex !== -1);
  assert.ok(returnLinkIndex < controllerIndex, "return-link helper must load before the page controller");
  assert.ok(prefillLogicIndex < controllerIndex, "workflow-prefill.logic.js must load before the page controller");
  assert.ok(returnLinkIndex < prefillLogicIndex, "return-link helper loads before workflow-prefill.logic.js");
});

// --- Genuine execution: the inline controller actually runs -------------
//
// String-matching the source (above) proves the right tokens exist, but not
// that they are wired together correctly. This is exactly the trap called
// out for this task: a banner whose apply button does nothing, or a
// `groups` argument that is silently ignored, would still pass every
// string-match test above. The tests below extract the real inline
// <script> from forms/expense-request.html and execute it for real inside a
// vm sandbox with a minimal fake DOM, the same technique
// tests/workflow-document.html.test.mjs uses for the generic shell.

function extractInlineControllerScript(html) {
  const start = html.indexOf('window.addEventListener("DOMContentLoaded"');
  assert.ok(start !== -1, "expected an inline DOMContentLoaded controller script");
  const end = html.indexOf("</script>", start);
  assert.ok(end !== -1, "expected a closing </script> after the controller");
  return html.slice(start, end);
}

// FakeNode and the HTML-to-fake-DOM derivation live in
// tests/support/fake-dom.mjs (Item 7 followup): elements, form.elements, and
// the #lineTemplate content below now all come from actually parsing
// forms/expense-request.html, not from a hand-typed literal that could
// silently drift from the real markup.

// Sets up the real inline controller script from forms/expense-request.html
// in a require-less vm sandbox against a fake DOM derived from the same real
// HTML text, runs its DOMContentLoaded handler, and waits for the
// fire-and-forget loadWorkflowPrefill() fetch chain to settle. Evidence
// upload cards ([data-evidence-card]) are real elements from the parsed
// HTML now (previously stubbed out entirely) -- the controller wires drag/
// drop and file-input listeners onto them during boot exactly like a real
// page load, which is unrelated to the workflow wiring under test but no
// longer needs to be faked away.
async function setupExpenseRequestSandbox({ search = "", prefillResponse = null, nextRequestNo = "REQ-2026-09-0001" } = {}) {
  const html = await readFile(htmlPath, "utf8");
  const script = extractInlineControllerScript(html);
  const { elementsById, document: fakeDocument } = buildFakeDomFromHtml(html);

  const form = elementsById.expenseForm;
  form._requestType = "reimbursement";

  class FakeFormData {
    constructor(targetForm) {
      this._entries = [];
      this._form = targetForm;
    }

    append(key, value) {
      this._entries.push([key, value]);
    }

    get(key) {
      const found = this._entries.find(([entryKey]) => entryKey === key);
      if (found) return found[1];
      if (this._form && key === "requestType") return this._form._requestType ?? "reimbursement";
      return null;
    }
  }

  const fetchLog = [];
  const stubFetch = async (url) => {
    fetchLog.push(url);
    if (url.includes("/prefill")) {
      return { ok: true, json: async () => prefillResponse ?? { availableGroups: [] } };
    }
    if (url.includes("/api/expense-requests/next")) {
      return { ok: true, json: async () => ({ sequence: "1", requestNo: nextRequestNo }) };
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
    FormData: FakeFormData,
    // Bare `fetch(...)` resolves through the sandbox's global object, which
    // is this context object itself, not our separate `window` property.
    fetch: stubFetch,
    navigator: {},
  });

  vm.runInContext(await readFile(expenseLogicPath, "utf8"), context);
  vm.runInContext(await readFile(returnLinkPath, "utf8"), context);
  // workflow-return-link.browser.js is a plain classic script (no
  // `window.` assignment, per its own test coverage) — in a real browser,
  // top-level function declarations attach to the real global object,
  // which *is* `window`. This vm sandbox uses a separate plain `window`
  // object, so bridge the one function the controller calls through
  // `window.sanitizeWorkflowReturnTo`.
  context.window.sanitizeWorkflowReturnTo = context.sanitizeWorkflowReturnTo;
  vm.runInContext(await readFile(prefillLogicPath, "utf8"), context);
  vm.runInContext(await readFile(prefillBannerPath, "utf8"), context);
  vm.runInContext(script, context);

  const bootResult = context.window._handlers.DOMContentLoaded();
  await bootResult;
  // loadWorkflowPrefill() is fired-and-forgotten at the end of the boot
  // sequence; let its fetch -> json -> renderWorkflowPrefillBanner
  // microtask chain fully settle before the test touches the DOM.
  await new Promise((resolve) => setTimeout(resolve, 10));

  return { context, elements: elementsById, form, fetchLog };
}

function getPrefillCheckbox(container, group) {
  return container.querySelectorAll('input[type="checkbox"]').find((checkbox) => checkbox.value === group);
}

test("opened with no workflow context: no prefill fetch fires and the return link/banner stay hidden", async () => {
  const { elements, fetchLog } = await setupExpenseRequestSandbox({ search: "" });

  assert.equal(elements.workflowReturnLink.hidden, true, "return link must stay hidden with no returnTo");
  assert.equal(elements.workflowPrefillBanner.hidden, true, "prefill banner must stay hidden with no transactionNo/workflowStepId");
  assert.ok(
    !fetchLog.some((url) => url.includes("/prefill")),
    "no prefill request should fire when transactionNo/workflowStepId are absent",
  );
});

test("opened with a workflow transactionNo but an unsafe returnTo: the return link stays hidden", async () => {
  const { elements } = await setupExpenseRequestSandbox({
    search: "?transactionNo=TXN-2026-09-0001&workflowTemplateId=tpl-1&workflowStepId=step-1&returnTo=https://evil.example",
    prefillResponse: { availableGroups: [] },
  });

  assert.equal(elements.workflowReturnLink.hidden, true, "an absolute/off-site returnTo must never surface as a clickable link");
});

test("opened from a workflow step: hidden fields are populated and a safe returnTo shows the return link", async () => {
  const { elements, form, fetchLog } = await setupExpenseRequestSandbox({
    search: "?transactionNo=TXN-2026-09-0001&workflowTemplateId=tpl-1&workflowStepId=step-1&returnTo=%2Fworkflow-transaction%3FtransactionNo%3DTXN-2026-09-0001",
    prefillResponse: { availableGroups: [] },
  });

  assert.equal(form.elements.transactionNo.value, "TXN-2026-09-0001");
  assert.equal(form.elements.workflowTemplateId.value, "tpl-1");
  assert.equal(form.elements.workflowStepId.value, "step-1");
  assert.equal(elements.workflowReturnLink.hidden, false);
  assert.equal(elements.workflowReturnLink.href, "/workflow-transaction?transactionNo=TXN-2026-09-0001");
  assert.ok(
    fetchLog.some((url) => url.includes("/api/workflow-transactions/TXN-2026-09-0001/prefill") && url.includes("documentKind=expense_request") && url.includes("stepId=step-1")),
    "must fetch the prefill endpoint for the right transaction/documentKind/stepId",
  );
});

test("applyWorkflowPrefillPatch fills only ticked groups, leaving unticked fields untouched", async () => {
  const prefillResponse = {
    availableGroups: ["payee", "purpose", "lines"],
    sources: { payee: "PO-2026-09-0001", purpose: "PO-2026-09-0001", lines: "PO-2026-09-0001" },
    context: {},
  };
  const { context, elements, form } = await setupExpenseRequestSandbox({
    search: "?transactionNo=TXN-2026-09-0001&workflowTemplateId=tpl-1&workflowStepId=step-1",
    prefillResponse,
  });

  assert.equal(elements.workflowPrefillBanner.hidden, false, "banner must appear when availableGroups is non-empty");

  const testPatch = {
    paymentTargetName: "ร้านค้าทดสอบ",
    businessPurpose: "วัตถุประสงค์ทดสอบ",
    expenseLines: [{ description: "ค่าทดสอบ" }],
  };
  context.window.WorkflowPrefillLogic = { applyWorkflowPrefillGroups: () => testPatch };

  getPrefillCheckbox(elements.workflowPrefillGroups, "payee").checked = true;
  getPrefillCheckbox(elements.workflowPrefillGroups, "purpose").checked = false;
  getPrefillCheckbox(elements.workflowPrefillGroups, "lines").checked = false;

  elements.workflowPrefillApply.dispatch("click");

  assert.equal(form.elements.paymentTargetName.value, "ร้านค้าทดสอบ", "the ticked payee group must be applied");
  assert.equal(form.elements.businessPurpose.value, "", "an unticked purpose group must be left untouched");
  assert.equal(elements.workflowPrefillBanner.hidden, true, "the banner closes after apply");

  const badge = form.querySelector('[data-badge-for="paymentTargetName"]');
  assert.equal(badge.hidden, false, "a prefilled field must carry a visible source badge");
  assert.match(badge.textContent, /PO-2026-09-0001/);

  const purposeBadge = form.querySelector('[data-badge-for="businessPurpose"]');
  assert.equal(purposeBadge.hidden, true, "an untouched field must not gain a source badge");
});

test("real workflow-prefill.logic.js fills an expense_request end to end through the apply button", async () => {
  const canonicalContext = {
    payee: { name: "ร้านค้าจริง", bankName: "ธนาคารจริง", accountNo: "111-1-11111-1" },
    purpose: { title: "หัวข้อจริง", businessPurpose: "วัตถุประสงค์จริงจากเอกสารก่อนหน้า" },
    lines: [{ description: "สินค้า A", quantity: "1", unitCost: "500.00", lineTotal: "500.00", stockSkuId: "" }],
  };
  const prefillResponse = {
    availableGroups: ["payee", "purpose", "lines"],
    sources: { payee: "PO-2026-09-0001", purpose: "PO-2026-09-0001", lines: "PO-2026-09-0001" },
    context: canonicalContext,
  };
  const { elements, form } = await setupExpenseRequestSandbox({
    search: "?transactionNo=TXN-2026-09-0001&workflowTemplateId=tpl-1&workflowStepId=step-1",
    prefillResponse,
  });

  getPrefillCheckbox(elements.workflowPrefillGroups, "payee").checked = true;
  getPrefillCheckbox(elements.workflowPrefillGroups, "purpose").checked = true;
  getPrefillCheckbox(elements.workflowPrefillGroups, "lines").checked = true;

  elements.workflowPrefillApply.dispatch("click");

  assert.equal(form.elements.paymentTargetName.value, "ร้านค้าจริง");
  assert.equal(form.elements.businessPurpose.value, "วัตถุประสงค์จริงจากเอกสารก่อนหน้า");
  const lineDescriptions = elements.lineItems
    .querySelectorAll(".line-row")
    .map((row) => row.querySelector('[name="lineDescription"]').value);
  assert.deepEqual(lineDescriptions, ["สินค้า A"], "the expenseLines patch must replace the line rows");
});

test("collectData includes the workflow context fields in the saved payload shape", async () => {
  const html = await readFile(htmlPath, "utf8");
  // The three workflow keys must appear inside collectData()'s returned
  // object literal so they are carried into buildExpensePayload/POST body.
  const collectDataBody = html.match(/function collectData\(\)\s*\{([\s\S]*?)\n\s{4}\}/)?.[1] ?? "";
  assert.match(collectDataBody, /transactionNo: fields\.transactionNo\.value/);
  assert.match(collectDataBody, /workflowTemplateId: fields\.workflowTemplateId\.value/);
  assert.match(collectDataBody, /workflowStepId: fields\.workflowStepId\.value/);
});
