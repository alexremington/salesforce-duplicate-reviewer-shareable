## ADDED Requirements

### Requirement: Salesforce Contact Exports Include Standard Deduplication Fields

The checked-in Contact export definition MUST include the standard Salesforce fields that carry the highest dedupe signal for Contacts while preserving the existing compatible columns.

#### Scenario: Contact export includes the expanded standard schema

- **WHEN** the Contact Salesforce export definition is inspected
- **THEN** it includes `Id`, `Name`, `FirstName`, `LastName`, `Email`, `Phone`, `MobilePhone`
- **AND** it includes `OtherPhone`, `HomePhone`, `AssistantPhone`
- **AND** it includes `Account.Name` or `AccountId`
- **AND** it includes `MailingStreet`, `MailingCity`, `MailingState`, `MailingPostalCode`, `MailingCountry`
- **AND** it includes `Title`, `Department`, `LeadSource`, `CreatedDate`
- **AND** any existing compatible columns remain present.

### Requirement: Salesforce Account Exports Include Standard Hierarchy and Business Fields

The checked-in Account export definition MUST include the standard Salesforce fields that carry the highest dedupe signal for Accounts while preserving existing compatibility with the current matcher.

#### Scenario: Account export includes the expanded standard schema

- **WHEN** the Account Salesforce export definition is inspected
- **THEN** it includes `Id`, `Name`, `Website`, `Phone`
- **AND** it includes `BillingStreet`, `BillingCity`, `BillingState`, `BillingPostalCode`, `BillingCountry`
- **AND** it includes `CurrencyIsoCode`
- **AND** it includes `Parent.Name` or the org's canonical ultimate-parent field
- **AND** it includes optional business descriptors when they are available in the org, including `Industry`, `Type`, `NumberOfEmployees`, `AnnualRevenue`, and `DUNSNumber`
- **AND** any existing compatible columns remain present.

### Requirement: New Contact Fields Must Remain Auto-Mappable And Influence Matching

The importer and matcher MUST keep the current mappings working while consuming the newly exported Contact fields that carry clear dedupe signal.

#### Scenario: Standard Contact headers still auto-map

- **GIVEN** a Contact CSV contains the expanded standard Salesforce headers
- **WHEN** the importer auto-maps the headers
- **THEN** the existing Contact mappings still resolve
- **AND** the phone variants and mailing address fields map to the new supported Contact inputs.

#### Scenario: Contact mailing address changes affect scoring

- **GIVEN** two Contact rows match on name, company context, and communication fields
- **AND** the only meaningful difference is the mailing address
- **WHEN** the pair is scored
- **THEN** the mailing address fields contribute to the score or the score rationale
- **AND** the result differs from the same pair with matching mailing address values.
