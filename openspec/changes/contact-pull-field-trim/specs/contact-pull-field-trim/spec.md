## ADDED Requirements

### Requirement: Staging And Prod Contact Pulls Share The Trimmed Field Contract

The checked-in staging and prod Contact export definitions MUST match the approved query-only Contact field set and MUST NOT include any extra Contact columns.

#### Scenario: Both Contact exports use the same minimal schema

- **WHEN** the staging or prod Contact SOQL file is inspected
- **THEN** it includes exactly `Id`, `Name`, `FirstName`, `LastName`, `Email`, `Phone`, `MobilePhone`, `Account.Name`, `MailingStreet`, `MailingCity`, `MailingState`, `MailingPostalCode`, `MailingCountry`, `LeadSource`, `CreatedDate`, `ziPersonDirectPhone__c`, and `ZI_Person_LinkedIn_URL__c`
- **AND** it does not include `AccountId`, `Title`, `Department`, `OtherPhone`, `HomePhone`, `AssistantPhone`, `LinkedIn__c`, or `LID__LinkedIn_Company_Id__c`.

### Requirement: Scheduler And Reviewer Regression Checks Must Match The Trimmed Contract

The scheduler and reviewer contract checks MUST assert the same trimmed Contact field set so the two job paths stay aligned.

#### Scenario: Contract checks fail on the removed fields

- **WHEN** the scheduler or reviewer contract regression reads the Contact query
- **THEN** it fails if any field outside the approved Contact export set is present
- **AND** it continues to pass when the approved Contact dataset loads and scores normally in Duplicate Reviewer.
