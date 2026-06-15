# Contact Excluded Mirror Groups

## Why

Entitled Contact `Mirror of` pairs are currently blocked from normal duplicate clustering, but reviewers cannot see those excluded pairs in Match Groups. That hides a hard business veto inside scoring logic and leaves merge readiness ambiguous when a reviewer still labels the pair `Duplicate`.

## What Changes

- surface Contact-only hard-zero exclusion pairs as explicit Match Groups entries without changing the underlying mirror veto;
- keep excluded groups visible by default, but make them filterable inside the existing Match Groups filter model;
- show explicit excluded copy and reason text in the list and detail views;
- keep evaluation and training-label workflows available for excluded groups;
- block excluded groups from the Salesforce merge-review queue even if a reviewer marks them `Duplicate`;
- keep dataset export conservative by preferring normal duplicate groups over excluded-only groups when a record belongs to both.

## Defaults

- v1 applies only to the Entitled Contact `Mirror of` hard-zero rule.
- Excluded groups stay in the main Match Groups list and sort with the rest of the list.
- Excluded groups are visible by default.
- The merge surface shows a hard-block warning and disables queue entry for excluded groups.
