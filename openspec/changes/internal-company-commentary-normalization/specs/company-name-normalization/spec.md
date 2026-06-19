## ADDED Requirements

### Requirement: Company Canonicalization Must Ignore Internal Commentary Vocabulary

Account-name and Contact-company canonicalization MUST strip internal commentary phrases before alias resolution and legal-suffix removal.

#### Scenario: Commentary phrases do not block an exact canonical company match

- **GIVEN** two Account or Contact rows refer to the same company
- **AND** one value includes internal commentary such as `FKA`, `A/K/A`, `AKA`, `formerly known as`, `DBA`, `doing business as`, `C/O`, `care of`, `T/A`, `trading as`, or `do not use`
- **WHEN** the rows are normalized for scoring
- **THEN** the commentary phrase is removed before canonical comparison
- **AND** the remaining company identity can still resolve to an exact match when the non-commentary tokens are otherwise equivalent.

#### Scenario: Existing alias handling remains intact

- **GIVEN** two company values already normalize through a curated alias such as `The Ohio State University` and `OSU`
- **WHEN** the matcher runs after the commentary-vocabulary change
- **THEN** the alias pair still resolves to the same canonical company identity
- **AND** the new commentary stripping does not weaken that match.

### Requirement: Internal Commentary Markers Must Not Count As Duplicate Evidence

Internal commentary markers MUST remain metadata only and MUST NOT act as corroborating duplicate evidence or suppress account-scope divergence logic.

#### Scenario: Commentary markers do not raise an exact-duplicate floor on their own

- **GIVEN** an Account pair shares a company name after normalization
- **AND** the only extra signal is that one row carries an internal commentary marker
- **WHEN** the pair is scored
- **THEN** the commentary marker alone does not raise the pair to an exact-duplicate floor
- **AND** the scorer still relies on the existing corroborating fields.
