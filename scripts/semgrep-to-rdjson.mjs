#!/usr/bin/env node

import { readFileSync } from "node:fs";

function severityFromSemgrep(value) {
  switch (String(value || "").toUpperCase()) {
    case "ERROR":
      return "ERROR";
    case "WARNING":
      return "WARNING";
    default:
      return "INFO";
  }
}

const rawInput = readFileSync(0, "utf8").trim();
const payload = rawInput ? JSON.parse(rawInput) : { results: [] };
const diagnostics = Array.isArray(payload.results)
  ? payload.results.map((result) => {
      const startLine = result?.start?.line ?? 1;
      const startColumn = result?.start?.col ?? 1;
      const endLine = result?.end?.line ?? startLine;
      const endColumn = result?.end?.col ?? startColumn;
      const message = [
        result?.check_id,
        result?.extra?.message,
      ]
        .filter(Boolean)
        .join(": ");

      return {
        message: message || "Semgrep finding",
        location: {
          path: result.path,
          range: {
            start: { line: startLine, column: startColumn },
            end: { line: endLine, column: endColumn },
          },
        },
        severity: severityFromSemgrep(result?.extra?.severity),
        code: result?.check_id ? { value: result.check_id } : undefined,
      };
    })
  : [];

process.stdout.write(
  `${JSON.stringify({ source: "semgrep", diagnostics }, null, 2)}\n`,
);
