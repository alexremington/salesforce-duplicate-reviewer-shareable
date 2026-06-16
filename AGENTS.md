# Project Agent Guidance

These instructions apply to this repository and its subdirectories.

## Product Goals

- Build inside the existing app and preserve the current workflow unless the user explicitly asks for a separate prototype.
- Keep the private branch and shareable branch in sync when changes are intended for both audiences.
- Keep the app portable for both macOS and Windows users.
- Never use demo data without labeling it explicitly as `demo data`, and never mix demo data with production data in the same view, response, runtime, or workflow. If the app can switch between demo and live sources, label the active source clearly and keep those datasets isolated.

## Front-End Design

- Prioritize clean, legible UI and familiar controls.
- Default new UI work to `Radix UI` primitives plus `shadcn/ui` components unless the repo already has an established design system.
- Use commonly understood graphical icons in place of text where an icon is clearer.
- Use common input patterns for user-provided data: selects for option sets, toggles or checkboxes for booleans, numeric inputs or steppers for numbers, and time selectors for clock times.
- Unless specifically requested otherwise, distribute whitespace evenly within and between UI elements.
- Prioritize legibility over density. Labels, buttons, cards, panels, headers, and form controls should feel balanced, readable, and intentionally placed rather than cramped or visually uneven.
- Never permit visible text or controls to extend below the viewport while scrolling is prohibited. If content can exceed the viewport, the page or the containing pane must provide a clear, working scroll path. Hidden overflow on primary content regions is a cardinal UX violation unless the clipped region is purely decorative and contains no user-facing content.

Shared UI stack policy:

- Use `Radix UI` for interaction primitives and accessibility-sensitive controls.
- Use `shadcn/ui` for app-level component scaffolding and common patterns.
- Keep styling localized and token-driven so themes can vary by app without changing behavior.
- Add thin internal wrappers only when they enforce shared patterns or reduce repetition.
- Avoid introducing a competing design system unless a repo-specific constraint clearly requires it.

## Cross-Platform Rules

- Avoid browser-specific and OS-specific behavior unless a platform-specific launcher or fallback is also provided.
- Prefer Node-based launcher and server logic over shell-only behavior when the same action must work on macOS and Windows.
- Keep local ports configurable so this app can run at the same time as other local apps or virtual-machine instances.
- Keep credentials and Salesforce access tokens server-side.

## Validation

- After UI or launcher changes, run `npm run check`, `npm run check:windows`, and `npm run smoke:ui:local`.
- `npm run check` must include live server contract coverage for current health/config flags, static app loading, and method-sensitive API routes. Mocked Playwright routes are not enough for server-backed workflows.
- Any user-visible bug fix should add or update a named regression assertion that would have failed before the fix.
- Launcher changes must reject or restart stale runtime processes when feature or API contract versions do not match the current source.
- Use Playwright for smoke testing. Do not attempt to use the Codex in-app browser for smoke tests; the repo Playwright harness is the source of truth for rendered smoke validation.
- Smoke coverage should exercise primary buttons and fail on scroll traps, hidden overflowing content, layout overlap, and nonfunctional controls.

## Duplicate Reviewer Contract Debugging

- Separate file ingest, normalization, matching, and autoload handoff into distinct stages when diagnosing failures; prove the stage that is actually broken.
- For large imports or slow loads, do not use a tiny smoke fixture as proof that production-sized exports are healthy; add a threshold or large-file regression that exercises the real failure mode.
- If the launcher runtime may be stale, verify the served bundle or copied runtime before trusting the checkout.
- When a behavior change affects import, matching, or autoload flow, add a named regression that proves the real user gesture path in the launched UI.

## Pre-Commit Preflight

- Before committing any feature, workflow, sync, or cleanup change, verify the diff does not remove any protected user-facing flow by accident.
- For merge-review work, explicitly confirm the queued review flow is still present in source, smoke coverage, and launcher output:
  - `renderMergeReviewPanel`
  - `renderMergeConfirmationPreview`
  - `startMergeReviewSession`
  - `handleConfirmedMerge`
  - the matching smoke assertions for review, preview, cancel, and confirm
