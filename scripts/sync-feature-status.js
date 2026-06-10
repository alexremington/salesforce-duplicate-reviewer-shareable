#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

main();

function main() {
  const options = parseArgs(process.argv.slice(2));
  const appRoot = resolveAppRoot(options.appRoot);
  const manifestPath = path.join(appRoot, "feature-test-manifest.json");
  const manifest = readJson(manifestPath);
  const now = new Date().toISOString();
  const changes = [];

  if (!Array.isArray(manifest.features)) {
    throw new Error("feature-test-manifest.json must contain a features array.");
  }

  for (const feature of manifest.features) {
    const briefPath = path.resolve(appRoot, feature.brief || "");
    if (!feature.id || !feature.brief) {
      throw new Error(`Feature ${feature.id || "(missing id)"} must define a brief path.`);
    }
    if (!fs.existsSync(briefPath)) {
      throw new Error(`Feature brief does not exist: ${path.relative(appRoot, briefPath)}`);
    }

    const current = fs.readFileSync(briefPath, "utf8");
    const next = syncBriefStatus(current, feature.status, feature.id);
    if (next !== current) {
      changes.push(path.relative(appRoot, briefPath));
      if (!options.dryRun) {
        fs.writeFileSync(briefPath, next, "utf8");
      }
    }
  }

  if (changes.length && !options.dryRun) {
    manifest.updatedAt = now;
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  }

  if (!changes.length) {
    console.log("Feature brief statuses already match the manifest.");
    return;
  }

  const action = options.dryRun ? "Would update" : "Updated";
  console.log(`${action} ${changes.length} feature brief${changes.length === 1 ? "" : "s"}.`);
  for (const file of changes) {
    console.log(`- ${file}`);
  }
  if (options.dryRun) {
    console.log("Dry run only; no files were written.");
  }
}

function parseArgs(args) {
  const options = {
    appRoot: ".",
    dryRun: false
  };

  const positional = [];
  for (const arg of args) {
    if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "-h" || arg === "--help") {
      printUsage();
      process.exit(0);
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown argument: ${arg}`);
    } else {
      positional.push(arg);
    }
  }

  if (positional.length > 0) options.appRoot = positional[0];
  return options;
}

function printUsage() {
  console.log([
    "Usage: node scripts/sync-feature-status.js [app-root] [--dry-run]",
    "",
    "Synchronizes the Status: line in each feature brief with feature-test-manifest.json."
  ].join("\n"));
}

function resolveAppRoot(input) {
  const appRoot = path.resolve(process.cwd(), input || ".");
  if (!fs.existsSync(path.join(appRoot, "package.json"))) {
    throw new Error(`App root does not contain package.json: ${appRoot}`);
  }
  return appRoot;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function syncBriefStatus(content, status, featureId) {
  const pattern = /^Status:\s*.*$/m;
  if (!pattern.test(content)) {
    throw new Error(`Feature brief for ${featureId} is missing a Status: line.`);
  }
  return content.replace(pattern, `Status: ${status}`);
}
