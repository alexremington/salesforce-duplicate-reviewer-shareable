---
name: launcher-runtime-triage
description: Use when a launched app can drift from the checked-out source, a copied runtime may be stale, launcher or contract gates need verification, or staging jobs depend on runtime registry and auth paths.
---

# Launcher Runtime Triage

Use this skill when the visible app may be serving copied assets, the launcher has contract-based restart behavior, or staging jobs need runtime-path debugging.

## Workflow

1. Identify the checked-out source path and the live runtime path before changing code.
2. Check the launcher, service, or wrapper that actually starts the app.
3. Inspect the narrow failure logs first.
4. Compare runtime version, contract version, or feature flags to the source tree when stale behavior is suspected.
5. Restart or refresh the runtime when the live copy is behind source.
6. For staging workflows, verify the canonical staging root and auth token path before blaming queries or exports.

## Rules

- Do not assume the checkout is the running app.
- Do not validate launcher-backed behavior only against source files.
- Prefer restart or contract bump over one-off fixes against a stale copy.
- Use app-specific logs before broad filesystem searches.

## Common Checks

- Live runtime path exists and is current.
- Launcher or service is pointing at the expected checkout or cache.
- Contract or feature version matches the current source.
- Canonical staging root and token retrieval path are correct.

## Output

Report the live path, the stale/new mismatch if one exists, and the next concrete repair step.
