# Canonical Prod Contacts Path Repair

## Why

The prod Contacts handoff needs to use the same raw Salesforce report naming that the pull job already produces for every environment, instead of a synthetic prod-only filename or a legacy download-prefixed filesystem path.

## What Changes

- pass the canonical prod Contacts CSV path through the reviewer startup flow so the server reads from `Duplicate Reviewer/prod/Output/prod-contacts/`;
- use `salesforce-report-latest.json` and `salesforce-report-latest.csv` as the canonical prod Contacts filenames on disk;
- keep the prod autoload URL contract unchanged;
- update the scheduler and reviewer docs/contracts to describe the canonical prod root and the source-aware recent-file metadata;
- add regression coverage for the canonical prod path and the raw report-latest filenames.

## Non-Goals

- Do not change staging Contacts or Accounts path behavior.
- Do not change the prod autoload URL shape.
- Do not rewrite the Salesforce pull data contract.
