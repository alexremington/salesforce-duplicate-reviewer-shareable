# Multi-Group Merge Preview Confirmation

Status: complete
Manifest ID: merge-preview-confirmation

## User Story

- Persona: Duplicate Reviewer operator preparing multiple Salesforce Contact merges from the existing duplicate-group review workflow.
- Goal: Understand exactly what each surviving merged Contact will look like before sending a destructive merge request batch.
- Decision or action the user needs to complete: Review the resulting merged Contact previews across multiple queued groups, then make one overall onscreen `Confirm` or `Cancel` decision without leaving the merge workflow.

## Requirements

- Replace the current per-group `Contact Merge` editing section with a read-only `Review before confirming` surface once the merge workflow enters confirmation mode.
- Support reviewing multiple merge groups in sequence, using the same left-rail group navigation model as `Evaluate`, plus inline `Previous` and `Next` controls inside the review surface.
- Do not require the operator to individually confirm each group. The operator should review any or all queued group previews, then make one overall onscreen `Confirm` or `Cancel` decision for the queued merge set.
- Keep the current pre-merge freshness check as the gate before any overall final confirmation UI is shown for the queued set.
- Show a concise onscreen preview of the resulting surviving Contact for the current group in view, including the selected master Contact, duplicate Contacts that will be merged into it, and the effective retained field values for the merge-relevant Contact fields shown in the matrix.
- The review surface must be read-only. While reviewing queued previews, the operator should not be able to edit master choice or field-retention choices from that screen.
- Preserve the existing stale-data and missing-Contact-ID blocker flows.
- Do not introduce a separate full-screen modal or off-workflow confirmation surface.

## Acceptance Criteria

- After the user enters merge confirmation mode and the freshness checks for the queued groups return `fresh`, the merge workspace shows a `Review before confirming` surface instead of the editable `Contact Merge` controls.
- The left rail and inline `Previous` / `Next` controls move between queued merge-group previews without leaving the merge workflow.
- Each preview clearly identifies the surviving master Contact Salesforce ID, the duplicate Contact IDs that will be deleted, and the resulting retained values for visible merge fields.
- The preview distinguishes values that will be written back to Salesforce from values that are review-only.
- No Salesforce merge request is sent until the user clicks the overall onscreen confirmation button for the queued set.
- Clicking the overall `Cancel` action exits confirmation mode without sending any queued merge request.
- The review surface is read-only. Editing master choice or field-retention choices is not available in the preview state.
- The preview layout remains readable without overlap on desktop and mobile, and all content remains reachable through the existing page or pane scroll model.
- Playwright smoke coverage proves the review surface appears for multiple groups, supports left-rail and inline navigation, remains read-only, and blocks merge submission until overall confirmation.

## Hume Design Direction

- Minimalist, high-contrast, accessible direction: Reuse the existing merge workspace and group-navigation model so the confirmation experience feels like a read-only review mode, not a detached modal or wizard.
- Required visible states: editable merge setup, multi-group read-only review surface, current-group preview, overall confirm/cancel actions, in-progress batch confirmation, success, stale-data failure, and missing-ID blocker.
- Controls and interaction pattern: the editable `Contact Merge` controls give way to `Review before confirming`; the operator navigates previews with the left rail and inline `Previous` / `Next`, then uses one overall `Confirm` or `Cancel` action for the queued merge set.
- Whitespace, no-overlap, and scroll criteria: the review surface must preserve clear spacing between summary, retained-value preview, navigation, and overall actions, and must never trap later groups or final actions below a non-scrollable container.
- Keyboard, focus, and contrast criteria: focus should move predictably between group navigation and overall actions, with visible focus styling and clear status hierarchy for current group, queued groups, and any blockers.
- Desktop success criteria: the review surface reads as the merge analogue of `Evaluate`, with the left rail still useful for scanning multiple groups while the main pane shows one read-only preview at a time.
- Mobile success criteria: the review surface stacks vertically, preserves left-rail-to-main-pane comprehension, and keeps `Previous`, `Next`, `Confirm`, and `Cancel` reachable through scrolling without clipped content.

## Fixtures

- Required fixture data: at least three Contact duplicate groups with differing Lead Source, company, phone, and mobile values so multi-group preview navigation is meaningful.
- Dummy data behavior: smoke routes should return `fresh` pre-merge checks for multiple queued groups and capture the final merge payload only after the overall confirmation button is pressed.
- Live integration behavior: real Salesforce merges still run only after successful pre-merge freshness checks and explicit overall confirmation for the queued set.

## Test Plan

- Unit or contract checks: `npm run check` remains green and any server-backed merge contract behavior stays unchanged or is intentionally expanded for queued-group handling.
- Targeted Playwright assertions: verify the multi-group review surface appears after pre-merge freshness passes, verify left-rail and inline `Previous` / `Next` navigation change the current preview, verify the review surface is read-only, verify no merge request is sent before the overall confirmation action, and verify overall cancel exits without sending queued merges.
- Cross-platform checks: keep launcher/server behavior unchanged; confirm the feature remains browser-portable on macOS and Windows through the existing harness expectations.
- Manual checks: review desktop and mobile screenshots for spacing, readable summary hierarchy, left-rail continuity with `Evaluate`, button placement, and scroll access to the current preview plus final overall actions.

## Release Evidence

- Fast check evidence: `npm run check` passed on 2026-06-09.
- Playwright evidence: `npm run smoke:ui:local` passed on 2026-06-09.
- Release pipeline evidence: handled by repo closeout.
- Known gaps: none documented.
