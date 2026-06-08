---
name: agentic-delivery
description: Use when the user wants a streamlined Codex workflow with just enough planning, review, and QA for the risk level involved, or asks for a broader agent setup for a repo or workspace.
---

# Agentic Delivery

Use this skill to keep multi-stage work structured without turning routine work into a committee.

## Workflow

1. Keep the main thread as the orchestrator and final decision-maker.
2. Use `architect` only when the task needs sequencing, risk analysis, or acceptance criteria.
3. Use `Hume` only for visible UI direction work when the design is still unresolved or the user explicitly wants design review.
4. Keep write-heavy implementation in one thread unless the user explicitly asks for parallel coders.
5. Use `reviewer` only after implementation when correctness, regression risk, or test gaps justify a second pass.
6. Use `qa-ux` only when the real user path needs validation in the launched app.

## Defaults

- Default to direct implementation for small, well-scoped edits.
- Prefer subagents for read-heavy work, not simultaneous code edits.
- Keep plans narrow and testable.
- Summarize subagent results back into the main thread instead of pasting long logs.
- If repo-specific AGENTS guidance adds validation gates, treat those gates as mandatory.

## When Not To Use

- Trivial single-step edits that do not need planning or delegated review.
- Tasks where the user explicitly wants direct implementation with no extra orchestration.
- Read-only questions, explanation tasks, or other non-implementation work.
