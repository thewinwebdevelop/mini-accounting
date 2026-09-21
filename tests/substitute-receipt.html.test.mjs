import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";
import { buildFakeDomFromHtml } from "./support/fake-dom.mjs";

const htmlPath = new URL("../forms/substitute-receipt.html", import.meta.url);
const browserLogicPath = new URL("../forms/substitute-receipt.logic.browser.js", import.meta.url);
const substituteReceiptLogicPath = new URL("../forms/substitute-receipt.logic.js", import.meta.url);
const returnLinkPath = new URL("../forms/workflow-return-link.browser.js", import.meta.url);
const prefillLogicPath = new URL("../forms/workflow-prefill.logic.js", import.meta.url);
const prefillBannerPath = new URL("../forms/workflow-prefill-banner.browser.js", import.meta.url);
const documentLifecyclePath = new URL("../forms/document-lifecycle.logic.js", import.meta.url);

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

test("substitute receipt controller uses numbered draft responses and locks legacy reads", async () => {
  const browserLogic = await readFile(browserLogicPath, "utf8");
  assert.match(browserLogic, /legacyReadOnly/);
  assert.match(browserLogic, /result\.receiptNo/);
  assert.match(browserLogic, /result\.status/);
  assert.match(browserLogic, /history\.replaceState/);
  assert.match(browserLogic, /pending_approval/);
});

test("substitute receipt controller validates canonical identity and legacy attachment links", async () => {
  const browserLogic = await readFile(browserLogicPath, "utf8");
  assert.match(browserLogic, /SR-\\d\{4\}.*\\d\{4\}/);
  assert.match(browserLogic, /state\.status !== "draft"/);
  assert.match(browserLogic, /legacyEvidenceLinks/);
  assert.match(browserLogic, /target="_blank" rel="noreferrer"/);
  assert.match(browserLogic, /workflowTemplateId/);
});

test("substitute receipt browser controller updates stock line summaries", async () => {
  const browserLogic = await readFile(browserLogicPath, "utf8");

  assert.match(browserLogic, /function updateStockLineSummaries/);
  assert.match(browserLogic, /data-stock-line-title/);
  assert.match(browserLogic, /data-stock-line-total/);
});

test("approved general expense completes directly through the canonical lifecycle action", async () => {
  const { elements, fetchCalls } = await setupSubstituteReceiptSandbox({
    search: "?receiptNo=RCT%2F1",
    receiptResponse: { receiptNo: "RCT/1", status: "approved", payload: { receiptType: "general_expense", lines: [] } },
    mutationResponses: [{ body: { status: "completed" } }],
  });

  assert.equal(elements.receiptStatus.textContent, "อนุมัติแล้ว");
  assert.equal(elements.completeReceipt.hidden, false);
  elements.completeReceipt.dispatch("click");
  await new Promise((resolve) => setTimeout(resolve, 10));

  const complete = fetchCalls.find((call) => call.url.endsWith("/api/substitute-receipts/RCT%2F1/complete"));
  assert.deepEqual(JSON.parse(complete.options.body), { completedBy: "" });
  assert.equal(elements.receiptStatus.textContent, "เสร็จสิ้น");
  assert.equal(elements.completeReceipt.hidden, true);
});

test("approved stock completion opens a modal and a decline or Escape makes no mutation", async () => {
  const { elements, fetchCalls, document } = await setupSubstituteReceiptSandbox({
    search: "?receiptNo=RCT-1",
    receiptResponse: { receiptNo: "RCT-1", status: "approved", payload: { receiptType: "stock_purchase", lines: [] } },
  });

  elements.completeReceipt.dispatch("click");
  assert.equal(elements.stockBeforeCompleteDialog.hidden, false);
  assert.equal(document.activeElement, elements.confirmReceiveBeforeComplete);
  elements.stockBeforeCompleteDialog.dispatch("keydown", { key: "Escape", preventDefault() {} });
  assert.equal(elements.stockBeforeCompleteDialog.hidden, true);
  assert.equal(document.activeElement, elements.completeReceipt);
  assert.equal(fetchCalls.filter((call) => call.options.method === "POST").length, 0);
});

