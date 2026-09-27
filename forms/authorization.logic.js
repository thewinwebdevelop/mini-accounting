const VALID_ROLES = new Set(["employee", "owner", "accounting", "admin"]);
const PRIVILEGED_ROLES = new Set(["owner", "accounting", "admin"]);

const ACTIONS = Object.freeze({
  DOCUMENT_CREATE: "document:create",
  DOCUMENT_READ: "document:read",
  DOCUMENT_EDIT: "document:edit",
  DOCUMENT_SUBMIT: "document:submit",
  DOCUMENT_APPROVE: "document:approve",
  DOCUMENT_REJECT: "document:reject",
  DOCUMENT_COMPLETE: "document:complete",
  STOCK_RECEIVE: "stock:receive",
  ACCOUNTING_SYNC: "accounting:sync",
  SETTINGS_MANAGE: "settings:manage",
});

const ROLE_PERMISSIONS = Object.freeze({
  employee: new Set([
    ACTIONS.DOCUMENT_CREATE,
    ACTIONS.DOCUMENT_READ,
    ACTIONS.DOCUMENT_EDIT,
    ACTIONS.DOCUMENT_SUBMIT,
  ]),
  owner: new Set(Object.values(ACTIONS)),
  accounting: new Set([
    ACTIONS.DOCUMENT_CREATE,
    ACTIONS.DOCUMENT_READ,
    ACTIONS.DOCUMENT_EDIT,
    ACTIONS.DOCUMENT_SUBMIT,
    ACTIONS.DOCUMENT_APPROVE,
    ACTIONS.DOCUMENT_REJECT,
    ACTIONS.DOCUMENT_COMPLETE,
    ACTIONS.STOCK_RECEIVE,
    ACTIONS.ACCOUNTING_SYNC,
  ]),
  admin: new Set(Object.values(ACTIONS)),
});

function forbidden(message = "ไม่มีสิทธิ์ดำเนินการ") {
  const error = new Error(message);
  error.code = "AUTH_FORBIDDEN";
  error.statusCode = 403;
  return error;
}

function normalizedRole(auth = {}) {
  const role = String(auth.role || "").trim().toLowerCase();
  if (!VALID_ROLES.has(role)) throw forbidden();
  return role;
}

function assertPermission(auth, action) {
  const role = normalizedRole(auth);
  if (!ROLE_PERMISSIONS[role].has(action)) throw forbidden();
  return true;
}

function assertDocumentAccess(auth, document = {}, action = ACTIONS.DOCUMENT_READ) {
  const role = normalizedRole(auth);
  assertPermission(auth, action);
  if (PRIVILEGED_ROLES.has(role)) return true;
  const ownerUserId = String(document.ownerUserId || "").trim();
  const userId = String(auth.userId || "").trim();
  if (ownerUserId && userId && ownerUserId === userId) return true;
  throw forbidden();
}

function actorLabel(auth = {}) {
  const displayName = String(auth.displayName || "").trim();
  if (displayName) return displayName;
  const lineUserId = String(auth.lineUserId || "").trim();
  return lineUserId || "ผู้ใช้ LINE";
}

module.exports = {
  ACTIONS,
  actorLabel,
  assertDocumentAccess,
  assertPermission,
};
