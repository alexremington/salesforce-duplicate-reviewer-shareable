# Project Agent Guidance

These instructions apply to this repository and its subdirectories.

## Product Goals

- Build inside the existing app and preserve the current workflow unless the user explicitly asks for a separate prototype.
- Keep the private branch and shareable branch in sync when changes are intended for both audiences.
- Keep the app portable for both macOS and Windows users.

## Feature Preflight

- Before development starts, read this file and the current repo guidance that governs visible work: `docs/HUME-DESIGN-REVIEW.md`, `docs/DEFINITION-OF-DONE.md`, `docs/features/README.md`, and any feature-specific brief already in scope.
- Before development starts, classify the work as `low`, `medium`, or `high` and state that label in commentary for the user.
- For `low` or `medium` work, use `gpt-5.4 mini medium` when the surface allows model selection and say that this requirement was applied.
- For `high` work, use `gpt-5.4 medium`. Stop after the warning and wait for explicit user approval before design iteration, implementation, or broad validation begins.
- State the applicable gates before implementation. For visible UI or workflow changes, that must include the Hume-first requirement, required docs, and the validation commands that will be used later.
- Any new visible feature request must go through Hume design before build. Create or update the tracked feature brief and capture the Hume design pass before editing app code.
- Do not begin implementation for a visible feature until the design artifact exists in the repo.
- If the request touches an existing visible feature without changing the UI or workflow, still perform the preflight read and state whether a new Hume pass is required.
- If any one of these is missing, the work is not allowed to proceed: cost label, Hume-first artifact when required, `gpt-5.4 mini medium` switch when applicable, or explicit approval for `high`-cost work.

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
- For pointer-driven controls like sliders, drag handles, and scrubbers, do not treat `input.value` assignments, synthesized `input` events, or screenshots alone as proof of a fix. Regression coverage must exercise the exact pointer gesture from the failure state and verify the control still moves after the edge case is reached.
