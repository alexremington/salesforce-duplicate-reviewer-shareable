---
name: brittle-ui-validation
description: Use when pointer hit-testing, overlapping controls, drag targets, overflow, menus, downloads, or other brittle UI interactions need real-user-path validation.
---

# Brittle UI Validation

Use this skill for interaction bugs where screenshots, synthetic events, or state changes can say the wrong thing.

## Workflow

1. Reproduce the exact human gesture path in the launched UI.
2. Probe the real hit target with `elementFromPoint`, bounding boxes, and `pointer-events`.
3. Check for overlap, invisible overlays, clipped controls, or scroll-path failures.
4. Fix the actual hit zone or layout fault, not the symptom layer first.
5. Add or update a named regression that fails before the fix.
6. If browser download events are unreliable, use an in-page blob or filename capture fallback.

## Rules

- Do not treat `input.value` changes as proof of interaction.
- Do not treat synthetic events as proof of interaction.
- Do not treat screenshots as proof that the user can actually click or drag the control.
- Do not close the loop until the launched app passes the same user action path that failed.

## Good Regression Targets

- `elementFromPoint` result at the intended hit zone.
- Pointer reachability after overlays and decorations render.
- Drag end position on the real control.
- Absence of clipped or hidden interactive content below the viewport.

## Output

State which hit target was actually reachable, what blocked it if anything, and which regression now proves the behavior.
