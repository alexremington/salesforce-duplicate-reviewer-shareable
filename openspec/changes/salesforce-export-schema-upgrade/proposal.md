# Salesforce Dedupe Export Schema Upgrade

## Why

The current Salesforce export schema still leans on a narrow set of fields, so Duplicate Reviewer loses standard dedupe signal that is already available in most org exports. Contacts are missing common name, phone, mailing address, and account-context fields. Accounts are missing the standard hierarchy and optional business descriptors that help the matcher separate near-duplicates from coincidental matches.

## What Changes

- expand the checked-in Salesforce query definitions for Contacts and Accounts to include the standard fields that carry the most dedupe signal;
- keep the current object mappings backward-compatible so existing headers and custom fields still map where possible;
- teach the matcher about the newly exported high-signal Contact fields, especially phone variants and mailing address;
- keep the current account scorer focused on the strongest canonical signals while allowing the new export columns to flow through the mapping and review surfaces;
- add contract coverage that proves the new columns are present and still auto-map correctly;
- add a scoring regression that proves the new Contact address/phone signal is actually consumed by the matcher.

## Defaults

- The change is additive only; no existing column names are removed.
- Standard Salesforce fields are preferred over custom fields when both are available.
- Optional Account descriptors such as Industry, Type, NumberOfEmployees, AnnualRevenue, and DUNSNumber are exported when present, but they remain secondary to the primary dedupe signals.
