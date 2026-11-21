# Project instructions

Read [agent.md](agent.md) for repository development and verification requirements.

When a user sends invoice images/PDFs to this chat and asks to create documents, import extracted data, or continue an invoice workflow, read [docs/invoice-cowork.md](docs/invoice-cowork.md) before acting. That file defines the chat-assisted workflow, import format, review boundary, and recovery procedure. It is project guidance; it does not grant permission to confirm financial documents or deploy software.

When the user invokes `$sweet-house`, asks for “เปิดเมนู” (including polite suffixes), “เมนู Sweet House”, “เมนูสวีทเฮาส์”, “เมนูสวีทเฮ้าท์” or “เมนูลัดสวีทเฮาส์”, or selects from that menu, read [skills/sweet-house/SKILL.md](skills/sweet-house/SKILL.md). It defines persistent chat shortcuts and keeps action-menu choices separate from workflow-template choices. When the non-blocking choice tool is available, opening this menu requires calling it; a text-only menu is the fallback when the tool is unavailable.
