# Salesforce Duplicate Review

[![Checks](https://github.com/alexremington/salesforce-duplicate-reviewer/actions/workflows/checks.yml/badge.svg?branch=main)](https://github.com/alexremington/salesforce-duplicate-reviewer/actions/workflows/checks.yml)

A static browser UI for reviewing possible duplicate Salesforce Contact and Account records from CSV exports.

For local setup, see [SETUP.md](SETUP.md). For teammate handoff, see [TEAM-HANDOFF.md](TEAM-HANDOFF.md).

## Open The App

Open `index.html` in a browser. No server or package install is required for CSV review.

To use server-backed features such as Salesforce merge actions or staging auto-load URLs, start the local server:

macOS:

```text
Double-click: Launch Duplicate Reviewer.command
```

Windows PowerShell:

```powershell
.\Launch Duplicate Reviewer.ps1
```

Manual start:

```bash
npm start
```

Click `Choose CSV`, then choose whether the import is a `Contacts` or `Accounts` file. Recent files remember which object type was used when they were loaded, so the same file can be reopened with the correct object type.

After a CSV is selected, the Source panel and review pane show a loading state while the browser parses the file and calculates match groups.

A loading modal appears while CSV data is being read, matched, and restored from saved review state. The same modal appears while exported label CSVs are imported.

## Supported Matching Fields

Contacts:

- `Full Name` or `Full_Name__c`
- `First Name`
- `Last Name`
- `Company` or `Account Name`
- `Email`
- `ZI Person LinkedIn URL`
- `Phone`
- `ZI Phone`
- `Mobile`

Accounts:

- `Name`
- `Website`
- `Billing Street`, `Billing City`, `Billing State`, `Billing Postal Code`, `Billing Country`
- A single `Billing Address` column can be mapped to `Billing Street`
- `Account Currency`
- `Ultimate Parent Account`

When a Contact file has `Full Name` instead of split first and last name columns, the matcher parses ordered name elements while ignoring common prefixes, titles, suffixes, and credentials such as `Dr.`, `Hon.`, `Jr.`, `III`, `PhD`, `MD`, and `Esq.`. Matching uses those ordered elements rather than forcing every token into first-name and last-name boxes, so `Gaige Flint` and `C. Gaige Flint` agree because `Gaige` appears before `Flint` in both names while the initial `C` is still preserved. The `First Name` and `Last Name` comparison rows show source values only when those fields exist in the CSV. Company and account-name normalization ignores operational markers such as `DO-NOT-USE`, `inactive`, `duplicate`, and `deprecated`.

## Match Score

The review threshold controls how close records must be before they appear as a duplicate group. Blank values are ignored rather than counted against a pair.

Account scoring gives the most weight to Account Currency, then Website, Billing Address, Ultimate Parent Account, and Name. Contact scoring gives the most weight to ordered Name elements, followed by LinkedIn, phone, email, and Company / Account. Company / Account still carries more weight than an isolated first-name difference. Exact Contact name alone is capped below the default threshold when Company is strongly different and there is no corroborating email, LinkedIn, or phone match. Matching business/government email domains, or related domain roots such as `raytheon.com` and `raytheon.com.au`, can corroborate an exact-name Contact match; generic personal email domains are not treated as organizational corroboration. Punctuation is preserved for exact person-name checks, so `Su Lin` and `Su-Lin` are not treated as literally identical strings, although they can still score as likely duplicates. Entity names treat conflicting geographic, short, and numeric tokens as significant, so `University of Colorado` / `University of Oregon` and `Initiative M` / `Initiative UK` do not receive near-match credit from their shared generic words. Strong shared company anchors, such as `Microsoft` in `Microsoft-Europe` and `Microsoft - London`, can still support a Contact match.

Account scoring is also calibration-aware. When account names diverge, exact matches on common broad fields such as currency, country, website, city, or ultimate parent are discounted as positive evidence. Distinct sub-entity names can cap the score so departments, offices, schools, programs, or agencies under the same umbrella organization do not look like strong duplicates. When Ultimate Parent Account indicates that one or both records are branches of a larger entity, the scorer removes shared parent/context words and gives extra weight to the remaining branch-specific differences.

For groups with more than two records, the displayed match score is the average score across every record pair in the group. The UI also shows the minimum pair score so loosely connected groups are easier to spot. Groups are sorted by match score, matched-field percentage, minimum pair score, record count, and then a stable key.

High Recall mode is slower but searches additional composite buckets and subdivides oversized buckets so likely matches are less likely to be missed. For Account files, the app also screens candidate pairs before they count against the pair cap: selective buckets are considered first, and pairs with exact contradictions that make them unable to reach the current threshold are discarded early. The Match Groups panel has a sort icon that toggles visible groups between descending and ascending order.

## Review And Export

The UI auto-maps common Salesforce header names, lets you adjust field mapping, supports batch judgment of selected clusters, shows the current judgment state, lets you choose accepted values for discrepant fields, and lets you separate individual records from a cluster. The Match Groups toolbar can hide groups that already have a duplicate/not-duplicate judgment or have all active calibration pairs labeled. Accepted field values use a suggested default that favors clean, non-empty values, avoids markers such as `DO-NOT-USE`, `inactive`, `duplicate`, `test`, and `unknown`, and gives a bonus to values from records that match more accepted or suggested values in the other fields.

Exported duplicate decisions use one row per duplicate group. The first column is the accepted group name, the next column is the Salesforce ID of the canonical record, the field columns show that canonical record’s values beside the accepted values, and the final column lists the Salesforce IDs of the other duplicate records.

## Salesforce Merge

When the local reviewer server is running, Contact duplicate groups can be handled in the `Merge` workflow. Mark the group as `Duplicate`, choose the master Contact, review field-level retained-value overrides, type `MERGE`, and confirm the browser prompt to send the merge to Salesforce.

Merges run server-side through the Salesforce SOAP API so access tokens are not exposed in the browser. The server uses `SF_ACCESS_TOKEN` when present; otherwise it gets a token from Salesforce CLI with `sf org display --target-org "$SF_ORG_ALIAS" --json`. The default merge target is the staging sandbox:

```text
SF_ORG_ALIAS=politico-staging
SF_INSTANCE_URL=https://politico--staging.sandbox.my.salesforce.com
SF_API_VERSION=v67.0
```

The merge action supports `Contact` records only. Account matching remains available in the `Evaluate` workflow, but Account merge is disabled because downstream Finance dependencies need business logic outside this app. The Contact merge keeps the selected master record's field values and asks Salesforce to move related records from the duplicate records to the master. Accepted values in the reviewer remain review/export guidance and are not written as field updates during merge. Groups with more than three active records are merged through successive SOAP merge requests, two duplicate records at a time.

Merge results are saved with the browser review state and server-side audit entries are appended to:

```text
/Users/aremington/Library/CloudStorage/OneDrive-POLITICO/Automation Projects/salesforce-duplicate-reviewer/Output/salesforce-merge-log.jsonl
```

## Salesforce Bulk Export

The Salesforce Reports REST API returns only the first 2,000 report detail rows. For large exports, use Bulk API 2.0 with a SOQL query that matches the report's fields and filters.

Bulk API doesn't execute a report ID directly. Use `scripts/fetch-salesforce-report-metadata.js` to save report metadata for `00OVq00000CxYd3MAF`, translate the metadata into SOQL, and save the query as `queries/report-00OVq00000CxYd3MAF.soql`.

```bash
SF_ACCESS_TOKEN="$(sf org display --target-org politico --json | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>process.stdout.write(JSON.parse(s).result.accessToken))')" \
  node scripts/fetch-salesforce-report-metadata.js \
  --report 00OVq00000CxYd3MAF \
  --out incoming/report-00OVq00000CxYd3MAF-metadata.json
```

Run the Bulk API query manually with:

```bash
/Users/aremington/Library/CloudStorage/OneDrive-POLITICO/Automation Projects/salesforce-duplicate-reviewer/scripts/run-salesforce-bulk-query.sh
```

The wrapper gets an access token from Salesforce CLI org alias `politico`, runs `queries/report-00OVq00000CxYd3MAF.soql`, writes a timestamped CSV for app compatibility, writes a timestamped JSON export, and updates both `salesforce-report-latest.json` and `salesforce-report-latest.csv`:

```text
/Users/aremington/Library/CloudStorage/OneDrive-POLITICO/Automation Projects/salesforce-duplicate-reviewer/Output/report-00OVq00000CxYd3MAF
```

For the staging sandbox Contacts report:

```text
org alias: politico-staging
instance: https://politico--staging.sandbox.my.salesforce.com
report ID: 00OVZ000003DjaH2AS
report name: New All Contacts Report
query: /Users/aremington/Library/CloudStorage/OneDrive-POLITICO/Automation Projects/salesforce-duplicate-reviewer/queries/report-00OVZ000003DjaH2AS.soql
latest JSON: /Users/aremington/Library/CloudStorage/OneDrive-POLITICO/Automation Projects/salesforce-duplicate-reviewer/Output/staging-contacts/salesforce-report-latest.json
compatibility CSV: /Users/aremington/Library/CloudStorage/OneDrive-POLITICO/Automation Projects/salesforce-duplicate-reviewer/Output/staging-contacts/salesforce-report-latest.csv
```

The staging report has nearly one million Contact rows, so use the staging Bulk API wrapper rather than the Reports API:

```bash
/Users/aremington/Library/CloudStorage/OneDrive-POLITICO/Automation Projects/salesforce-duplicate-reviewer/scripts/run-staging-contacts-bulk-query.sh --dry-run
/Users/aremington/Library/CloudStorage/OneDrive-POLITICO/Automation Projects/salesforce-duplicate-reviewer/scripts/run-staging-contacts-bulk-query.sh
/Users/aremington/Library/CloudStorage/OneDrive-POLITICO/Automation Projects/salesforce-duplicate-reviewer/scripts/run-staging-contacts-bulk-query.sh --background
```

For the staging sandbox Accounts report:

```text
org alias: politico-staging
instance: https://politico--staging.sandbox.my.salesforce.com
report ID: 00OVZ000003Dm572AC
report name: New Accounts Report
query: /Users/aremington/Library/CloudStorage/OneDrive-POLITICO/Automation Projects/salesforce-duplicate-reviewer/queries/report-00OVZ000003Dm572AC.soql
latest JSON: /Users/aremington/Library/CloudStorage/OneDrive-POLITICO/Automation Projects/salesforce-duplicate-reviewer/Output/staging-accounts/salesforce-report-latest.json
compatibility CSV: /Users/aremington/Library/CloudStorage/OneDrive-POLITICO/Automation Projects/salesforce-duplicate-reviewer/Output/staging-accounts/salesforce-report-latest.csv
```

```bash
/Users/aremington/Library/CloudStorage/OneDrive-POLITICO/Automation Projects/salesforce-duplicate-reviewer/scripts/run-staging-accounts-bulk-query.sh --dry-run
/Users/aremington/Library/CloudStorage/OneDrive-POLITICO/Automation Projects/salesforce-duplicate-reviewer/scripts/run-staging-accounts-bulk-query.sh
/Users/aremington/Library/CloudStorage/OneDrive-POLITICO/Automation Projects/salesforce-duplicate-reviewer/scripts/run-staging-accounts-bulk-query.sh --background
```

After a successful staging export, the wrapper starts a local Duplicate Reviewer server at:

```text
http://127.0.0.1:5180
```

It then opens the app with the latest staging compatibility CSV auto-loaded. The app sends a macOS Notification Center alert after it finishes loading and matching the CSV, so the alert means the file is ready to review. The staging wrappers use a 60-second Bulk API polling interval by default to reduce Salesforce API calls for large exports.

The staging auto-load URL includes `sticky=1`, so the local server also opens a small macOS alert dialog after the CSV is ready. That dialog stays onscreen until dismissed. Notification Center itself controls whether the notification is a temporary banner or a persistent alert in macOS System Settings.

The local server can also be started manually:

```bash
scripts/start-reviewer-server.sh
```

The server LaunchAgent writes logs outside OneDrive to avoid macOS File Provider launchd restrictions:

```text
~/Library/Logs/salesforce-duplicate-reviewer
```

The starter refreshes a generated local static cache before launching or checking the server:

```text
~/Library/Application Support/salesforce-duplicate-reviewer/static
```

The OneDrive project folder is still the source of truth. The cache is only a runtime copy used so static app loads are not blocked by transient OneDrive file-provider read errors. If a compatibility CSV cannot be read from OneDrive, the server falls back to the matching `salesforce-report-latest.json` export and synthesizes the CSV response for the browser.

The staging Contacts and Accounts wrappers are registered in the scheduler UI under `Duplicate Reviewer exports`.

## Calibration Labels

Each duplicate group includes a compact pair-labeling panel. Use `Match`, `Not Match`, or `Unsure` to label the displayed pair; the panel advances to the next unlabeled pair in the group. The global confidence selector applies to new labels. Keyboard shortcuts are available when focus is not inside an input: `Enter` for the next match group, `Shift+Enter` for the previous match group, `M` for Match, `N` for Not Match, `U` for Unsure, and left/right arrows for pair navigation.

Labels and review choices are saved automatically in the browser for the loaded dataset. When the same dataset is loaded again, the app restores saved pair labels, duplicate/not-duplicate judgments, accepted field values, and separated-record choices from local IndexedDB storage. The Source panel shows when saved review state is restored or saved.

`Export Labels` downloads a pair-level calibration CSV with object type, group score, pair score, Salesforce IDs, names, label, confidence, reasons, and field-score JSON. `Import Labels` restores labels from one of those exported CSVs into the currently loaded dataset and then saves them in local browser storage. `Unsure` rows are exported for auditability, but they should usually be excluded from model calibration.

You can check the exported labels against the current scorer with:

```bash
node scripts/check-account-calibration.js \
  --labels "/Users/aremington/Downloads/account-training-labels (1).csv" \
  --source "/Users/aremington/Downloads/Account.csv" \
  --object account \
  --assert-threshold 86
```

For Contact labels:

```bash
node scripts/check-account-calibration.js \
  --labels "/Users/aremington/Downloads/contact-training-labels.csv" \
  --source "/Users/aremington/Desktop/contact.csv" \
  --object contact \
  --assert-threshold 86
```

The script recomputes pair scores from the source CSV, summarizes precision and recall at common thresholds, and fails if any labeled match falls below the asserted threshold or any labeled non-match remains above it.

Developer documentation is in [DEVELOPMENT.md](DEVELOPMENT.md).
