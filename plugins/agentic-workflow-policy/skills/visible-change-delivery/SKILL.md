---
name: visible-change-delivery
description: Use when a user-visible change needs design review, regression coverage, validation gates, and a clean release path.
---

# Visible Change Delivery

Use this skill for user-visible work that needs a disciplined path from design to validation to release.

## Workflow

1. If design direction is unsettled, use Hume or equivalent design review first.
2. Capture the expected user-facing behavior in a brief, manifest, or task note if the repo uses one.
3. Implement the source change and the regression together.
4. Run the repo-local validation gates that apply to the change.
5. Verify the launched app or runtime copy, not only the checkout.
6. Finish with clean status, run `npm run closeout`, then commit and push when the user expects the work shared.

## Rules

- Keep one thread as the main writer unless the task explicitly needs parallel implementation.
- Prefer a narrow regression that would have failed before the fix.
- Do not use a broader, slower validation pass as a substitute for the repo-local gate set.
- Mirror to public history when the repo policy or user request requires it.

## Release Discipline

- Design artifact first for visible UI work when required.
- Regression added before closeout.
- Validation passed on the launched app path.
- Clean tree and pushed result when the work is intended to be shared.

## Output

Summarize the design dependency, the regression added, the validation gates run, and the release state.
