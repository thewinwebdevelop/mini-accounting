# Step 4 Handoff — Unified Document Lifecycle (Approval + Central State Machine)

Audience: an implementing agent (Codex) picking this up cold. Everything you need is in this file.
Author: PM/orchestrator of the workflow MVP, 2026-09-11.

---

## 0. Read first — where and how to work

| Item | Value |
|---|---|
| Repo | `https://github.com/thewinwebdevelop/mini-accounting` |
| **Base branch** | `claude/fixed-accounting-workflows-c59bfb` @ **`58d517a`** (pushed; PR #1 open against `main`) |
| **Do NOT use** | `.worktrees/fixed-accounting-workflows` / branch `codex/fixed-accounting-workflows` — it is stale at `78e9a5b`, 30+ commits behind. Branch fresh from `origin/claude/fixed-accounting-workflows-c59bfb`. |
| Node (tests) | `/Users/tar/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node` (system node is v16 and cannot run `node --test`) |
| Python | `/Users/tar/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3` |
| Full suite | `./scripts/test.sh` — baseline **511 Node + 19 Python, all passing** |
| Backup before touching real data | `SWEET_HOUSE_ROOT_DIR="/Users/tar/Documents/หจกสวีทเฮาส์" ./scripts/backup.sh` → `~/sweet-house-backups/` |
| Server | binds `127.0.0.1` by default; `SWEET_HOUSE_ALLOW_NETWORK=1` opts into all interfaces |

Working rules (each one was learned the hard way on this branch):
- Stage commits **by explicit path**. Never `git add -A` / `git add .`.
- **Never `git stash`** — the stash stack is shared across worktrees and sessions. Use a WIP commit to prove a test fails against old code.
- **No npm dependencies.** Node built-ins only (`node:sqlite`, `node:test`, `node:vm`).
- All user-facing strings are **Thai**, matching existing wording.
- **Do not rewrite an existing assertion to make it pass.** If one genuinely encodes old wrong behaviour, stop and ask the owner.
- Browser modules are classic `<script>`s: no top-level `require`, no ESM `import`, attach to `window`. Script order matters.

---

## 1. The owner's principles (binding)

1. A **workflow template** is an ordered list of document kinds. Starting one creates a transaction `TXN-YYYY-MM-0001`; documents are produced **in strict order** (a step after the first incomplete step is `blocked`, enforced server-side).
2. **Each document type has the same process and states whether used standalone or inside a workflow.** Same state ⇒ same actions. The workflow **reuses** the standalone document's own flow and actions; it never reimplements them. The only thing a workflow adds is the transaction id that binds the set.
3. The `completed` state exists on every kind precisely so the workflow can reuse it; reaching it through a `complete` action is fine.
4. **If a document type has no proper standalone flow, build the standalone flow first, then reuse it in the workflow.**

Earlier binding decisions still in force:
- **D2** `substitute_receipt` workflow completion is hybrid by `receiptType`: `stock_purchase` completes at native `received`; `general_expense` completes at native `approved`; an explicit `complete` action always works.
- **D5** strict document order, enforced server-side in `start-document`.
- **D6** the workflow layer **never writes a Google Sheets row** (child documents already write their own rows with real amounts; a workflow row would double-count). No `syncGoogleSheets` toggle anywhere.
- **D3** workflow Drive sync follows the template's `syncGoogleDrive` toggle (auto when on, manual button when off).
- **D9** repeat completion is a true no-op: preserve the original `completedAt` / `completedBy`, append no history, do not throw.
- **D12** a workflow template declares the `receiptType` for each `substitute_receipt` step; the form locks it under workflow context and the server rejects a mismatch.

---

## 2. The problem — current state, verified in code at `58d517a`

There are seven document kinds in three families, and **three different lifecycles**:

| Family | Kinds | Declared states | Actions that actually exist |
|---|---|---|---|
| Expense request | `expense_request` (`REQ-`) | `submitted → approved → completed`, `cancelled` | save draft (separate draft store, `saveExpenseDraft`, `forms/local-server.logic.js:1194`), submit, `POST /api/expense-requests/:no/approve`, `/complete`, `/sync-drive`. **No cancel.** |
| Substitute receipt | `substitute_receipt` (`SR-`) | `draft → pending_approval → approved → received → completed`, `cancelled`, `voided` (`SUBSTITUTE_RECEIPT_TRANSITIONS`, `forms/substitute-receipt.logic.js`) | save draft (separate draft store), submit = `POST /api/substitute-receipts` (sets `pending_approval`), `/approve`, `/receive-stock`, `/complete`, `/sync-drive`. **No cancel, no void.** |
| Lightweight (shared shell) | `purchase_order` (`PO-`), `payment_voucher` (`PV-`), `cash_spend_declaration` (`CSD-`), `payee_acknowledgement` (`PAR-`), `goods_receipt` (`GR-`) | `draft`, `pending_approval`, `approved`, `completed`, `cancelled` (`WORKFLOW_DOCUMENT_STATUS_LABELS`, `forms/workflow-document.logic.js:17`) | save (`POST /api/workflow-documents`), `/complete`, `/sync-drive`. **No submit, no approve, no cancel.** |

Consequences:
- **Lightweight kinds violate "same state ⇒ same actions".** `pending_approval`, `approved` and `cancelled` are declared but unreachable. The only guard is "cannot complete from `cancelled`" (`assertWorkflowDocumentCompletable`, `forms/workflow-document.logic.js:30`), so a document goes **`draft → completed` in one click by one person** — including the **payment voucher**, which is the document that authorises paying money. Expense requests and substitute receipts require approval; these five do not.
- `cancelled` / `voided` are declared on the two older families but have no action either.
- Guards are implemented three different ways: a transition table (substitute receipt), ad-hoc `if` checks in `appendExpenseRequestStatus` (`forms/local-server.logic.js`), and a single "uncompletable" set (lightweight). Adding more document types this way (the destination is a full accounting system with dozens of types) multiplies the divergence.
- **Approvals record no approver.** The substitute-receipt UI posts `approvedBy: ""` (`forms/substitute-receipt.logic.browser.js:540`). There is no authentication in the app.

Workflow coupling you must preserve — `deriveChildWorkflowStatus` in `forms/workflow.logic.js`:
```
native completed                           -> workflow completed
substitute_receipt + stock_purchase + received  -> completed
substitute_receipt + general_expense + approved -> completed
anything else                              -> in_progress
```

Index coupling — `documents.status` has a **CHECK constraint** built from `DOCUMENT_STATUSES` (`forms/document-index.logic.js:51`, used at `:93`). Any **new** status value needs a schema migration (SQLite cannot alter a CHECK in place; rebuild the table). The index is rebuilt from disk at startup, and disk is the source of truth.

---

## 3. Decisions the owner must make BEFORE implementation

Do not decide these yourself. Each has a recommendation; confirm with the owner.

| # | Question | Recommendation | Why |
|---|---|---|---|
| **D-A** | Shape of the lifecycle | **One canonical transition table in one pure module**, with each kind declaring which states it uses plus kind-specific extensions (`received`, `voided` for substitute receipts) | One place to reason about and test; new document types declare instead of re-implementing |
| **D-B** | Must the five lightweight kinds pass approval before `completed`? | **Yes**: `draft → pending_approval → approved → completed`. At minimum for `payment_voucher` | Brings them to parity with the other two families; closes one-person payment authorisation |
| **D-C** | Change `expense_request`'s lifecycle to match (add `draft` / `pending_approval` as statuses)? | **No, not in step 4.** Map it into the canonical table as it is | In daily use; its drafts live in a separate store by design |
| **D-D** | Add `cancel` (and `void` for substitute receipts after `received`) actions? | **Yes, cancel from every pre-completion state on all kinds; void only where declared** | Declared states must have actions |
| **D-E** | Approver identity without authentication | **Require a non-empty approver name** on approve and cancel, recorded in `statusHistory` | Real segregation of duties needs auth, which is deliberately out of scope |
| **D-F** | Keep the D12 `receiptType` lock inside workflows? (It is the one deliberate standalone/workflow difference) | **Keep** | It prevents a real stock purchase from completing at `approved` and skipping stock receiving |
| **D-G** | One generic form for the five kinds, or a dedicated form per kind? | **Defer; keep the generic form** | Separate, larger decision |
| **D-H** | Fix Drive re-sync duplicating files? (`uploadFolderToGoogleDrive` reuses folders via `ensureDrivePath` but calls `uploadFileToDrive` for every file on every sync) | Optional; small, can ride along | Pre-existing; affects every sync button |

---

## 4. Work breakdown (assuming the recommended decisions)

Follow TDD in every task: failing test → confirm it fails for the right reason → implement → green → full suite → commit by path.

### T4.1 Central lifecycle module
- New pure module, e.g. `forms/document-lifecycle.logic.js` (CommonJS + `window` dual-export tail, **no top-level `require`**).
- Owns: canonical statuses, Thai labels, the transition table, per-kind state subsets and extensions, `assertDocumentTransition(kind, from, to)`, `availableDocumentActions(kind, status)`.
- Tests: the **full matrix** — every kind × every state × every target, accepted and rejected. (An early task on this branch asserted one row of a six-row table; five were silently wrong.) Include a `vm`-sandbox test proving the module loads as a classic script.

### T4.2 Lightweight kinds reach parity (standalone first)
- Server functions + routes: `POST /api/workflow-documents/:kind/:no/submit`, `/approve`, `/cancel`.
- Per D-B, `/complete` requires `approved`.
- Server owns identifiers, paths, status, history and stamps (never trust client JSON — three Criticals on this branch came from that). Repeat calls are true no-ops that preserve the original stamp. Re-check the on-disk status immediately before the commit write (the existing `beforeCommit` pattern). Keep the SQLite index write-through.
- UI: `forms/workflow-document.html` + `forms/workflow-document.logic.browser.js` show only the buttons `availableDocumentActions` allows. The list page `forms/workflow-documents.html` already filters by these statuses.
- Tests: all five kinds, not one representative.

### T4.3 Retrofit the two older families onto the central module
- `substitute_receipt` and `expense_request` guards call the central module. **Behaviour must not change** — their existing tests must pass unchanged.
- Add `cancel` routes (and `void` for substitute receipts) per D-D.
- Do **not** modify `forms/expense-request.logic.js`, `forms/substitute-receipt.logic.js`, `forms/inventory.logic.js`, or `createPurchaseInMovement()` beyond what the retrofit strictly requires; prefer putting enforcement in `forms/local-server.logic.js`. If you believe one of these must change, ask first.

### T4.4 Workflow integration
- `deriveChildWorkflowStatus` semantics unchanged; lightweight documents now reach `completed` only via `approved → completed`.
- Confirm strict order, `start-document`, prefill and packet PDF are unaffected.
- **Add an end-to-end HTTP test that drives a shipped template to `completed` including the new approve steps** (e.g. `stock_no_tax_invoice_company_bank`: PO → SR → PV → GR). The worst bug found on this branch was a template that could never finish while every test was green because tests used a synthetic one-step template.

### T4.5 Index migration (only if new status values are introduced)
- Rebuild the `documents` table to update the CHECK constraint, using the existing migration mechanism (`forms/inventory-db.logic.js`, `forms/document-index.logic.js`). Must be safe on the live database; verify against a backup copy first and report row counts before/after.

### T4.6 Approver identity (D-E)
- Approve and cancel require a non-empty actor name, recorded in `statusHistory`; fix the substitute-receipt UI that currently posts `approvedBy: ""`.

### T4.7 Small leftovers
- Link from `forms/workflow-document.html` back to its list page `/workflow-documents?documentKind=...`.
- Reopening a workflow-linked substitute-receipt draft from its list link does not visually re-lock `receiptType` (the server still enforces it).
- Optional D-H: make Drive re-sync skip files already uploaded.

---

## 5. Guards that must not be weakened

- Path containment on every file route (`assertPathWithinDirectory`, the `getExpenseRequestFile` pattern).
- Server-owned identifiers, folder paths, status, history and audit stamps; client JSON is never trusted for these.
- Uploaded file names sanitised; write-side containment in `saveWorkflowDocument`.
- `returnTo` validated through `sanitizeWorkflowReturnTo()`.
- Strict workflow order (`deriveWorkflowProgress` + `start-document` refusal).
- Idempotent completion / receive (preserve original stamps).
- `beforeCommit` race re-checks.
- Atomic document numbering via `document_number_allocations` `UNIQUE(document_kind, accounting_month, sequence)`.
- D12 `receiptType` enforcement.
- No `absolutePath` / `absoluteFolderPath` in responses.
- Loopback binding by default.
- No Google Sheets write in the workflow layer.

---

## 6. Testing rules and lessons from review

- Test **every member** of every set (kinds, states, transitions, prefixes).
- Page tests must execute the real browser modules against the real HTML: use `tests/support/fake-dom.mjs` (it parses the actual HTML) inside a `vm` sandbox. String-matching source let five broken pages ship green.
- Stub the Drive uploader; tests must never hit the network.
- Bind test servers to port 0.
- Think about retries, double submits, and out-of-order calls for every new action.

---

## 7. Browser verification (required before claiming done)

Start the server (`PORT` free, loopback), then for a lightweight document: save → submit → approve (with a name) → complete, and separately save → cancel; confirm only the allowed buttons show at each state and the console is clean. Then drive `stock_no_tax_invoice_company_bank` end to end through `/workflow-transactions` including the approve steps, and confirm the checklist unlocks in order and the packet PDF lists every document. Report what you observed.

---

## 8. Definition of done

- Every declared state on every kind is reachable through an action, and every action is guarded by the central module.
- The five lightweight kinds require approval before completion (per D-B) and can be cancelled.
- The two older families behave exactly as before, now routed through the central module, with cancel (and void) added.
- A shipped template completes end to end over HTTP including approvals.
- Full suite green with more tests than the 511 + 19 baseline; no existing assertion rewritten without the owner's approval.
- Commits staged by path, pushed; PR target decided by the owner.
