# LINE Resource Authorization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce role and resource authorization for LINE-authenticated document workflows while preserving disabled-mode compatibility.

**Architecture:** Keep authentication in `local-server.mjs`, centralize policy decisions in a pure authorization module, and pass only server-derived actor/owner fields into existing local persistence builders. Legacy unowned records remain readable/mutable only to privileged roles until the Supabase data adapter supplies an ownership migration.

**Tech Stack:** Node.js built-ins, existing local JSON/filesystem workflows, `node:test`, LINE signed session context.

**Spec:** `docs/superpowers/specs/2026-09-25-line-resource-authorization-design.md`

## Global Constraints

- `SWEET_HOUSE_AUTH_MODE=disabled` preserves existing local behavior.
- In `line` mode, the browser cannot choose audit actors or ownership.
- Employees can only mutate/read owned documents; missing owner is treated as legacy and denied to employees.
- Owner/accounting/admin retain privileged access for operations and migration.
- Existing document numbers, statuses, PDFs, Drive/Sheets behavior, and local tests remain compatible.

## Review Focus

- A client posts another user's `approvedBy`/`ownerUserId`; the server must ignore it.
- An employee requests a legacy unowned file; the server must deny without confirming resource existence.
- An employee edits a document after changing the request body's owner field; the stored owner must win.
- An owner/accounting user acts on an employee-owned document; the action should succeed according to the policy.
- Disabled mode must not require a fake session or change existing tests.

---

### Task 1: Central authorization policy

**Files:**
- Create: `forms/authorization.logic.js`
- Create: `tests/authorization.logic.test.mjs`

**Interfaces:**
- Produces `assertPermission(auth, action)`, `assertDocumentAccess(auth, document, action)`, `actorLabel(auth)`, and stable error codes.

- [ ] **Step 1: Write failing policy tests**

Test the role matrix, employee owner access, employee legacy denial, privileged legacy access, and cross-user denial.

- [ ] **Step 2: Run tests and verify missing-module failure**

```bash
/Users/tar/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/authorization.logic.test.mjs
```

Expected: FAIL because the policy module does not exist.

- [ ] **Step 3: Implement the pure policy**

Normalize only the known roles. Throw `AUTH_FORBIDDEN` with a safe message for insufficient role/ownership. Treat `ownerUserId` as the authoritative resource field; do not infer ownership from display names.

- [ ] **Step 4: Run focused tests and commit**

```bash
/Users/tar/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/authorization.logic.test.mjs
git add forms/authorization.logic.js tests/authorization.logic.test.mjs
git commit -m "feat: add centralized resource authorization policy"
```

### Task 2: Bind owners and server-owned actors

**Files:**
- Modify: `forms/expense-request.logic.js`
- Modify: `forms/substitute-receipt.logic.js`
- Modify: `forms/workflow-document.logic.js`
- Modify: `local-server.mjs`
- Modify: `forms/local-server.logic.js`
- Modify: `tests/line-auth-api.test.mjs`
- Modify: existing document logic tests as needed

**Interfaces:**
- Consumes `assertDocumentAccess` and `actorLabel` from Task 1.
- Produces payload field `ownerUserId` for new records and preserves it on edits.

- [ ] **Step 1: Write failing HTTP/persistence tests**

Cover an authenticated employee creating a document with a forged owner/audit body, then verify stored `ownerUserId` and `submittedBy`/audit fields come from the session. Cover edits that attempt to change ownership.

- [ ] **Step 2: Run focused tests and verify failures**

Run the new auth API and document logic tests; expect owner fields to be absent or client-controlled before implementation.

- [ ] **Step 3: Add owner fields and authoritative server merge**

Include `ownerUserId` in the three payload builders. For a new record, inject `request.auth.userId`; for an edit, reload and preserve the stored owner. Replace client actor values with `actorLabel(request.auth)` in line mode. Keep request-body actor values in disabled mode for existing compatibility tests.

- [ ] **Step 4: Run focused tests and commit**

```bash
/Users/tar/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/authorization.logic.test.mjs tests/line-auth-api.test.mjs tests/expense-request.logic.test.mjs tests/substitute-receipt.logic.test.mjs tests/workflow-document.logic.test.mjs
git add local-server.mjs forms/local-server.logic.js forms/expense-request.logic.js forms/substitute-receipt.logic.js forms/workflow-document.logic.js tests
git commit -m "feat: bind documents to authenticated line users"
```

### Task 3: Enforce route/resource permissions and document-file access

**Files:**
- Modify: `local-server.mjs`
- Modify: `tests/line-auth-api.test.mjs`
- Modify: `docs/feature-checklist.md`
- Modify: `docs/supabase-migration-runbook.md`

**Interfaces:**
- Consumes the policy and owner fields from Tasks 1–2.
- Produces stable `403 AUTH_FORBIDDEN` behavior for unauthorized lifecycle/settings/file actions.

- [ ] **Step 1: Write failing route tests**

Test employee denial for approve/complete/receive-stock and unowned/cross-owner file reads; test privileged role success and disabled-mode compatibility.

- [ ] **Step 2: Run tests to verify failures**

Run the focused HTTP suite and observe that current routes accept client-supplied actor fields or expose files without role checks.

- [ ] **Step 3: Add permission gate helpers and apply them to routes**

Require `document:approve` for approve routes, `document:complete` for complete routes, `stock:receive` for receive-stock, `accounting:sync` for Sheets sync, and `settings:manage` for company/template/user configuration. Before file reads and edits, load the record and call `assertDocumentAccess`. Return a generic forbidden response for denied employees.

- [ ] **Step 4: Run focused tests and the full suite**

```bash
/Users/tar/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/authorization.logic.test.mjs tests/line-auth-api.test.mjs
./scripts/test.sh
```

Expected: focused tests and the full suite pass with zero failures.

- [ ] **Step 5: Commit**

```bash
git add local-server.mjs tests/line-auth-api.test.mjs docs/feature-checklist.md docs/supabase-migration-runbook.md
git commit -m "feat: enforce line resource permissions"
```
