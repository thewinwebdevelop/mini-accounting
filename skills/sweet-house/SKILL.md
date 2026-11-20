---
name: sweet-house
description: Use when the user asks for Sweet House accounting shortcuts, เมนูสวีทเฮาส์, or invoice import, continuation, and status actions for the Sweet House document system. Not for unrelated accounting apps or software development.
---

# Sweet House quick actions

This is a persistent chat entrypoint for the user's Sweet House system. Respond in Thai. Show choices promptly; showing a menu does not call APIs or create documents.

## Entry and selection

When invoked without a specific action, or with `เมนูสวีทเฮาส์` / `เมนูลัดสวีทเฮาส์`, show exactly this compact menu:

1. **สร้างเอกสารจากใบกำกับภาษี** — แนบรูป/PDF ให้ช่วยอ่านและเตรียมตรวจข้อมูล
2. **ทำ workflow ที่ค้างต่อ** — เปิดรายการเดิมและทำต่อจากจุดที่ค้าง
3. **ตรวจสถานะเอกสาร / workflow** — ดูความคืบหน้าและขั้นตอนถัดไป
4. **เปิดระบบสวีทเฮาส์** — เปิดเว็บเพื่อล็อกอินหรือทำงานเอง

Then say: `ตอบหมายเลขหรือบอกชื่องาน พร้อมแนบไฟล์หรือเลขรายการได้เลย`.

When `request_user_input_async` is available, it can present a choice prompt for the user's next action using those four action names. Use it only to choose the task; attachments must be sent in the chat, and sign-in happens on the website. When a choice-prompt tool is unavailable, the numbered menu remains usable. Do not claim a text menu is a native permanent button row.

A number selects only the latest Sweet House action menu visible in this chat. A new chat has no remembered numeric selection: if given only `2` without a menu, display the menu first. If the user already supplies an action, invoice, URL, or document ID, act on that request without repeating the menu or discarding attachments. Do not treat workflow choice numbers from the app as action-menu numbers.

## Action routing

- **1 — Import:** Read the current project's `docs/invoice-cowork.md` if present. Otherwise read [invoice import reference](references/invoice-import.md), bundled for sessions outside the source checkout. Extract attached originals into JSON; use the authenticated import page/API and return the persisted review URL. If no invoice is attached, request the file. Fetch active workflows from the user's authenticated system before offering them; never invent the catalog. Do not auto-confirm on menu selection alone: automatic versus manual completion is a separate business choice for the specific invoice.
- **2 — Continue:** Use the given batch/transaction URL or ID. If absent, list accessible current workflows using the signed-in browser/API, or ask for a URL/ID if access is unavailable. Inspect current state, pinned mode and checkpoints before resuming an already-confirmed paused batch. Never create a second import/transaction as a retry. Honor an already-authorized request to resume; do not ask for the same approval again.
- **3 — Status:** Read the identified workflow/document, report its current status, next step and link. If no ID or session is available, ask only for the missing information. This action does not submit, approve, complete, receive stock or resume work.
- **4 — Open:** Provide [ระบบสวีทเฮาส์](https://sweet-house-znczpe4qoq-as.a.run.app/) and [หน้านำเข้าใบกำกับภาษี](https://sweet-house-znczpe4qoq-as.a.run.app/assistant-invoice-import). Open the user's requested page with an available browser tool when appropriate.

## Session and scope

Use a browser/session that the user has actually logged into via LINE. An installed skill does not grant API access or transfer login between browsers/chats. If access is missing, provide the sign-in link and explain what remains; never request passwords, cookies, LINE tokens or the server's signing secret in chat. Do not forge sessions, bypass auth or use production documents as test data.

For repository work, read applicable `AGENTS.md` and `agent.md`; read current source and production records rather than treating this skill as proof of a deployment. Do not run deployments, change templates, or perform other unrelated work merely because the menu was opened.

This skill supplies a selectable capability and a text menu. Do not claim it adds permanent LINE-style buttons or automatically sends a greeting into an empty new chat.
