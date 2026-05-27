# Maintenance

This branch is intended to remain public-safe.

## Branches And Mirrors

- Keep private/local settings on a private working branch.
- Keep this branch free of exported data, real report IDs, tenant IDs, personal machine paths, tokens, and team-specific config.
- If this branch is mirrored to a separate public repository, push it deliberately after checks pass.

## Local Changes

```bash
npm run check
git add .
git commit -m "Describe the change"
```

For UI changes, also run:

```bash
npm run smoke:ui
```

## Public-Safety Checks

```bash
npm run check:shareable
scripts/check-shareable.sh HEAD
```

Review the diff before publishing:

```bash
git diff origin/shareable..shareable
```

## Never Commit

- Exported Salesforce data.
- Real report IDs, org IDs, tenant IDs, access tokens, or secrets.
- Personal machine paths.
- OneDrive sync-state files.
- `Output/`, `incoming/`, `logs/`, `node_modules/`, or browser/test artifacts.