test("canonical lifecycle labels and SR mutation controls cover each receipt type and status", async () => {
  const expected = {
    draft: ["แบบร่าง", ["saveDraft", "submitForApproval"]],
    pending_approval: ["รอตรวจอนุมัติ", ["approveReceipt"]],
    approved: ["อนุมัติแล้ว", ["completeReceipt"]],
    received: ["รับเข้าคลังแล้ว", ["completeReceipt"]],
    completed: ["เสร็จสิ้น", []],
    cancelled: ["ยกเลิก", []],
    voided: ["ยกเลิกหลังรับรู้", []],
  };
  for (const receiptType of ["general_expense", "stock_purchase"]) {
    for (const [status, [label, visible]] of Object.entries(expected)) {
      const { elements } = await setupSubstituteReceiptSandbox({
        search: "?receiptNo=RCT-1",
        receiptResponse: { receiptNo: "RCT-1", status, payload: { receiptType, lines: [] } },
      });
      const actual = ["saveDraft", "submitForApproval", "approveReceipt", "receiveStock", "completeReceipt"]
        .filter((id) => !elements[id].hidden);
      const expectedVisible = status === "approved" && receiptType === "stock_purchase"
        ? ["receiveStock", ...visible]
        : visible;
      assert.equal(elements.receiptStatus.textContent, label, `${receiptType}/${status} label`);
      assert.deepEqual(actual, expectedVisible, `${receiptType}/${status} actions`);
    }
  }
});

test("confirmed stock receipt stays received until a separate complete click and can retry completion", async () => {
  const { elements, fetchCalls } = await setupSubstituteReceiptSandbox({
    search: "?receiptNo=RCT-1",
    receiptResponse: { receiptNo: "RCT-1", status: "approved", payload: { receiptType: "stock_purchase", lines: [] } },
    mutationResponses: [
      { body: { status: "received", stockMovements: [{ id: "move-1" }] } },
      { ok: false, body: { error: "complete failed" } },
      { body: { status: "completed" } },
    ],
  });

  elements.completeReceipt.dispatch("click");
  elements.confirmReceiveBeforeComplete.dispatch("click");
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(elements.receiptStatus.textContent, "รับเข้าคลังแล้ว");
  assert.equal(elements.stockBeforeCompleteDialog.hidden, true);
  assert.equal(fetchCalls.filter((call) => call.url.endsWith("/complete")).length, 0, "O11 requires a second explicit click");
  const receive = fetchCalls.find((call) => call.url.endsWith("/receive-stock"));
  assert.deepEqual(JSON.parse(receive.options.body), { receivedDate: "2026-09-13", receivedBy: "" });

  elements.completeReceipt.dispatch("click");
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(elements.receiptStatus.textContent, "รับเข้าคลังแล้ว", "failure keeps received for retry without a second receive");
  elements.completeReceipt.dispatch("click");
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(elements.receiptStatus.textContent, "เสร็จสิ้น");
  assert.equal(fetchCalls.filter((call) => call.url.endsWith("/receive-stock")).length, 1);
  assert.equal(fetchCalls.filter((call) => call.url.endsWith("/complete")).length, 2);
});

test("stock modal prompt cancellation and malformed receive status retain approved without completing", async () => {
  const cancelled = await setupSubstituteReceiptSandbox({
    search: "?receiptNo=RCT-1",
    promptResult: "",
    receiptResponse: { receiptNo: "RCT-1", status: "approved", payload: { receiptType: "stock_purchase", lines: [] } },
  });
  cancelled.elements.completeReceipt.dispatch("click");
  cancelled.elements.confirmReceiveBeforeComplete.dispatch("click");
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(cancelled.elements.receiptStatus.textContent, "อนุมัติแล้ว");
  assert.equal(cancelled.fetchCalls.filter((call) => call.options.method === "POST").length, 0);

  const malformed = await setupSubstituteReceiptSandbox({
    search: "?receiptNo=RCT-2",
    receiptResponse: { receiptNo: "RCT-2", status: "approved", payload: { receiptType: "stock_purchase", lines: [] } },
    mutationResponses: [{ body: { stockMovements: [] } }],
  });
  malformed.elements.completeReceipt.dispatch("click");
  malformed.elements.confirmReceiveBeforeComplete.dispatch("click");
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(malformed.elements.receiptStatus.textContent, "อนุมัติแล้ว");
  assert.match(malformed.elements.substituteReceiptStatus.textContent, /สถานะเอกสาร/);
  assert.equal(malformed.fetchCalls.filter((call) => call.url.endsWith("/complete")).length, 0);
});

