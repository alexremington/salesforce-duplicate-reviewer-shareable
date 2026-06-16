# Prod Contacts Handoff

## Requirement: Prod Contacts Launch Must Use The Canonical Prod Root

The prod Contacts handoff MUST read and write the canonical `Salesforce Pulls/Duplicate Reviewer/prod/Output/prod-contacts/` tree.

### Scenario: Reviewer starts on the prod dataset

- **GIVEN** a successful prod Contacts pull has written `salesforce-prod-contacts-latest.json` and `salesforce-prod-contacts-latest.csv`
- **WHEN** the launcher opens Duplicate Reviewer with `autoload=prod-contacts`
- **THEN** the reviewer server reads the canonical prod Contacts CSV path from the `Duplicate Reviewer/prod` tree
- **AND** the loaded dataset is the prod Contacts dataset.

## Requirement: Legacy Prod Output Must Be Repaired Once

The prod Contacts launcher MUST copy any existing legacy prod output into the canonical prod root before the reviewer opens.

### Scenario: Legacy output exists in a download-prefixed folder

- **GIVEN** a legacy `download-prod-contacts-for-duplicate-review` output tree exists
- **AND** the canonical prod output tree does not yet contain the latest prod dataset
- **WHEN** the prod Contacts launcher starts
- **THEN** the launcher copies the legacy prod output into the canonical `Duplicate Reviewer/prod/Output/prod-contacts/` tree
- **AND** the reviewer opens against the canonical prod tree without needing a fallback path.

## Requirement: Autoload Contract Stays Stable

The prod Contacts autoload URL MUST keep the existing route and query contract.

### Scenario: Prod launch URL remains unchanged

- **GIVEN** the prod Contacts handoff completes successfully
- **WHEN** the launcher opens Duplicate Reviewer
- **THEN** the URL includes `autoload=prod-contacts`, `object=contact`, `notify=1`, `sticky=1`, and `name=salesforce-prod-contacts-latest.json`
- **AND** the app keeps its existing prod latest-file endpoint contract.
