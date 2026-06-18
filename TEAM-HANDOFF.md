# Team Handoff

## What To Share

Share a GitHub Release archive or a clean clone of the public-safe branch. Do not share local `Output/`, `incoming/`, `logs/`, `node_modules/`, generated exports, or `.env` files.

## Teammate Setup

1. Install Node.js 18 or newer.
2. Install Salesforce CLI if you need Salesforce-backed features.
3. Download or clone the app folder.
4. Copy `.env.example` to `.env` only if Salesforce CLI-backed features are needed.
5. Open `public/index.html` for file-only review, or start the server with the Mac `.command` or Windows `.cmd` launcher.
6. Use `Choose CSV` or `Load Demo` to confirm the UI renders correctly.

For duplicate-label exports, use `Launch Duplicate Labels Export - Mac.command` on macOS or `Launch Duplicate Labels Export - Windows.cmd` on Windows. Those launchers default to the canonical staging Contacts or Accounts CSV when it exists and fall back to prompting only if the file is missing.

For prod Contacts review, use `scripts/run-prod-contacts-bulk-query.sh` after the prod pull completes. It opens Duplicate Reviewer on the `prod-contacts` autoload route with `object=contact`, `notify=1`, `sticky=1`, and `name=salesforce-report-latest.json`.

For prod Accounts review, use `scripts/run-prod-accounts-bulk-query.sh` after the prod pull completes. It opens Duplicate Reviewer on the `prod-accounts` autoload route with `object=account`, `notify=1`, `sticky=1`, and `name=salesforce-report-latest.json`.

For plan-to-implementation session changes, use `/Users/aremington/codex-workspace/apps/automation-shared-resources/docs/SESSION-HANDOFF.md`.
