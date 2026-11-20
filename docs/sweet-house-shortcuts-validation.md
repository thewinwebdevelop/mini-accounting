# Sweet House chat shortcuts — 2026-11-20

## Installation

Source package: `skills/sweet-house/` in this repository. Installed user package: `~/.agents/skills/sweet-house/`. Root `AGENTS.md` routes the Thai menu command and `$sweet-house` to the project source when working in this checkout. The source is deliberately outside the auto-discovered repo `.agents/skills` path, so the user-level installation and project do not produce two selector entries with the same name.

The installed package contains SKILL.md, agents/openai.yaml and a portable invoice-import reference. It has no token, session, server key or dependency on this worktree's absolute path. It can be invoked in a new chat on this computer; another computer needs the package installed or the project instructions/source. The skill does not start a greeting before a user prompt, create permanent app buttons or transfer LINE sign-in sessions.

## Checks

- Baseline isolated agent: confirmed no Sweet House skill existed in repo/user skill directories. The old installed-menu request could not be fulfilled.
- Independent fresh-context forward test of installed package: four scenarios passed — show the four choices; display the menu for a bare number in a new chat; explain missing authenticated access for a status request; use the bundled invoice reference outside the repo without inventing tax values, state, imports or authentication.
- `quick_validate.py skills/sweet-house`: valid.
- `quick_validate.py /Users/tar/.agents/skills/sweet-house`: valid.
- Compared all three source/installed files byte-for-byte: identical.
- `git diff --check`: passed.

Validator used Python runtime with PyYAML6.0.3 in a temporary dependency directory, without modifying the app's runtime dependencies.

The product app is closed source and Computer Use explicitly denied inspection of `com.openai.codex`; no alternate UI-control path was used. Native picker appearance/click behavior could not be manually verified. This change modifies skill/instruction files only, so repository browser E2E tests cannot exercise its chat picker; fresh-context behavioral checks and package validation are the compensating coverage. No website/backend code changed, no production writes occurred, and no Cloud Run deployment is needed for the local skill.

Official discovery and invocation guidance: [Build skills](https://learn.chatgpt.com/docs/build-skills). The app should discover local skills; if missing in the selector, restart the app. Plain `เมนูสวีทเฮาส์` in this project's new chat is also routed by AGENTS.md.

## Popup correction — 2026-11-20

User reported that another chat showed a text menu instead of a popup. Read-only inspection of thread `01a1f813-cbc5-7d22-ad6d-6ac488533e3e` (title “เปิดเมนูสวีทเฮ้าท์”) confirmed it read the installed SKILL.md and then returned only numbered text for both `เมนูสวีทเฮ้าท์` and `เมนูสวีทเฮาส์`. Thus discovery worked in that observed chat; no popup tool invocation appeared in those turns. The original installed/source entry at commit `d13fe54` said the tool “can” present choices, making popup rendering optional.

Changed the rendering contract to require exactly one `request_user_input_async` call when available, with explicit title/options, and permit text only when the tool is missing or explicitly fails. Added English menu wording and the observed Thai spelling to trigger aliases. Synced the user installation and updated project routing/usage guidance. This is not an attempt to install a new tool into other chats.

Fresh independent simulated forward tests:4 passed — English trigger with tool, Thai spelling with tool, missing-tool fallback, and a direct status request without sign-in. Tests reported intended calls without actually prompting the user. Separately, this primary chat invoked the actual choice tool and received `accepted:true`. This confirms acceptance here, not that the other chat has been rerun or its UI inspected.

Both package validators passed; all source/installed files were identical; `git diff --check` passed. Only skill/instruction files changed, so no website redeploy or application E2E rerun was needed. Reinvoke the updated skill in an existing chat to load the new contract; an old chat's already-rendered text is not retroactively converted to a popup.

## Short alias — 2026-11-20

Added `เปิดเมนู` as the short command in a Sweet House project/chat, including polite suffix `เปิดเมนูหน่อย`. Updated trigger metadata, project routing and usage instructions, and synced the installed user package. Independent simulated forward checks passed3/3: both short forms require one popup-tool call when available, while `เปิดเมนู Canva` in another project does not invoke Sweet House. Both package validators, installed/source byte comparison and `git diff --check` passed. Instruction-only change; existing application E2E and deployment are unaffected. Popup-tool availability remains host-dependent.
