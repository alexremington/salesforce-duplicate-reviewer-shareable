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
