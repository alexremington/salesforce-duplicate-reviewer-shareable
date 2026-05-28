const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");

const PROJECT_DIR = findManagedAppRoot(__dirname);
const AUTOMATION_PROJECTS_DIR = path.dirname(PROJECT_DIR);

function loadPlaywright() {
  try {
    return require("playwright");
  } catch (localError) {
    for (const nodeModulesDir of sharedNodeModulesDirs()) {
      try {
        return createRequire(path.join(nodeModulesDir, ".playwright-require.cjs"))("playwright");
      } catch {
        // Try the next shared install location.
      }
    }

    throw new Error([
      "Playwright is not installed.",
      "Run `npm run setup:playwright` from any managed app, then retry.",
      `Expected shared install: ${path.join(AUTOMATION_PROJECTS_DIR, ".shared-playwright")}`,
      `Original error: ${localError.message}`
    ].join("\n"));
  }
}

function sharedNodeModulesDirs() {
  const dirs = [
    process.env.PLAYWRIGHT_NODE_MODULES,
    process.env.PLAYWRIGHT_SHARED_ROOT && path.join(process.env.PLAYWRIGHT_SHARED_ROOT, "node_modules"),
    path.join(AUTOMATION_PROJECTS_DIR, ".shared-playwright", "node_modules"),
    path.join(AUTOMATION_PROJECTS_DIR, "node_modules")
  ].filter(Boolean);

  return dirs
    .map((dir) => path.resolve(dir))
    .filter((dir, index, all) => all.indexOf(dir) === index)
    .filter((dir) => fs.existsSync(path.join(dir, "playwright")));
}

function findManagedAppRoot(startDir) {
  let currentDir = path.resolve(startDir);
  while (true) {
    const packagePath = path.join(currentDir, "package.json");
    if (fs.existsSync(packagePath)) {
      try {
        const manifest = JSON.parse(fs.readFileSync(packagePath, "utf8"));
        if (manifest.scripts?.["smoke:ui"]) return currentDir;
      } catch {
        // Keep walking.
      }
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) return process.cwd();
    currentDir = parentDir;
  }
}

module.exports = { loadPlaywright };
