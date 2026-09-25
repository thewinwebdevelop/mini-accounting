import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  ACTIONS,
  actorLabel,
  assertDocumentAccess,
  assertPermission,
} = require("../forms/authorization.logic.js");

const roles = ["owner", "accounting", "admin"];

test("assertPermission enforces the approval, accounting, and settings role matrix", () => {
  assertPermission({ role: "employee" }, ACTIONS.DOCUMENT_CREATE);
  assertPermission({ role: "employee" }, ACTIONS.DOCUMENT_SUBMIT);
  assert.throws(() => assertPermission({ role: "employee" }, ACTIONS.DOCUMENT_APPROVE), error => error.code === "AUTH_FORBIDDEN");
  assert.throws(() => assertPermission({ role: "employee" }, ACTIONS.STOCK_RECEIVE), error => error.code === "AUTH_FORBIDDEN");
  assert.throws(() => assertPermission({ role: "employee" }, ACTIONS.ACCOUNTING_SYNC), error => error.code === "AUTH_FORBIDDEN");
  assert.throws(() => assertPermission({ role: "employee" }, ACTIONS.SETTINGS_MANAGE), error => error.code === "AUTH_FORBIDDEN");
  for (const role of roles) {
    assertPermission({ role }, ACTIONS.DOCUMENT_APPROVE);
    assertPermission({ role }, ACTIONS.DOCUMENT_COMPLETE);
    assertPermission({ role }, ACTIONS.STOCK_RECEIVE);
    assertPermission({ role }, ACTIONS.ACCOUNTING_SYNC);
  }
  assertPermission({ role: "owner" }, ACTIONS.SETTINGS_MANAGE);
  assertPermission({ role: "admin" }, ACTIONS.SETTINGS_MANAGE);
  assert.throws(() => assertPermission({ role: "accounting" }, ACTIONS.SETTINGS_MANAGE), error => error.code === "AUTH_FORBIDDEN");
});

test("employee document access requires the authenticated owner", () => {
  const auth = { userId: "user-1", role: "employee" };
  assertDocumentAccess(auth, { ownerUserId: "user-1" }, ACTIONS.DOCUMENT_READ);
  assertDocumentAccess(auth, { ownerUserId: "user-1" }, ACTIONS.DOCUMENT_EDIT);
  assert.throws(() => assertDocumentAccess(auth, { ownerUserId: "user-2" }, ACTIONS.DOCUMENT_READ), error => error.code === "AUTH_FORBIDDEN");
  assert.throws(() => assertDocumentAccess(auth, {}, ACTIONS.DOCUMENT_READ), error => error.code === "AUTH_FORBIDDEN");
});

test("privileged roles can access owned and legacy documents", () => {
  for (const role of roles) {
    assertDocumentAccess({ userId: "user-1", role }, {}, ACTIONS.DOCUMENT_READ);
    assertDocumentAccess({ userId: "user-1", role }, { ownerUserId: "user-2" }, ACTIONS.DOCUMENT_EDIT);
  }
});

test("authorization rejects unknown roles and actor labels never fall back to client input", () => {
  assert.throws(() => assertPermission({ role: "manager" }, ACTIONS.DOCUMENT_READ), error => error.code === "AUTH_FORBIDDEN");
  assert.equal(actorLabel({ displayName: "  ผู้อนุมัติ  ", lineUserId: "U1" }), "ผู้อนุมัติ");
  assert.equal(actorLabel({ displayName: "", lineUserId: "U1" }), "U1");
  assert.equal(actorLabel({}), "ผู้ใช้ LINE");
});
