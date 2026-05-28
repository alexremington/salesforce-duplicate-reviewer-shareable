# UI Checklist

Use this checklist for visual or interaction changes.

## General

- The first screen is the usable Duplicate Reviewer workspace, not a marketing page.
- The UI separates evaluation work from merge work when the workflows have different user goals.
- Important record state is visible where decisions happen, including Duplicate and Not Duplicate status.
- Controls match their job: radio buttons for one retained value, segmented controls for modes, menus for object/source selection, and modals for reference information.
- Icons are used for familiar commands when available, with accessible labels or tooltips.
- Empty, loading, error, and success states are visible and actionable.

## Duplicate Reviewer Specific

- Evaluate mode supports Accounts and Contacts.
- Merge mode supports Contacts only.
- Account merge entry points remain disabled and visually muted until downstream account merge rules are explicitly in scope.
- Contact merge shows a master record choice and field-level retained-value choices.
- Training shortcuts only affect evaluation behavior, not merge selection.

## Responsive Layout

- At desktop width, comparison tables and merge matrices remain scannable.
- At mobile width, primary controls wrap cleanly and text remains readable.
- Page-level horizontal overflow is not introduced.
- Text does not overlap adjacent controls, badges, cards, or table cells.
- Any layout change that affects the workspace has a Playwright screenshot reviewed at desktop and mobile widths.

## Accessibility

- Buttons and inputs have labels that work with role-based Playwright selectors.
- Modals have a clear accessible name and close control.
- Color is not the only signal for decision state.
- Focus remains usable after opening and closing modal or menu controls.

