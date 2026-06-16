# Maintenance

This repo uses a private working branch and a public-safe branch.

## Branches And Remotes

- `main`: private working branch for local paths, real org defaults, and team-specific notes.
- `shareable`: approved public-safe source branch for code and docs that can be published.
- `origin`: private GitHub repo.
- `public`: public mirror repo that is updated from `shareable` through the mirror worktree.

GitHub branch protection is available on the public mirror. The private repo currently cannot use branch protection or rulesets without a GitHub plan upgrade, so local checks and deliberate push commands matter. If private protection becomes available, require `Repository checks` and `UI smoke test`.

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
git diff origin/shareable..shareable
# In the public-mirror-sync worktree, start from public/main, cherry-pick the
# commits after the merge-base, and push the resulting branch-based update.
git switch main
```

Review `git diff origin/shareable..shareable` before pushing the public mirror.
If mirror reconciliation needs temporary worktrees, scratch repos, or helper links, treat them as disposable repair state and remove them after the publish completes.

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
