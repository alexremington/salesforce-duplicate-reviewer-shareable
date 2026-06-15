# Prod Contacts Autoload

Status: in progress

## User Story

- Persona: Duplicate Reviewer operator arriving from the prod Contacts handoff.
- Goal: Open the reviewer on the freshly downloaded prod Contacts dataset without picking a file manually.
- Decision or action the user needs to complete: Follow the prod launcher URL and let the app load the latest prod Contacts export.

## Scope

- Mode or page: Server-backed Duplicate Reviewer startup, autoload routing, and latest-file seeding.
- Data source: `/api/prod-contacts/latest.json`, `/api/prod-contacts/latest.csv`, and prod latest-file metadata.
- Object type: Contact.
- Primary actions: Autoload the prod Contacts dataset, keep the notification flag path working, and render the loaded records.
- Secondary actions: Seed prod latest files into Recent files and keep the staging autoload path unchanged.

## Out Of Scope

- Explicitly excluded behavior: Any change to staging Contacts or Accounts autoload behavior.
- Business logic that must remain outside the app: Salesforce pull execution and merge logic.
- Data writes that are not allowed: No production data mutation in the browser.

## UI Expectations

- Hume design target: Not applicable; this is a startup routing and dataset-loading change.
- Required visible state: The prod dataset loads as Contacts and is available in the normal review workspace.
- Required controls: Existing file import and review controls remain unchanged.
- Empty, loading, success, and error states: Preserve the current loading modal and error handling.
- Whitespace, no-overlap, and scroll criteria: No layout changes are expected.
- Keyboard, focus, and contrast criteria: No new focus targets are introduced.
- Desktop success criteria: `autoload=prod-contacts` loads the prod Contacts dataset and displays it as the current source.
- Mobile success criteria: No mobile-specific behavior changes are expected.

## Verification

- Local checks: `npm run check`, `npm run check:windows`, and `npm run smoke:ui:local`.
- Playwright coverage, including Hume design alignment: Add a regression that proves `autoload=prod-contacts` loads the expected prod latest Contacts dataset.
- Manual checks: Confirm the prod latest file endpoint and launch URL work together end to end.
- Docs to update: `README.md`, `SETUP.md`, and the team handoff notes.
