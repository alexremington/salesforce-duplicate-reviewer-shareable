#!/usr/bin/env node

const assert = require("node:assert/strict");
const { classifyGitStatusLines } = require("./closeout.js");

const result = classifyGitStatusLines([
  "## main...origin/main",
  " M public/app.js",
  "?? .beads/interactions.jsonl",
  "?? notes.txt",
  " M .beads-credential-key",
  "?? .beads/embeddeddolt/salesforce_duplicate_reviewer/.dolt/repo_state.json"
]);

assert.equal(result.branch, "main...origin/main");
assert.deepEqual(result.dirtyLines, [
  " M public/app.js",
  "?? notes.txt"
]);
assert.deepEqual(result.beadsLines, [
  "?? .beads/interactions.jsonl",
  " M .beads-credential-key",
  "?? .beads/embeddeddolt/salesforce_duplicate_reviewer/.dolt/repo_state.json"
]);

console.log("Closeout Beads regression passed.");
