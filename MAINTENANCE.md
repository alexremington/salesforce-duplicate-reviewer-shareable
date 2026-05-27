# Maintenance

This repo uses a private working branch and a public-safe branch.

## Branches And Remotes

- `main`: private working branch for local paths, real org defaults, and team-specific notes.
- `shareable`: public-safe branch for code and docs that can be published.
- `origin`: private GitHub repo.
- `public`: public mirror repo.

GitHub branch protection is available on the public mirror. The private repo currently cannot use branch protection or rulesets without a GitHub plan upgrade, so local checks and deliberate push commands matter.

## Private Changes

```bash
git switch main
npm run check
git add .
git commit -m "Describe the change"
git push
```

For UI changes, also run:

```bash
npm run smoke:ui
```

## Public Mirror Updates

Only update the public mirror intentionally:

```bash
git switch shareable
npm run check
npm run check:shareable
git push origin shareable
git push public shareable:main
git switch main
```

Review `git diff origin/shareable..shareable` before pushing the public mirror.

## Never Commit

- Exported Salesforce data.
- Real report IDs, org IDs, tenant IDs, access tokens, or secrets.
- Personal machine paths.
- OneDrive sync-state files.
- `Output/`, `incoming/`, `logs/`, `node_modules/`, or browser/test artifacts.

## Health Checks

- `npm run check`: syntax checks and shareable-branch safety scan.
- `npm run check:shareable`: public-safety scan for the selected ref.
- `npm run smoke:ui`: Playwright smoke test for duplicate badges, shortcuts, and mobile layout.
