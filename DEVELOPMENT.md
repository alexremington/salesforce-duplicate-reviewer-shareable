# Developer Guide

This app is a dependency-free browser tool. `public/index.html` loads `public/styles.css` and `public/app.js` directly, and server-backed matching uses `public/matching-worker.js`; there is no bundler, package manager, or build step.

## File Map

- `public/index.html`: App shell, import controls, collapsible panels, review pane, and static button/section markup.
- `public/styles.css`: Layout, panel, group-list, detail-window, batch-action, and responsive styling.
- `public/app.js`: JSON/CSV parsing, field mapping, duplicate detection, review state, rendering, recent-file storage, and export. Worker lifecycle orchestration is delegated to the shared `ManagedWorkerClient` helper copied under `public/vendor/managed-app/scripts/`.
- `public/matching-worker.js`: Web Worker entry point for parsing datasets and calculating match groups off the UI thread.
- `scripts/check-account-calibration.js`: Node regression check for exported account or contact label CSVs.
- `README.md`: User-facing usage notes.

## Runtime Flow

1. A JSON or CSV dataset is loaded by file input, drag/drop, recent-file reload, staging auto-load, or demo data.
2. Server-backed loads route parsing and matching through `public/matching-worker.js`; file-only loads fall back to the same logic on the main thread. Large JSON imports use the worker-backed ingest path first, then defer matching until the user explicitly continues.
3. `stageRowsForReview()` stores original row objects in `state.rows`, adds a stable `__rowIndex`, infers headers, and auto-maps fields from `OBJECT_CONFIG`.
4. `recompute()` calls `buildGroupsAsync()` with the current object type, mapping, threshold, and High Recall mode.
5. `buildGroupsAsync()` gets a cached scoring context, generates candidate pair keys, scores candidate pairs, unions threshold-passing pairs into connected components, summarizes each group from all pairwise scores, filters groups by the threshold, then sorts them.
6. `render()` updates the source panel, field mapping, metrics, match group list, navigation state, and active detail view.
7. User decisions, pair-level calibration labels, field-resolution choices, separated records, and selected batch groups live in `state`.
8. `exportDecisions()` writes duplicate decisions to a canonical-record CSV download.
9. Review/workspace state for real dataset loads is persisted in IndexedDB and restored by dataset key when the same dataset is loaded again.
10. The same workspace state can be exported and imported as JSON through `Export > Workspace` and `Import > Workspace`; pair-level calibration labels still have separate CSV export/import for compatibility.

## State Model

`state.rows` preserves the source CSV values. Rendering and export should use these original rows.

Matching should use prepared rows created by `prepareRows()` through `getScoringContext()`. Prepared rows contain normalized values such as parsed contact names, normalized websites, normalized phone numbers, and normalized account addresses. This avoids repeatedly normalizing the same row for every candidate pair. Account scoring contexts also include field-frequency stats so common values can be discounted as positive evidence.

Person-name normalization is punctuation-sensitive for exact checks. For example, `Su-Lin` is not literally the same normalized token as `Su Lin`, and apostrophes remain part of the normalized name token. Fuzzy name similarity may relax punctuation with a score cap below 100%, so punctuation variants can be clustered as likely duplicates without being treated as exact string matches. `parsePersonName()` preserves ordered `nameElements` instead of discarding leading initials or treating every token as a first/last-name component. Contact scoring uses `nameElementSequenceScore()`, which first does cheap ordered-subsequence checks before falling back to string similarity. Derived first/last values are used only for candidate buckets; `explicitFirstName` and `explicitLastName` drive first/last field-score display when source columns exist. Company and account-name normalization strips internal commentary vocabulary such as `DO-NOT-USE`, `inactive`, `duplicate`, `deprecated`, `FKA`, `formerly known as`, and `DBA` before removing legal suffixes. `entityNameSimilarity()` gives strong but non-exact credit when one multi-token company/account name is an ordered token subsequence of the other. Non-name fields still use broader normalization where punctuation is usually formatting noise.

Important state fields:

