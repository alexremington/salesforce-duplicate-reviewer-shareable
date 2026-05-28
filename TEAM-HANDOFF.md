# Team Handoff

## What To Share

Share a GitHub Release archive or a clean clone of the public-safe branch. Do not share local `Output/`, `incoming/`, `logs/`, `node_modules/`, or `.env` files.

## Teammate Setup

1. Install Node.js 18 or newer.
2. Download or clone the app folder.
3. Copy `.env.example` to `.env` only if Salesforce CLI-backed features are needed.
4. Open `index.html` for file-only review, or start the server with the Mac or Windows launcher.
5. Use `Choose CSV` or `Load Demo` to confirm the UI renders correctly.

Use the launcher for normal server-backed work. When latest Contact or Account exports exist under `Output/`, the app adds them to `Recent files` automatically.

For local UI smoke tests, run `npm run sync:shared` after shared resource updates, then run `npm run setup:playwright` once from any managed app. That creates a shared Playwright install in the Automation Projects folder.

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
