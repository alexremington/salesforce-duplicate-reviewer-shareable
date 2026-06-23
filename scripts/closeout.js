#!/usr/bin/env node

const childProcess = require("node:child_process");
const path = require("node:path");

const PROJECT_DIR = path.resolve(process.env.CLOSEOUT_PROJECT_DIR || path.join(__dirname, ".."));
const SKIP_RELEASE_VERIFY = process.env.CLOSEOUT_SKIP_RELEASE_VERIFY === "1";
const RELEASE_VERIFY_STEPS = ["sync:shared", "check", "check:features", "check:windows", "smoke:ui:local", "check:shareable"];
const BEADS_PATH_PATTERN = /\.beads(?:[\\/]|$)|\.beads-credential-key$/;

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  });
}

async function main() {
  if (!SKIP_RELEASE_VERIFY) {
    verifyRelease(PROJECT_DIR);
  }

  const status = getGitStatus(PROJECT_DIR);
  if (status.dirtyLines.length > 0) {
    console.error("Closeout failed: the working tree is not clean.");
    console.error(`Project: ${PROJECT_DIR}`);
    console.error("Dirty files:");
    for (const line of status.dirtyLines) {
      console.error(`  ${line}`);
    }
    if (status.beadsLines.length > 0) {
      console.error("");
      console.error("Ignored local Beads metadata:");
      for (const line of status.beadsLines) {
        console.error(`  ${line}`);
      }
    }
    console.error("");
    console.error("Commit or remove the remaining changes, then run `npm run closeout` again.");
    process.exit(1);
  }

  if (status.beadsLines.length > 0) {
    console.log(`Closeout passed: ${status.branch} is clean aside from local Beads metadata.`);
    console.log("Local Beads metadata was present and ignored for closeout:");
    for (const line of status.beadsLines) {
      console.log(`  ${line}`);
    }
  } else {
    console.log(`Closeout passed: ${status.branch} is clean.`);
  }
  if (SKIP_RELEASE_VERIFY) {
    console.log("Release verification was skipped because CLOSEOUT_SKIP_RELEASE_VERIFY=1.");
  }
}

function verifyRelease(cwd) {
  const result = runCommand("npm", ["run", "verify:release"], cwd, { captureOutput: true });
  if (result.status === 0) {
    return;
  }

  const output = `${result.stdout || ""}\n${result.stderr || ""}`.trim();
  if (!output.includes("Managed app not found:")) {
    throw new Error(output || "npm run verify:release failed");
  }

  console.log("Release pipeline could not discover this worktree; running the equivalent local release steps instead.");
  for (const scriptName of RELEASE_VERIFY_STEPS) {
    runChecked("npm", ["run", scriptName], cwd);
  }
}

function getGitStatus(cwd) {
  const result = childProcess.spawnSync(
    "git",
    ["status", "--short", "--branch", "--untracked-files=all"],
    { cwd, encoding: "utf8" }
  );

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || "git status failed").trim());
  }

  const lines = String(result.stdout || "")
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean);
  return classifyGitStatusLines(lines);
}

function runChecked(command, args, cwd) {
  const result = runCommand(command, args, cwd);

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

function runCommand(command, args, cwd, options = {}) {
  const result = childProcess.spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    shell: process.platform === "win32",
    stdio: options.captureOutput ? ["ignore", "pipe", "pipe"] : "inherit"
  });

  if (result.error) {
    throw result.error;
  }

  if (options.captureOutput) {
    if (result.stdout) {
      process.stdout.write(result.stdout);
    }
    if (result.stderr) {
      process.stderr.write(result.stderr);
    }
  }

  return result;
}

function isBeadsPathStatus(line) {
  return BEADS_PATH_PATTERN.test(line);
}

function classifyGitStatusLines(lines) {
  const [branchLine = "## unknown branch", ...statusLines] = lines;
  const branch = branchLine.replace(/^##\s*/, "");
  const dirtyLines = [];
  const beadsLines = [];
  for (const line of statusLines) {
    if (line.startsWith("## ")) {
      continue;
    }
    if (isBeadsPathStatus(line)) {
      beadsLines.push(line);
    } else {
      dirtyLines.push(line);
    }
  }

  return { branch, dirtyLines, beadsLines };
}

module.exports = {
  classifyGitStatusLines,
  getGitStatus,
  isBeadsPathStatus
};
