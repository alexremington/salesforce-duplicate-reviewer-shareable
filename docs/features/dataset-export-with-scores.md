# Dataset Export With Scores

Status: complete
Manifest ID: dataset-export-with-scores

## User Story

- Persona: Duplicate Reviewer operator exporting a matched Salesforce dataset for downstream review or handoff.
- Goal: Export the imported dataset in its original shape, plus the computed match group and match score for each original record.
- Decision or action the user needs to complete: Choose the export option and download a CSV that can be re-imported without losing the source columns.

## Requirements

- Keep the export shape aligned with the imported dataset rather than exporting only group summaries.
- Add `group` and `score` as appended columns for each original record.
- Preserve the source column order and values exactly as loaded.
- Use the current computed group assignment and group score from the duplicate matching run.
- Keep the export in the existing Export menu so the workflow stays familiar.

## Acceptance Criteria

- The Export menu includes a `Dataset + Scores` action.
- The exported CSV contains one row per original record.
- The exported CSV preserves the original imported columns and appends `group` and `score`.
- The `group` value reflects the current duplicate group identifier for each row, or blank when the record is not in a duplicate group.
- The `score` value reflects the current duplicate group score for each row, or blank when the record is not in a duplicate group.
- The exported CSV can be re-imported by the existing loader without schema loss.

## Hume Design Direction

- Minimalist, high-contrast, accessible direction: keep the new action inside the existing Export menu; do not add a new panel or secondary workflow surface.
- Required visible states: disabled before a dataset is loaded, enabled once a dataset exists, and visually consistent with the existing menu items.
- Controls and interaction pattern: use the same button/menu-item pattern as the current export actions so users do not have to learn a new control surface.
- Whitespace, no-overlap, and scroll criteria: no new layout regions, no overlap with existing topbar controls, and no hidden content introduced by the export option.
- Keyboard, focus, and contrast criteria: the new menu item must be reachable by keyboard with visible focus and readable contrast in the existing menu styling.
- Desktop success criteria: the export menu remains compact and the new action does not widen or crowd the topbar.
- Mobile success criteria: the export menu remains usable at smaller widths without clipping or pushing controls below the viewport.

## Fixtures

- Required fixture data: at least one loaded Contacts and one loaded Accounts dataset with duplicate groups and non-duplicate rows so group assignment and blank-group cases can be checked.
- Dummy data behavior: demo data should also produce a valid dataset export with appended `group` and `score` columns.
- Live integration behavior: no Salesforce write action is required; this is a local export of the current in-memory dataset state.

## Test Plan

- Unit or contract checks: `npm run check` must pass after the export menu and CSV builder changes.
- Targeted Playwright assertions: smoke should verify the `Dataset + Scores` menu item exists, exports a CSV, and preserves the expected columns.
- Cross-platform checks: confirm the export action remains a normal browser download on macOS and Windows.
- Manual checks: open the export menu, confirm the new action is enabled only when a dataset is loaded, and verify the downloaded CSV includes `group` and `score`.

## Release Evidence

- Fast check evidence: `npm run check` passed on 2026-06-09.
- Playwright evidence: `npm run smoke:ui:local` passed on 2026-06-09.
- Release pipeline evidence: handled by repo closeout.
- Known gaps: none documented.