- `objectType`: `contact` or `account`.
- `datasetKey`: hash-like key built from object type, mapped headers, row count, record keys, names, and subtitles for restoring saved review state.
- `reviewStateStatus`: Source-panel text for review-state restore/save feedback.
- `isLoadingFile` / `loadingFileName`: transient CSV-loading state shown before parsing and matching finish.
- `mapping`: internal field key to CSV header name.
- `groups`: sorted duplicate clusters produced by `buildGroups()`.
- `selectedGroupKey`: currently displayed cluster.
- `selectedGroupKeys`: batch-selected clusters.
- `decisions`: review decisions keyed by group key.
- `trainingLabels`: pair-level calibration labels keyed by object type plus record keys.
- `trainingPairIndexes`: currently displayed calibration pair index per group.
- `trainingConfidence`: default confidence value applied to newly labeled pairs.
- `fieldResolutions`: accepted values for discrepant fields.
- `separatedRecords`: records removed from a cluster during review.
- `threshold`: minimum pair and final group score shown in the UI.
- `highRecallMode`: enables slower, broader candidate generation.
- `sortDirection`: `desc` by default, or `asc` to reverse the visible match-group order.
- `hideLabeledGroups`: hides groups with a duplicate/not-duplicate decision or fully labeled active calibration pairs.

Recent-file records include `objectType` so reloading a recent CSV restores whether it was loaded as Contacts or Accounts. The record ID also prefixes the object type, allowing the same file name to be stored once per object type.

Review/workspace-state records are stored in the same IndexedDB database under `REVIEW_STATE_STORE`. They are keyed by `state.datasetKey` rather than file name alone, and include training labels, duplicate/not-duplicate decisions, field-resolution overrides, separated-record choices, merge results, merge-master selections, and source dataset metadata. `restoreReviewStateForCurrentDataset()` runs after `recompute()` so group-key-scoped state can be validated against the current groups before rendering.

If an exact `datasetKey` lookup misses, restore falls back to compatible saved states with the same object type, row count, file name, and header signature. This protects users when the dataset-key algorithm changes; fallback restores are immediately saved again under the current key.

## Matching Pipeline

The matching path has four stages:

1. `getScoringContext()` prepares normalized rows once and builds account field-frequency stats when needed.
2. `getContactCandidatePairs()` / `getAccountCandidatePairs()` create buckets that find likely pairs without comparing every row to every other row on large imports.
3. `scoreCandidatePairs()` calls `scoreContactPair()` / `scoreAccountPair()` and keeps only pairs whose score meets the current threshold.
4. `collectPairGroups()` unions passing pairs, and `summarizeGroup()` recalculates every pair inside the cluster so the group score reflects the whole group, not just the highest-scoring pair.

Candidate generation uses exact or coarse buckets such as email, LinkedIn URL, phone, website, account-name prefix, postal code plus account token, and address prefix. `pairsFromBuckets()` processes smaller buckets first so narrow evidence is admitted before broad buckets can consume the pair cap. For small files, it also does exhaustive comparison so demo-sized imports do not miss edge cases.

High Recall mode adds composite buckets and subdivides oversized buckets with more specific keys such as website plus country, website plus postal prefix, name token plus postal prefix, and ultimate parent plus country. It raises the candidate-pair cap from `MAX_CANDIDATE_PAIRS` to `MAX_HIGH_RECALL_CANDIDATE_PAIRS`.

Account candidate generation has an additional threshold-aware pruning pass. `accountCandidateUpperBoundScore()` computes an optimistic score from cheap decisive fields before a pair is admitted. If high-weight contradictions such as different currencies, unrelated websites, conflicting postal codes, or short/numeric entity-name conflicts make the pair unable to reach the current threshold, the pair is discarded before it counts against the cap. Street and city are treated optimistically in this pre-screen to avoid dropping plausible variants before full scoring.

## Score Semantics

Pair scores are weighted averages of comparable, non-blank fields. Blank fields are ignored; contradictory non-blank values lower the score. Account scoring also applies an additional penalty when high-weight fields diverge strongly.

Account scoring uses two calibration-aware adjustments:

- Common positive evidence discounting: when account names are not close, exact matches on common broad fields such as currency, country, city, website, state, postal code, street, and ultimate parent contribute less positive score. Mismatches on those fields still count at full weight as negative evidence.
- Name-divergence caps: when account names share context but have different distinctive tokens, the final score is capped. This handles umbrella-organization false positives such as different offices, schools, departments, programs, or agencies.
- Parent branch divergence caps: when `ultimateParentAccount` indicates that one or both account records are branches of a larger parent, `hasAccountParentBranchDivergence()` removes shared parent/context words and compares the remaining branch-specific tokens. Pairs such as a parent department versus a bureau, or two different offices under the same parent, are capped below the default review threshold and are also filtered by the account candidate pre-screen.

