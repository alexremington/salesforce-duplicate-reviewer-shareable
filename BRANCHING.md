# Branching Workflow

This repo has two local/pushed branches with different purposes.

## Branches

- `main`: private working branch. It may contain local paths, real report IDs, org defaults, and team-specific operating notes.
- `shareable`: public-safe branch. It must not contain exported Salesforce data, real report IDs, tenant IDs, personal machine paths, tokens, or private team-specific config.

The public GitHub mirror is separate from the private repo:

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
git push origin shareable
git push public shareable:main
git switch main
```

Do not merge `main` into `shareable` without reviewing the diff for private details first.
