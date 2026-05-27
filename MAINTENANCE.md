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

## Health Checks

- `npm run check`: syntax checks and shareable-branch safety scan.
- `npm run check:shareable`: public-safety scan for the selected ref.
- `npm run smoke:ui`: Playwright smoke test for CSV loading, duplicate/not-duplicate badges, shortcuts, empty states, and mobile layout.

## Releases

Tags that start with `v` run the release workflow and publish a source archive:

```bash
git tag v0.1.0
git push origin v0.1.0
```
