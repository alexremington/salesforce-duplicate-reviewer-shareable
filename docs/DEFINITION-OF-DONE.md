# Definition Of Done

A Duplicate Reviewer change is done when the implementation, verification, and sharing path are all covered.

## Required

- Development started only after repo guidance was reviewed and any required preflight artifact was created for the change scope.
- Visible feature work did not begin until the Hume-first design pass and tracked feature brief were in place.
- The change is scoped to the requested workflow and avoids unrelated refactors.
- Evaluation and merge flows remain separate where their user stories differ.
- Account review remains available in Evaluate mode.
- Account merge remains disabled unless explicit account merge business rules are added in a later project.
- Contact merge changes preserve the master record and field-level retained-value flow.
- User-facing state is visible for duplicate decisions, merge readiness, loading, errors, and empty datasets.
- Content that extends beyond the viewport remains reachable by page-level or pane-level scrolling.
- Interactive controls touched by the change are covered by smoke tests or a focused manual pass.
- Cross-app smoke-test mechanics use the shared managed harness in `vendor/managed-app/scripts/smoke-test-harness.js`.
- Large local dataset and worker-backed workflow changes include lightweight performance-budget assertions.
- Hume's minimalist, high-contrast, accessibility-first design review is reflected in `docs/HUME-DESIGN-REVIEW.md` before visible UI changes are implemented.
- Every fixed user-visible bug has a named regression assertion in the check or smoke harness.
- `npm run check` passes, including live server contract checks for current health and API routes.
- `npm run smoke:ui:local` passes after UI changes.
- Stale runtime checks reject or restart any running server whose health or API contract does not match the current source.
- CI is green before treating the change as ready to share.
- Setup, maintenance, or handoff docs are updated when behavior changes.
- `docs/RELEASE-CHECKLIST.md` is followed before commit and push.

## Public-Safe Work

- Public-safe changes are applied to `shareable` and pushed to the public mirror.
- No local data, logs, generated output, credentials, org details, or machine-specific paths are committed.
- `npm run check:shareable` passes on public-safe branches.

## Manual Review

- Review desktop and mobile Playwright screenshots after visible UI changes.
- Use the Windows VM for launcher, path, and browser checks when the change affects teammate setup or merge workflows.
