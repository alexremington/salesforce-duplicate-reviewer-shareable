# Setup

## Requirements

- Node.js 18 or newer.
- Salesforce CLI if you want the helper scripts to fetch data or merge records.
- A local Salesforce org alias for each user.

## Run Locally

```bash
npm start
```

Open:

```text
http://127.0.0.1:5180
```

The browser UI can also load CSV files directly through the file picker.

## Team Notes

- Keep generated exports in `Output/`; Git ignores that folder.
- Keep personal org aliases, report IDs, access tokens, and machine paths out of committed files.
- Run `npm run check` before committing changes.
- Run `npm run smoke:ui` after UI changes.
