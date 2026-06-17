# Two-Stage Contact Deduplication With Legacy Comparison

## Why

The current Contact matcher treats company text too much like a hard gate, which suppresses plausible same-person matches when company aliases, punctuation, suffixes, or org shorthand differ. The intended model should estimate whether two records represent the same person working at the same company, not whether two company strings are identical.

The new model also needs a durable way to compare itself against the current matcher so we can detect whether the revised logic under-includes candidates. A drop in groups scoring at or above `70` should be treated as a red flag because it likely means the new model is excluding matches that the current model would have retained.

## What Changes

- introduce a two-stage Contact matching model:
  - organization identity resolution first;
  - person identity scoring second, conditioned on the organization result;
- replace exact company-string gating with canonical organization matching plus fuzzy alias/variant handling;
- keep curated organization aliases as first-class inputs to organization resolution;
- use corroborating signals such as email domain, website, address, and parent/ultimate-parent fields to support same-company decisions;
- preserve explicit hard exclusions such as Entitled Contact mirror relationships as zero-score vetoes;
- add a legacy-vs-new comparison path so the same dataset can be scored by both the current matcher and the new matcher;
- record comparison output that highlights changes in group counts and pair scores, with an immediate red flag when the new model produces fewer groups scoring at or above `70` than the legacy model;
- keep the existing review/export workflow intact while making the comparison data available for regression checks and future operator review.

## Defaults

- The first release compares the new model against the current legacy matcher on the same dataset.
- The comparison threshold for red-flagging reductions is `70` unless a repo-specific regression proves a different operational threshold is better.
- Curated organization aliases are preferred over pure fuzzy matching, but fuzzy matching remains available as fallback for unseen variants.
