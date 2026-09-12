import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const sourcePath = fileURLToPath(new URL("../forms/document-lifecycle.logic.js", import.meta.url));
const lifecycle = require(sourcePath);

const EXPECTED_KINDS = [
  "purchase_order",
  "payment_voucher",
  "cash_spend_declaration",
  "payee_acknowledgement",
  "goods_receipt",
  "expense_request",
  "substitute_receipt",
];

const EXPECTED_STATUSES = [
  "draft",
  "pending_approval",
  "approved",
  "received",
  "completed",
  "cancelled",
  "voided",
];

const EXPECTED_LABELS = {
  draft: "แบบร่าง",
  pending_approval: "รอตรวจอนุมัติ",
  approved: "อนุมัติแล้ว",
  received: "รับเข้าคลังแล้ว",
  completed: "เสร็จสิ้น",
  cancelled: "ยกเลิก",
  voided: "ยกเลิกหลังรับรู้",
};

const EXPECTED_ACTIONS = ["submit", "approve", "receive_stock", "complete", "cancel", "void"];
const EXPECTED_ACTION_TARGETS = {
  submit: "pending_approval",
  approve: "approved",
  receive_stock: "received",
  complete: "completed",
  cancel: "cancelled",
  void: "voided",
};

const STANDARD_STATES = ["draft", "pending_approval", "approved", "completed", "cancelled"];
const EXPECTED_KIND_STATES = {
  purchase_order: STANDARD_STATES,
  payment_voucher: STANDARD_STATES,
  cash_spend_declaration: STANDARD_STATES,
  payee_acknowledgement: STANDARD_STATES,
  goods_receipt: STANDARD_STATES,
  expense_request: STANDARD_STATES,
  substitute_receipt: EXPECTED_STATUSES,
};

const STANDARD_TRANSITIONS = {
  draft: ["draft", "pending_approval", "cancelled"],
  pending_approval: ["pending_approval", "approved", "cancelled"],
  approved: ["approved", "completed", "cancelled"],
  completed: ["completed"],
  cancelled: ["cancelled"],
};

