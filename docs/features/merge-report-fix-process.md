# Merge Report Fix Process

Use this checklist when changing merge review, merge report, or launcher behavior.

## Goals

- Preserve the queued merge review workflow unless the change explicitly retires it.
- Keep the merge report aligned with the uploaded CSV that created the merge set.
- Avoid silent regressions from stale cached runtime assets or broad branch syncs.

## Preflight

Before editing code:

1. Confirm the exact failure mode in the launched app, not just in source.
2. Verify which runtime the launcher is serving:
   - checked-out source
   - cached app-support static bundle
3. Identify the protected flow that must remain intact:
   - merge review screen
   - preview pane
   - cancel and confirm actions
   - merge report CSV download
4. Decide whether the change is a narrow fix or a cleanup follow-up.
   - If both are needed, split them into separate commits.

## Change Rules

- Keep fixes surgical. Do not bundle workflow repairs with broad sync or refactor commits.
- If a retired string, selector, or flow is intentionally removed, update the smoke test and contract guard in the same change.
- If a launcher or static asset path is involved, refresh or restart the live runtime before relying on the browser.
- Do not overwrite a richer workflow with a snapshot from another branch without reviewing removed UI and handler code.

## Validation

Run the full repo gates after any user-visible merge change:

- `npm run check`
- `npm run check:windows`
- `npm run smoke:ui:local`

The smoke test should prove the real user path:

- review screen appears
- preview opens
- cancel does not merge
- confirm does merge
- merge report downloads and contains uploaded-file values

## Anti-Patterns

- Large sync commits that delete workflow code and replace it with older behavior.
- Relying on source files when the launcher is actually serving a cached bundle.
- Treating a passing API check as proof that the UI workflow still exists.
- Combining an emergency fix with unrelated cleanup in the same commit.

## After the Fix

- Add or keep a regression assertion for the exact failure you just repaired.
- Update any guardrail strings or feature-contract checks in the same change.
- Re-run the real launcher path once before considering the fix done.
