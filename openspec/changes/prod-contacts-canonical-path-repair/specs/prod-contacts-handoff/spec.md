# Prod Contacts Handoff

## Requirement: Prod Contacts Launch Must Use The Canonical Prod Root

The prod Contacts handoff MUST read and write the canonical `Salesforce Pulls/Duplicate Reviewer/prod/Output/prod-contacts/` tree.

### Scenario: Reviewer starts on the prod dataset

- **GIVEN** a successful prod Contacts pull has written `salesforce-report-latest.json` and `salesforce-report-latest.csv`
- **WHEN** the launcher opens Duplicate Reviewer with `autoload=prod-contacts`
- **THEN** the reviewer server reads the canonical prod Contacts CSV path from the `Duplicate Reviewer/prod` tree
- **AND** the loaded dataset is the prod Contacts dataset.

## Requirement: Prod Contacts Must Use The Raw Report Filenames

The prod Contacts launcher MUST use the raw Salesforce report filenames in the canonical prod root.

### Scenario: Prod Contacts output uses the raw report file names

- **GIVEN** the canonical prod output tree contains the latest prod dataset
- **WHEN** the prod Contacts launcher starts
- **THEN** the on-disk filenames are `salesforce-report-latest.json` and `salesforce-report-latest.csv`
- **AND** the reviewer opens against the canonical prod tree without needing a synthetic prod-only filename.

## Requirement: Autoload Contract Stays Stable

The prod Contacts autoload URL MUST keep the existing route and query contract.

### Scenario: Prod launch URL remains unchanged

- **GIVEN** the prod Contacts handoff completes successfully
- **WHEN** the launcher opens Duplicate Reviewer
- **THEN** the URL includes `autoload=prod-contacts`, `object=contact`, `notify=1`, `sticky=1`, and `name=salesforce-report-latest.json`
- **AND** the app keeps its existing prod latest-file endpoint contract.

### Scenario: Legacy prod recent-file rows reopen through the canonical endpoint

- **GIVEN** a browser already has a legacy prod Contacts recent-file row whose stored metadata still points at the retired prod-only name or lacks an endpoint
- **WHEN** the user reopens that recent file
- **THEN** Duplicate Reviewer resolves it to `/api/prod-contacts/latest.json`
- **AND** the source label remains `Latest Prod Contacts`
- **AND** the user can reopen the dataset without restoring the retired filesystem path.
