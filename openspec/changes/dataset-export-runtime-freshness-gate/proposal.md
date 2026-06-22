# Dataset Export Runtime Freshness Gate

## Why

The Dataset + Scores export should not download scores from a reviewer session that is already known to be stale. When the runtime is out of date, the export would faithfully serialize stale in-memory scores, which makes the downloaded CSV look current even though it was produced by an outdated runtime.

## What Changes

- disable Dataset + Scores export when the reviewer health check reports a stale runtime;
- surface a clear refresh prompt instead of downloading the stale export;
- keep the normal export path unchanged when the runtime is aligned;
- add a regression that proves the export button is blocked when the runtime health flag is stale.

## Non-Goals

- Do not change the scoring engine.
- Do not change the CSV export shape.
- Do not change the Scheduler handoff flow.
