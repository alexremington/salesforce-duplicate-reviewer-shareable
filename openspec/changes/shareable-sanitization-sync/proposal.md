# Shareable Sanitization Sync

## Why

The current `main` to `shareable` flow relies on manual conflict resolution and ad hoc public-safe cleanup. That has repeatedly left the `shareable` branch carrying drift that is not part of the intended product change, such as private-only feature metadata or machine-specific references that must be removed before the public mirror can be updated.

The repo already has a `check:shareable` scan, but it only detects the bad state after the branch has drifted. We need a deterministic way to build and verify the public-safe projection of selected files so `shareable` stops depending on manual surgery.

## What Changes

- add a repeatable shareable-sanitization script that derives managed public-safe files from `main`;
- sanitize `feature-test-manifest.json` by filtering out feature entries that contain private-only detail;
- keep `docs/features/*.md` aligned with the sanitized manifest so removed private features do not leave orphaned private briefs on `shareable`;
- verify in `check:shareable` that the current `shareable` branch matches the sanitized projection from `main`;
- document the new sync step in the branching workflow so shareable updates are reproducible.

## Defaults

- `main` remains the source of truth;
- `shareable` is treated as a derived public-safe projection for the managed files;
- managed-file sanitization should fail loudly when a file cannot be projected deterministically.
