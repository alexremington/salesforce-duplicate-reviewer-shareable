# Reviewer Launch Freshness

## Requirement: Scheduler-Launched Reviewer Flows Must Force A Fresh Runtime

The Scheduler-opened Duplicate Reviewer flows MUST restart the reviewer server and refresh the copied runtime before the app opens.

### Scenario: A scheduler job opens Duplicate Reviewer

- **GIVEN** the reviewer server is already running and appears healthy
- **WHEN** a scheduler-launched reviewer script opens Duplicate Reviewer
- **THEN** it invokes `scripts/start-reviewer-server.sh --force-refresh`
- **AND** the existing reviewer server is stopped before the browser opens
- **AND** the copied static/runtime bundle is refreshed from the current source tree
- **AND** the server health timestamp reflects the new launch
- **AND** the browser opens only after the refreshed server becomes ready.

## Requirement: Standalone Reviewer Launch Remains Reusable

The normal Duplicate Reviewer launcher MUST keep its current reuse behavior.

### Scenario: A user starts Duplicate Reviewer directly

- **GIVEN** a user launches Duplicate Reviewer outside the Scheduler handoff path
- **WHEN** the standalone launcher starts the app
- **THEN** it may keep using the existing runtime reuse and mismatch detection rules
- **AND** it does not need to force-refresh the server on every launch.