test("draft save adopts the numbered response and reuses its receipt identity", async () => {
  const { elements, capturedPost } = await setupSubstituteReceiptSandbox({
    draftResponse: { receiptNo: "SR-2026-09-0001", status: "draft", evidenceFiles: {}, rawFiles: [] },
  });
  elements.saveDraft.dispatch("click");
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(elements.receiptStatus.textContent, "แบบร่าง");
  assert.match(elements.substituteReceiptStatus.textContent, /บันทึกแบบร่าง SR-2026-09-0001 แล้ว/);

  elements.saveDraft.dispatch("click");
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(capturedPost.payloads[1].receiptNo, "SR-2026-09-0001");
  assert.match(elements.substituteReceiptStatus.textContent, /บันทึกแบบร่าง SR-2026-09-0001 แล้ว/);
});

test("stock dialog cycles Tab forward and Shift+Tab backward across both decisions", async () => {
  const { elements, document } = await setupSubstituteReceiptSandbox({
    search: "?receiptNo=RCT-1",
    receiptResponse: { receiptNo: "RCT-1", status: "approved", payload: { receiptType: "stock_purchase", lines: [] } },
  });
  elements.completeReceipt.dispatch("click");
  elements.stockBeforeCompleteDialog.dispatch("keydown", { key: "Tab", preventDefault() {} });
  assert.equal(document.activeElement, elements.declineReceiveBeforeComplete);
  elements.stockBeforeCompleteDialog.dispatch("keydown", { key: "Tab", shiftKey: true, preventDefault() {} });
  assert.equal(document.activeElement, elements.confirmReceiveBeforeComplete);
});

test("shared in-flight guard blocks duplicate direct completion and form mutations until the response settles", async () => {
  const { elements, form, fetchCalls, pendingMutations } = await setupSubstituteReceiptSandbox({
    search: "?receiptNo=RCT-1",
    receiptResponse: { receiptNo: "RCT-1", status: "approved", payload: { receiptType: "general_expense", lines: [] } },
    mutationResponses: [{ body: { status: "completed" } }],
    holdMutations: true,
  });
  let resetPrevented = false;
  elements.completeReceipt.dispatch("click");
  elements.completeReceipt.dispatch("click");
  form.dispatch("submit", { preventDefault() {} });
  form.dispatch("reset", { preventDefault() { resetPrevented = true; } });
  assert.equal(fetchCalls.filter((call) => call.options.method === "POST").length, 1);
  assert.equal(elements.completeReceipt.disabled, true);
  assert.equal(resetPrevented, true);
  pendingMutations[0].resolve();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(elements.receiptStatus.textContent, "เสร็จสิ้น");
  assert.equal(elements.completeReceipt.disabled, false);
});

