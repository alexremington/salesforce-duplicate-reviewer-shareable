## ADDED Requirements

### Requirement: Contact Matching Must Resolve Organization Identity Before Person Identity

Contact deduplication MUST evaluate organization identity as a distinct step before deciding whether two records are the same person.

#### Scenario: Same person with equivalent organization names can still match

- **GIVEN** two Contact rows have strong person evidence such as exact email, strong name similarity, or corroborating phone/LinkedIn signals
- **AND** the organization names differ only by punctuation, suffix, abbreviation, or a known alias
- **WHEN** the records are scored
- **THEN** the organization resolver treats the company names as equivalent or plausibly equivalent
- **AND** the person score can still reach the duplicate threshold when the combined evidence is strong enough.

#### Scenario: Clearly different companies still suppress a person match

- **GIVEN** two Contact rows have strong person evidence
- **AND** the organization evidence indicates clearly different institutions
- **WHEN** the records are scored
- **THEN** the person score is capped or vetoed so the pair does not become a duplicate match.

### Requirement: Organization Resolution Must Support Canonical Aliases And Fuzzy Variants

The organization-resolution step MUST support canonical organization identities and curated aliases, with fuzzy similarity as a fallback for unseen variants.

#### Scenario: Known aliases resolve to the same organization

- **GIVEN** a canonical organization and one or more curated aliases, such as a formal name, short name, acronym, or punctuation-variant form
- **WHEN** two Contact rows refer to those variants
- **THEN** the organization resolver can map them to the same canonical organization
- **AND** the score rationale can explain the alias or normalization path.

#### Scenario: Fuzzy organization variants are not exact-string dependent

- **GIVEN** two Contact rows refer to the same institution with different punctuation or suffixes
- **WHEN** the records are scored
- **THEN** the organization score can remain positive without requiring exact string equality.

### Requirement: Legacy And New Contact Matchers Must Be Comparable On The Same Dataset

The app MUST preserve the current Contact matcher as a legacy baseline while also producing results from the new matcher for comparison.

#### Scenario: Both scoring models can be evaluated against one dataset

- **GIVEN** a loaded Contact dataset
- **WHEN** the matcher runs
- **THEN** the legacy model result and the new model result are both available for the same records
- **AND** pair- and group-level differences can be inspected without reloading the dataset.

#### Scenario: Reduction in high-confidence groups is a red flag

- **GIVEN** the legacy matcher produces a set of groups with score at or above `70`
- **WHEN** the new matcher produces fewer such groups for the same dataset
- **THEN** the comparison output flags the reduction as a regression risk
- **AND** the comparison does not silently treat the drop as acceptable.

### Requirement: Explicit Hard Exclusions Must Remain Zero-Score Cases

Entitled Contact mirror relationships and any other explicit veto rules MUST continue to produce an explicit zero-score exclusion rather than a normal duplicate match.

#### Scenario: Mirror relationships still hard-block the pair

- **GIVEN** two Contacts are linked by the Entitled Contact mirror rule
- **WHEN** the pair is scored
- **THEN** the pair receives a zero-score exclusion with an explicit reason
- **AND** it does not enter the duplicate cluster as a normal match.

### Requirement: Existing Export And Review Behavior Must Remain Stable

The existing review workflow MUST continue to distinguish duplicate groups, excluded groups, and ungrouped rows.

#### Scenario: Ungrouped rows remain blank in the dataset export

- **GIVEN** a Contact row does not belong to any duplicate group or explicit exclusion group
- **WHEN** the dataset-with-scores export is generated
- **THEN** the row remains blank in `group` and `score`.

#### Scenario: Explicitly excluded rows still export zero

- **GIVEN** a Contact row belongs to an explicit exclusion group
- **WHEN** the dataset-with-scores export is generated
- **THEN** the row exports `0` for `score` and retains the exclusion grouping.
