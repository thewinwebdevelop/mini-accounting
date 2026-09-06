import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const htmlPath = new URL("../forms/workflow-document.html", import.meta.url);
const browserLogicPath = new URL("../forms/workflow-document.logic.browser.js", import.meta.url);
const returnLinkPath = new URL("../forms/workflow-return-link.browser.js", import.meta.url);

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
  assert.match(html, /workflow-prefill\.logic\.js/);
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
