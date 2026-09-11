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

Do not decide these yourself. Rows marked **DECIDED** or **DEFERRED** are settled by the owner (2026-09-11). **Every other row is only a recommendation — confirm it with the owner before implementing it.**

| # | Question | Recommendation | Why |
|---|---|---|---|
| **D-A** | Shape of the lifecycle | **One canonical transition table in one pure module**, with each kind declaring which states it uses plus kind-specific extensions (`received`, `voided` for substitute receipts) | One place to reason about and test; new document types declare instead of re-implementing |
| **D-B** | Must the five lightweight kinds pass approval before `completed`? | **DECIDED (owner): all five kinds require approval** — `draft → pending_approval → approved → completed`, no shortcut from `draft` to `completed` | Parity with the other two families; closes one-person payment authorisation |
| **D-C** | Change `expense_request`'s lifecycle to match the others? | **DECIDED (owner): C3 — full alignment.** Spec in §3.2, work in T4.3a | Highest-risk option, chosen by the owner for consistency across all document types |
| **D-D** | Add `cancel` (and `void` for substitute receipts after `received`) actions? | **Yes, cancel from every pre-completion state on all kinds; void only where declared** | Declared states must have actions |
| **D-E** | Approver identity without authentication | **DEFERRED (owner): handle together with authentication later.** Do not add approver-name requirements in step 4; leave `approvedBy` handling as it is | Real segregation of duties needs auth |
| **D-F** | Keep the D12 `receiptType` lock inside workflows? (It is the one deliberate standalone/workflow difference) | **Keep** | It prevents a real stock purchase from completing at `approved` and skipping stock receiving |
| **D-G** | One generic form for the five kinds, or a dedicated form per kind? | **Defer; keep the generic form** | Separate, larger decision |
| **D-H** | Fix Drive re-sync duplicating files? (`uploadFolderToGoogleDrive` reuses folders via `ensureDrivePath` but calls `uploadFileToDrive` for every file on every sync) | Optional; small, can ride along | Pre-existing; affects every sync button |
| **D-J** | Align substitute-receipt drafts too — draft as a status on the numbered `SR-` record instead of the separate `SR-DRAFT-…` store? | **DECIDED (owner): yes, in the same step.** Spec in §3.3, work in T4.3b | Without it, C3 itself would create a new divergence |

### 3.1 Expense request flow today — context for D-C (verified at `58d517a`)

1. **บันทึกแบบร่าง** (`#saveDraft`) → a separate draft record under `drafts/YYYY/MM/DRAFT-YYYY-MM-<unique>/`. **No `REQ-` number yet.**
2. **บันทึกใบเบิกจ่าย** (`#submitRequest`) → allocates `REQ-YYYY-MM-NNNN`; status `submitted`, **labelled "บันทึกแล้ว"** even though it means "waiting for approval".
3. On the **list page** `/expense-requests`, button **"อนุมัติ"** (only while `submitted`) → `approved` "อนุมัติแล้ว". Approval also **writes the Google Sheets row** via `recordMonthlyExpense`; if that fails the button becomes "ลง Sheet อีกครั้ง".
4. On the list page, once approved and synced → `completed` "เสร็จสิ้น".
5. `cancelled` "ยกเลิก" is declared but has no action.

How it differs from the others: the waiting-for-approval state is labelled "บันทึกแล้ว" (the others say "รอตรวจอนุมัติ"); approval happens on the list page (substitute receipts approve on the form page); drafts are a separate un-numbered store (same as substitute receipts — lightweight drafts, by contrast, are numbered documents from their first save).

| Option | What changes | Risk |
|---|---|---|
| **C1** | Nothing. Map into the central table (`submitted` ≡ waiting for approval) and add `cancel` per D-D | None |
| **C2** | C1 + relabel `submitted` from "บันทึกแล้ว" to "รอตรวจอนุมัติ". Stored value stays `submitted`; no data migration | Very low; any test asserting the old label needs owner approval to change |
| **C3** ✅ **chosen by the owner** | Full alignment: make draft a status on the numbered record and rename stored `submitted` → `pending_approval` | Highest: migrate existing records, touch the approve/Sheets path of a flow in daily use |

