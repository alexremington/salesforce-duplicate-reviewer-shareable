# Project Agent Guidance

These instructions apply to this repository and its subdirectories.

## Product Goals

- Build inside the existing app and preserve the current workflow unless the user explicitly asks for a separate prototype.
- Keep the private branch and shareable branch in sync when changes are intended for both audiences.
- Keep the app portable for both macOS and Windows users.

## Front-End Design

- Prioritize clean, legible UI and familiar controls.
- Use commonly understood graphical icons in place of text where an icon is clearer.
- Use common input patterns for user-provided data: selects for option sets, toggles or checkboxes for booleans, numeric inputs or steppers for numbers, and time selectors for clock times.
- Unless specifically requested otherwise, distribute whitespace evenly within and between UI elements.
- Prioritize legibility over density. Labels, buttons, cards, panels, headers, and form controls should feel balanced, readable, and intentionally placed rather than cramped or visually uneven.
- Never permit visible text or controls to extend below the viewport while scrolling is prohibited. If content can exceed the viewport, the page or the containing pane must provide a clear, working scroll path. Hidden overflow on primary content regions is a cardinal UX violation unless the clipped region is purely decorative and contains no user-facing content.

## Cross-Platform Rules

- Avoid browser-specific and OS-specific behavior unless a platform-specific launcher or fallback is also provided.
- Prefer Node-based launcher and server logic over shell-only behavior when the same action must work on macOS and Windows.
- Keep local ports configurable so this app can run at the same time as other local apps or virtual-machine instances.
- Keep credentials and Salesforce access tokens server-side.

## Validation

- After UI or launcher changes, run `npm run check`, `npm run check:windows`, and `npm run smoke:ui:local`.
- `npm run check` must include live server contract coverage for current health/config flags, static app loading, and method-sensitive API routes. Mocked Playwright routes are not enough for server-backed workflows.
- Any user-visible bug fix should add or update a named regression assertion that would have failed before the fix.
- Launcher changes must reject or restart stale runtime processes when feature or API contract versions do not match the current source.
- Use Playwright for smoke testing. Do not attempt to use the Codex in-app browser for smoke tests; the repo Playwright harness is the source of truth for rendered smoke validation.
- Smoke coverage should exercise primary buttons and fail on scroll traps, hidden overflowing content, layout overlap, and nonfunctional controls.

## Pre-Commit Preflight

- Before committing any feature, workflow, sync, or cleanup change, verify the diff does not remove any protected user-facing flow by accident.
- For merge-review work, explicitly confirm the queued review flow is still present in source, smoke coverage, and launcher output:
  - `renderMergeReviewPanel`
  - `renderMergeConfirmationPreview`
  - `startMergeReviewSession`
  - `handleConfirmedMerge`
  - the matching smoke assertions for review, preview, cancel, and confirm
- If a commit intentionally retires or renames a protected flow, update the guardrail and smoke assertions in the same change before pushing.
- Do not commit a broad sync or cleanup that deletes protected workflow code unless you have manually reviewed the removed sections and confirmed the replacement behavior is intentional.
- Treat `npm run check` as the minimum pre-commit gate, then run `npm run smoke:ui:local` before pushing any user-visible change.
- If a change touches the launcher or cached runtime path, confirm the live served bundle still reflects the current source before committing.

## Recommended Agent Workflow

- Use `Hume` first for visible UI direction unless the user explicitly waives that step.
- Keep the main Codex thread as the orchestrator and primary implementation thread.
- Use the repo-local `architect` agent for scoped planning, merge-safety review, interaction-risk review, and acceptance criteria.
- Use the repo-local `reviewer` agent after implementation for correctness, portability, merge-safety, and validation-gap review.
- Use the repo-local `qa-ux` agent to enforce `npm run check`, `npm run check:windows`, and `npm run smoke:ui:local` as the validation floor.
- Prefer subagents for planning, review, and QA. Do not default to multiple parallel implementation agents editing the same change.

The repo-local custom agents live under `.codex/agents/`, and the reusable workflow lives in `.agents/skills/agentic-delivery/`.

New development-task prompts are hook-enforced through `.codex/config.toml`. Start them with `Use $agentic-delivery:`. For visible UI work, mention `Hume` or explicitly waive Hume in the request.
