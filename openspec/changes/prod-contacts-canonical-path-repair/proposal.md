# Canonical Prod Contacts Path Repair

## Why

The prod Contacts handoff currently depends on two different path assumptions:

- the Salesforce pull writes the dataset into the canonical `Salesforce Pulls/Duplicate Reviewer/prod/Output/prod-contacts/` tree;
- the reviewer server must also read that same canonical prod tree when `autoload=prod-contacts` opens the app.

Earlier prod output may still exist in a legacy download-prefixed folder from before the canonical root was settled. Without a migration step, the reviewer can open successfully but fail to find the latest prod dataset.

## What Changes

- pass the canonical prod Contacts CSV path through the reviewer startup flow so the server reads from `Duplicate Reviewer/prod/Output/prod-contacts/`;
- add a one-time repair step that copies any existing legacy prod output into the canonical prod folder before the reviewer opens;
- keep the prod autoload URL contract unchanged;
- update the scheduler and reviewer docs/contracts to describe the canonical prod root and the repair behavior;
- add regression coverage for the canonical prod path and the repair step.

## Non-Goals

- Do not change staging Contacts or Accounts path behavior.
- Do not change the prod autoload URL shape.
- Do not rewrite the Salesforce pull data contract.
