(function exportDocumentLifecycleLogic(root) {
  "use strict";

  function deepFreeze(value) {
    if (typeof value === "function") return Object.freeze(value);
    for (const key of Reflect.ownKeys(value)) {
      const child = value[key];
      if (child !== null && (typeof child === "object" || typeof child === "function") && !Object.isFrozen(child)) {
        deepFreeze(child);
      }
    }
    return Object.freeze(value);
  }

  const DOCUMENT_KINDS = [
    "purchase_order",
    "payment_voucher",
    "cash_spend_declaration",
    "payee_acknowledgement",
    "goods_receipt",
    "expense_request",
    "substitute_receipt",
  ];

  const DOCUMENT_STATUSES = [
    "draft",
    "pending_approval",
    "approved",
    "received",
    "completed",
    "cancelled",
    "voided",
  ];

  const DOCUMENT_STATUS_LABELS = {
    draft: "แบบร่าง",
    pending_approval: "รอตรวจอนุมัติ",
    approved: "อนุมัติแล้ว",
    received: "รับเข้าคลังแล้ว",
    completed: "เสร็จสิ้น",
    cancelled: "ยกเลิก",
    voided: "ยกเลิกหลังรับรู้",
  };

  const DOCUMENT_ACTIONS = [
    "submit",
    "approve",
    "receive_stock",
    "complete",
    "cancel",
    "void",
  ];

  const DOCUMENT_ACTION_TARGET_STATUS = {
    submit: "pending_approval",
    approve: "approved",
    receive_stock: "received",
    complete: "completed",
    cancel: "cancelled",
    void: "voided",
  };

  const standardStates = ["draft", "pending_approval", "approved", "completed", "cancelled"];
  const DOCUMENT_KIND_STATES = {
    purchase_order: standardStates,
    payment_voucher: standardStates,
    cash_spend_declaration: standardStates,
    payee_acknowledgement: standardStates,
    goods_receipt: standardStates,
    expense_request: standardStates,
    substitute_receipt: DOCUMENT_STATUSES,
  };

  const standardTransitions = {
    draft: ["draft", "pending_approval", "cancelled"],
    pending_approval: ["pending_approval", "approved", "cancelled"],
    approved: ["approved", "completed", "cancelled"],
    completed: ["completed"],
    cancelled: ["cancelled"],
  };
  const DOCUMENT_TRANSITIONS = {
    purchase_order: standardTransitions,
    payment_voucher: standardTransitions,
    cash_spend_declaration: standardTransitions,
    payee_acknowledgement: standardTransitions,
    goods_receipt: standardTransitions,
    expense_request: standardTransitions,
    substitute_receipt: {
      draft: ["draft", "pending_approval", "cancelled"],
      pending_approval: ["pending_approval", "approved", "cancelled"],
      approved: ["approved", "received", "completed", "cancelled"],
      received: ["received", "completed", "voided"],
      completed: ["completed"],
      cancelled: ["cancelled"],
      voided: ["voided"],
    },
  };

  const LEGACY_STATUS_ALIASES = {
    expense_request: { submitted: "pending_approval" },
  };

  const standardActions = {
    draft: ["submit", "cancel"],
    pending_approval: ["approve", "cancel"],
    approved: ["complete", "cancel"],
    completed: [],
    cancelled: [],
  };
  const substituteReceiptActions = {
    draft: ["submit", "cancel"],
    pending_approval: ["approve", "cancel"],
    approved: ["complete", "cancel"],
    received: ["complete", "void"],
    completed: [],
    cancelled: [],
    voided: [],
  };

  function clean(value) {
    return String(value ?? "").trim();
  }

  function hasOwn(object, key) {
    return Object.prototype.hasOwnProperty.call(object, key);
  }

  function normalizeDocumentStatus(documentKind, status) {
    const kind = clean(documentKind);
    const rawStatus = clean(status);
    if (!DOCUMENT_KINDS.includes(kind)) {
      throw new Error(`ประเภทเอกสารไม่ถูกต้อง: ${kind}`);
    }

    const aliases = hasOwn(LEGACY_STATUS_ALIASES, kind) ? LEGACY_STATUS_ALIASES[kind] : undefined;
    const normalizedStatus = aliases && hasOwn(aliases, rawStatus) ? aliases[rawStatus] : rawStatus;
    if (!DOCUMENT_KIND_STATES[kind].includes(normalizedStatus)) {
      throw new Error(`สถานะไม่ถูกต้องสำหรับ ${kind}: ${rawStatus}`);
    }
    return normalizedStatus;
  }

  function assertDocumentTransition(documentKind, fromStatus, toStatus, context = {}) {
    const kind = clean(documentKind);
    const from = normalizeDocumentStatus(kind, fromStatus);
    const to = clean(toStatus);
    const targets = DOCUMENT_TRANSITIONS[kind][from];
    const isCanonicalTarget = DOCUMENT_STATUSES.includes(to) && DOCUMENT_KIND_STATES[kind].includes(to);
    const isAllowed = isCanonicalTarget && targets.includes(to);
    const hasReceivingCapability = !(
      kind === "substitute_receipt"
      && from === "approved"
      && to === "received"
      && context?.receiptType !== "stock_purchase"
    );

    if (!isAllowed || !hasReceivingCapability) {
      throw new Error(`ไม่อนุญาตให้เปลี่ยนสถานะเอกสาร ${kind}: ${from} -> ${to}`);
    }
  }

  function availableDocumentActions(documentKind, status, context = {}) {
    const kind = clean(documentKind);
    const normalizedStatus = normalizeDocumentStatus(kind, status);
    let actions;

    if (kind === "substitute_receipt") {
      actions = substituteReceiptActions[normalizedStatus];
      if (normalizedStatus === "approved" && context?.receiptType === "stock_purchase") {
        actions = ["receive_stock", ...actions];
      }
    } else {
      actions = standardActions[normalizedStatus];
    }

    return Object.freeze([...actions]);
  }

  deepFreeze(DOCUMENT_KINDS);
  deepFreeze(DOCUMENT_STATUSES);
  deepFreeze(DOCUMENT_STATUS_LABELS);
  deepFreeze(DOCUMENT_ACTIONS);
  deepFreeze(DOCUMENT_ACTION_TARGET_STATUS);
  deepFreeze(DOCUMENT_KIND_STATES);
  deepFreeze(DOCUMENT_TRANSITIONS);
  deepFreeze(LEGACY_STATUS_ALIASES);
  deepFreeze(standardActions);
  deepFreeze(substituteReceiptActions);

  const api = deepFreeze({
    DOCUMENT_KINDS,
    DOCUMENT_STATUSES,
    DOCUMENT_STATUS_LABELS,
    DOCUMENT_ACTIONS,
    DOCUMENT_ACTION_TARGET_STATUS,
    DOCUMENT_KIND_STATES,
    DOCUMENT_TRANSITIONS,
    LEGACY_STATUS_ALIASES,
    normalizeDocumentStatus,
    assertDocumentTransition,
    availableDocumentActions,
  });

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.DocumentLifecycleLogic = api;
  }
}(typeof window !== "undefined" ? window : globalThis));
