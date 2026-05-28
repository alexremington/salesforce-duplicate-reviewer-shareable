#!/usr/bin/env node

const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const PROJECT_DIR = path.resolve(__dirname, "..");
const AUTOMATION_PROJECTS_DIR = path.dirname(PROJECT_DIR);
const SHARED_ROOT = path.resolve(process.env.PLAYWRIGHT_SHARED_ROOT || path.join(AUTOMATION_PROJECTS_DIR, ".shared-playwright"));
const PACKAGE_JSON = path.join(SHARED_ROOT, "package.json");

main();

function main() {
  fs.mkdirSync(SHARED_ROOT, { recursive: true });
  if (!fs.existsSync(PACKAGE_JSON)) {
    fs.writeFileSync(PACKAGE_JSON, `${JSON.stringify({
      private: true,
      description: "Shared Playwright install for local managed Automation Projects apps."
    }, null, 2)}\n`);
  }

  if (!hasSharedPlaywright() && !seedFromExistingManagedApp()) {
    run("npm", ["install", "--prefix", SHARED_ROOT, "--no-save", "playwright"]);
  }

  run(process.execPath, [path.join(SHARED_ROOT, "node_modules", "playwright", "cli.js"), "install", "chromium"]);

  console.log(`Shared Playwright is ready at ${SHARED_ROOT}`);
}

function hasSharedPlaywright() {
  return fs.existsSync(path.join(SHARED_ROOT, "node_modules", "playwright"))
    && fs.existsSync(path.join(SHARED_ROOT, "node_modules", "playwright-core"));
}

function seedFromExistingManagedApp() {
  const source = managedAppDirs().find((dir) => {
    return fs.existsSync(path.join(dir, "node_modules", "playwright"))
      && fs.existsSync(path.join(dir, "node_modules", "playwright-core"));
  });
  if (!source) return false;

  const nodeModules = path.join(SHARED_ROOT, "node_modules");
  fs.mkdirSync(nodeModules, { recursive: true });
  for (const packageName of ["playwright", "playwright-core"]) {
    const target = path.join(nodeModules, packageName);
    fs.rmSync(target, { recursive: true, force: true });
    fs.cpSync(path.join(source, "node_modules", packageName), target, { recursive: true });
  }
  console.log(`Seeded shared Playwright from ${source}`);
  return true;
}

function managedAppDirs() {
  const dirs = [PROJECT_DIR];
  for (const entry of fs.readdirSync(AUTOMATION_PROJECTS_DIR, { withFileTypes: true })) {
    if (entry.isDirectory() && !entry.name.startsWith(".")) {
      dirs.push(path.join(AUTOMATION_PROJECTS_DIR, entry.name));
    }
  }
  return [...new Set(dirs.map((dir) => path.resolve(dir)))];
}

function run(command, args) {
  const result = childProcess.spawnSync(command, args, {
    stdio: "inherit",
    env: process.env
  });

  if (result.error) throw result.error;
  if (result.status) process.exit(result.status);
}
