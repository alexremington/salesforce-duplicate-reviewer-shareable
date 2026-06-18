#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const PROJECT_DIR = path.resolve(__dirname, "..");
const FEATURE_MANIFEST_PATH = "feature-test-manifest.json";
const AGENTS_PATH = "AGENTS.md";
const DEFAULT_SOURCE_REF = "main";
const DEFAULT_TARGET_REF = "shareable";
const DEFAULT_WORKTREE = PROJECT_DIR;
const PRIVATE_PATTERN = /00OV|00OS|OneDrive-POLITICO|\/Users|politico--staging|politico-staging|politico\.my\.salesforce|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;
const AGENTS_REPLACEMENTS = [
  [/\/Users\/aremington\/codex-workspace\/docs\/CLOSEOUT-TEMPLATES\.md/g, "the workspace shared closeout templates"],
  [/\/Users\/aremington\/codex-workspace\/scripts\/bd-with-shared-beads\.sh/g, "the workspace shared Beads helper"],
  [/\/Users\/aremington\/codex-workspace\/docs\/BEADS-STORAGE\.md/g, "the workspace shared Beads storage convention"],
  [/\/Users\/aremington\/codex-workspace\/AGENTS\.md/g, "the top-level workspace AGENTS.md"],
  [/\/Users\/aremington\/codex-workspace\/apps\/automation-shared-resources\/docs\/SESSION-HANDOFF\.md/g, "the workspace automation shared resources session handoff guide"]
];

function main() {
  const args = parseArgs(process.argv.slice(2));
  const projection = buildProjection(args.sourceRef);
  if (args.checkWorktree) {
    const mismatches = checkProjectionAgainstWorktree(projection, args.worktree);
    if (mismatches.length) {
      console.error("Shareable sanitized worktree drift detected:");
      mismatches.forEach((mismatch) => console.error(`- ${mismatch}`));
      process.exitCode = 1;
      return;
    }
    console.log(`Shareable sanitized projection matches worktree ${args.worktree}.`);
    return;
  }
  if (args.check) {
    const mismatches = checkProjection(projection, args.targetRef);
    if (mismatches.length) {
      console.error("Shareable sanitized projection drift detected:");
      mismatches.forEach((mismatch) => console.error(`- ${mismatch}`));
      process.exitCode = 1;
      return;
    }
    console.log(`Shareable sanitized projection matches ${args.targetRef}.`);
    return;
  }

  applyProjection(projection, args.worktree);
  console.log(`Applied sanitized shareable projection from ${args.sourceRef}.`);
}

