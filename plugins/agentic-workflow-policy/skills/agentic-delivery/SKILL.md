---
name: agentic-delivery
description: Use when Duplicate Reviewer work needs an explicit Hume to architect to implementation to review to QA workflow.
---

# Agentic Delivery

Use this skill for non-trivial Duplicate Reviewer work that benefits from explicit planning and validation.

## Workflow

1. Keep the main thread as orchestrator.
2. For visible UI changes, route design through Hume first unless waived.
3. Use `architect` to define scope, merge-safety risks, interaction risks, validation steps, and acceptance criteria.
4. Keep code-writing single-threaded unless the user explicitly wants parallel implementation.
5. Use `reviewer` to check merge safety, portability, regressions, and missing proof.
6. Use `qa-ux` to require the repo validation path: `npm run check`, `npm run check:windows`, and `npm run smoke:ui:local`.
7. Finish with `npm run closeout` so the working tree is clean before handoff.
8. Use `launcher-runtime-triage` when a launcher-backed app may be serving stale copied assets or runtime state.
9. Use `brittle-ui-validation` when hit-testing, overlap, drag targets, overflow, or other brittle UI interactions need proof.
10. Use `visible-change-delivery` when a user-visible change needs design, regression, and release discipline.
