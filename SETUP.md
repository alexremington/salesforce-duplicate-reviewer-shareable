# Setup

## Requirements

- Node.js 18 or newer.
- Salesforce CLI if you want the helper scripts to fetch data or merge records.
- A local Salesforce org alias for each user.

## Run Locally

Copy the example config if you need Salesforce CLI-backed features such as merge actions or helper scripts:

```bash
cp .env.example .env
```

Edit `.env` for your own Salesforce org alias and instance URL. Do not commit `.env`.

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

Open:

```text
http://127.0.0.1:5180
```

Use `DUPLICATE_REVIEWER_PORT` in `.env` only if you need to move Duplicate Reviewer off its default port.

The browser UI can also load CSV files directly through the file picker.

Use the launcher for normal review work after Scheduler downloads finish. The server-backed app automatically adds the latest Contact and Account exports to `Recent files` when those exports exist.

Use `scripts/run-prod-contacts-bulk-query.sh` when you need the prod Contacts pull to open Duplicate Reviewer automatically on the freshly downloaded prod dataset. The prod launcher opens `/?autoload=prod-contacts&object=contact&notify=1&sticky=1&name=salesforce-prod-contacts-latest.json`, keeps its output under `Output/prod-contacts/` with `salesforce-prod-contacts-latest.*` filenames, repairs any legacy download-prefixed prod output into the canonical `Salesforce Pulls/Duplicate Reviewer/prod/` tree before the reviewer opens, and fails if the reviewer handoff cannot be opened.

On Windows, OneDrive may show `Node.js JavaScript Runtime` downloading a recent dataset when the latest export is cloud-only. Mark the app folder, `Output` folder, or latest export folder as `Always keep on this device` in File Explorer so recent dataset loads do not need OneDrive hydration.

For UI smoke tests on a local machine, install Playwright once for all managed apps:

```bash
npm run sync:shared
npm run setup:playwright
```

## Team Notes

- Keep generated exports in `Output/`; Git ignores that folder.
- Keep personal org aliases, report IDs, access tokens, and machine paths in `.env` or another local-only file.
- Run `npm run check` before committing changes.
- Run `npm run smoke:ui` after UI changes.
- Publish team-ready versions from GitHub Releases instead of asking teammates to pull an arbitrary branch.
