// Cross-document prefill (Task 6). One canonical transaction context instead
// of N-by-N pairwise mappings: every document kind gets exactly two small
// adapters (toWorkflowContext / applyWorkflowContext) instead of the 42
// pairwise mappings seven kinds would otherwise need.
//
// This module must be pure: no filesystem, no network, no `new Date()`. It is
// also loaded as a plain classic <script> in the browser (see
// forms/workflow-document.logic.browser.js's `window.WorkflowPrefillLogic`
// usage), so — like workflow-document.logic.js — it must never call
// `require(...)` at module-load time; resolveWorkflowLogic() below resolves
// workflow.logic.js lazily, at call time, exactly like that sibling file does.

function resolveWorkflowLogic() {
  if (typeof module !== "undefined" && module.exports) {
    return require("./workflow.logic.js");
  }
  return typeof window !== "undefined" ? window.WorkflowLogic : undefined;
}

function cleanText(value) {
  return String(value ?? "").trim();
}

function toCents(value) {
  const text = cleanText(value).replace(/,/g, "");
  if (!text) return 0;
  const parsed = Number(text);
  if (!Number.isFinite(parsed)) return 0;
  return Math.round(parsed * 100);
}

function money(cents) {
  return (cents / 100).toFixed(2);
}

// The three groups a user ticks independently in the UI (Task 4/Task 7).
// `parties` and `sources` are not here: `parties` always rides along
// automatically whenever a source document supplies it (see
// applyWorkflowPrefillGroups below), and `sources` is UI metadata, not a
// user-tickable group. There is deliberately no `totals` group (D10): every
// kind recomputes its own totals from its own lines when it saves.
const PREFILL_GROUPS = ["payee", "purpose", "lines"];

// Kept as a per-kind map (rather than one flat array) purely so a future
// document kind that genuinely cannot support one of these groups has
// somewhere to say so. Today every entry is identical (D10): expense_request
// used to be excluded from `lines` and was the only kind eligible for a
// `totals` group, but the product owner rejected that in favor of
// expense_request mapping line-by-line like every other kind.
const RECEIVABLE_PREFILL_GROUPS = {
  expense_request: ["payee", "purpose", "lines"],
  substitute_receipt: ["payee", "purpose", "lines"],
  purchase_order: ["payee", "purpose", "lines"],
  payment_voucher: ["payee", "purpose", "lines"],
  cash_spend_declaration: ["payee", "purpose", "lines"],
  payee_acknowledgement: ["payee", "purpose", "lines"],
  goods_receipt: ["payee", "purpose", "lines"],
};

// Builds a group object containing only the fields that are actually
// non-blank, and returns undefined (skip the group key entirely) when none of
// them are. This is what makes e.g. a substitute_receipt with a blank
// receiptTitle produce a `purpose` group with only `businessPurpose`, not
// `{ title: "", businessPurpose: "..." }`. Never-auto-copied fields
// (documentNo, documentDate, status, statusHistory, completedAt, completedBy,
// signatures, evidence/raw files) are enforced structurally: this helper (and
// the per-kind field lists that call it) simply never reads them onto the
// context, so there is no separate filter list to bypass.
function compactGroup(fields) {
  const result = {};
  for (const [key, value] of Object.entries(fields)) {
    const text = cleanText(value);
    if (text) result[key] = text;
  }
  return Object.keys(result).length ? result : undefined;
}

// ---------------------------------------------------------------------------
// expense_request
// ---------------------------------------------------------------------------

function expenseRequestToWorkflowContext(payload = {}) {
  const context = {};

  const payee = compactGroup({
    name: payload.paymentTargetName,
    bankName: payload.paymentBankName,
    accountNo: payload.paymentAccountNo,
  });
  if (payee) context.payee = payee;

  const purpose = compactGroup({
    title: payload.requestTitle,
    businessPurpose: payload.businessPurpose,
  });
  if (purpose) context.purpose = purpose;

  const parties = compactGroup({
    requesterName: payload.requesterName,
    requesterRole: payload.requesterRole,
  });
  if (parties) context.parties = parties;

  const expenseLines = Array.isArray(payload.expenseLines) ? payload.expenseLines : [];
  const lines = expenseLines.map((line) => {
    // Gross (amountBeforeVat + vatAmount), not amountBeforeVat alone: dropping
    // VAT here would silently lose money if a user ever puts VAT on an
    // expense line. A zero-VAT line — the normal case for these six
    // no-tax-invoice templates — round-trips identically either way, since
    // gross === amountBeforeVat when vatAmount is "0.00".
    const gross = money(toCents(line.amountBeforeVat) + toCents(line.vatAmount));
    return {
      description: cleanText(line.description),
      quantity: "1",
      unitCost: gross,
      lineTotal: gross,
      stockSkuId: "",
    };
  });
  if (lines.length) context.lines = lines;

  return context;
}

