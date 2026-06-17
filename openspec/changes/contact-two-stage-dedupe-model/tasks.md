## Tasks

- [ ] Add an organization-resolution layer for Contact matching with canonical alias support and fuzzy fallback.
- [ ] Split Contact scoring into legacy and new model paths so both can be evaluated on the same loaded dataset.
- [ ] Add comparison output and regression checks that report legacy-vs-new group counts, pair-score deltas, and any reduction in groups scoring `>= 70`.
- [ ] Preserve explicit zero-score exclusions for mirror relationships and keep ungrouped rows blank in the dataset export.
- [ ] Add named regressions for same-email/same-company variants, alias resolution, and the `>= 70` comparison red-flag.
- [ ] Run the repo validation gates that cover contract behavior and Playwright smoke coverage.