test("modal guard issues one receive request and blocks duplicate confirmation and background mutations", async () => {
  const { elements, form, fetchCalls, pendingMutations } = await setupSubstituteReceiptSandbox({
    search: "?receiptNo=RCT-1",
    receiptResponse: { receiptNo: "RCT-1", status: "approved", payload: { receiptType: "stock_purchase", lines: [] } },
    mutationResponses: [{ body: { status: "received", stockMovements: [] } }],
    holdMutations: true,
  });
  let resetPrevented = false;
  elements.completeReceipt.dispatch("click");
  elements.confirmReceiveBeforeComplete.dispatch("click");
  elements.confirmReceiveBeforeComplete.dispatch("click");
  elements.receiveStock.dispatch("click");
  form.dispatch("submit", { preventDefault() {} });
  form.dispatch("reset", { preventDefault() { resetPrevented = true; } });
  assert.equal(fetchCalls.filter((call) => call.options.method === "POST").length, 1);
  assert.equal(fetchCalls.find((call) => call.options.method === "POST").url.endsWith("/receive-stock"), true);
  assert.equal(elements.confirmReceiveBeforeComplete.disabled, true);
  assert.equal(resetPrevented, true);
  pendingMutations[0].resolve();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(elements.receiptStatus.textContent, "รับเข้าคลังแล้ว");
  assert.equal(elements.stockBeforeCompleteDialog.hidden, true);
  assert.equal(elements.confirmReceiveBeforeComplete.disabled, false);
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

// FakeNode and the HTML-to-fake-DOM derivation live in
// tests/support/fake-dom.mjs (Item 7 followup): elements, form.elements, and
// the #stockLineTemplate content below now all come from actually parsing
// forms/substitute-receipt.html, not from a hand-typed literal that could
// silently drift from the real markup.

// Sets up the real forms/substitute-receipt.logic.browser.js in a
// require-less vm sandbox against a fake DOM derived from the real
// forms/substitute-receipt.html (see tests/support/fake-dom.mjs), runs its
// DOMContentLoaded handler, and waits for both the boot Promise.all chain and
// the fire-and-forget loadWorkflowPrefill() fetch chain to settle. Evidence
// file inputs are real elements from the parsed HTML but never get a `.files`
// list set — the controller already handles that (via optional chaining and
// `?? []`), and file uploads are unrelated to the workflow wiring under test.
async function setupSubstituteReceiptSandbox({
  search = "",
  prefillResponse = null,
  nextReceiptNo = "RCT-2026-09-0001",
  receiptResponse = null,
  mutationResponses = [],
  promptResult = "2026-09-13",
  draftResponse = { receiptNo: "SR-2026-09-0001", status: "draft", evidenceFiles: {}, rawFiles: [], updatedAt: "2026-09-13T00:00:00.000Z" },
  holdMutations = false,
} = {}) {
  const realHtml = await readFile(htmlPath, "utf8");
  const { elementsById, document: fakeDocument } = buildFakeDomFromHtml(realHtml);
  const form = elementsById.substituteReceiptForm;

  const fetchLog = [];
  const fetchCalls = [];
  // Captures whatever the controller last posted as a multipart "payload"
  // field (draft save / submit-for-approval), so a test can assert on the
  // actual JSON that would have reached the server -- specifically, that a
  // workflow-locked (and therefore `disabled`) receiptType select still
  // contributes its value to that payload, since collectPayload() reads
  // form.elements.receiptType.value directly rather than relying on native
  // form/FormData serialization (which *would* silently drop a disabled
  // field).
  const capturedPost = { payload: null, payloads: [] };
  const pendingMutations = [];
  const stubFetch = async (url, options = {}) => {
    fetchLog.push(url);
    fetchCalls.push({ url, options });
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
    if (url.includes("/api/substitute-receipts/") && !url.includes("/approve") && !url.includes("/complete") && !url.includes("/receive-stock")) {
      return { ok: true, json: async () => receiptResponse ?? {} };
    }
    if (options.method === "POST" && (url.includes("/approve") || url.includes("/complete") || url.includes("/receive-stock"))) {
      const response = mutationResponses.shift() ?? { ok: true, body: { status: "completed", stockMovements: [] } };
      if (holdMutations) {
        return new Promise((resolve) => pendingMutations.push({ resolve: () => resolve({ ok: response.ok ?? true, json: async () => response.body ?? response }) }));
      }
      return { ok: response.ok ?? true, json: async () => response.body ?? response };
    }
    if (
      options.method === "POST"
      && (url.includes("/api/substitute-receipt-drafts") || url.includes("/api/substitute-receipts"))
      && options.body instanceof FormData
    ) {
      capturedPost.payload = JSON.parse(options.body.get("payload"));
      capturedPost.payloads.push(capturedPost.payload);
      if (url.includes("/api/substitute-receipt-drafts")) {
        return { ok: true, json: async () => draftResponse };
      }
      return { ok: true, json: async () => ({ receiptNo: nextReceiptNo, status: "pending_approval", evidenceFiles: {}, pdfFiles: [], rawFiles: [] }) };
    }
    return { ok: true, json: async () => ({}) };
  };

  const window = { prompt: () => promptResult };
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

  for (const element of Object.values(elementsById)) {
    element.focus = () => { fakeDocument.activeElement = element; };
  }

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
  vm.runInContext(await readFile(prefillBannerPath, "utf8"), context);
  vm.runInContext(await readFile(documentLifecyclePath, "utf8"), context);
  vm.runInContext(await readFile(browserLogicPath, "utf8"), context);

  context.window._handlers.DOMContentLoaded();
  // Both the Promise.all(...) boot chain and the fire-and-forget
  // loadWorkflowPrefill() fetch -> json -> renderWorkflowPrefillBanner
  // microtask chain need to fully settle before a test touches the DOM.
  await new Promise((resolve) => setTimeout(resolve, 20));

  return { context, elements: elementsById, form, fetchLog, fetchCalls, capturedPost, pendingMutations, document: fakeDocument };
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
// receiptType controls whether stock receiving applies; native "completed"
// alone unlocks the next workflow step. start-document carries the snapshotted
// template's declared receiptType as a `receiptType` query
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
  // The flip side of the payeeTaxId hole below: when the source genuinely
  // supplies a tax ID, the badge must still show -- the fix must not have
  // overcorrected into hiding every badge unconditionally.
  const taxIdBadge = form.querySelector('[data-badge-for="payeeTaxId"]');
  assert.equal(taxIdBadge.hidden, false, "payeeTaxId must carry a source badge when the source document genuinely supplied a tax ID");
  assert.match(taxIdBadge.textContent, /PO-2026-09-0001/);
  const lineDescriptions = elements.stockLineItems
    .querySelectorAll(".stock-line")
    .map((row) => row.querySelector('input[name="description"]').value);
  assert.deepEqual(lineDescriptions, ["สินค้า A"], "the lines patch must replace the stock-line rows");
});

test("real workflow-prefill.logic.js: prefilling from an expense_request source (no tax-ID field) must not badge the empty payeeTaxId", async () => {
  // expense_request's payee context only ever carries `name` -- see
  // expenseRequestToWorkflowContext in forms/workflow-prefill.logic.js --
  // so payeeTaxId has nothing to receive on a substitute_receipt target.
  const canonicalContext = {
    payee: { name: "คุณต้า" },
    purpose: { businessPurpose: "ค่าใช้จ่ายทดสอบ" },
  };
  const prefillResponse = {
    availableGroups: ["payee", "purpose"],
    sources: { payee: "ER-2026-09-0001", purpose: "ER-2026-09-0001" },
    context: canonicalContext,
  };
  const { elements, form } = await setupSubstituteReceiptSandbox({
    search: "?transactionNo=TXN-2026-09-0001&workflowTemplateId=tpl-1&workflowStepId=step-2",
    prefillResponse,
  });

  getPrefillCheckbox(elements.workflowPrefillGroups, "payee").checked = true;
  getPrefillCheckbox(elements.workflowPrefillGroups, "purpose").checked = true;

  elements.workflowPrefillApply.dispatch("click");

  assert.equal(form.elements.payeeName.value, "คุณต้า");
  const taxIdBadge = form.querySelector('[data-badge-for="payeeTaxId"]');
  assert.equal(taxIdBadge.hidden, true, "payeeTaxId must not carry a source badge when the source document never supplied a tax ID");
  assert.equal(form.elements.payeeTaxId.value, "", "payeeTaxId legitimately stays blank -- there is nothing to carry over");
});
