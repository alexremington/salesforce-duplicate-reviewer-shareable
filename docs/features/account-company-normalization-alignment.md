# Account Company Normalization Alignment

Status: complete
Manifest ID: account-company-normalization-alignment

## User Story

- Persona: Duplicate Reviewer operator reviewing Account duplicate candidates.
- Goal: Make Account matching use the same canonical company normalization path used by Contact matching so alias-style company names compare consistently.
- Decision or action the user needs to complete: Import or review Accounts and trust that canonical company aliases are treated as the same company during matching.

## Requirements

- Reuse the canonical company normalization behavior already used by Contact matching.
- Keep Account-specific weights, caps, and corroboration logic intact unless regression evidence shows a real breakage.
- Preserve existing account smoke coverage while adding a focused regression for company alias normalization.
- Keep the change compatible with the existing private and shareable branch workflow.

## Acceptance Criteria

- Account matching uses the same canonical company alias logic as Contact matching.
- A sparse Account pair that differs only by a company alias and exact phone groups as a duplicate pair.
- The existing near-exact name-only Account smoke regression still stays separated.
- `npm run check`, `npm run check:windows`, and `npm run smoke:ui:local` pass after the change.

## Hume Design Direction

- Minimalist, high-contrast, accessible direction: no visible UI redesign is expected for this change.
- Required visible states: unchanged.
- Controls and interaction pattern: unchanged.
- Whitespace, no-overlap, and scroll criteria: unchanged.
- Keyboard, focus, and contrast criteria: unchanged.
- Desktop success criteria: unchanged.
- Mobile success criteria: unchanged.

## Fixtures

- Required fixture data: one sparse Account pair using an alias-style company name plus exact phone, and the existing near-exact account smoke fixture.
- Dummy data behavior: tests may use synthetic CSV fixtures only; no demo data should leak into live runtime paths.
- Live integration behavior: the browser smoke should exercise the real account import path and the real account scorer.

## Test Plan

- Unit or contract checks: validate the scoring logic change through the existing smoke harness and account calibration checks.
- Targeted Playwright assertions: prove the alias pair groups and the old near-exact name-only pair remains separated.
- Cross-platform checks: run `npm run check` and `npm run check:windows`.
- Manual checks: refresh the launched reviewer/runtime before browser validation so the smoke run uses the current bundle.

## Release Evidence

- Fast check evidence: `npm run check` passed on 2026-06-17.
- Playwright evidence: `npm run smoke:ui:local` passed on 2026-06-17.
- Release pipeline evidence: not applicable for this planning artifact.
- Known gaps: the alias map is intentionally narrow; any future broadening should be justified by labeled data.
