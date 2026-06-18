# Internal Company Commentary Normalization

## Why

Internal Salesforce naming conventions sometimes append operational commentary to Account and Contact company values. The current normalizer strips a small set of status markers such as `DO-NOT-USE`, but it does not treat broader commentary phrases like `FKA`, `formerly known as`, or `DBA` as removable noise. That leaves the matcher overly sensitive to internal annotation text instead of the underlying company identity.

The account scorer also treats the existing commentary marker as corroborating evidence or as a reason to suppress scope-divergence checks. That turns internal commentary into hidden score bias instead of metadata.

## What Changes

- expand company-name normalization to strip a broader internal-commentary vocabulary before alias and legal-suffix handling;
- reuse the same commentary-stripping helper for Account and Contact company canonicalization so both matchers see the same cleaned company identity;
- keep the commentary flag as metadata only by removing it from Account corroboration and exact-duplicate-floor logic;
- preserve existing curated alias, legal-suffix, and account-scope behavior outside the commentary vocabulary change;
- add regressions that prove a previously unhandled commentary phrase now normalizes to an exact account-name match without breaking the existing alias fixture.

## Defaults

- commentary phrases are removable only when they appear as standalone tokens or obvious separator-delimited variants;
- the change affects matching and canonical comparison only, not export-field suggestions or other downstream resolution behavior;
- exact duplicate decisions still require the existing corroborating fields, but commentary text no longer counts as corroboration by itself.