const EXPECTED_TRANSITIONS = {
  purchase_order: STANDARD_TRANSITIONS,
  payment_voucher: STANDARD_TRANSITIONS,
  cash_spend_declaration: STANDARD_TRANSITIONS,
  payee_acknowledgement: STANDARD_TRANSITIONS,
  goods_receipt: STANDARD_TRANSITIONS,
  expense_request: STANDARD_TRANSITIONS,
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

const EXPECTED_STANDARD_ACTIONS = {
  draft: ["submit", "cancel"],
  pending_approval: ["approve", "cancel"],
  approved: ["complete", "cancel"],
  completed: [],
  cancelled: [],
};

function transitionError(kind, from, to) {
  return `ไม่อนุญาตให้เปลี่ยนสถานะเอกสาร ${kind}: ${from} -> ${to}`;
}

function assertRecursivelyFrozen(value, path = "api") {
  if (value === null || (typeof value !== "object" && typeof value !== "function")) return;
  assert.equal(Object.isFrozen(value), true, `${path} must be frozen`);
  for (const key of Reflect.ownKeys(value)) {
    const child = value[key];
    if (child && typeof child === "object") assertRecursivelyFrozen(child, `${path}.${String(key)}`);
  }
}

test("exports the exact canonical constants and per-kind lifecycle tables", () => {
  assert.deepEqual(lifecycle.DOCUMENT_KINDS, EXPECTED_KINDS);
  assert.deepEqual(lifecycle.DOCUMENT_STATUSES, EXPECTED_STATUSES);
  assert.deepEqual(lifecycle.DOCUMENT_STATUS_LABELS, EXPECTED_LABELS);
  assert.deepEqual(lifecycle.DOCUMENT_ACTIONS, EXPECTED_ACTIONS);
  assert.deepEqual(lifecycle.DOCUMENT_ACTION_TARGET_STATUS, EXPECTED_ACTION_TARGETS);
  assert.deepEqual(lifecycle.DOCUMENT_KIND_STATES, EXPECTED_KIND_STATES);
  assert.deepEqual(lifecycle.DOCUMENT_TRANSITIONS, EXPECTED_TRANSITIONS);
  assert.deepEqual(lifecycle.LEGACY_STATUS_ALIASES, {
    expense_request: { submitted: "pending_approval" },
  });
  assert.equal(lifecycle.DOCUMENT_STATUSES.includes("submitted"), false);
});

test("checks all 343 kind/source/target cells against an independent matrix fixture", () => {
  let checked = 0;
  for (const kind of EXPECTED_KINDS) {
    const context = kind === "substitute_receipt" ? { receiptType: "stock_purchase" } : {};
    for (const from of EXPECTED_STATUSES) {
      for (const to of EXPECTED_STATUSES) {
        checked += 1;
        const allowed = EXPECTED_TRANSITIONS[kind][from]?.includes(to) === true;
        if (allowed) {
          assert.equal(lifecycle.assertDocumentTransition(kind, from, to, context), undefined);
        } else {
          const expectedMessage = EXPECTED_KIND_STATES[kind].includes(from)
            ? transitionError(kind, from, to)
            : `สถานะไม่ถูกต้องสำหรับ ${kind}: ${from}`;
          assert.throws(
            () => lifecycle.assertDocumentTransition(kind, from, to, context),
            { message: expectedMessage },
            `${kind}: ${from} -> ${to}`,
          );
        }
      }
    }
  }
  assert.equal(checked, 7 * 7 * 7);
});

test("gates substitute-receipt receiving on the exact stock-purchase context", () => {
  assert.equal(
    lifecycle.assertDocumentTransition("substitute_receipt", "approved", "received", { receiptType: "stock_purchase" }),
    undefined,
  );
  for (const context of [{ receiptType: "general_expense" }, {}, { receiptType: "unknown" }, null]) {
    assert.throws(
      () => lifecycle.assertDocumentTransition("substitute_receipt", "approved", "received", context),
      { message: transitionError("substitute_receipt", "approved", "received") },
    );
  }
  for (const context of [{ receiptType: "stock_purchase" }, { receiptType: "general_expense" }, {}, null]) {
    assert.equal(
      lifecycle.assertDocumentTransition("substitute_receipt", "approved", "completed", context),
      undefined,
    );
  }
});

test("accepts draft replay but forbids returning to draft after submission for every kind", () => {
  for (const kind of EXPECTED_KINDS) {
    assert.equal(lifecycle.assertDocumentTransition(kind, "draft", "draft"), undefined);
    assert.throws(
      () => lifecycle.assertDocumentTransition(kind, "pending_approval", "draft"),
      { message: transitionError(kind, "pending_approval", "draft") },
    );
  }
});

test("accepts terminal replays while displaying no terminal actions", () => {
  const terminalByKind = {
    purchase_order: ["completed", "cancelled"],
    payment_voucher: ["completed", "cancelled"],
    cash_spend_declaration: ["completed", "cancelled"],
    payee_acknowledgement: ["completed", "cancelled"],
    goods_receipt: ["completed", "cancelled"],
    expense_request: ["completed", "cancelled"],
    substitute_receipt: ["completed", "cancelled", "voided"],
  };
  for (const [kind, statuses] of Object.entries(terminalByKind)) {
    for (const status of statuses) {
      assert.equal(lifecycle.assertDocumentTransition(kind, status, status), undefined);
      assert.deepEqual(lifecycle.availableDocumentActions(kind, status), []);
    }
  }
});

test("returns exact ordered standard actions and every action maps to an allowed target", () => {
  for (const kind of EXPECTED_KINDS.slice(0, -1)) {
    for (const [status, expected] of Object.entries(EXPECTED_STANDARD_ACTIONS)) {
      const actions = lifecycle.availableDocumentActions(kind, status);
      assert.deepEqual(actions, expected, `${kind}: ${status}`);
      for (const action of actions) {
        assert.equal(
          lifecycle.assertDocumentTransition(kind, status, EXPECTED_ACTION_TARGETS[action]),
          undefined,
        );
      }
    }
  }
});

test("returns exact ordered substitute-receipt actions by state and receipt type", () => {
  const cases = [
    ["draft", {}, ["submit", "cancel"]],
    ["pending_approval", {}, ["approve", "cancel"]],
    ["approved", { receiptType: "stock_purchase" }, ["receive_stock", "complete", "cancel"]],
    ["approved", { receiptType: "general_expense" }, ["complete", "cancel"]],
    ["approved", {}, ["complete", "cancel"]],
    ["approved", null, ["complete", "cancel"]],
    ["approved", { receiptType: "unknown" }, ["complete", "cancel"]],
    ["received", {}, ["complete", "void"]],
    ["completed", {}, []],
    ["cancelled", {}, []],
    ["voided", {}, []],
  ];
  for (const [status, context, expected] of cases) {
    const actions = lifecycle.availableDocumentActions("substitute_receipt", status, context);
    assert.deepEqual(actions, expected, `${status}: ${JSON.stringify(context)}`);
    for (const action of actions) {
      assert.equal(
        lifecycle.assertDocumentTransition(
          "substitute_receipt",
          status,
          EXPECTED_ACTION_TARGETS[action],
          context,
        ),
        undefined,
      );
    }
  }
});

test("normalizes the expense submitted alias only as a read/source value", () => {
  assert.equal(lifecycle.normalizeDocumentStatus("expense_request", "submitted"), "pending_approval");
  assert.equal(
    lifecycle.assertDocumentTransition("expense_request", "submitted", "approved"),
    undefined,
  );
  assert.deepEqual(
    lifecycle.availableDocumentActions("expense_request", "submitted"),
    ["approve", "cancel"],
  );
  assert.throws(
    () => lifecycle.assertDocumentTransition("expense_request", "draft", "submitted"),
    { message: transitionError("expense_request", "draft", "submitted") },
  );
  for (const kind of EXPECTED_KINDS.filter((kind) => kind !== "expense_request")) {
    assert.throws(
      () => lifecycle.normalizeDocumentStatus(kind, "submitted"),
      { message: `สถานะไม่ถูกต้องสำหรับ ${kind}: submitted` },
    );
  }
});

test("trims kind and statuses without case folding or guessing", () => {
  assert.equal(
    lifecycle.normalizeDocumentStatus(" expense_request ", " submitted "),
    "pending_approval",
  );
  assert.equal(
    lifecycle.assertDocumentTransition(" purchase_order ", " draft ", " pending_approval "),
    undefined,
  );
  assert.throws(
    () => lifecycle.normalizeDocumentStatus("PURCHASE_ORDER", "draft"),
    { message: "ประเภทเอกสารไม่ถูกต้อง: PURCHASE_ORDER" },
  );
  assert.throws(
    () => lifecycle.normalizeDocumentStatus("purchase_order", "DRAFT"),
    { message: "สถานะไม่ถูกต้องสำหรับ purchase_order: DRAFT" },
  );
});

test("uses exact normalization errors for invalid kinds, statuses, and unsupported states", () => {
  for (const value of [undefined, null, "", "   "]) {
    assert.throws(
      () => lifecycle.normalizeDocumentStatus(value, "draft"),
      { message: "ประเภทเอกสารไม่ถูกต้อง: " },
    );
  }
  for (const value of ["unknown", "constructor", "toString", "__proto__"]) {
    assert.throws(
      () => lifecycle.normalizeDocumentStatus(value, "draft"),
      { message: `ประเภทเอกสารไม่ถูกต้อง: ${value}` },
    );
  }
  for (const value of [undefined, null, "", "   "]) {
    assert.throws(
      () => lifecycle.normalizeDocumentStatus("purchase_order", value),
      { message: "สถานะไม่ถูกต้องสำหรับ purchase_order: " },
    );
  }
  for (const value of ["unknown", "constructor", "toString", "__proto__", "received", "voided"] ) {
    assert.throws(
      () => lifecycle.normalizeDocumentStatus("purchase_order", value),
      { message: `สถานะไม่ถูกต้องสำหรับ purchase_order: ${value}` },
    );
  }
});

test("validates the source first and then reports every invalid target as a transition error", () => {
  assert.throws(
    () => lifecycle.assertDocumentTransition("bad_kind", "bad_source", "bad_target"),
    { message: "ประเภทเอกสารไม่ถูกต้อง: bad_kind" },
  );
  assert.throws(
    () => lifecycle.assertDocumentTransition("purchase_order", "bad_source", "bad_target"),
    { message: "สถานะไม่ถูกต้องสำหรับ purchase_order: bad_source" },
  );
  for (const target of [undefined, null, "", "   ", "unknown", "constructor", "toString", "__proto__", "received", "voided"] ) {
    const trimmed = String(target ?? "").trim();
    assert.throws(
      () => lifecycle.assertDocumentTransition("purchase_order", "draft", target),
      { message: transitionError("purchase_order", "draft", trimmed) },
    );
  }
  assert.throws(
    () => lifecycle.assertDocumentTransition("expense_request", "submitted", "submitted"),
    { message: transitionError("expense_request", "pending_approval", "submitted") },
  );
});

test("validates available-action inputs with the normalization policy", () => {
  assert.throws(
    () => lifecycle.availableDocumentActions("__proto__", "draft"),
    { message: "ประเภทเอกสารไม่ถูกต้อง: __proto__" },
  );
  assert.throws(
    () => lifecycle.availableDocumentActions("purchase_order", "received"),
    { message: "สถานะไม่ถูกต้องสำหรับ purchase_order: received" },
  );
});

test("freezes the entire public data graph and returns fresh frozen action arrays", () => {
  assertRecursivelyFrozen(lifecycle);
  const first = lifecycle.availableDocumentActions("purchase_order", "draft");
  const second = lifecycle.availableDocumentActions("purchase_order", "draft");
  assert.notEqual(first, second);
  assert.equal(Object.isFrozen(first), true);
  assert.throws(() => first.push("void"), TypeError);
  assert.throws(() => { lifecycle.DOCUMENT_TRANSITIONS.purchase_order.draft[0] = "voided"; }, TypeError);
  assert.throws(() => { lifecycle.LEGACY_STATUS_ALIASES.expense_request.submitted = "draft"; }, TypeError);
  assert.deepEqual(lifecycle.DOCUMENT_TRANSITIONS.purchase_order.draft, ["draft", "pending_approval", "cancelled"]);
  assert.equal(lifecycle.normalizeDocumentStatus("expense_request", "submitted"), "pending_approval");
  assert.deepEqual(lifecycle.availableDocumentActions("purchase_order", "draft"), ["submit", "cancel"]);
});

test("exposes the same frozen API to a classic browser without Node or DOM globals", () => {
  const source = readFileSync(sourcePath, "utf8");
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: "document-lifecycle.logic.js" });
  const browserApi = sandbox.window.DocumentLifecycleLogic;
  assert.ok(browserApi);
  assert.equal(Object.isFrozen(browserApi), true);
  assert.deepEqual([...browserApi.DOCUMENT_KINDS], EXPECTED_KINDS);
  assert.deepEqual({ ...browserApi.DOCUMENT_STATUS_LABELS }, EXPECTED_LABELS);
  assert.deepEqual(
    [...browserApi.availableDocumentActions("substitute_receipt", "approved", { receiptType: "stock_purchase" })],
    ["receive_stock", "complete", "cancel"],
  );
  assert.equal(browserApi.assertDocumentTransition("expense_request", "submitted", "approved"), undefined);
});

test("loads the real source as the CommonJS frozen API", () => {
  assert.equal(require(sourcePath), lifecycle);
  assert.equal(Object.isFrozen(lifecycle), true);
  assert.equal(typeof lifecycle.normalizeDocumentStatus, "function");
  assert.equal(typeof lifecycle.assertDocumentTransition, "function");
  assert.equal(typeof lifecycle.availableDocumentActions, "function");
});
