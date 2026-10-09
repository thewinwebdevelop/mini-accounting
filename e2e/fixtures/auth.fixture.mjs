import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { signSession, SESSION_COOKIE_NAME } = require("../../forms/session.logic.js");

export const SESSION_NAME = SESSION_COOKIE_NAME;
export const PERSONAS = Object.freeze({
  employeeA: { userId: "employee-a", role: "employee", ownerUserId: "employee-a", displayName: "Employee A" },
  employeeB: { userId: "employee-b", role: "employee", ownerUserId: "employee-b", displayName: "Employee B" },
  owner: { userId: "owner-1", role: "owner", ownerUserId: "owner-1", displayName: "Owner" },
  accounting: { userId: "accounting-1", role: "accounting", ownerUserId: "accounting-1", displayName: "Accounting" },
  admin: { userId: "admin-1", role: "admin", ownerUserId: "admin-1", displayName: "Admin" },
  pending: { userId: "pending-1", role: "employee", ownerUserId: "pending-1", displayName: "Pending" },
  inactive: { userId: "inactive-1", role: "employee", ownerUserId: "inactive-1", displayName: "Inactive" },
});

export function createTestSession({ userId, role, ownerUserId = userId, secret, now = () => Math.floor(Date.now() / 1000), displayName = "E2E User" }) {
  const timestamp = typeof now === "function" ? now() : Number(now);
  return signSession({ userId, role, ownerUserId, displayName, exp: timestamp + 3600 }, secret);
}

export function sessionCookie(token) {
  return { name: SESSION_NAME, value: token };
}
