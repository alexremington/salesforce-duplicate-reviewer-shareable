# Workspace Export and Restore

Status: in progress
Manifest ID: workspace-export-restore

## User Story

- Persona: Duplicate Reviewer operator who wants to hand off or resume a review without juggling separate CSV exports, label files, and state fragments.
- Goal: Save and restore the current review workspace as one JSON artifact tied to the loaded dataset.
- Decision or action the user needs to complete: Choose `Export > Workspace` to download one workspace file, or `Import > Workspace` after reloading the matching dataset to restore the saved review state.

## Requirements

- Keep the current CSV dataset loader as the source of truth for the source records.
- Save the active review state as a single workspace record in browser persistence and export that same record as JSON.
- Restore duplicate/not-duplicate decisions, training labels, field-resolution choices, separated records, merge results, and merge master selections from the workspace JSON.
- Keep the existing Decisions and Labels CSV exports available for downstream workflows and backward compatibility.
- Keep the workspace controls inside the existing Import and Export menus. Do not add a new panel or separate workflow surface.

## Acceptance Criteria

- The Import menu includes a `Workspace` action that opens a JSON file picker.
- The Export menu includes a `Workspace` action that downloads a JSON file.
- The exported workspace JSON includes the current dataset metadata plus the saved review state.
- Importing a matching workspace file restores the saved review state in a fresh browser context after the same dataset is loaded again.
- The current CSV-based dataset import path still works unchanged.
- The workspace export/import path remains reachable with the existing menu and keyboard behavior on desktop and mobile.

## Hume Design Direction

- Minimalist, high-contrast, accessible direction: keep the new action inside the existing topbar menus so the workflow stays familiar.
- Required visible states: disabled before a dataset is loaded, enabled once a dataset exists, and consistent with the existing menu items.
- Controls and interaction pattern: use the same menu-item pattern as the existing import/export actions so users do not have to learn a new surface.
- Whitespace, no-overlap, and scroll criteria: do not add new layout regions or push existing topbar controls below the viewport.
- Keyboard, focus, and contrast criteria: the new menu items must be reachable by keyboard with visible focus and readable contrast in the current styling.

## Fixtures

- Required fixture data: at least one Contacts dataset with duplicate groups and saved review state so the round-trip can prove label and decision restoration.
- Dummy data behavior: demo data should still load normally even if no workspace file has been exported yet.
- Live integration behavior: no Salesforce write action is required; this is a local JSON handoff for review state.

## Test Plan

- Unit or contract checks: `npm run check` must pass after the workspace persistence and export/import changes.
- Targeted Playwright assertions: smoke should verify the `Workspace` menu items exist, export a JSON file, and restore saved review state in a fresh browser context.
- Cross-platform checks: confirm the menu actions remain normal browser downloads and file imports on macOS and Windows.
- Manual checks: open the menus, confirm the workspace actions are enabled only when a dataset is loaded, and verify the imported workspace restores decisions and labels.
