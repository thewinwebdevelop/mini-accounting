# LINE invoice to existing workflow

## Intent and agreed behavior

Users select an existing workflow in LINE OA, send invoice images/PDFs and supporting evidence, review and edit extracted data in a separate authenticated form, then choose one of two actions:

- **ยืนยันและทำทุกขั้นตอนอัตโนมัติ**: create documents, fill them, execute native lifecycle actions and complete each step sequentially before proceeding to the next.
- **ยืนยันและดำเนินการเอง**: create the transaction and its first draft document with confirmed data. Users perform native signing/approval/completion themselves. When later steps unlock, their forms are prefilled from the confirmed context; opening a form must not silently complete it.

Confirmation is before workflow creation. No additional review gate between automatic steps. Existing lifecycle requirements and actor permissions still apply. Failure pauses processing at the affected step and preserves earlier successful work.

## Approaches

1. Existing single-file intake to expense-request draft: already implemented, but cannot select arbitrary workflow or complete its steps.
2. Create every step as a draft immediately: previously proposed, superseded by the user's requirement to respect sequential unlocking.
3. Conversation intake plus reviewed shared data and sequential native workflow execution: agreed approach. Reuses templates, document functions, persistence and prefill; requires durable batch state and retry coordination.

## Existing integration points

- `local-server.mjs`: `handleLineWebhook`, `listRuntimeWorkflowTemplates`, `getRuntimeWorkflowTemplate`, `ensureLineIntakeScanned`, intake review/confirmation, document and workflow handlers.
- `forms/line-bot.logic.js`: content download and replies.
- `forms/line-intake.logic.js`: local/Supabase private evidence intake and OCR persistence.
- `forms/line-ocr.logic.js`: manual/HTTP OCR adapter; current schema is scalar fields only and must gain line items and provenance without breaking existing callers.
- `forms/workflow.logic.js`: template definitions and sequential progress; only native `completed` unlocks subsequent steps.
- `forms/workflow-prefill.logic.js`: canonical context and document-specific adapters.
- `forms/local-server.logic.js`: document creation, approval, receiving and completion functions. Expense requests require approval; stock substitute receipts require receiving before completion.
- `forms/line-intake.html` and browser controller: reuse authentication/layout patterns for the separate batch-review view; retain existing single-file intake behavior.

## Chat UX

Rich Menu entry sends a dedicated create-from-invoice command/postback. Fetch active runtime templates, restricted to the actor's allowed scope. Display names and numbered choices; quick replies carry server-validated template IDs and conversation revision. Numeric replies resolve against the exact displayed snapshot, never a newly sorted list. Page choices to stay within LINE's 13-button limit including navigation/cancel. Preserve text-number fallback.

After selection, accept multiple images/PDFs. Provide camera, camera-roll, finish and cancel actions; PDF uses normal chat attachment or the authenticated upload form. Acknowledge accepted file counts and resend relevant quick replies. A file outside a session retains the existing intake path and may offer to start a workflow without resending it. Explicit finish freezes the review revision; subsequent files require reopening review rather than changing an already confirmed operation.

Keep one active intake per LINE user/conversation/channel. Initial scope is direct OA chat; group messages must not share private selections or review links. Resume/cancel actions recover a pending batch. Template labels may be shortened on buttons, with full names in the message.

## Review form

Show source previews/downloads alongside editable seller identity, tax ID, invoice number/date, accounting month, line items, quantities, unit prices, VAT and totals. Add workflow-specific required inputs: purpose, requester/payee, stock SKU mapping, received quantities/date and other fields required by native validators. Preserve unknown values as missing, not inferred zero. Identify conflicting/missing values and their source file/page. Supporting payment evidence must not be counted as a second purchase.

Implementation choice: one primary invoice per transaction in the first version; multi-page invoice is supported, other files are evidence. Ask the user to designate the primary invoice when ambiguous; multiple independent invoices require separate transactions. Do not silently merge invoices.

Before either confirmation, validate the complete reviewed context. The automatic action shows the actual steps and any approval/stock-receiving effects it will perform under the authenticated actor. Permit it only where the actor has the relevant permissions and required evidence/inputs. Never synthesize another person's signature or assert their approval. Missing required external signatures block that step with an actionable link.

