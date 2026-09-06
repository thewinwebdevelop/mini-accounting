import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";

const htmlPath = new URL("../forms/workflow-document.html", import.meta.url);
const browserLogicPath = new URL("../forms/workflow-document.logic.browser.js", import.meta.url);
const returnLinkPath = new URL("../forms/workflow-return-link.browser.js", import.meta.url);
const workflowLogicPath = new URL("../forms/workflow.logic.js", import.meta.url);
const workflowDocumentLogicPath = new URL("../forms/workflow-document.logic.js", import.meta.url);
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
  // workflow-prefill.logic.js does not exist yet (it ships in a later task) — the
  // script tag was removed because it 404'd in the console on every page load.
  // The banner markup itself is still expected to be here waiting for that file.
  assert.doesNotMatch(html, /workflow-prefill\.logic\.js/);
  assert.match(html, /id="workflowPrefillBanner"/);
  assert.match(html, /id="workflowPrefillApply"/);
  assert.match(html, /id="workflowPrefillDismiss"/);
  assert.match(html, /ใช้ข้อมูลเดิม/);
  assert.match(html, /กรอกใหม่/);
  assert.match(html, /id="workflowPrefillGroups"/);
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

test("workflow document browser controller fetches prefill data and fails silently", async () => {
  const browserLogic = await readFile(browserLogicPath, "utf8");
  assert.match(browserLogic, /function fetchWorkflowPrefill/);
  assert.match(browserLogic, /\/api\/workflow-transactions\/.*\/prefill/);
  assert.match(browserLogic, /catch/);
});

test("workflow document browser controller renders prefill groups with source document badges", async () => {
  const browserLogic = await readFile(browserLogicPath, "utf8");
  assert.match(browserLogic, /function renderPrefillBanner/);
  assert.match(browserLogic, /availableGroups/);
  assert.match(browserLogic, /ผู้รับเงิน\/คู่ค้า/);
  assert.match(browserLogic, /วัตถุประสงค์/);
  assert.match(browserLogic, /รายการ/);
  assert.match(browserLogic, /applyWorkflowPrefillGroups/);
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
