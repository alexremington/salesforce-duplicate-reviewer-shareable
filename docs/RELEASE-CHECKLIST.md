# Release Checklist

Run this before committing or sharing Duplicate Reviewer changes.

1. Run `npm run verify:release` and keep the generated `.managed-app-pipeline/<timestamp>-release/summary.md` as release evidence.
2. Run `npm run closeout` and account for every changed, untracked, or generated file before handoff or push. Local Beads metadata under `.beads/` is workspace state, not release state, and should remain ignored and untracked so it does not block closeout.
3. If a feature brief status drifts from the manifest, run `npm run feature:sync-status` before closeout so the two metadata sources stay aligned.
4. Confirm the release evidence includes `npm run check:features`. New feature work must have a `feature-test-manifest.json` entry and a linked `docs/features/<slug>.md` brief before release.
5. Confirm the release evidence includes the shared Hume design check. Visible UI changes must align with `docs/HUME-DESIGN-REVIEW.md`.
6. Confirm the release evidence includes `npm run check`. This includes syntax, metadata, shareable-branch safety, and live server contract checks.
7. Confirm the release evidence includes `npm run check:windows`. Launcher, path, server, Salesforce CLI, generated script, and cross-platform changes must include Windows evidence.
8. Confirm the release evidence includes `npm run smoke:ui:local`. UI, layout, workflow, browser interaction, merge, import/export, scrolling, and clickable-control behavior must be covered by Playwright, not the Codex in-app browser.
9. Treat every fixed user-visible bug as a named regression assertion in the check or smoke harness.
10. Keep reusable Playwright mechanics in `vendor/managed-app/scripts/smoke-test-harness.js`; keep app-specific data fixtures in `tests/fixtures/`.
11. Verify stale runtime protections: the launcher must reject or restart an existing process when health or API contract versions do not match the current source.
12. Capture release evidence before push:
   - Mac smoke: `npm run check`, `npm run check:windows`, and `npm run smoke:ui:local`.
   - Windows smoke: Windows launcher opens, Node and Salesforce CLI are discovered, import works, merge controls are reachable, and `Run now`/server actions use platform-safe process launching.
   - Fresh install smoke: no prior app-support state, one-click launcher creates runtime state, Recent files and demo/import paths still work.
   - Upgrade-path smoke: existing app-support state, recent files, saved labels/decisions, and runtime restart behavior survive the update.
13. Commit private changes, apply public-safe changes to `shareable`, publish through the approved mirror worktree, run the same checks there, and push the private changes before or alongside the mirror update as appropriate.
