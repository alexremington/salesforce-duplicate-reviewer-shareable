# Salesforce Duplicate Reviewer

[![Checks](https://github.com/alexremington/salesforce-duplicate-reviewer-shareable/actions/workflows/checks.yml/badge.svg?branch=main)](https://github.com/alexremington/salesforce-duplicate-reviewer-shareable/actions/workflows/checks.yml)

Local-first browser UI for reviewing likely duplicate Salesforce Account and Contact records from Salesforce JSON datasets or CSV exports.

For local setup, see [SETUP.md](SETUP.md). For teammate handoff, see [TEAM-HANDOFF.md](TEAM-HANDOFF.md).

## Requirements

- Node.js 18 or newer.
- Salesforce CLI, if you want the helper scripts to fetch data or merge Contact records.
- A locally authenticated Salesforce org alias.

## Run The App

Open `public/index.html` in a browser for manual JSON or CSV review.

macOS:

```text
Double-click: Launch Duplicate Reviewer - Mac.command
```

Windows:

```text
Double-click: Launch Duplicate Reviewer - Windows.cmd
```

Windows PowerShell fallback:

```powershell
.\scripts\launch-duplicate-reviewer-windows.ps1
```

Manual start:

```bash
npm start
```

Then open:

```text
http://127.0.0.1:5180
```

Click `Import`, then choose whether the import is a `Contacts` or `Accounts` file. Recent files remember which object type was used when they were loaded, so the same file can be reopened with the correct object type.

Server-backed latest loads use JSON datasets and a Web Worker so parsing and duplicate matching do not block the UI. Manual JSON and CSV imports remain supported.

Use `DUPLICATE_REVIEWER_PORT` in `.env` to choose a different Duplicate Reviewer port. The launcher intentionally uses this app-specific setting so it can run alongside Launch Scheduler.

Opening `index.html` directly remains supported for manual JSON or CSV uploads. If it is opened from disk while the local server is already running, the page redirects itself to the server-backed URL so the latest Scheduler exports and staging auto-load URLs keep working. If the server is not running, the static page stays open as a manual-upload fallback.

For day-to-day review work, use `Launch Duplicate Reviewer - Mac.command` on macOS or `Launch Duplicate Reviewer - Windows.cmd` on Windows. PowerShell users can run `scripts\launch-duplicate-reviewer-windows.ps1` as a fallback. The server-backed app automatically adds the latest configured Contact and Account JSON datasets to `Recent files` when those exports exist, so the launcher is the single entry point for continuing work after downloads finish.

On Windows, if OneDrive shows a notice that `Node.js JavaScript Runtime` is downloading `salesforce-report-latest.json`, Node is not being installed. The local app server is reading a cloud-only OneDrive dataset file. Right-click the app folder, `Output` folder, or latest export folder in File Explorer and choose `Always keep on this device` before loading recent datasets.

## Workflows

- `Evaluate`: review match scores, mark groups Duplicate or Not Duplicate, label pairs, and export model-feedback labels.
- `Merge`: prepare Contact merges with a master Contact radio choice plus field-level retained-value overrides.
Account matching remains available in `Evaluate`. Account merge is intentionally disabled because downstream Finance dependencies require business logic outside this app.

## Salesforce Merge

When the local reviewer server is running, Contact duplicate groups can be handled in the `Merge` workflow. Mark the group as `Duplicate`, choose the master Contact, review field-level retained-value overrides, review the queued merge preview, and then confirm the merge to send it to Salesforce.

Merges run server-side through the Salesforce SOAP API so access tokens are not exposed in the browser. The server uses `SF_ACCESS_TOKEN` when present; otherwise it gets a token from Salesforce CLI with `sf org display --target-org "$SF_ORG_ALIAS" --json`.
After a successful merge, the merge result card exposes a CSV status report and the server writes the same report to `Output/salesforce-merge-report-latest.csv` for later review.
The CSV now keeps the Salesforce ID and the record snapshot fields for the master and duplicate Contacts so the report can serve as a usable merge log.

Current app-enforced rules:

- A group must be marked `Duplicate` before merge controls can submit.
- Every active record in the merge group must be a Contact with a valid `003` Salesforce ID. If the loaded Contacts dataset is missing IDs, the app blocks merge and, for server-backed latest Contacts data, offers to refresh the Contacts pull that includes the `Id` field.
- One Contact is selected as the master. The selected master keeps its field values by default, and Salesforce reparents related records from duplicate Contacts to that master.
- `Lead Source` is locked to the oldest created Contact when both `Lead Source` and `Created Date` are available. If the selected master has a different Lead Source, the merge payload updates the master to the oldest-created value.
- The browser collects intent and preview confirmation, but merge execution stays server-side so Salesforce access tokens are not exposed to the browser.
- The user must review the queued merge preview before the merge is sent to Salesforce.
- Before every merge, the server re-reads the selected Contacts from Salesforce and blocks the merge if any selected record is missing, deleted, or changed from the loaded reviewer data.

Field-retention policy for merges:

- `Marketing Opt-Out`: if true on any merged record, retain true on the surviving Contact.
- `Invalid Email`: if true on any merged record, retain true on the surviving Contact.
- `International Opt-In`: if true on any merged record, retain true on the surviving Contact.
- `Marketo Exclusion`: if true on any or all merged records, set the surviving Contact value to false.
- Other Contact fields are not expected to create merge conflicts unless a team-specific rule is added. The selected master value can remain the default retained value.
- Related object detail should be preserved from both sides of the merge. Salesforce should keep or reparent campaigns, activities, entitlements, opportunities, and other related records from the duplicate Contacts to the surviving master Contact.

Before every merge, the server re-reads the selected Contacts from Salesforce and compares the current values with the rows loaded in the reviewer. Missing IDs, missing records, deleted records, or changed records block the merge. If the loaded dataset came from a server-backed latest Contacts endpoint, the browser asks whether to refresh that dataset automatically; approving the prompt reloads the latest export before the merge can be tried again. Manual file uploads cannot be refreshed automatically because the browser does not retain permission to reread the original local path.

Salesforce merges still do not have a guaranteed one-click rollback in this app. Each attempted merge writes the requested master, duplicate IDs, pre-merge freshness result, and a recovery snapshot to the audit log. If the loaded Contacts report was produced with the rollback-capable JSON contract, the recovery snapshot also carries the related-record inventory captured at report pull time. If a merge needs to be unwound, use the audit entry to identify the master and duplicate Contacts, restore deleted duplicate Contacts from Salesforce recovery tooling if still available, then manually repair related-record ownership and any master-field changes.

Merge results are saved with the browser review state and server-side audit entries are appended to `Output/salesforce-merge-log.jsonl`.

## Calibration Labels

Each duplicate group includes a pair-labeling panel. Use `Match`, `Not Match`, or `Unsure` to label the displayed pair; the panel advances to the next unlabeled pair in the group.

Labels and review choices are saved automatically in the browser for the loaded dataset. When the same dataset is loaded again, the app restores saved pair labels, duplicate/not-duplicate judgments, accepted field values, and separated-record choices from local IndexedDB storage. You can also export the whole workspace from `Export > Workspace` and import it again from `Import > Workspace` after reloading the matching dataset.

Use `Export > Labels` to download a pair-level calibration CSV. Use `Import > Labels` to restore labels from one of those exported CSVs into the currently loaded dataset and save them in local browser storage. `Unsure` rows are exported for auditability, but they should usually be excluded from model calibration.

## Fetch Salesforce Data

Copy one of the example SOQL files and edit it for your org:

```bash
cp queries/contacts.soql.example queries/contacts.soql
cp queries/accounts.soql.example queries/accounts.soql
cp queries/account-duplicate-record-items.soql.example queries/account-duplicate-record-items.soql
cp queries/contact-duplicate-record-items.soql.example queries/contact-duplicate-record-items.soql
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

## Salesforce Duplicate Sets To Match Labels

If Salesforce is already flagging duplicates, you can turn those duplicate sets into training labels for Match Score calibration.

1. Export the duplicate items query above with `scripts/run-salesforce-bulk-query.sh`.
2. Export your source dataset with the matching account or contact query.
3. Convert both CSVs into app-ready labels:

```bash
node scripts/export-salesforce-duplicate-training-labels.js \
  --duplicate-items "/path/to/duplicate-record-items.csv" \
  --source "/path/to/source.csv" \
  --object account \
  --output "/path/to/account-duplicate-training-labels.csv"
```

The exported CSV uses the same label format as the app's `Export > Labels` workflow, so you can load it back into Duplicate Reviewer or feed it into `scripts/check-account-calibration.js`.

For a one-command version that fetches the duplicate-items CSV and then builds the label file, use:

```bash
node scripts/run-salesforce-duplicate-label-export.js \
  --object account \
  --source "/path/to/accounts.csv" \
  --output "/path/to/account-duplicate-training-labels.csv"
```

Use `--object contact` for the Contact workflow. The Node launcher writes object-specific outputs under `Output/account-duplicate-label-export/` or `Output/contact-duplicate-label-export/` by default.

If you want a clickable launcher instead of Terminal, open:

- `Launch Duplicate Labels Export - Mac.command`
- `Launch Duplicate Labels Export - Windows.cmd`

Those launchers default to the canonical staging Contacts or Accounts CSV when it exists, fall back to prompting only if the file is missing, then call the portable Node launcher.

## Local Server Helpers

For day-to-day review work, use `Launch Duplicate Reviewer - Mac.command` on macOS or `Launch Duplicate Reviewer - Windows.cmd` on Windows. PowerShell users can run `scripts\launch-duplicate-reviewer-windows.ps1` as a fallback. All three launchers delegate to `scripts/launch-local-app.js`, which chooses an available local port, prepares the per-user static cache, starts the server, checks readiness, and opens the browser. On Windows, the launcher also adds common Node.js and Salesforce CLI install folders to the app process PATH so Explorer-launched sessions can find tools installed outside the inherited PATH.

The local server can also be started manually:

```bash
scripts/start-reviewer-server.sh
```

That helper creates a user LaunchAgent and refreshes a generated static cache under:

```text
~/Library/Application Support/salesforce-duplicate-reviewer/static
```

The project folder remains the source of truth. The cache only avoids transient OneDrive or cloud-file-provider read errors at runtime. The server exposes `salesforce-report-latest.json` as the native review dataset and keeps CSV endpoints available for compatibility. If one format cannot be read from OneDrive, the server falls back to the other format when possible.

The Scheduler-launched staging reviewer scripts always force a fresh reviewer runtime before opening the browser. That path restarts any existing reviewer server and recopies the current static bundle so the opened app cannot reuse stale cached assets from an earlier launch.

## Private Configuration

Do not commit real Salesforce access tokens, exported Salesforce data, teammate-specific workbook paths, or private report IDs. Use environment variables and local untracked files for those values.
