# Hume Design Review

## Hume Design Target

Duplicate Reviewer should keep current functionality while moving toward a minimalist, high-contrast, accessibility-first workspace. The target design uses a shared header, compact match controls, a readable group list, and a clear review/merge workspace with inline blockers and one obvious recovery action.

## Current Alignment

- The app already keeps Duplicate Reviewer workflows task-first: import, filter, review, label, export, and merge.
- The current merge flow now exposes missing Contact ID blockers inline and smoke-tests the `Load Latest Contacts` recovery path.
- The UI uses shared typography, visible focus styling, accessible labels, and Playwright checks for clickable controls.
- Content below the viewport must remain reachable by page-level or pane-level scroll. Scroll lock is treated as a release-blocking defect.
- Unintentional overlap between controls, side rails, comparison panes, text, and action areas is treated as a release-blocking defect.
- Current functionality must be preserved when Hume-inspired visual simplification is implemented.

## Feature Request Review

Every Duplicate Reviewer feature request should include a Hume pass before code changes:

- Define the primary user task and whether it belongs in Import, Match Controls, Review, Merge, Export, or Help.
- Keep the surface minimalist and avoid adding a new panel when an existing workflow area can hold the feature.
- Use high-contrast semantic status: blue for primary action, green for success, amber for setup/caution, red for failure.
- Provide accessible labels, visible focus states, keyboard behavior, and clear error/recovery copy.
- Include empty, loading, success, warning, disabled, and error states when relevant.

## Feature Notes

### Multi-Group Merge Preview Confirmation

- This feature belongs in the existing `Merge` workflow and should preserve the same left-rail navigation mental model as `Evaluate`.
- The editable `Contact Merge` section should give way to a read-only `Review before confirming` surface once the queued merge set is ready for confirmation.
- The confirmation surface should appear only after the Salesforce pre-merge freshness checks succeed for the queued groups.
- The operator should be able to move through queued group previews with the left rail and inline `Previous` / `Next` controls, without being forced to confirm each group individually.
- The preview for the current group should summarize the surviving master Contact, the duplicate Contacts that will be deleted, and the resulting retained values in a compact, readable card.
- The final destructive action should be a single overall onscreen primary button paired with an overall cancel action for the queued merge set.
- The review surface must be read-only, with no master or field-retention editing while in confirmation mode.
- The preview must preserve the existing page and pane scroll model, with no overlap between navigation, summary, value preview, and overall action area on desktop or mobile.
- Any preview content that reflects review-only accepted values rather than actual Salesforce write-back fields must be labeled clearly.

## Build And Test Gate

Before a Duplicate Reviewer change is ready:

- The shared Hume design check must pass in the managed app pipeline.
- Smoke tests must cover any visible interactive control touched by the change.
- Smoke tests must verify scrolling remains available when content exceeds the viewport.
- Smoke tests or review screenshots must verify that visible controls and panes do not overlap at supported viewport sizes.
- Any Hume design proposal that changes layout must preserve current functionality and add regression coverage for the new interaction model.
