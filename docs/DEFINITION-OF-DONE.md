# Definition Of Done

A Duplicate Reviewer change is done when the implementation, verification, and sharing path are all covered.

## Required

- The change is scoped to the requested workflow and avoids unrelated refactors.
- Evaluation and merge flows remain separate where their user stories differ.
- Account review remains available in Evaluate mode.
- Account merge remains disabled unless explicit account merge business rules are added in a later project.
- Contact merge changes preserve the master record and field-level retained-value flow.
- User-facing state is visible for duplicate decisions, merge readiness, loading, errors, and empty datasets.
- Content that extends beyond the viewport remains reachable by page-level or pane-level scrolling.
- Interactive controls touched by the change are covered by smoke tests or a focused manual pass.
- `npm run check` passes.
- `npm run smoke:ui` passes after UI changes.
- CI is green before treating the change as ready to share.
- Setup, maintenance, or handoff docs are updated when behavior changes.

## Public-Safe Work

- Public-safe changes are applied to `shareable` and pushed to the public mirror.
- No local data, logs, generated output, credentials, org details, or machine-specific paths are committed.
- `npm run check:shareable` passes on public-safe branches.

## Manual Review

- Review desktop and mobile Playwright screenshots after visible UI changes.
- Use the Windows VM for launcher, path, and browser checks when the change affects teammate setup or merge workflows.
