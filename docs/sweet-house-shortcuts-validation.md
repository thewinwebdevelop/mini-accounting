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