function applyWorkflowContextToExpenseRequest(context = {}, groups = []) {
  const patch = {};

  if (groups.includes("payee") && context.payee) {
    patch.paymentTargetName = context.payee.name ?? "";
    patch.paymentBankName = context.payee.bankName ?? "";
    patch.paymentAccountNo = context.payee.accountNo ?? "";
  }

  if (groups.includes("purpose") && context.purpose) {
    patch.requestTitle = context.purpose.title ?? "";
    patch.businessPurpose = context.purpose.businessPurpose ?? "";
  }

  if (groups.includes("lines") && Array.isArray(context.lines)) {
    // One canonical line maps to one expense line. VAT/withholding are fixed
    // at zero — these six templates are all no-tax-invoice cases, so VAT is
    // genuinely zero on a prefilled line — and quantity/unitCost have no
    // target field on an expense line, so they are dropped.
    patch.expenseLines = context.lines.map((line) => ({
      description: cleanText(line.description),
      amountBeforeVat: line.lineTotal ?? "0.00",
      vatAmount: "0.00",
      withholdingTax: "0.00",
    }));
  }

  // `parties` always rides along when present, regardless of which of the
  // three tickable groups the caller requested.
  if (context.parties) {
    patch.requesterName = context.parties.requesterName ?? "";
    patch.requesterRole = context.parties.requesterRole ?? "";
  }

  return patch;
}

// ---------------------------------------------------------------------------
// substitute_receipt
// ---------------------------------------------------------------------------

function substituteReceiptLineToCanonical(line = {}) {
  return {
    description: cleanText(line.description),
    quantity: cleanText(line.quantity),
    unitCost: cleanText(line.unitCost),
    lineTotal: cleanText(line.lineTotal),
    stockSkuId: cleanText(line.stockSkuId),
  };
}

function substituteReceiptToWorkflowContext(payload = {}) {
  const context = {};

  const payee = compactGroup({
    name: payload.payeeName,
    taxId: payload.payeeTaxId,
  });
  if (payee) context.payee = payee;

  const purpose = compactGroup({
    title: payload.receiptTitle,
    businessPurpose: payload.businessPurpose,
  });
  if (purpose) context.purpose = purpose;

  const lines = (Array.isArray(payload.lines) ? payload.lines : []).map(substituteReceiptLineToCanonical);
  if (lines.length) context.lines = lines;

  // substitute_receipt has no requester field at all, so `parties` is never
  // set for this kind.
  return context;
}

function applyWorkflowContextToSubstituteReceipt(context = {}, groups = []) {
  const patch = {};

  if (groups.includes("payee") && context.payee) {
    patch.payeeName = context.payee.name ?? "";
    patch.payeeTaxId = context.payee.taxId ?? "";
  }

  if (groups.includes("purpose") && context.purpose) {
    patch.receiptTitle = context.purpose.title ?? "";
    patch.businessPurpose = context.purpose.businessPurpose ?? "";
  }

  if (groups.includes("lines") && Array.isArray(context.lines)) {
    patch.lines = context.lines.map(substituteReceiptLineToCanonical);
  }

  // No requester field on substitute_receipt — `parties` is never applied.
  return patch;
}

// ---------------------------------------------------------------------------
// the five generic workflow-document shell kinds: purchase_order,
// payment_voucher, cash_spend_declaration, payee_acknowledgement,
// goods_receipt. They all read/write an identical payload shape (Task 4's
// buildWorkflowDocumentPayload), so they share one implementation and are
// only exported under five separate names because WORKFLOW_CONTEXT_ADAPTERS
// dispatches on documentKind.
// ---------------------------------------------------------------------------

function workflowDocumentShellLineToCanonical(line = {}) {
  return {
    description: cleanText(line.description),
    quantity: cleanText(line.quantity),
    unitCost: cleanText(line.unitCost),
    lineTotal: cleanText(line.lineTotal),
    stockSkuId: cleanText(line.stockSkuId),
  };
}

function workflowDocumentShellToContext(payload = {}) {
  const context = {};

  // The lightweight shell has no taxId/address/bankName/accountNo fields — a
  // known limitation of the generic shell, not of this adapter.
  const payee = compactGroup({ name: payload.payeeName });
  if (payee) context.payee = payee;

  const purpose = compactGroup({
    title: payload.title,
    businessPurpose: payload.businessPurpose,
  });
  if (purpose) context.purpose = purpose;

  // The generic shell has no requesterRole field.
  const parties = compactGroup({ requesterName: payload.requesterName });
  if (parties) context.parties = parties;

  const lines = (Array.isArray(payload.lines) ? payload.lines : []).map(workflowDocumentShellLineToCanonical);
  if (lines.length) context.lines = lines;

  return context;
}

