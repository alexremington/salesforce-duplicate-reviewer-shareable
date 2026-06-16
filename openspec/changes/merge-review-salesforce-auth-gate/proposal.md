# Gate Prod Merge Review on Salesforce Auth Health

## Why

The prod Contacts merge-review flow should stop early when Duplicate Reviewer already knows Salesforce auth is stale. Without that gate, the UI can enter merge review and reach the premerge freshness path even though the health check already reported blocked auth, which leads to a slower and less actionable failure.

## What Changes

- read the cached `/api/health` Salesforce auth flag in the merge UI and disable the merge entry action when auth is blocked;
- show a visible stale-auth warning that tells the user to refresh Salesforce auth before starting merge review;
- prevent `startMergeReviewSession` from issuing premerge freshness checks when auth is already known to be stale;
- keep the existing prod Contacts handoff and runtime alignment behavior unchanged;
- add smoke coverage that proves the blocked state does not send a premerge request.

## Non-Goals

- Do not change the Salesforce auth health check itself.
- Do not add automatic auth retries.
- Do not change the merge payload or merge-confirmation contract.