function parseArgs(args) {
  const parsed = {
    check: false,
    checkWorktree: false,
    sourceRef: DEFAULT_SOURCE_REF,
    targetRef: DEFAULT_TARGET_REF,
    worktree: DEFAULT_WORKTREE
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--check") {
      parsed.check = true;
    } else if (arg === "--check-worktree") {
      parsed.checkWorktree = true;
    } else if (arg === "--source-ref") {
      parsed.sourceRef = requiredValue(args, ++index, arg);
    } else if (arg === "--target-ref") {
      parsed.targetRef = requiredValue(args, ++index, arg);
    } else if (arg === "--worktree") {
      parsed.worktree = path.resolve(requiredValue(args, ++index, arg));
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return parsed;
}

function requiredValue(args, index, flag) {
  const value = args[index];
  if (!value) throw new Error(`Missing value for ${flag}`);
  return value;
}

function buildProjection(sourceRef) {
  const manifest = JSON.parse(readRefFile(sourceRef, FEATURE_MANIFEST_PATH));
  const featureEntries = Array.isArray(manifest.features) ? manifest.features : [];
  const retainedFeatures = [];
  const removedBriefs = new Set();
  const projectedBriefs = new Map();

  for (const feature of featureEntries) {
    const briefPath = typeof feature.brief === "string" ? feature.brief : "";
    const featureText = JSON.stringify(feature);
    const briefText = briefPath ? readRefFileIfExists(sourceRef, briefPath) : null;
    if (PRIVATE_PATTERN.test(featureText) || (typeof briefText === "string" && PRIVATE_PATTERN.test(briefText))) {
      if (briefPath) removedBriefs.add(briefPath);
      continue;
    }
    retainedFeatures.push(feature);
    if (briefPath && typeof briefText === "string") {
      projectedBriefs.set(briefPath, ensureTrailingNewline(briefText));
    }
  }

  return {
    agents: ensureTrailingNewline(sanitizeAgents(readRefFile(sourceRef, AGENTS_PATH))),
    manifest: `${JSON.stringify({ ...manifest, features: retainedFeatures }, null, 2)}\n`,
    briefs: projectedBriefs,
    removedBriefs
  };
}

function sanitizeAgents(content) {
  let sanitized = content;
  AGENTS_REPLACEMENTS.forEach(([pattern, value]) => {
    sanitized = sanitized.replace(pattern, value);
  });
  if (PRIVATE_PATTERN.test(sanitized)) {
    throw new Error("Sanitized AGENTS.md still contains private patterns.");
  }
  return sanitized.replace(/\s+$/, "");
}

function applyProjection(projection, worktree) {
  writeFile(worktree, AGENTS_PATH, projection.agents);
  writeFile(worktree, FEATURE_MANIFEST_PATH, projection.manifest);
  projection.briefs.forEach((content, briefPath) => {
    writeFile(worktree, briefPath, content);
  });
  projection.removedBriefs.forEach((briefPath) => {
    const fullPath = path.join(worktree, briefPath);
    if (fs.existsSync(fullPath)) fs.rmSync(fullPath, { force: true });
  });
}

function checkProjection(projection, targetRef) {
  const mismatches = [];
  compareProjectedFile(mismatches, targetRef, AGENTS_PATH, projection.agents);
  compareProjectedFile(mismatches, targetRef, FEATURE_MANIFEST_PATH, projection.manifest);
  projection.briefs.forEach((content, briefPath) => {
    compareProjectedFile(mismatches, targetRef, briefPath, content);
  });
  projection.removedBriefs.forEach((briefPath) => {
    if (readRefFileIfExists(targetRef, briefPath) != null) {
      mismatches.push(`${briefPath} should be absent from ${targetRef}`);
    }
  });
  return mismatches;
}

function checkProjectionAgainstWorktree(projection, worktree) {
  const mismatches = [];
  compareProjectedWorktreeFile(mismatches, worktree, AGENTS_PATH, projection.agents);
  compareProjectedWorktreeFile(mismatches, worktree, FEATURE_MANIFEST_PATH, projection.manifest);
  projection.briefs.forEach((content, briefPath) => {
    compareProjectedWorktreeFile(mismatches, worktree, briefPath, content);
  });
  projection.removedBriefs.forEach((briefPath) => {
    if (fs.existsSync(path.join(worktree, briefPath))) {
      mismatches.push(`${briefPath} should be absent from ${worktree}`);
    }
  });
  return mismatches;
}

function compareProjectedFile(mismatches, targetRef, filePath, expectedContent) {
  const actualContent = readRefFileIfExists(targetRef, filePath);
  if (typeof actualContent !== "string") {
    mismatches.push(`${filePath} is missing from ${targetRef}`);
    return;
  }
  if (actualContent !== expectedContent) {
    mismatches.push(`${filePath} differs from sanitized projection`);
  }
}

function compareProjectedWorktreeFile(mismatches, worktree, filePath, expectedContent) {
  const fullPath = path.join(worktree, filePath);
  if (!fs.existsSync(fullPath)) {
    mismatches.push(`${filePath} is missing from ${worktree}`);
    return;
  }
  const actualContent = fs.readFileSync(fullPath, "utf8");
  if (actualContent !== expectedContent) {
    mismatches.push(`${filePath} differs from sanitized projection`);
  }
}

function writeFile(worktree, relativePath, content) {
  const fullPath = path.join(worktree, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, "utf8");
}

function readRefFile(ref, filePath) {
  return execGit(["show", `${ref}:${filePath}`]);
}

function readRefFileIfExists(ref, filePath) {
  try {
    execGit(["cat-file", "-e", `${ref}:${filePath}`]);
  } catch {
    return null;
  }
  return readRefFile(ref, filePath);
}

function execGit(args) {
  return execFileSync("git", args, {
    cwd: PROJECT_DIR,
    encoding: "utf8"
  });
}

function ensureTrailingNewline(value) {
  return value.endsWith("\n") ? value : `${value}\n`;
}

main();