Entity-name comparisons use `entityNameSimilarity()`, which starts from normal string similarity and then caps the score when names share broader context but disagree on geographic names, short non-numeric tokens, or numeric-only tokens. This prevents cases such as `University of Colorado` versus `University of Oregon`, `Initiative M` versus `Initiative UK`, or `Clinic 12` versus `Clinic 14` from receiving high near-match credit from shared generic words alone. It can still boost names with a shared distinctive anchor token, such as `Microsoft` in `Microsoft-Europe` and `Microsoft - London`; generic anchor tokens such as `university`, `department`, `association`, and `insurance` are ignored for this boost.

Account field weights:

- Account Currency: `35`
- Website: `25`
- Billing Address total: `20` (`Billing Street` `8`, `Billing City` `3`, `Billing State` `2`, `Billing Postal Code` `5`, `Billing Country` `2`)
- Ultimate Parent Account: `12`
- Name: `8`

Contact field weights:

- Ordered Name elements: `40`
- ZI Person LinkedIn URL: `25`
- Phone: `18`
- Email: `12`
- Company / Account: `10`

Name remains the highest-weighted contact signal in aggregate, but it is scored as an ordered sequence rather than as separate first-name and last-name boxes. Company / Account remains strong enough that same-last-name contacts with similar but different first names, such as `Francis` / `Francois` or `Frances` / `Francis`, do not override disagreement on Company / Account. Exact-name Contact pairs are also capped below the default threshold when Company is strongly different and there is no strong corroborating Email, LinkedIn, or Phone evidence; this prevents sparse files from treating an exact name plus a weak company string match as sufficient proof. Business/government email-domain corroboration is allowed to override that sparse-company cap, including related domain roots such as `raytheon.com` and `raytheon.com.au`; generic personal domains are excluded from that corroboration.

Entitled Contact mirrors are a Contact-only hard exclusion. If a loaded Contact's mapped `Mirror of` lookup resolves to another loaded Contact by Salesforce ID or mirrored display name, the pair scores as a non-duplicate, is excluded from duplicate-group formation, and carries the `Entitled Contact mirror` reason.

The staging source report for `00OVZ000003DjaH2AS` is Contact-only and does not expose `Mirror Of` in the report metadata or CSV headers. Any Contact-level mirror field must therefore be supplied by a companion source or post-export normalization step before Duplicate Reviewer matching starts.

The group score is the average of every pair score in the active cluster. `minPairScore` is tracked separately and displayed as a cohesion warning. `matchedFieldPercent` is the average share of comparable fields whose pair score is at least `MATCHED_FIELD_THRESHOLD`.

Groups are sorted by:

1. Match score, descending.
2. Matched-field percentage, descending.
3. Minimum pair score, descending.
4. Number of records, descending.
5. Stable group key, ascending.

## Adding Or Changing Fields

All supported fields are declared in `OBJECT_CONFIG`.

For a new field:

1. Add it to the object’s `fields` aliases so it can be mapped from CSV headers.
2. Add it to `displayFields` if it should appear in the comparison table and exported canonical-record CSV.
3. Add a user-facing label to `FIELD_LABELS`.
4. If it should affect duplicate detection, add normalization to `prepareContactRow()` or `prepareAccountRow()`.
5. Add bucket logic only if the field is selective enough to identify candidates.
6. Add score logic and a field weight in the relevant score constants.

Avoid adding broad fields, such as currency, as candidate buckets by themselves. Broad fields are better as weighted comparison evidence after more selective buckets identify candidate pairs.

## Rendering

Rendering is intentionally centralized through `render()`, with targeted render functions for each surface:

- `renderSource()`
- `renderMapping()`
- `renderMetrics()`
- `renderGroups()`
- `renderDetail()`

When changing state from user actions, prefer calling the smallest render function that refreshes the affected surface. Use full `render()` after recomputing groups or switching objects.

The app shell is a fixed-height frame. The left control pane and the central review pane are separate scroll containers, so navigation through match groups should not move the entire page or top bar.

`loadFile()` calls `beginFileLoad()` before reading the chosen CSV. That renders an immediate loading acknowledgment in the Source panel and review pane, then waits for the next browser paint before parsing and matching so large files do not leave the UI looking idle.

