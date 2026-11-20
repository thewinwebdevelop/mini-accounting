---
name: sweet-house
description: Use when the user says เปิดเมนู in the Sweet House project, asks for เมนู Sweet House, เมนูสวีทเฮาส์, เมนูสวีทเฮ้าท์, or Sweet House accounting shortcuts, or invoice import, continuation, and status actions for the Sweet House document system. Not for unrelated accounting apps or software development.
---

# Sweet House quick actions

This is a persistent chat entrypoint for the user's Sweet House system. Respond in Thai. Show choices promptly; showing a menu does not call APIs or create documents.

## Entry and selection

When invoked without a specific action, with `เปิดเมนู` in a Sweet House project/chat, or with `เมนู Sweet House`, `เมนูสวีทเฮาส์`, `เมนูสวีทเฮ้าท์`, or `เมนูลัดสวีทเฮาส์` (case/spacing variants included), present the following four actions using the rendering contract below:

1. **สร้างเอกสารจากใบกำกับภาษี** — แนบรูป/PDF ให้ช่วยอ่านและเตรียมตรวจข้อมูล
2. **ทำ workflow ที่ค้างต่อ** — เปิดรายการเดิมและทำต่อจากจุดที่ค้าง
3. **ตรวจสถานะเอกสาร / workflow** — ดูความคืบหน้าและขั้นตอนถัดไป
4. **เปิดระบบสวีทเฮาส์** — เปิดเว็บเพื่อล็อกอินหรือทำงานเอง

The short command `เปิดเมนู` means this action menu when Sweet House is the current project or established chat context. Accept normal whitespace and polite endings (e.g. `เปิดเมนูหน่อย`). It does not require `$sweet-house`. If the user names another app/menu, follow that request instead; do not hijack unrelated projects' menus.

### Rendering contract

If the current tools include `request_user_input_async`, **call that tool once to render the menu**. A numbered text response alone is not completion in that case. This is the user's choice of next task, not a request for permission.

Use exactly this argument object:

```json
{"questions":[{"title":"เมนูสวีทเฮาส์ — ต้องการทำงานอะไรต่อ?","options":["สร้างเอกสารจากใบกำกับภาษี","ทำ workflow ที่ค้างต่อ","ตรวจสถานะเอกสาร / workflow","เปิดระบบสวีทเฮาส์"]}]}
```

After the tool accepts, briefly say the selection menu is open. Avoid repeating a second full numbered menu. Do not immediately call the choice tool again or require an answer to finish opening the menu. Treat the eventual selected answer as the requested action. Files must be attached in chat and sign-in must happen on the website; the choice prompt only chooses the task.

If this tool is absent or explicitly fails, show the numbered text menu above and say that this chat cannot display the popup; the user may answer by number or task name. Do not claim a popup opened without an accepted tool result. Do not use Plan-only input tools outside Plan mode. Do not claim a skill installs permanent buttons into the app.

A number selects only the latest Sweet House action menu visible in this chat. A new chat has no remembered numeric selection: if given only `2` without a menu, display the menu first. If the user already supplies an action, invoice, URL, or document ID, act on that request without repeating the menu or discarding attachments. Do not treat workflow choice numbers from the app as action-menu numbers.

## Action routing

- **1 — Import:** Read the current project's `docs/invoice-cowork.md` if present. Otherwise read [invoice import reference](references/invoice-import.md), bundled for sessions outside the source checkout. For attached bill images/PDFs without a workflow already selected for that bill, read briefly, fetch the live active catalog and call `request_user_input_async` with numbered workflow names immediately, before asking about payer/payment/tax details. Follow the workflow-selection contract in the guide/reference; do not show the generic four-action menu in its place. Retain the chosen template for additional evidence on the same bill and do not ask again. Default handoff: produce and deliver one extraction `.json` file with `{fields,lines,warnings}` for the user to import on the website themselves, plus the chosen workflow name and import-page link. Include a single JSON code block if they want to copy the object. Explain that the current website selects a JSON file and original evidence separately; it does not paste JSON or auto-select a workflow from the file. Generating this file needs no logged-in browser/session. Do not open a login handoff or upload via API unless the user explicitly asks you to operate the website for them. If the live catalog is inaccessible, still deliver extraction JSON and let the user choose the workflow on the website; never invent catalog entries. If no invoice is attached, request the file. Fetch active workflows from the user's authenticated system before offering them; never invent the catalog. Do not auto-confirm on menu selection alone: automatic versus manual completion is a separate business choice for the specific invoice.
- **2 — Continue:** Use the given batch/transaction URL or ID. If absent, list accessible current workflows using the signed-in browser/API, or ask for a URL/ID if access is unavailable. Inspect current state, pinned mode and checkpoints before resuming an already-confirmed paused batch. Never create a second import/transaction as a retry. Honor an already-authorized request to resume; do not ask for the same approval again.
- **3 — Status:** Read the identified workflow/document, report its current status, next step and link. If no ID or session is available, ask only for the missing information. This action does not submit, approve, complete, receive stock or resume work.
- **4 — Open:** Provide [ระบบสวีทเฮาส์](https://sweet-house-znczpe4qoq-as.a.run.app/) and [หน้านำเข้าใบกำกับภาษี](https://sweet-house-znczpe4qoq-as.a.run.app/assistant-invoice-import). Open the user's requested page with an available browser tool when appropriate.

## Session and scope

Preparing/delivering extraction JSON requires no website session. Only when the user requests direct website/API operation, use a browser/session that the user has actually logged into via LINE. An installed skill does not grant API access or transfer login between browsers/chats. If access is missing, provide the sign-in link and explain what remains; never request passwords, cookies, LINE tokens or the server's signing secret in chat. Do not forge sessions, bypass auth or use production documents as test data.

For repository work, read applicable `AGENTS.md` and `agent.md`; read current source and production records rather than treating this skill as proof of a deployment. Do not run deployments, change templates, or perform other unrelated work merely because the menu was opened.

This skill supplies a selectable capability and an on-demand choice menu, with text fallback only when the popup tool is unavailable or fails. Do not claim it adds permanent LINE-style buttons or automatically sends a greeting into an empty new chat.
