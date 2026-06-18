# Prod Accounts Autoload

## Why

The prod Accounts handoff needs to open Duplicate Reviewer on the freshly downloaded prod Accounts dataset with the same fresh-runtime launch discipline already used by the prod Contacts flow.

## What Changes

- add a prod Accounts autoload source alongside the existing staging autoload sources;
- expose the prod Accounts latest JSON and CSV endpoints from the reviewer server;
- route the reviewer startup flow to the canonical `Duplicate Reviewer/prod/Output/prod-accounts/` tree when the prod Accounts launcher starts;
- keep the raw `salesforce-report-latest.json` and `salesforce-report-latest.csv` filenames on disk;
- update docs/contracts and add regression coverage for the canonical prod Accounts path and URL.

## Non-Goals

- Do not change staging Contacts or Accounts autoload behavior.
- Do not change the prod Contacts autoload contract.
- Do not rewrite the Salesforce pull execution logic.
