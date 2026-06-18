## ADDED Requirements

### Requirement: Shareable Managed Files Must Be Derived Deterministically

The repo MUST provide a deterministic way to derive managed `shareable` files from `main` so public-safe updates do not depend on manual conflict cleanup.

#### Scenario: Shareable projection is generated from main

- **GIVEN** `main` contains the current private source of truth
- **WHEN** the shareable sync workflow runs
- **THEN** the managed `shareable` files are rewritten from the `main` projection using the repo sanitization rules
- **AND** the result is suitable for the public-safe branch.

### Requirement: Shareable Verification Must Detect Projection Drift

The repo MUST fail shareable validation when the `shareable` branch no longer matches the deterministic sanitized projection.

#### Scenario: Manual shareable edits drift from the sanctioned projection

- **GIVEN** a managed file on `shareable` differs from the sanitized projection from `main`
- **WHEN** `npm run check:shareable` runs
- **THEN** the check fails
- **AND** the failure identifies the managed file drift instead of relying only on generic private-pattern scans.
