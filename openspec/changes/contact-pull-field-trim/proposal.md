# Trim Contacts Pull Fields

## Why

The staging and prod Contacts pull contracts should stay aligned, but both currently export three fields Duplicate Reviewer does not need for its current dedupe, merge-safety, or refresh flows:

- `AccountId`
- `Title`
- `Department`

Keeping those fields in the exported query expands the producer contract without adding value to the reviewer. Trimming them from both Contacts pull paths reduces payload size while keeping the fields the app still relies on.

## What Changes

- remove `AccountId`, `Title`, and `Department` from the checked-in staging Contacts SOQL;
- remove the same three fields from the prod Contacts SOQL so both paths share the same minimal contract;
- update scheduler and reviewer regression checks so they assert the trimmed field set instead of the older wider schema;
- keep the remaining Contact fields that Duplicate Reviewer still uses for matching, merge safety, and refresh behavior.

## Non-Goals

- Do not remove `Id`, `Name`, `FirstName`, `LastName`, `Email`, `Phone`, `MobilePhone`, `Account.Name`, `LeadSource`, `CreatedDate`, or the mailing and secondary phone fields.
- Do not change the reviewer merge logic or the prod autoload URL contract.
- Do not expand the trim beyond the three clearly unused fields in this change.
