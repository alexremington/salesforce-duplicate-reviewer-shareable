# Account Recall Audit And Regression Coverage

## Why

The current Account coverage only proves a handful of exact pair outcomes. That leaves a gap between "one pair still matches" and "recall is healthy on a representative account set." The Disney failure history shows that a stale runtime or an export symptom can mask a broader recall regression, so the next guardrail needs to measure where Account pairs are lost.

## What Changes

- add a coverage-focused Account recall audit that reports:
  - how many rows participate in at least one candidate pair;
  - how many candidate pairs survive scoring at the active threshold;
  - how many groups are formed;
  - which pruning stage eliminated each lost pair;
- add a named Disney-based regression fixture that exercises obvious alias and commentary-normalized Account matches;
- keep the existing dataset-with-scores export shape unchanged;
- preserve the current Account scorer unless the audit proves a specific pruning layer is suppressing valid matches;
- add a group-rate floor regression so a representative Account dataset cannot silently collapse to near-zero recall.

## Defaults

- treat the audit as a diagnostic first, not a scoring rewrite;
- only widen recall in the layer that the audit identifies as the loss point;
- keep the new regression isolated to Account behavior so Contact workflows remain unchanged.
