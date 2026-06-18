# Salesforce Org Selector Reflow

Status: complete
Manifest ID: salesforce-org-selector-reflow

## User Story

- Persona: Duplicate Reviewer operator working in the existing `Source` rail.
- Goal: Keep the Salesforce org selector compact and readable without letting it widen the left rail or block the lower collapse controls.
- Decision or action the user needs to complete: Choose or edit the Salesforce org inline in `Source`, then continue with imports, matching, or merge work.

## Requirements

- Keep the Salesforce org selector inside the existing `Source` rail.
- Keep the rail as a contained column so long org labels and URLs do not widen into the workspace pane.
- Preserve the existing file import workflow, recent files list, and collapse toggles.
- Provide a clear scroll path when the left rail contents exceed the viewport.
- Keep the org selector compact and truncation-safe on desktop, with readable stacking behavior on narrow screens.

## Acceptance Criteria

- The `Source` rail no longer overlaps the workspace column at supported desktop and mobile widths.
- The `Source`, `Match Controls`, and `Match Groups` collapse toggles remain visible and clickable after the org selector renders.
- The left rail scrolls when its contents exceed the viewport instead of pushing controls offscreen without a scroll path.
- Long org labels, aliases, and instance URLs remain usable without widening the rail.
- Existing import, match, and merge behavior remains unchanged.

## Hume Design Direction

- Minimalist, high-contrast, accessible direction: keep the org selector inline inside `Source` and avoid adding a separate settings panel or new workflow branch.
- Required visible states: no org selected, selected org, selected-plus-mismatch warning, and compact recent-org choices.
- Controls and interaction pattern: keep the existing recent org selector, alias field, instance URL field, and `Use org` action in the same rail section.
- Whitespace, no-overlap, and scroll criteria: the rail should stay visually contained, preserve clear separation from the workspace column, and provide a real scroll path when it grows taller than the viewport.
- Keyboard, focus, and contrast criteria: keep the selector controls reachable and readable with visible focus states and no clipped text.
- Desktop success criteria: the org selector reads as part of the `Source` stack, with labels that truncate before they threaten the workspace gutter.
- Mobile success criteria: the rail remains scrollable and the org selector stacks cleanly without clipping or horizontal spill.

## Fixtures

- Required fixture data: at least one loaded dataset with a selected Salesforce org and at least one long org label or URL value to exercise the truncation-safe layout.
- Dummy data behavior: no demo-only fallback should alter the org selector layout.
- Live integration behavior: the org selector must continue to drive the same Salesforce org-scoped requests as before.

## Test Plan

- Unit or contract checks: `npm run check` must pass after the rail and selector layout changes.
- Targeted Playwright assertions: smoke should verify the rail does not overlap the workspace, the collapse toggles remain hit-testable, the rail can scroll, and the org selector stays usable with long values.
- Cross-platform checks: confirm the rail remains readable and scrollable on macOS and Windows browser rendering.
- Manual checks: open the `Source` rail, review the org selector with long values, and confirm the lower collapse controls remain reachable.

## Release Evidence

- Fast check evidence: `npm run check` passed on 2026-06-12.
- Playwright evidence: `npm run smoke:ui:local` passed on 2026-06-12.
- Release pipeline evidence: handled by repo closeout.
- Known gaps: none documented.
