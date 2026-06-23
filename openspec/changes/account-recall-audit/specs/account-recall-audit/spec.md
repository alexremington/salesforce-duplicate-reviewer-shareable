## ADDED Requirements

### Requirement: Account Recall Audit Must Report Coverage And Loss Stages

The app's Account coverage checks MUST report how far records progress through candidate admission, scoring, and grouping.

#### Scenario: Representative Account coverage can be audited

- **GIVEN** a representative Account dataset with named alias and commentary-normalized examples
- **WHEN** the audit runs
- **THEN** it reports how many rows participate in at least one candidate pair
- **AND** how many candidate pairs survive scoring at the active threshold
- **AND** how many groups are formed
- **AND** which pruning stage eliminated each lost pair.

### Requirement: Representative Account Recall Must Preserve A Floor

The Account matcher MUST keep a representative recall floor on the regression fixture so obvious duplicates cannot vanish silently.

#### Scenario: Disney exemplar and sibling aliases stay surfaced

- **GIVEN** an Account fixture that includes a Disney exemplar and other obvious alias/commentary-normalized matches
- **WHEN** the matcher runs at the active threshold
- **THEN** the Disney exemplar is grouped
- **AND** the overall group count stays above the expected floor for that fixture.

### Requirement: Account Export Shape Must Remain Stable

The dataset-with-scores Account export MUST keep its current shape unless the audit proves export selection is the actual failure.

#### Scenario: Export columns remain unchanged

- **GIVEN** an Account dataset that loads successfully
- **WHEN** the dataset-with-scores export is generated
- **THEN** the export keeps the existing group and score columns and does not introduce a new schema.