The manual action requires enough data for its first document; unresolved later-step inputs remain visibly pending. Store corrected data independently from OCR and use it as the authoritative baseline. Changes to an actual document take precedence over the baseline when filling later steps; do not overwrite existing edits on reload. Monetary calculations use existing deterministic money helpers.

## State, authorization and persistence

Persist batches, ordered template snapshots, evidence references, extracted context, corrected context, revision, selected mode, transaction identity, per-step document identity and action checkpoints. Proposed states: selecting, collecting, scanning, needs_review, ready, running, paused, manual, completed, cancelled. Manual-mode transaction progress remains governed by existing workflow state.

Use existing local/Supabase adapter conventions; Cloud Run state must be durable, with no memory-only jobs or detached promises. Add a durable job/lease mechanism for extraction/execution and an authenticated worker invocation plus recovery sweep. Concrete scheduler transport is an implementation decision, configured explicitly and tested with fake adapters. Persist queued work before acknowledging acceptance. Do not deploy or configure live cloud infrastructure as part of local implementation.

Verify LINE signatures, bind evidence and batch to authenticated LINE/app identity, and derive actor IDs server-side. A copied link or client-supplied owner/template ID grants no access. Unlinked users may collect files but must authenticate and obtain existing permissions before creating documents. Preserve existing authorization for local and cloud records, private file URLs and lifecycle actions.

Use stable idempotency keys for webhook events, confirmation revision, transaction, step documents and stock operations. Reject stale review revisions and conflicting mode changes. Atomic claims prevent concurrent confirmations/workers. Native mutations need recoverable identity before retry; after a crash, reconcile persisted document status, numbering and stock movements before repeating an action. Never claim exactly-once behavior merely from an in-memory lock. Template changes after review require a fresh review; confirmed jobs use the pinned snapshot.

## Execution

Reuse native services, not loopback HTTP or direct status-field writes. For each automatic step: create/recover linked document, fill reviewed data using existing adapters, attach appropriate evidence, perform the native required submit/approve/receive actions, complete, persist checkpoint and refresh workflow progress. Verify preceding completion before continuing. Record the real actor and per-action history. Document types with external signatures or unsupported lifecycle requirements must pause explicitly, not be silently skipped.

Do not equate completing a document with closing/locking the whole workflow transaction: retain the existing explicit transaction-close behavior. Report all document steps completed when applicable.

For manual mode create only the first eligible document. Integrate confirmed context into the existing next-step entry points so manual completion unlocks the next step and its form receives the reviewed data. Preserve document edits, native approval/signing controls and status rules.

Failures expose the affected step, completed steps and a resume/open-document action. Resume reconciles existing state before proceeding; no duplicated transaction, documents, attachments or stock movements. Final chat result links to the existing workflow detail; message delivery failure does not undo successful document processing.

## OCR and limits

Retain the existing 20 MiB/file default. Validate actual format and reject corrupt/encrypted/unsupported documents explicitly. Bound PDF processing and file counts with configured limits, displayed before intake; do not truncate silently. Preserve all pages or surface partial extraction as a review issue. HTTP OCR configuration is required for real automatic extraction; manual fallback is clearly labeled and does not pretend OCR succeeded. Provider credentials remain server-side. Provider integration must pass representative image and multi-page PDF fixtures before production claims.

## Verification and rollout

Follow `agent.md`: deterministic isolated E2E success/failure tests, no production writes. Cover Quick Reply and numeric selection, pagination/stale options, image and PDF evidence, multiple uploads, corrected OCR data and persisted reload, both modes, sequential blocking, native approval/receiving, denied actor/cross-user access, duplicate events/confirmations, crash/retry recovery, OCR failure and a failed later step resumed without duplicate stock/documents.

Browser E2E must reopen actual document URLs and assert identity, corrected fields, lines, status and evidence links for local nested payload and flattened Supabase responses. Run relevant existing LINE intake, workflow, prefill, document and stock regressions; report exact commands/results. Validate Quick Reply payloads against current LINE API constraints with fixtures.

Feature flag the new flow; keep legacy intake working. Live Rich Menu publication, provider credentials and production deployment are separate rollout actions. Existing untracked `data/`, `test-results/` and November 7 shop-billing documents are unrelated and must remain untouched.

## Status

Conversation behavior agreed on 2026-11-19. Independent builder check completed: nothing important left unanswered. Written design awaits user review; no implementation or runtime verification claimed.
