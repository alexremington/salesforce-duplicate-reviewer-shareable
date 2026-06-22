## ADDED Requirements

### Requirement: Dataset Export Must Refuse Known-Stale Runtime Sessions

The Dataset + Scores export MUST be disabled or blocked when the reviewer health check reports `runtimeAligned: false`.

#### Scenario: Stale runtime disables dataset export

- **GIVEN** the reviewer has loaded a dataset
- **AND** the cached health state reports `runtimeAligned: false`
- **WHEN** the user attempts to export the dataset with scores
- **THEN** the export does not download a CSV
- **AND** the UI tells the user to refresh the reviewer runtime first.

#### Scenario: Aligned runtime still allows dataset export

- **GIVEN** the reviewer has loaded a dataset
- **AND** the cached health state reports `runtimeAligned: true`
- **WHEN** the user exports the dataset with scores
- **THEN** the CSV downloads normally
- **AND** the export includes the current in-memory `group` and `score` values.
