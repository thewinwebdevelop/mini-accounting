# LINE Resource Authorization Design

## Goal

Make the LINE-authenticated app safe for multiple users by enforcing role-based actions, binding newly created documents to the authenticated app user, and protecting document mutations/files without breaking local compatibility mode.

## Scope

This phase includes:

- a centralized authorization policy module;
- role gates for approvals, completion, stock receiving, accounting sync, and settings/admin mutations;
- server-owned actor stamps from the signed LINE session, ignoring client-supplied `approvedBy`, `completedBy`, `receivedBy`, and similar fields in enforced mode;
- `ownerUserId` binding for new expense requests, substitute receipts, and lightweight workflow documents;
- owner-or-privileged checks for editing, lifecycle mutations, and direct document-file reads;
- conservative treatment of legacy documents with no owner: employees cannot mutate or open their files, while owner/accounting/admin retain access for migration and operations.

It does not yet filter every list query through Supabase, migrate ownership to existing cloud rows, or replace local persistence. Those belong to the data-adapter/cutover phase.

## Policy

Roles are `employee`, `owner`, `accounting`, and `admin`.

| Action | Employee | Owner | Accounting | Admin |
|---|---:|---:|---:|---:|
| create/submit own document | yes | yes | yes | yes |
| edit own draft | yes | yes | yes | yes |
| approve/complete | no | yes | yes | yes |
| receive stock | no | yes | yes | yes |
| sync accounting outputs | no | yes | yes | yes |
| manage company/templates/users | no | yes | no | yes |

An employee may access a document only when `ownerUserId` equals the session `userId`. A missing owner is legacy/unowned and is denied to employees. Privileged roles may access legacy and owned documents.

## Integration

The existing `requireAuthenticatedRequest` remains the authentication gate. A new `requirePermission` helper runs after route matching and returns stable `403 AUTH_FORBIDDEN` errors. Handlers derive audit actors from `request.auth.displayName`/`lineUserId`, never from request JSON. In disabled mode all existing route behavior remains unchanged and tests continue to run without auth fixtures.

## Failure handling

- Missing or malformed session context in enforced mode returns `401 AUTH_REQUIRED` through the existing gate.
- Insufficient role or ownership returns `403 AUTH_FORBIDDEN` without revealing whether an employee's requested document exists.
- Client-supplied audit identity is ignored in line mode.
- Legacy unowned records are not silently assigned to the first user who opens them.

## Testing and success criteria

Tests cover policy matrix, owner/legacy decisions, actor stamping, employee denial of approval/file access, privileged access, and disabled-mode compatibility. A real LINE session can create and edit its own draft, but cannot approve another user's document or read another user's file.
