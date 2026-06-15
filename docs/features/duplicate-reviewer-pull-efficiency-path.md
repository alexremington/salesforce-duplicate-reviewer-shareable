# Duplicate Reviewer Pull Efficiency Path

Status: in-progress
Manifest ID: duplicate-reviewer-pull-efficiency-path

## User Story

- Persona: Duplicate Reviewer operator working from the existing Source rail and the staging pull scripts.
- Goal: Avoid wasted Salesforce pull work when auth or runtime state is stale, while keeping the canonical org choice and latest-data flow predictable.
- Decision or action the user needs to complete: Confirm the current org/runtime state is usable, then run or re-run the Contacts or Accounts pull without accidentally duplicating the same work.

## Requirements

- Fail fast before expensive Salesforce pull work when auth freshness or runtime alignment is not usable.
- Expose auth freshness and runtime alignment in `/api/health`.
- Resolve the requested org through the canonical shared catalog at the pull boundary.
- Reuse an in-flight pull for the same canonical org plus source signature.
- Reuse a recently completed pull for the same canonical org plus source signature for a short time window.
- Keep the read-only instance URL display and existing apply flow intact.
- Surface compact blocked or ready feedback in the existing workflow surface instead of adding a new admin view.

## Acceptance Criteria

- `/api/health` reports both auth freshness and runtime alignment.
- A stale auth state blocks the pull path before the Salesforce job starts.
- A matching in-flight pull request reuses the first request instead of starting a duplicate query.
- A matching recent pull request reuses the latest cached result when the short-lived reuse window is still valid.
- Canonical org resolution prefers the shared catalog alias and does not regress the existing read-only instance URL display or apply flow.
- The compact status summary is visible in the normal workflow surface and clearly explains blocked versus ready state.

## Hume Design Direction

- Minimalist, high-contrast, accessible direction: reuse the existing Source rail and status affordances.
- Required visible states: ready, auth-blocked, runtime-blocked, and canonical-org-selected.
- Controls and interaction pattern: keep the org selector and apply flow familiar; add only compact status text or a small status pill where the operator already looks for source state.
- Whitespace, no-overlap, and scroll criteria: do not widen the rail or push any controls below the viewport without a working scroll path.
- Keyboard, focus, and contrast criteria: preserve current focus order and readable contrast for status text.
- Desktop success criteria: the status summary reads as part of the source/org stack, not a separate admin surface.
- Mobile success criteria: the status summary stacks cleanly and never clips the org selector or apply control.

## Fixtures

- Required fixture data: a canonical staging org, a legacy staging alias that resolves to the canonical alias, and a synthetic repeated pull signature.
- Dummy data behavior: contract tests may use a fake Salesforce CLI and a fake org catalog, but the reuse logic should still exercise the real cache keys and fail-fast path.
- Live integration behavior: the actual pull wrappers should still resolve the org through Salesforce CLI and reuse the same output when the signature matches.

## Test Plan

- Unit or contract checks: add named regressions for stale auth preflight, canonical org resolution, pull reuse, health summary, and stale-runtime replacement.
- Targeted Playwright assertions: prove the blocked state, the compact status summary, and the visible runtime/org state in the real UI.
- Cross-platform checks: run `npm run check` and `npm run check:windows`.
- Manual checks: confirm the visible runtime matches the current source after launcher restart and that the pull path reuses repeated work.

## Release Evidence

- Fast check evidence: `npm run check`.
- Playwright evidence: `npm run smoke:ui:local`.
- Release pipeline evidence: `npm run verify:release` if the repo release flow requires it.
- Known gaps: short-lived reuse is process-local and cache-backed only; it does not persist across a restart.
