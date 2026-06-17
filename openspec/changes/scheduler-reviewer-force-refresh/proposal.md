# Scheduler Reviewer Force Refresh

## Why

The scheduler-opened Duplicate Reviewer flows can reuse a healthy-but-stale copied runtime, which makes the opened app depend on whatever bundle happened to be on disk before the launch. That is the wrong tradeoff for the scheduler handoff path, where the user expects the freshly downloaded data and the current source runtime to line up.

## What Changes

- make the Scheduler-opened reviewer launch scripts restart the reviewer server even when an existing instance appears healthy;
- refresh the copied static/runtime bundle before reopening the app;
- keep the standalone Duplicate Reviewer launcher behavior unchanged;
- add regression coverage that proves the Scheduler path restarts the server and refreshes runtime state before opening the browser.

## Non-Goals

- Do not change the Duplicate Reviewer matching logic.
- Do not change the normal manual reviewer launcher semantics.
- Do not introduce private report IDs, machine paths, or team-specific org defaults into the public-safe branch.
