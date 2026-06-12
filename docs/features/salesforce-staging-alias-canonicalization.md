# Salesforce Staging Alias Canonicalization

Status: complete
Manifest ID: salesforce-staging-alias-canonicalization

## User Story

- Persona: Duplicate Reviewer operator working with the Salesforce org selector and source metadata.
- Goal: See only one staging identity in the app while preserving the same underlying sandbox connection.
- Decision or action the user needs to complete: Choose or reuse the canonical staging org alias, then apply it without seeing the legacy `staging` alias as a separate option.

## Scope

- Mode or page: Main Duplicate Reviewer workspace, source org selector, org catalog loading, persisted org preferences, and source dataset metadata normalization.
- Data source: Shared Salesforce org catalog, locally persisted org preferences, and source-derived org metadata embedded in loaded jobs or recent files.
- Object type: Applies to both Contact and Account workflows.
- Primary actions: Load the org catalog, select a staging org, apply it, and compare the active target org against loaded source metadata.
- Secondary actions: Rehydrate a saved org preference, display mismatch state, and keep imported metadata aligned to the canonical alias.

## Out Of Scope

- Explicitly excluded behavior: Salesforce CLI auth migration or any change to the underlying sandbox instance URL.
- Business logic that must remain outside the app: Salesforce authentication, dataset matching, and merge execution.
- Data writes that are not allowed: No Salesforce alias rewrite is performed in the CLI itself; the app only normalizes the org identity it displays and stores.

## Requirements

- Treat `politico-staging` as the canonical alias for the staging sandbox.
- Collapse any legacy `staging` org references onto `politico-staging` before the selector renders.
- Keep the existing instance URL, org ID, and username data attached to the canonical profile.
- Normalize persisted preferences, imported job metadata, and source-derived metadata to the canonical alias.
- Keep the dropdown alias-only and preserve the read-only instance URL display.

## Acceptance Criteria

- `/api/salesforce/orgs` returns one staging entry labeled `politico-staging` instead of a separate legacy `staging` option.
- The org selector never renders `staging` as a distinct choice in the dropdown.
- Existing saved or imported `staging` references are rewritten to `politico-staging` when loaded by the app.
- The active staging sandbox still resolves to the same instance URL and auth target.
- The mismatch warning and apply flow continue to work after canonicalization.

## Implementation Tasks

- Add server-side alias canonicalization for org catalog assembly and requested-org normalization.
- Add client-side alias canonicalization for persisted preferences and source metadata.
- Update the server contract regression to assert the alias collapse.
- Update the Playwright smoke regression to prove the live selector no longer shows `staging`.

## Verification

- Local checks: `npm run check` and `npm run check:windows`.
- Playwright coverage: `npm run smoke:ui:local` must verify the canonical alias and reject the legacy alias in the live selector.
- Manual check: confirm the loaded dataset source and selected target org both resolve to `politico-staging` after a preference reload.
