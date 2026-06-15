## ADDED Requirements

### Requirement: JSON Ingest Strategy Must Switch By Size

The app MUST keep the current eager JSON parse-and-match workflow for small files while switching large JSON files to a worker-backed ingest path.

#### Scenario: Small JSON file stays eager

- **GIVEN** a JSON export smaller than the configured large-file threshold
- **WHEN** the user loads the file
- **THEN** the app parses it and runs matching in the current eager flow
- **AND** the loaded dataset becomes reviewable without a separate follow-up ingest step.

#### Scenario: Large JSON file uses deferred matching

- **GIVEN** a JSON export larger than the configured large-file threshold
- **WHEN** the user loads the file
- **THEN** the app parses the dataset in the worker-backed ingest path
- **AND** the loaded dataset becomes reviewable before matching runs
- **AND** matching only runs after the user explicitly continues or applies matching controls.

### Requirement: Large JSON Ingest Must Be Cancelable Without Losing The Previous Dataset

The app MUST provide a cancel action for long-running ingest work and preserve the previously loaded dataset if cancellation happens before the new dataset is committed.

#### Scenario: User cancels during large JSON ingest

- **GIVEN** a dataset is already loaded
- **AND** a new large JSON ingest is in progress
- **WHEN** the user cancels the ingest from the loading modal
- **THEN** the app aborts the in-flight load work
- **AND** the previously loaded dataset remains intact
- **AND** the canceled ingest does not replace the current review state.

### Requirement: Ingest State Must Be Visible During Load

The app MUST expose clear ingest states during a JSON load so users can distinguish reading, parsing, parsed-ready, matching, canceled, and failed conditions.

#### Scenario: Worker-backed ingest reports progress

- **GIVEN** a large JSON export is loading
- **WHEN** the app is reading or parsing the file
- **THEN** the loading UI reports the current ingest phase
- **AND** the loading UI shows progress while the worker-backed ingest runs.

#### Scenario: Deferred match shows parsed-ready state

- **GIVEN** a large JSON export has been parsed successfully
- **WHEN** matching has not yet been started
- **THEN** the app shows the dataset as parsed-ready
- **AND** the user can explicitly start matching from the loaded dataset.
