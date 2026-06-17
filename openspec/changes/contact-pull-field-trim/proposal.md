# Trim Contacts Pull Fields

## Why

The staging and prod Contacts pull contracts should stay aligned, but both currently export fields Duplicate Reviewer does not need for its current dedupe, merge-safety, or refresh flows:

- `OtherPhone`
- `HomePhone`
- `AssistantPhone`
- `LinkedIn__c`
- `LID__LinkedIn_Company_Id__c`

Keeping those fields in the exported query expands the producer contract without adding value to the reviewer. Trimming them from both Contacts pull paths reduces payload size while keeping the fields the app still relies on.

## What Changes

- replace the checked-in staging and prod Contacts SOQL with the approved query-only field set;
- remove non-query Contact fields from the reviewer model wiring, mapping, and contract checks;
- update scheduler and reviewer regression checks so they assert the exact approved field set instead of the older wider schema;
- keep `ziPersonDirectPhone__c` mapped into the existing alternate-phone signal and keep `ZI_Person_LinkedIn_URL__c` as the single LinkedIn signal.

## Non-Goals

- Do not remove `Id`, `Name`, `FirstName`, `LastName`, `Email`, `Phone`, `MobilePhone`, `Account.Name`, `MailingStreet`, `MailingCity`, `MailingState`, `MailingPostalCode`, `MailingCountry`, `LeadSource`, `CreatedDate`, `ziPersonDirectPhone__c`, or `ZI_Person_LinkedIn_URL__c`.
- Do not change the reviewer merge logic or the prod autoload URL contract.
- Do not add any new non-query columns to the Contact model.
