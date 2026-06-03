# Release Checklist

Run this before committing or sharing Duplicate Reviewer changes.

1. Confirm `git status --short` and account for every changed, untracked, or generated file.
2. Run `npm run check`. This includes syntax, metadata, shareable-branch safety, and live server contract checks.
3. Run `npm run check:windows` before every push. Launcher, path, server, Salesforce CLI, generated script, and cross-platform changes must include Windows evidence.
4. Run `npm run smoke:ui:local` before every push. UI, layout, workflow, browser interaction, merge, import/export, scrolling, and clickable-control behavior must be covered by Playwright, not the Codex in-app browser.
5. Treat every fixed user-visible bug as a named regression assertion in the check or smoke harness.
6. Keep reusable Playwright mechanics in `vendor/managed-app/scripts/smoke-test-harness.js`; keep app-specific data fixtures in `tests/fixtures/`.
7. Verify stale runtime protections: the launcher must reject or restart an existing process when health or API contract versions do not match the current source.
8. Capture release evidence before push:
   - Mac smoke: `npm run check`, `npm run check:windows`, and `npm run smoke:ui:local`.
   - Windows smoke: Windows launcher opens, Node and Salesforce CLI are discovered, import works, merge controls are reachable, and `Run now`/server actions use platform-safe process launching.
   - Fresh install smoke: no prior app-support state, one-click launcher creates runtime state, Recent files and demo/import paths still work.
   - Upgrade-path smoke: existing app-support state, recent files, saved labels/decisions, and runtime restart behavior survive the update.
9. Commit private changes, apply public-safe changes to `shareable`, run the same checks there, and push the private and public/shareable branches together.
