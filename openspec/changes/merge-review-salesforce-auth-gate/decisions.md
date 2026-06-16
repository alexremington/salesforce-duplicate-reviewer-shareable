# Technical Decisions

- Treat stale Salesforce auth as a hard stop for merge review rather than a recoverable warning.
- Reuse the cached health state already surfaced by `/api/health`; do not add a live auth probe in the UI.
- Keep the blocked state conservative: the app should surface the warning, disable entry, and avoid any premerge request until the user refreshes Salesforce auth and reloads the flow.