function applyWorkflowContextToWorkflowDocumentShell(context = {}, groups = []) {
  const patch = {};

  if (groups.includes("payee") && context.payee) {
    patch.payeeName = context.payee.name ?? "";
  }

  if (groups.includes("purpose") && context.purpose) {
    patch.title = context.purpose.title ?? "";
    patch.businessPurpose = context.purpose.businessPurpose ?? "";
  }

  if (groups.includes("lines") && Array.isArray(context.lines)) {
    patch.lines = context.lines.map(workflowDocumentShellLineToCanonical);
  }

  if (context.parties) {
    patch.requesterName = context.parties.requesterName ?? "";
  }

  return patch;
}

// goods_receipt line quantities must never be prefilled: a received quantity
// must reflect what actually arrived, so prefilling it from the purchase
// order would hide a short delivery. Description and stockSkuId still carry
// over; only quantity is cleared, after the shared shell logic runs.
function applyWorkflowContextToGoodsReceipt(context = {}, groups = []) {
  const patch = applyWorkflowContextToWorkflowDocumentShell(context, groups);
  if (Array.isArray(patch.lines)) {
    patch.lines = patch.lines.map((line) => ({ ...line, quantity: "" }));
  }
  return patch;
}

const purchaseOrderToWorkflowContext = workflowDocumentShellToContext;
const paymentVoucherToWorkflowContext = workflowDocumentShellToContext;
const cashSpendDeclarationToWorkflowContext = workflowDocumentShellToContext;
const payeeAcknowledgementToWorkflowContext = workflowDocumentShellToContext;
const goodsReceiptToWorkflowContext = workflowDocumentShellToContext;

const applyWorkflowContextToPurchaseOrder = applyWorkflowContextToWorkflowDocumentShell;
const applyWorkflowContextToPaymentVoucher = applyWorkflowContextToWorkflowDocumentShell;
const applyWorkflowContextToCashSpendDeclaration = applyWorkflowContextToWorkflowDocumentShell;
const applyWorkflowContextToPayeeAcknowledgement = applyWorkflowContextToWorkflowDocumentShell;

// ---------------------------------------------------------------------------
// registry
// ---------------------------------------------------------------------------

const WORKFLOW_CONTEXT_ADAPTERS = {
  expense_request: {
    toWorkflowContext: expenseRequestToWorkflowContext,
    applyWorkflowContext: applyWorkflowContextToExpenseRequest,
  },
  substitute_receipt: {
    toWorkflowContext: substituteReceiptToWorkflowContext,
    applyWorkflowContext: applyWorkflowContextToSubstituteReceipt,
  },
  purchase_order: {
    toWorkflowContext: purchaseOrderToWorkflowContext,
    applyWorkflowContext: applyWorkflowContextToPurchaseOrder,
  },
  payment_voucher: {
    toWorkflowContext: paymentVoucherToWorkflowContext,
    applyWorkflowContext: applyWorkflowContextToPaymentVoucher,
  },
  cash_spend_declaration: {
    toWorkflowContext: cashSpendDeclarationToWorkflowContext,
    applyWorkflowContext: applyWorkflowContextToCashSpendDeclaration,
  },
  payee_acknowledgement: {
    toWorkflowContext: payeeAcknowledgementToWorkflowContext,
    applyWorkflowContext: applyWorkflowContextToPayeeAcknowledgement,
  },
  goods_receipt: {
    toWorkflowContext: goodsReceiptToWorkflowContext,
    applyWorkflowContext: applyWorkflowContextToGoodsReceipt,
  },
};

// ---------------------------------------------------------------------------
// context builder + group applier
// ---------------------------------------------------------------------------

function isGroupNonEmpty(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (!value || typeof value !== "object") return false;
  return Object.values(value).some((field) => field !== undefined && field !== null && field !== "");
}

