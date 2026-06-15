## ADDED Requirements

### Requirement: Visible Contact Excluded Groups

The app MUST surface Contact-only hard-zero exclusion pairs as explicit Match Groups entries when a business rule veto prevents the pair from being treated as a duplicate cluster.

#### Scenario: Mirror-veto pair is visible but not clustered

- **GIVEN** a Contact pair scores `0` because of the Entitled Contact `Mirror of` rule
- **AND** either Contact still participates in another positive duplicate group
- **WHEN** the dataset is matched
- **THEN** the mirrored pair appears as its own explicit excluded Match Group
- **AND** the mirrored Contacts do not appear together inside a normal duplicate cluster
- **AND** any surviving positive duplicate group still appears normally.

### Requirement: Excluded Groups Stay Reviewable But Not Mergeable

The app MUST keep excluded groups reviewable in Evaluate mode while preventing them from entering the Contact merge-review queue.

#### Scenario: Reviewer marks an excluded pair Duplicate

- **GIVEN** an excluded Contact group is selected
- **WHEN** the reviewer marks the group `Duplicate`
- **THEN** that decision is preserved in review state
- **AND** the Salesforce merge panel explains that the group is blocked by a hard-zero exclusion rule
- **AND** the action that queues the group for merge review remains disabled.

### Requirement: Excluded Status Is Filterable

The Match Groups filter model MUST allow reviewers to hide or show excluded groups without moving them into a separate section.

#### Scenario: Excluded status filter is applied

- **GIVEN** a matched Contacts dataset contains both normal duplicate groups and excluded groups
- **WHEN** the reviewer filters Match Groups to `Excluded`
- **THEN** only excluded groups remain visible
- **WHEN** the reviewer filters Match Groups to `Duplicate`
- **THEN** excluded groups are hidden and ordinary duplicate groups remain visible.

### Requirement: Dataset Export Prefers Normal Groups

The dataset export MUST preserve the existing appended `group` and `score` columns while handling excluded groups conservatively.

#### Scenario: Row belongs only to an excluded group

- **GIVEN** a Contact row belongs to an explicit excluded group and no normal duplicate group
- **WHEN** the reviewer exports Dataset + Scores
- **THEN** the row exports the excluded group identifier
- **AND** the `score` column exports `0`.

#### Scenario: Row belongs to both a normal group and an excluded group

- **GIVEN** a Contact row appears in both a normal duplicate group and an excluded group
- **WHEN** the reviewer exports Dataset + Scores
- **THEN** the export uses the normal duplicate group's identifier and score
- **AND** the excluded-only value does not override that duplicate result.
