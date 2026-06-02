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
