# Release Checklist

Run this before committing or sharing Duplicate Reviewer changes.

1. Confirm `git status --short` and account for every changed, untracked, or generated file.
2. Run `npm run check`. This includes syntax, metadata, shareable-branch safety, and live server contract checks.
3. Run `npm run check:windows` when launcher, path, server, Salesforce CLI, or cross-platform behavior changed.
4. Run `npm run smoke:ui:local` for UI, layout, workflow, or browser interaction changes.
5. Treat every fixed user-visible bug as a named regression assertion in the check or smoke harness.
6. Verify stale runtime protections: the launcher must reject or restart an existing process when health or API contract versions do not match the current source.
7. Commit private changes, apply public-safe changes to `shareable`, run the same checks there, and push the private and public/shareable branches together.
