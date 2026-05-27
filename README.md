# Salesforce Duplicate Reviewer

[![Checks](https://github.com/alexremington/salesforce-duplicate-reviewer-shareable/actions/workflows/checks.yml/badge.svg?branch=main)](https://github.com/alexremington/salesforce-duplicate-reviewer-shareable/actions/workflows/checks.yml)

Local-first browser UI for reviewing likely duplicate Salesforce Account and Contact records.

For local setup, see [SETUP.md](SETUP.md).

## Requirements

- Node.js 18 or newer.
- Salesforce CLI, if you want the helper scripts to fetch data or merge records.
- A locally authenticated Salesforce org alias.

## Run The App

```bash
npm start
```

Then open:

```text
http://127.0.0.1:5180
```

The browser-only UI can also load CSV files directly through the file picker.

## Fetch Salesforce Data

Copy one of the example SOQL files and edit it for your org:

```bash
cp queries/contacts.soql.example queries/contacts.soql
cp queries/accounts.soql.example queries/accounts.soql
```

Run a fetch with environment variables:

```bash
SF_ORG_ALIAS=your-org-alias \
SF_INSTANCE_URL=https://your-domain.my.salesforce.com \
SF_REPORT_ID=contacts \
SF_SOQL_FILE="$PWD/queries/contacts.soql" \
OUT_DIR="$PWD/Output/contacts" \
scripts/run-salesforce-bulk-query.sh
```

Generated CSV/JSON exports are written under `Output/`, which is ignored by Git.

## Local Server Helpers

macOS users can use:

```bash
scripts/start-reviewer-server.sh
```

That helper creates a user LaunchAgent and refreshes a generated static cache under:

```text
~/Library/Application Support/salesforce-duplicate-reviewer/static
```

The project folder remains the source of truth. The local cache only avoids transient OneDrive or cloud-file-provider read errors at runtime.

## Private Configuration

Do not commit real Salesforce access tokens, exported Salesforce data, teammate-specific workbook paths, or private report IDs. Use environment variables and local untracked files for those values.