Note for T4.2: lightweight drafts consume a document number at first save. With cancel added, an abandoned draft keeps its number as a `cancelled` record, which is auditable; do not change this without asking.

### 3.2 C3 — target expense request lifecycle (DECIDED)

Target: `draft → pending_approval → approved → completed`, plus `cancelled` — the same lifecycle as the lightweight kinds.

Facts verified against the owner's real data (read-only) and the code at `bc866c2`:
- The owner's install has exactly **one** expense request, `REQ-2026-09-0001`, whose payload has **no `status` field at all** and an empty `statusHistory`. Today `normalizeExpenseRequestStatus` treats a missing status as `submitted`. The migration must handle a missing status, not only a literal `submitted`.
- **Zero** expense drafts and **zero** substitute drafts exist under `drafts/` on the owner's install.
- The `/drafts` page only redirects to `/expense-requests?status=draft`; keep that URL working.
- The Google Sheets row (`buildExpenseRequestSheetEntry`) carries **no status**, so renaming the status does not change Sheets output. Approval must still write the row exactly as it does today.
- `documents.status` CHECK already allows `draft`, `submitted` and `pending_approval` (`forms/document-index.logic.js:51`), so C3 needs **no** index table rebuild. Keep `submitted` allowed for legacy history.

Required behaviour:
1. **Draft is a status on the numbered record.** "บันทึกแบบร่าง" creates or updates a `REQ-` record with `status: "draft"`; the `REQ-` number is allocated at first draft save through the existing atomic allocator. New expense drafts no longer go to the separate `drafts/` store.
2. **New submit action "ส่งตรวจอนุมัติ"**: `draft → pending_approval`. Approve is allowed only from `pending_approval`. Offer approve on the form page as well as keeping the list-page button, so the actions match the other kinds.
3. **Stored value renamed.** New records never store `submitted`. Existing records whose status is missing or `submitted` migrate to `pending_approval`.
4. **Never rewrite `statusHistory`.** Historical entries may say `submitted`; readers interpret legacy `submitted` as `pending_approval`. The migration appends one history entry recording the migration itself.
5. **Legacy `DRAFT-…` records** (none on the owner's install, but handle them): convert each into a numbered `draft` record, or keep them readable; state which, and report counts.
6. **Migration mechanics.** A separate idempotent script with a `--dry-run` mode that prints every change it would make; take a backup first (`scripts/backup.sh`); run it against a backup copy before live data; report each record before and after. Re-running it changes nothing. **Run it on the owner's live data only after the owner has seen the dry-run report.**
7. Labels: `draft` "แบบร่าง", `pending_approval` "รอตรวจอนุมัติ", `approved` "อนุมัติแล้ว", `completed` "เสร็จสิ้น", `cancelled` "ยกเลิก".
8. Inside a workflow, an expense request now also passes `draft → pending_approval → approved → completed`, and its relation fields (`transactionNo`, `workflowTemplateId`, `workflowStepId`) live on the numbered draft record from its first save.

Test impact, **approved by the owner through choosing C3**: roughly 29 existing references encode the old lifecycle — `"submitted"` (15, across `tests/document-index.logic.test.mjs`, `tests/document-index-consistency.test.mjs`, `tests/expense-request.logic.test.mjs`, `tests/local-server.logic.test.mjs`, `tests/document-numbering.test.mjs`, `tests/expense-requests.html.test.mjs`), "บันทึกแล้ว" (1, `tests/expense-request.logic.test.mjs`), and the separate draft store (`saveExpenseDraft` 8, `getExpenseDraft` 3, `listExpenseDrafts` 2, all in `tests/local-server.logic.test.mjs`). These **may** be updated to the new lifecycle; list every changed assertion in your report with before and after. Any assertion change **outside** the expense-request lifecycle still requires asking the owner.

### 3.3 D-J — substitute-receipt drafts become numbered records (DECIDED)

Verified on the owner's install (read-only) and in the code at `a85b567`:
- Drafts live in a separate un-numbered store: `createSubstituteReceiptDraftId` (`forms/local-server.logic.js:97`, ids `SR-DRAFT-YYYY-MM-<unique>`), `saveSubstituteReceiptDraft` (`:1142`), `getSubstituteReceiptDraft` (`:1086`), `findSubstituteReceiptDraftRecords` (`:1051`), `writeSubstituteReceiptDraftRecord` (`:1132`).
- `listSubstituteReceipts` merges those drafts into the list with `status: "draft"` and an edit link `/substitute-receipt?draftId=…`.
- The status values already match the target — `draft`, `pending_approval`, `approved`, `received`, `completed`, `cancelled`, `voided` (`SUBSTITUTE_RECEIPT_TRANSITIONS`). **No status rename is needed**; only where drafts are stored changes. This makes D-J lower risk than C3.
- The owner has **zero** substitute drafts. The owner's one submitted receipt, `SR-2026-09-0001` (`stock_purchase`), has **no `status` field**, like the expense request.

Required behaviour:
1. "บันทึกแบบร่าง" creates or updates a numbered `SR-` record with `status: "draft"`; the `SR-` number is allocated at first draft save through the atomic allocator. The separate `SR-DRAFT-…` store is no longer written.
2. Submitting moves `draft → pending_approval` on the same record. Every existing transition in `SUBSTITUTE_RECEIPT_TRANSITIONS` keeps its meaning, including `pending_approval → draft`.
3. Stock-line locking (`assertStockLinesUnchanged`) and `receiveSubstituteReceiptStock` behave exactly as today.
4. A record with a missing status migrates to **whatever status the app reports for it today** — read what the current code shows for `SR-2026-09-0001`; do not guess — and it appears in the dry-run for the owner. Apply the same rule to the expense request in §3.2.
5. Legacy `?draftId=` links (both `/expense-request` and `/substitute-receipt` use them) either resolve to the migrated numbered record or show a Thai "not found" message — never an error page.
6. Because a numbered draft carries `transactionNo`, `workflowTemplateId` and `workflowStepId` from its first save, the D12 `receiptType` lock re-applies from the stored record when the draft is reopened from its list link. This closes the T4.7 re-lock item.
7. Same migration mechanics as §3.2 item 6 (it can be the same script): idempotent, `--dry-run`, backup first, backup copy before live, **live only after the owner has seen the dry-run**.

Test impact, **approved by the owner through D-J**: the separate substitute draft store appears in `tests/local-server.logic.test.mjs` (`saveSubstituteReceiptDraft` 6, `getSubstituteReceiptDraft` 3, `SR-DRAFT` 2), and `draftId` appears 30 times across `tests/expense-requests.html.test.mjs`, `tests/expense-request.html.test.mjs`, `tests/local-server.logic.test.mjs` and `tests/substitute-receipt.html.test.mjs` (shared with C3). These may be updated; list every changed assertion with before and after. Assertions about substitute-receipt **statuses, transitions, stock locking or receiving must not change.**

---

## 4. Work breakdown (assuming the recommended decisions)

Follow TDD in every task: failing test → confirm it fails for the right reason → implement → green → full suite → commit by path.

### T4.1 Central lifecycle module
- New pure module, e.g. `forms/document-lifecycle.logic.js` (CommonJS + `window` dual-export tail, **no top-level `require`**).
- Owns: canonical statuses, Thai labels, the transition table, per-kind state subsets and extensions, `assertDocumentTransition(kind, from, to)`, `availableDocumentActions(kind, status)`.
- Tests: the **full matrix** — every kind × every state × every target, accepted and rejected. (An early task on this branch asserted one row of a six-row table; five were silently wrong.) Include a `vm`-sandbox test proving the module loads as a classic script.

### T4.2 Lightweight kinds reach parity (standalone first)
- Server functions + routes: `POST /api/workflow-documents/:kind/:no/submit`, `/approve`, `/cancel`.
- Per D-B (decided): for **all five** kinds, `/complete` requires `approved`; `draft → completed` is no longer allowed.
- Server owns identifiers, paths, status, history and stamps (never trust client JSON — three Criticals on this branch came from that). Repeat calls are true no-ops that preserve the original stamp. Re-check the on-disk status immediately before the commit write (the existing `beforeCommit` pattern). Keep the SQLite index write-through.
- UI: `forms/workflow-document.html` + `forms/workflow-document.logic.browser.js` show only the buttons `availableDocumentActions` allows. The list page `forms/workflow-documents.html` already filters by these statuses.
- Tests: all five kinds, not one representative.

### T4.3 Retrofit the two older families onto the central module
- `substitute_receipt` guards call the central module; its **status values and transitions do not change** — only where drafts are stored (D-J), see T4.3b.
- `expense_request` moves to the new lifecycle per C3 — see T4.3a.
- Add `cancel` routes (and `void` for substitute receipts) per D-D.
- Do **not** modify `forms/expense-request.logic.js`, `forms/substitute-receipt.logic.js`, `forms/inventory.logic.js`, or `createPurchaseInMovement()` beyond what the retrofit strictly requires; prefer putting enforcement in `forms/local-server.logic.js`. If you believe one of these must change, ask first.

### T4.3a Expense request lifecycle migration (C3)
- Implement §3.2 in full, in its own commit(s) separate from T4.2, so it can be reviewed and reverted on its own.
- Order: central module (T4.1) → migration script with `--dry-run` → dry-run against a backup copy, report to the owner → routes and UI → live migration only after the owner has seen the dry-run.
- Prove: approval still writes the same Sheets row; a workflow containing an expense request (e.g. `director_expense_transfer`) still completes end to end; the `/drafts` redirect still lands on the draft list.

### T4.3b Substitute-receipt draft migration (D-J)
- Implement §3.3 in its own commit(s), after T4.3a, so both families share one migration script and one pattern.
- Prove: a `stock_purchase` receipt still locks its stock lines and receives stock exactly as before; a `general_expense` receipt inside a workflow still completes its step at `approved`; the D12 lock re-applies when a workflow-linked draft is reopened from the list.

### T4.4 Workflow integration
- `deriveChildWorkflowStatus` semantics unchanged; lightweight documents now reach `completed` only via `approved → completed`.
- Confirm strict order, `start-document`, prefill and packet PDF are unaffected.
- **Add an end-to-end HTTP test that drives a shipped template to `completed` including the new approve steps** (e.g. `stock_no_tax_invoice_company_bank`: PO → SR → PV → GR). The worst bug found on this branch was a template that could never finish while every test was green because tests used a synthetic one-step template.

### T4.5 Index migration (only if new status values are introduced)
- Rebuild the `documents` table to update the CHECK constraint, using the existing migration mechanism (`forms/inventory-db.logic.js`, `forms/document-index.logic.js`). Must be safe on the live database; verify against a backup copy first and report row counts before/after.

### T4.6 Approver identity — DEFERRED (D-E)
- Out of scope for step 4. The owner will address approver identity together with authentication. Do not change how `approvedBy` is captured; the known issue that the substitute-receipt UI posts `approvedBy: ""` stays as is for now.

### T4.7 Small leftovers
- Link from `forms/workflow-document.html` back to its list page `/workflow-documents?documentKind=...`.
- ~~Reopening a workflow-linked substitute-receipt draft from its list link does not re-lock `receiptType`~~ — resolved by T4.3b (numbered drafts carry their workflow relation fields; re-lock from the stored record).
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
- Substitute receipts keep their statuses and transitions, now routed through the central module, with cancel and void added; their drafts are numbered `SR-` records (D-J), and the owner's `SR-2026-09-0001` is handled as shown in the dry-run the owner reviewed.
- Expense requests follow the C3 lifecycle (§3.2); the owner's `REQ-2026-09-0001` is migrated as shown in the dry-run the owner reviewed.
- A shipped template completes end to end over HTTP including approvals.
- Full suite green with more tests than the 511 + 19 baseline; no existing assertion rewritten without the owner's approval.
- Commits staged by path, pushed; PR target decided by the owner.
