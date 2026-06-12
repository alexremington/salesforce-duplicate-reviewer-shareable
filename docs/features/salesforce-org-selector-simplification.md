# Salesforce Org Selector Simplification

Status: complete
Manifest ID: salesforce-org-selector-simplification

## User Story

- Persona: Duplicate Reviewer operator working in the existing `Source` rail.
- Goal: Keep the Salesforce org selector compact and harder to misuse by reducing inline editing surface area.
- Decision or action the user needs to complete: Choose a recent Salesforce org by alias, review the read-only instance URL, and apply the selected org before refreshing or merging.

## Scope

- Mode or page: Main Duplicate Reviewer workspace, `Source` rail only.
- Data source: Shared Salesforce org catalog from the server plus the currently selected local preference and loaded dataset source metadata.
- Object type: Applies to both Contact and Account workflows.
- Primary actions: Select an org from the shared catalog, apply the org, and see mismatch status update.
- Secondary actions: Review the selected alias, instance URL, and target/source mismatch warning.

## Out Of Scope

- Explicitly excluded behavior: Freeform editing of the alias or instance URL inline in the selector.
- Business logic that must remain outside the app: Salesforce authentication, dataset matching, and merge execution.
- Data writes that are not allowed: No new server-side writes are introduced by the selector simplification; the catalog is read-only and the only local preference is the selected org.

## UI Expectations

- Hume design target: Minimalist, high-contrast, accessibility-first `Source` rail surface with no new panel or workflow branch.
- Required visible state: no org selected, queued catalog org, applied org, and mismatch warning.
- Required controls: alias-only shared org catalog dropdown, read-only instance URL display, and `Use org` action.
- Alias-only wording: catalog org options should show the Salesforce alias only, with no host or URL appended in the option text.
- Empty, loading, success, and error states: keep the existing status and mismatch messaging, but render the instance URL as read-only text rather than an input.
- Whitespace, no-overlap, and scroll criteria: the selector must stay inside the contained left rail and preserve the scroll path when the rail exceeds the viewport.
- Keyboard, focus, and contrast criteria: keep the dropdown and apply action reachable with visible focus states; the read-only URL must remain legible and clearly labeled.
- Desktop success criteria: the selector reads as part of the `Source` stack, with alias-only options and a read-only URL line beneath.
- Mobile success criteria: the selector stacks cleanly without clipping or horizontal spill.

## Verification

- Local checks: `npm run check` and `npm run check:windows`.
- Playwright coverage, including Hume design alignment: `npm run smoke:ui:local` must prove alias-only dropdown entries, read-only URL rendering, apply flow, and mismatch warning behavior.
- Shared catalog regression: the dropdown must render every seeded org entry, with no display cap and no URL text in the option labels.
- Manual checks: open the `Source` rail, compare catalog orgs, and confirm the selected org details remain readable without freeform editing.
- Docs to update: `docs/HUME-DESIGN-REVIEW.md`, `feature-test-manifest.json`.