- If a commit intentionally retires or renames a protected flow, update the guardrail and smoke assertions in the same change before pushing.
- Do not commit a broad sync or cleanup that deletes protected workflow code unless you have manually reviewed the removed sections and confirmed the replacement behavior is intentional.
- Treat `npm run check` as the minimum pre-commit gate, then run `npm run smoke:ui:local` before pushing any user-visible change.
- Run `npm run closeout` before handoff so the working tree is clean and every remaining file is accounted for.
- Local Beads workspace metadata should live in the workspace-owned external Beads home, not under the app tree; if an older `.beads/` tree still exists locally, it should stay ignored and untracked until the migration is complete, and closeout should not treat it as release content.
- If mirror reconciliation needs temporary worktrees, scratch repos, or helper links, treat them as disposable repair state and remove them before closeout.
- If the change is user-visible, behavior-changing, or tied to a release, include a short release note in the handoff closeout before marking the work done. Use one of: `Release note: fixed <issue> for <users>, validated by <test or smoke>.` `Release note: updated launcher/runtime behavior for <scenario>, validated by <check> and <smoke>.` `Release note: release handoff for <branch or version>, includes <summary> and <validation>.`
- Use the shared closeout templates in `/Users/aremington/codex-workspace/docs/CLOSEOUT-TEMPLATES.md` and keep the closeout summary, release note, commit SHA(s), and one residual-risk bullet in every handoff.
- Any local Beads state should remain ignored and untracked rather than committed as release content. Prefer the shared helper in `/Users/aremington/codex-workspace/scripts/bd-with-shared-beads.sh` and the storage convention in `/Users/aremington/codex-workspace/docs/BEADS-STORAGE.md`.
- If a change touches the launcher or cached runtime path, confirm the live served bundle still reflects the current source before committing.

## Recommended Agent Workflow

- Use `Hume` only when visible UI direction is still unresolved or the user explicitly wants design review.
- Keep the main Codex thread as the orchestrator and primary implementation thread.
- Use the repo-local `architect` agent for scoped planning, merge-safety review, interaction-risk review, and acceptance criteria.
- Use the repo-local `reviewer` agent after implementation for correctness, portability, merge-safety, and validation-gap review.
- Use the repo-local `qa-ux` agent to enforce `npm run check`, `npm run check:windows`, and `npm run smoke:ui:local` as the validation floor.
- Prefer subagents for planning, review, and QA. Do not default to multiple parallel implementation agents editing the same change.

The repo-local custom agents live under `.codex/agents/`, and the reusable workflow lives in `.agents/skills/agentic-delivery/`.

New development-task prompts are hook-enforced through `.codex/config.toml`, so no special `agentic-delivery` prefix is required. For visible UI work, mention `Hume` only when design direction is still unresolved or you want design review.

OpenSpec follows the workspace-level policy in `/Users/aremington/codex-workspace/AGENTS.md`. For user-visible, behavior-changing, cross-cutting, launcher/runtime, or multi-session work, create or update the required OpenSpec proposal, spec delta or capability spec, implementation tasks, and any behavior-affecting technical decisions before coding.

## Testing Ladder

Use the shortest proof that still matches the failure mode, then escalate only if the first layer is insufficient.

- Source changed: confirm the intended file and code path changed.
- Runtime aligned: confirm the launched app or copied runtime is serving the change, not just the checkout.
- Interaction proven: for pointer, drag, menu, or overflow bugs, verify the exact human gesture path in the launched UI.
- Regression named: add or update a named test that would have failed before the fix.
- Gate complete: run the repo-local validation set that applies to the change.

For brittle interaction work, check `elementFromPoint`, bounding boxes, overlap, and `pointer-events` before assuming state or screenshots prove anything.

Useful reusable skills:

- `live-contract-triage` for repeated source/runtime/downstream contract incidents across scheduler, duplicate reviewer, and token dashboard.
- `launcher-runtime-triage` for copied-runtime and launcher-backed app drift.
- `brittle-ui-validation` for hit-testing, overlays, and other false-positive-prone UI work.
- `visible-change-delivery` for user-visible changes that need design, regression, and release discipline.