`showLoadingModal()` / `hideLoadingModal()` manage the blocking loading overlay. CSV load and recent-file reload keep it visible through parsing, matching, and saved-review-state restore. Large JSON ingest also uses the modal for reading/parsing progress and exposes a cancel action so the previous dataset stays available if the user stops the load before commit. Label import keeps it visible while the exported label CSV is read and matched to the current source rows.

The Match Groups panel owns list-level controls: the sort icon toggles `state.sortDirection`, and the Hide labeled checkbox toggles `state.hideLabeledGroups`. Hidden labeled groups are filtered from the visible list only; their labels and duplicate decisions remain in state and still export normally.

Document-level keyboard shortcuts are routed through explicit handlers. `Enter` advances to the next visible match group and `Shift+Enter` returns to the previous visible match group when focus is not on an editable field, button, or link. Calibration shortcuts use `M`, `N`, `U`, and left/right arrows when focus is not in an editable field.

Group navigation and batch selection should avoid full list renders. `selectGroup()` updates `state.selectedGroupKey`, toggles only the selected row through `renderGroupSelection()`, and then rerenders the detail pane. Checkbox selection updates existing rows through `renderGroupCheckStates()` and refreshes only the batch toolbar. Use `renderGroups()` only when the list contents, separated-record status, decision badges, search result set, or sort order need to change.

## Export Format

`exportDecisions()` emits one row per group marked Duplicate. The row contains:

- `Group Name`: accepted value for the primary name field.
- `Salesforce ID`: ID for the canonical record.
- Field record/accepted-value column pairs for every display field.
- `Duplicate Salesforce IDs`: semicolon-separated IDs for the other active duplicate records.

`selectCanonicalRecord()` chooses the active record with the greatest number of accepted-value matches, then the greatest number of populated display fields, then the lowest stable record key.

Accepted-value suggestions are scored in `scoreResolutionOption()`. The base score favors repeated non-blank values, valid-looking emails, valid-looking websites, valid postal codes, and person-name completeness, while heavily penalizing bad markers such as `DO-NOT-USE`, `inactive`, `duplicate`, `test`, and `unknown`. `createFieldResolutionContext()` computes option sets, baseline accepted values, and cross-field record-confidence scores once per detail render or export. `buildResolutionRecordScores()` adds the record-confidence bonus: a value gets extra credit when it comes from a record that matches more manually accepted or baseline-suggested values in the other display fields. The target field is excluded from that record-confidence calculation to avoid circular reinforcement.

`exportTrainingLabels()` emits one row per labeled pair. The row contains:

- Object type, source file name, group key, group score, and minimum pair score.
- Left/right Salesforce IDs, stable record keys, and display names.
- Current pair score, human label, confidence, score reasons, field-score JSON, and timestamps.

Training labels are intentionally separate from duplicate decisions. Duplicate decisions are group-level workflow output; training labels are pair-level calibration data. `unsure` labels are exported for review history but should not usually be used as positive or negative examples.

`importTrainingLabels()` reads that same export format back into `state.trainingLabels`. It only imports rows for the currently loaded object type, resolves records by Salesforce ID when possible and by exported `row-N` record keys otherwise, and then schedules a review-state save so imported labels become part of IndexedDB persistence.

## Performance Notes

