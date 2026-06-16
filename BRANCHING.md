# Branching Workflow

This repo has two local/pushed branches with different purposes.

## Branches

- `main`: private working branch. It may contain local paths, real report IDs, org defaults, and team-specific operating notes.
- `shareable`: approved public-safe source branch. It must not contain exported Salesforce data, real report IDs, tenant IDs, personal machine paths, tokens, or private team-specific config.

The public GitHub mirror is separate from the private repo. Publish `shareable` through the mirror worktree instead of pushing `main` directly to `public/main`:

- Private remote: `origin`
- Public mirror remote: `public`

## Normal Work

Work on `main` by default:

```bash
git switch main
npm run check
git add .
git commit -m "Describe the change"
git push
```

## Updating The Public Mirror

Only update the public mirror deliberately:

```bash
git switch shareable
npm run check
npm run check:shareable
git diff origin/shareable..shareable
# In the public-mirror-sync worktree, start from public/main, cherry-pick the
# commits after the merge-base, and push the resulting branch-based update.
git switch main
```

Do not merge `main` into `shareable` without reviewing the diff for private details first, and do not push `main` directly to `public/main`.

## Branch Protection Decision

The public mirror `main` branch is protected with required checks. The private repo cannot currently enforce private branch protection on the available GitHub plan, so private `main` and `shareable` rely on local checks plus GitHub Actions after push.

If private branch protection becomes available, require `Repository checks` and `UI smoke test` on both private branches. Until then, run the checks before pushing and keep public mirror pushes deliberate.

If mirror reconciliation needs temporary worktrees, scratch repos, or helper links, treat them as disposable repair state and remove them after the mirror push completes.

## Releases

Create releases from known-good tags:

```bash
git tag v0.1.0
git push origin v0.1.0
```

Push the same tag to the public mirror only when the tagged commit is public-safe and has been published through the mirror worktree.
