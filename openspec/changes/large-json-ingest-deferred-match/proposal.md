# Large JSON Ingest With Deferred Match

## Why

Very large Salesforce JSON exports can stall the current load path because the app parses the full payload and immediately starts matching in one synchronous workflow. That makes the import feel frozen, prevents useful progress feedback during ingest, and gives users no way to cancel without losing the current dataset.

## What Changes

- add a size-based ingest strategy gate so small JSON files keep the current eager parse-and-match behavior;
- route large JSON files through a worker-backed ingest path that reports progress during reading and parsing;
- keep ingest and matching separate for large files so the parsed dataset is shown first and matching only runs after the user explicitly continues;
- preserve the previous loaded dataset if the user cancels a long ingest before the new dataset is committed;
- expose clear ingest states for reading, parsing, parsed-ready, matching, canceled, and failed;
- add a cancel control in the loading modal for long-running ingest operations;
- keep the current JSON contract and existing small-file workflow unchanged.

## Defaults

- The first version uses a conservative large-file threshold near 50 MB.
- Small JSON files continue to auto-match after parsing.
- Large JSON files become review-ready after ingest and only match when the user clicks the explicit match action or an equivalent follow-up control.