// Precedence: the most recently `completed` child document wins per group; an
// earlier `completed` document only fills a group that no later `completed`
// document supplied. Only documents whose *workflow* status
// (normalizeDocumentWorkflowStatus, Task 2 — not native status) is
// "completed" are ever used as a source.
//
// Recency is the document's `workflowStepId` ("step-001", "step-002", …),
// NOT `completedAt`. `completedAt` looks tempting (it's an ISO string, so
// lexicographic comparison "just works"), but it is not reliably stamped: the
// hybrid substitute_receipt completion rule (workflow.logic.js
// deriveChildWorkflowStatus) reports a receipt as workflow-completed on
// native status alone (general_expense+approved, stock_purchase+received)
// without ever setting completedAt, so it can be "" on a completed source.
// "" sorts before every real ISO string, which made a completed-but-unstamped
// document look like the *oldest* one regardless of when it actually
// completed. workflowStepId has no such gap: every child document carries
// one, it sorts lexicographically into exactly template order, and a
// separate binding rule already forces documents to be produced in strict
// template order (a step after the first incomplete step is `blocked`) — so
// step order IS completion order, deterministically, with no dependence on
// whether a clock value was ever stamped. Do not switch this back to
// completedAt.
//
// Sources are sorted by workflowStepId descending (latest step first) and
// only fill a group that is still empty, which is precedence stated the
// other way around: the first (latest) source to supply a non-empty group
// wins, and earlier sources fill only what's left empty. Documents with no
// workflowStepId (or an equal one) fall back to descending array index —
// callers pass documents in template step order, so a later array position
// is a later step.
function buildWorkflowPrefillContext(childDocuments = [], targetDocumentKind, options = {}) {
  const normalizeDocumentWorkflowStatus = resolveWorkflowLogic()?.normalizeDocumentWorkflowStatus;

  const context = { payee: {}, purpose: {}, lines: [], parties: {} };
  const sources = {};

  const completedInOrder = childDocuments
    .map((doc, index) => ({ doc, index, normalized: normalizeDocumentWorkflowStatus(doc) }))
    .filter((entry) => entry.normalized.workflowStatus === "completed")
    .sort((a, b) => {
      const left = a.doc.workflowStepId || "";
      const right = b.doc.workflowStepId || "";
      if (left === right) return b.index - a.index;
      return left > right ? -1 : 1;
    });

  for (const { doc, normalized } of completedInOrder) {
    const adapter = WORKFLOW_CONTEXT_ADAPTERS[doc.documentKind];
    if (!adapter) continue;
    const partial = adapter.toWorkflowContext(doc);
    for (const group of ["payee", "purpose", "parties"]) {
      if (!sources[group] && isGroupNonEmpty(partial[group])) {
        context[group] = partial[group];
        sources[group] = normalized.documentNo;
      }
    }
    if (!sources.lines && isGroupNonEmpty(partial.lines)) {
      context.lines = partial.lines;
      sources.lines = normalized.documentNo;
    }
  }

  return { context, sources };
}

// Filters the requested groups down to the ones the target kind can actually
// receive, always folds `parties` in when present (never user-tickable), and
// delegates the actual field mapping to that kind's own applyWorkflowContext.
function applyWorkflowPrefillGroups(context, targetDocumentKind, groups = []) {
  const adapter = WORKFLOW_CONTEXT_ADAPTERS[targetDocumentKind];
  if (!adapter) return {};
  const receivable = RECEIVABLE_PREFILL_GROUPS[targetDocumentKind] || [];
  const requested = groups.filter((group) => receivable.includes(group));
  const filteredContext = {
    ...Object.fromEntries(requested.map((group) => [group, context[group]])),
    // buildWorkflowPrefillContext seeds context.parties as {} when no source
    // document ever supplied one (e.g. every source is a substitute_receipt,
    // which never emits parties), so a plain `context.parties` here would
    // fold that empty object in as if it were real data — the applier's own
    // `if (context.parties)` guard treats {} as truthy, so it happily writes
    // out an empty requesterName/requesterRole and clears whatever the user
    // had already typed. Only fold parties in when it actually has fields.
    ...(isGroupNonEmpty(context.parties) ? { parties: context.parties } : {}),
  };
  return adapter.applyWorkflowContext(filteredContext, requested);
}

const WorkflowPrefillLogic = {
  PREFILL_GROUPS,
  RECEIVABLE_PREFILL_GROUPS,
  WORKFLOW_CONTEXT_ADAPTERS,
  expenseRequestToWorkflowContext,
  applyWorkflowContextToExpenseRequest,
  substituteReceiptToWorkflowContext,
  applyWorkflowContextToSubstituteReceipt,
  purchaseOrderToWorkflowContext,
  applyWorkflowContextToPurchaseOrder,
  paymentVoucherToWorkflowContext,
  applyWorkflowContextToPaymentVoucher,
  cashSpendDeclarationToWorkflowContext,
  applyWorkflowContextToCashSpendDeclaration,
  payeeAcknowledgementToWorkflowContext,
  applyWorkflowContextToPayeeAcknowledgement,
  goodsReceiptToWorkflowContext,
  applyWorkflowContextToGoodsReceipt,
  buildWorkflowPrefillContext,
  applyWorkflowPrefillGroups,
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = WorkflowPrefillLogic;
} else {
  window.WorkflowPrefillLogic = WorkflowPrefillLogic;
}