- Normalization belongs in `prepareRows()`, not inside repeated pair scoring.
- Shared score math belongs in `comparableWeightedFields()`, `weightedFieldScore()`, and `applyContradictionPenalty()` so contact and account scoring stay consistent.
- Person-name exact checks should preserve meaningful internal punctuation, especially hyphens and apostrophes. Use `nameSimilarity()` when a punctuation-relaxed fuzzy comparison is intended.
- Candidate bucket size is capped by `MAX_DUPLICATE_BUCKET_SIZE` to avoid accidental huge pair explosions; High Recall mode subdivides oversized buckets instead of skipping them outright.
- Pair count is capped by `MAX_CANDIDATE_PAIRS` in normal mode and `MAX_HIGH_RECALL_CANDIDATE_PAIRS` in High Recall mode to keep the browser responsive. For Accounts, the cap now counts only pairs that survive the optimistic pre-score screen, and raw candidate attempts are capped at `CANDIDATE_ATTEMPT_LIMIT_FACTOR` times the pair cap.
- Searching the group list does not recompute matches; it only filters `state.groups`.
- Moving between match groups should not rebuild the group list. `filteredGroups()` caches visible groups until `state.groups`, search text, sort direction, hide-labeled state, object type, mapping, label count, or decision count changes.
- Repeated selected-group access should go through `findGroupByKey()`, which lazily builds a key-to-group map for the current group array.
- Batch checkbox updates should use `renderGroupCheckStates()` and `renderBatchToolbar()` so the browser does not reparse and recreate the full group list for simple selection changes.
- Calibration label export recomputes pair scores at export time so exported field-score JSON reflects the current mapping and scoring logic.
- `scripts/check-account-calibration.js` recomputes labeled pair scores from the source CSV and exported label CSV, rather than trusting stale exported pair scores.
- Recent files are stored in IndexedDB and capped by `RECENT_FILE_LIMIT`.
- Saved review states are stored in IndexedDB and capped by `REVIEW_STATE_LIMIT`.
- Recent files should preserve object type metadata. Use `recentRecordObjectType()` when reading records and `recentFileId()` when writing records.
- Review-state writes are debounced through `scheduleReviewStateSave()` so rapid labeling does not write on every keystroke immediately.
- `buildDatasetKey()` is on the CSV load path for very large files. Keep it sampled and based on raw mapped field values; do not call `displayName()`, `displaySubtitle()`, or expensive normalization for every row there.
- Large JSON ingest stays size-gated. Small JSON files can still auto-match, but large files should commit a parsed-ready dataset first and only run matching after the explicit follow-up action.
- If `buildDatasetKey()` changes, keep `findCompatibleReviewState()` broad enough to migrate existing browser-saved labels.
- Contact scoring uses per-run caches from `createContactScoreCache()` for repeated name/company/domain sub-scores. Keep those caches local to `createPairScorer()` so they are reused during one recompute but discarded when rows or mapping change.

## Calibration Regression

Use `scripts/check-account-calibration.js` after account or contact scoring changes. It loads the browser app code in a mocked DOM, parses the source CSV with the same parser as the UI, rebuilds account field-frequency stats when needed, recomputes every exported label pair, and reports threshold metrics.

The `--assert-threshold` option turns the report into a regression check. It exits non-zero if a labeled `match` scores below the threshold or a labeled `not_match` scores at or above the threshold. The script intentionally ignores `unsure` labels for pass/fail checks.

Live Salesforce duplicate-item exports are especially useful for account calibration because they surface exact-name pairs that should stay high even when the duplicate set only corroborates them through a shared website, parent, or billing address.

## Best-Practice Alignment

The current logic follows several common deduplication practices: typed normalization, blocking/candidate generation, weighted field scoring, explicit blank-value handling, frequency-aware positive evidence discounting for accounts, contradiction penalties for diverging account fields, whole-cluster scoring, and human review before export.

It is still a deterministic browser-side reviewer, not a calibrated probabilistic or machine-learning deduplication system. It does not learn weights automatically from reviewer labels or estimate source-specific error rates. Those would be the next major upgrades if the workflow needs statistically calibrated match probabilities.

## Verification

There is no test framework. Minimum checks before committing changes:

```bash
node --check public/app.js
node --check scripts/check-account-calibration.js
node scripts/check-account-calibration.js \
  --labels "/path/to/account-training-labels.csv" \
  --source "/path/to/Account.csv" \
  --object account \
  --assert-threshold 86
node scripts/check-account-calibration.js \
  --labels "/path/to/contact-training-labels.csv" \
  --source "/path/to/contact.csv" \
  --object contact \
  --assert-threshold 86
```

Then open `public/index.html` in a browser and verify:

- Demo data loads for Contacts and Accounts.
- Import opens the Contacts/Accounts menu.
- Field Mapping appears after data load.
- Match Controls threshold and High Recall recompute groups.
- Match Groups selects, searches, sorts ascending/descending, hides labeled groups, and navigates correctly.
- Duplicate / Not Duplicate decisions update the group list and export count.
- Pair calibration labels enable the `Export > Labels` menu item and produce a pair-level CSV.
- `Import > Labels` restores an exported label CSV for the currently loaded dataset and enables the `Export > Labels` menu item.
- Reloading the same dataset restores pair labels, group decisions, accepted field choices, and separated-record choices.
- Separating and restoring records updates the active cluster.
- `Export > Decisions` downloads a canonical-record CSV.
