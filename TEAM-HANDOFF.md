# Team Handoff

## What To Share

Share a GitHub Release archive or a clean clone of the public-safe branch. Do not share local `Output/`, `incoming/`, `logs/`, `node_modules/`, or `.env` files.

## Teammate Setup

1. Install Node.js 18 or newer.
2. Download or clone the app folder.
3. Copy `.env.example` to `.env` only if Salesforce CLI-backed features are needed.
4. Open `public/index.html` for file-only review, or start the server with the Mac `.command` or Windows `.cmd` launcher.
5. Use `Choose CSV` or `Load Demo` to confirm the UI renders correctly.

For duplicate-label exports, double-click `Launch Duplicate Labels Export - Mac.command` on macOS or `Launch Duplicate Labels Export - Windows.cmd` on Windows. Those launchers default to the canonical staging Contacts or Accounts CSV when it exists, fall back to prompting only if the file is missing, then write app-ready training labels under `Output/` by default.

For prod Contacts review, run `scripts/run-prod-contacts-bulk-query.sh` after the prod pull completes. It opens Duplicate Reviewer on the `prod-contacts` autoload route with `object=contact`, `notify=1`, `sticky=1`, and `name=salesforce-report-latest.json`, keeps the prod latest files separate from staging through source-aware recent-file metadata, and logs whether the reviewer server was reused or started fresh.

For prod Accounts review, run `scripts/run-prod-accounts-bulk-query.sh` after the prod pull completes. It opens Duplicate Reviewer on the `prod-accounts` autoload route with `object=account`, `notify=1`, `sticky=1`, and `name=salesforce-report-latest.json`, keeps the prod latest files separate from staging through source-aware recent-file metadata, and logs whether the reviewer server was reused or started fresh.

If mirror reconciliation needs temporary worktrees, scratch repos, or helper links, treat them as disposable repair state and remove them before handoff.

Use the launcher for normal server-backed work. When latest Contact or Account exports exist under `Output/`, the app adds them to `Recent files` automatically.

For local UI smoke tests, run `npm run sync:shared` after shared resource updates, then run `npm run setup:playwright` once from any managed app. That creates a shared Playwright install in `Automation Projects/Apps/.shared-playwright`.

## Release Notes

- Release note: fixed staging-alias canonicalization for Duplicate Reviewer org selection, validated by `npm run check`, `npm run check:windows`, and `npm run smoke:ui:local`.

## Updating

Replace the app folder with the latest release archive, or pull the latest approved branch. Keep each user's `.env`, exports, logs, and Salesforce CLI authentication local to that user's machine.

## Troubleshooting

- If the app does not start, run `node --version` and confirm it is 18 or newer.
- If Contact merge actions fail, run `sf org display --target-org <alias> --json` to confirm Salesforce CLI authentication.
- Account merge is intentionally disabled; use Account review decisions for evaluation/export only.
- If a CSV does not load, try the demo data. If demo data works, inspect the CSV headers and encoding.

## Maintainer Checklist

- Run `npm run check`.
- Run `npm run smoke:ui:local` after UI changes so the smoke test starts and stops its own isolated server.
- Use [docs/FEATURE-BRIEF.md](docs/FEATURE-BRIEF.md) before larger workflow changes.
- Check [docs/UI-CHECKLIST.md](docs/UI-CHECKLIST.md) for visual or interaction changes.
- Use [docs/DEFINITION-OF-DONE.md](docs/DEFINITION-OF-DONE.md) before sharing a completed change.
- Update [SETUP.md](SETUP.md) when setup steps change.
- Create a `v*` tag when a version is ready for teammates so GitHub Actions packages a release archive.
