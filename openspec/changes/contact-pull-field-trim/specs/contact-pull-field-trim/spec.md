## ADDED Requirements

### Requirement: Staging And Prod Contact Pulls Share The Trimmed Field Contract

The checked-in staging and prod Contact export definitions MUST omit the clearly unused Contact fields `AccountId`, `Title`, and `Department` while keeping the existing fields Duplicate Reviewer still relies on.

#### Scenario: Both Contact exports use the same minimal schema

- **WHEN** the staging or prod Contact SOQL file is inspected
- **THEN** it includes `Id`, `Name`, `FirstName`, `LastName`, `Email`, `Phone`, `MobilePhone`
- **AND** it includes `OtherPhone`, `HomePhone`, `AssistantPhone`
- **AND** it includes `Account.Name`, `MailingStreet`, `MailingCity`, `MailingState`, `MailingPostalCode`, `MailingCountry`
- **AND** it includes `LeadSource` and `CreatedDate`
- **AND** it does not include `AccountId`, `Title`, or `Department`.

### Requirement: Scheduler And Reviewer Regression Checks Must Match The Trimmed Contract

The scheduler and reviewer contract checks MUST assert the same trimmed Contact field set so the two job paths stay aligned.

#### Scenario: Contract checks fail on the removed fields

- **WHEN** the scheduler or reviewer contract regression reads the Contact query
- **THEN** it fails if `AccountId`, `Title`, or `Department` are present
- **AND** it continues to pass when the trimmed Contact dataset loads and scores normally in Duplicate Reviewer.
