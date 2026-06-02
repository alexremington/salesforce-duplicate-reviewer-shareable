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
Double-click: Launch Duplicate Reviewer.command
```

Windows:

```text
Double-click: Launch Duplicate Reviewer.cmd
```

Windows PowerShell fallback:

```powershell
.\Launch Duplicate Reviewer.ps1
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
