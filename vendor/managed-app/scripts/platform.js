// @ts-check

const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

/**
 * @typedef {NodeJS.ProcessEnv} Environment
 * @typedef {{ command: string, args: string[], env?: Environment }} CommandInvocation
 * @typedef {{
 *   env?: Environment,
 *   platform?: NodeJS.Platform,
 *   execPath?: string,
 *   homeDir?: string,
 *   includeSalesforceCli?: boolean
 * }} DefaultCommandPathOptions
 * @typedef {{
 *   env?: Environment,
 *   platform?: NodeJS.Platform,
 *   defaultPath?: string,
 *   homeDir?: string
 * }} ExecutableResolutionOptions
 */

const UNIX_BASE_PATH = "/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin";

function currentPlatform() {
  return process.platform;
}

/**
 * Build a normalized PATH string that works for app launches, server starts, Node, and Salesforce CLI discovery.
 *
 * @param {DefaultCommandPathOptions} [options]
 * @returns {string}
 */
function defaultCommandPath(options = {}) {
  const platform = options.platform || currentPlatform();
  const env = options.env || process.env;
  const execPath = options.execPath || process.execPath;
  const homeDir = options.homeDir || os.homedir();
  const includeSalesforceCli = options.includeSalesforceCli !== false;
  const pathImpl = pathForPlatform(platform);
  const delimiter = pathDelimiterForPlatform(platform);

  if (platform === "win32") {
    return uniquePathParts([
      env.Path,
      env.PATH,
      execPath && pathImpl.dirname(execPath),
      env.ProgramFiles && pathImpl.join(env.ProgramFiles, "nodejs"),
      env["ProgramFiles(x86)"] && pathImpl.join(env["ProgramFiles(x86)"], "nodejs"),
      env.LOCALAPPDATA && pathImpl.join(env.LOCALAPPDATA, "Programs", "nodejs"),
      ...(includeSalesforceCli
        ? [
            env.ProgramFiles && pathImpl.join(env.ProgramFiles, "sf", "bin"),
            env.ProgramFiles && pathImpl.join(env.ProgramFiles, "Salesforce CLI", "bin"),
            env["ProgramFiles(x86)"] && pathImpl.join(env["ProgramFiles(x86)"], "sf", "bin"),
            env["ProgramFiles(x86)"] && pathImpl.join(env["ProgramFiles(x86)"], "Salesforce CLI", "bin"),
            env.LOCALAPPDATA && pathImpl.join(env.LOCALAPPDATA, "Programs", "sf", "bin"),
            env.APPDATA && pathImpl.join(env.APPDATA, "npm"),
            pathImpl.join(homeDir, "AppData", "Roaming", "npm")
          ]
        : [])
    ].filter(Boolean).join(delimiter), { platform }).join(delimiter);
  }

  return uniquePathParts([
    env.PATH,
    UNIX_BASE_PATH
  ].filter(Boolean).join(delimiter), { platform }).join(delimiter);
}

/**
 * @param {Environment} env
 * @param {string} commandPath
 * @param {NodeJS.Platform} [platform]
 * @returns {Environment}
 */
function withCommandPath(env, commandPath, platform = currentPlatform()) {
  const next = { ...env };
  if (!commandPath) return next;
  next.PATH = commandPath;
  if (platform === "win32") next.Path = commandPath;
  return next;
}

/**
 * @param {string} value
 * @param {{ platform?: NodeJS.Platform }} [options]
 * @returns {string[]}
 */
function uniquePathParts(value, options = {}) {
  const platform = options.platform || currentPlatform();
  const delimiter = pathDelimiterForPlatform(platform);
  const seen = new Set();
  const parts = [];
  for (const rawPart of String(value || "").split(delimiter)) {
    const part = rawPart.trim();
    const key = platform === "win32" ? part.toLowerCase() : part;
    if (!part || seen.has(key)) continue;
    seen.add(key);
    parts.push(part);
  }
  return parts;
}

/**
 * @param {string} value
 * @returns {string}
 */
function expandHome(value) {
  const text = String(value || "");
  if (text === "~") return os.homedir();
  if (text.startsWith("~/") || text.startsWith("~\\")) return path.join(os.homedir(), text.slice(2));
  return text;
}

/**
 * @param {string} command
 * @param {ExecutableResolutionOptions} [options]
 * @returns {string}
 */
function resolveExecutable(command, options = {}) {
  const platform = options.platform || currentPlatform();
  const env = options.env || process.env;
  const defaultPath = options.defaultPath || "";
  const homeDir = options.homeDir || os.homedir();
  const candidate = String(command || "").trim().replace(/^["']|["']$/g, "");
  const pathImpl = pathForPlatform(platform);
  if (!candidate) return "";

  if (isPathLike(candidate, { platform })) {
    return executablePath(candidate, { platform, homeDir });
  }

  for (const folder of commandSearchPaths({ env, platform, defaultPath })) {
    for (const executableName of executableNames(candidate, { platform })) {
      const resolved = executablePath(pathImpl.join(folder, executableName), { platform, homeDir });
      if (resolved) return resolved;
    }
  }

  return "";
}

/**
 * @param {string} filePath
 * @param {{ platform?: NodeJS.Platform, homeDir?: string }} [options]
 * @returns {string}
 */
function executablePath(filePath, options = {}) {
  const platform = options.platform || currentPlatform();
  const basePath = expandHomeWithHomeDir(filePath, options.homeDir || os.homedir(), platform);
  for (const candidate of executablePathCandidates(basePath, { platform })) {
    try {
      const stat = fs.statSync(candidate);
      if (stat.isFile()) return candidate;
    } catch {
      // Keep trying candidate executable paths.
    }
  }
  return "";
}

/**
 * @param {string} filePath
 * @param {{ platform?: NodeJS.Platform }} [options]
 * @returns {string[]}
 */
function executablePathCandidates(filePath, options = {}) {
  const platform = options.platform || currentPlatform();
  const pathImpl = pathForPlatform(platform);
  if (platform !== "win32" || pathImpl.extname(filePath)) return [filePath];
  return [`${filePath}.cmd`, `${filePath}.exe`, `${filePath}.bat`, filePath];
}

/**
 * @param {string} command
 * @param {{ platform?: NodeJS.Platform }} [options]
 * @returns {string[]}
 */
function executableNames(command, options = {}) {
  const platform = options.platform || currentPlatform();
  const pathImpl = pathForPlatform(platform);
  if (platform !== "win32" || pathImpl.extname(command)) return [command];
  return [`${command}.cmd`, `${command}.exe`, `${command}.bat`, command];
}

/**
 * @param {ExecutableResolutionOptions} [options]
 * @returns {string[]}
 */
function commandSearchPaths(options = {}) {
  const env = options.env || process.env;
  const platform = options.platform || currentPlatform();
  const delimiter = pathDelimiterForPlatform(platform);
  return uniquePathParts([
    env.Path,
    env.PATH,
    options.defaultPath
  ].filter(Boolean).join(delimiter), { platform });
}

/**
 * @param {string} value
 * @param {{ platform?: NodeJS.Platform }} [options]
 * @returns {boolean}
 */
function isPathLike(value, options = {}) {
  const platform = options.platform || currentPlatform();
  return pathForPlatform(platform).isAbsolute(value) || /[\\/]/.test(value);
}

/**
 * Invoke Windows .cmd/.bat files through PowerShell using environment variables for the path and args.
 * This avoids cmd.exe quoting failures for paths like C:\Program Files (x86)\sf\bin\sf.cmd.
 *
 * @param {string} command
 * @param {string[]} [args]
 * @param {{ platform?: NodeJS.Platform, envPrefix?: string }} [options]
 * @returns {CommandInvocation}
 */
function commandInvocation(command, args = [], options = {}) {
  const platform = options.platform || currentPlatform();
  const envPrefix = options.envPrefix || "MANAGED_APP_RUN";
  if (platform === "win32" && /\.(?:cmd|bat)$/i.test(String(command || ""))) {
    const commandVar = `${envPrefix}_COMMAND`;
    const argsVar = `${envPrefix}_ARGS_JSON`;
    return {
      command: "powershell.exe",
      args: [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        [
          "$ErrorActionPreference = 'Stop'",
          `$command = $env:${commandVar}`,
          "$commandArgs = @()",
          `if ($env:${argsVar}) { $commandArgs = @(ConvertFrom-Json -InputObject $env:${argsVar}) }`,
          "& $command @commandArgs",
          "exit $LASTEXITCODE"
        ].join("; ")
      ],
      env: {
        [commandVar]: String(command),
        [argsVar]: JSON.stringify(args || [])
      }
    };
  }

  return { command, args };
}

/**
 * @param {{ env?: Environment, platform?: NodeJS.Platform, homeDir?: string }} [options]
 * @returns {string[]}
 */
function salesforceCliCandidates(options = {}) {
  const platform = options.platform || currentPlatform();
  const env = options.env || process.env;
  const homeDir = options.homeDir || os.homedir();
  const pathImpl = pathForPlatform(platform);

  if (platform === "win32") {
    const candidates = ["sf.cmd", "sf.exe", "sf"];
    if (env.ProgramFiles) {
      candidates.push(pathImpl.join(env.ProgramFiles, "sf", "bin", "sf.cmd"));
      candidates.push(pathImpl.join(env.ProgramFiles, "Salesforce CLI", "bin", "sf.cmd"));
    }
    if (env["ProgramFiles(x86)"]) {
      candidates.push(pathImpl.join(env["ProgramFiles(x86)"], "sf", "bin", "sf.cmd"));
      candidates.push(pathImpl.join(env["ProgramFiles(x86)"], "Salesforce CLI", "bin", "sf.cmd"));
    }
    if (env.LOCALAPPDATA) candidates.push(pathImpl.join(env.LOCALAPPDATA, "Programs", "sf", "bin", "sf.cmd"));
    if (env.APPDATA) candidates.push(pathImpl.join(env.APPDATA, "npm", "sf.cmd"));
    candidates.push(pathImpl.join(homeDir, "AppData", "Roaming", "npm", "sf.cmd"));
    return candidates;
  }

  return [
    "sf",
    "/usr/local/bin/sf",
    "/opt/homebrew/bin/sf"
  ];
}

/**
 * @param {NodeJS.Platform} [platform]
 * @returns {string}
 */
function defaultSalesforceCliName(platform = currentPlatform()) {
  return platform === "win32" ? "sf.cmd" : "sf";
}

/**
 * @param {string} url
 * @param {{ platform?: NodeJS.Platform, noOpen?: boolean }} [options]
 */
function openUrl(url, options = {}) {
  const platform = options.platform || currentPlatform();
  if (options.noOpen) return;

  if (platform === "darwin") {
    childProcess.spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
    return;
  }

  if (platform === "win32") {
    childProcess.spawn("cmd.exe", ["/d", "/s", "/c", "start", '""', url], {
      detached: true,
      stdio: "ignore",
      windowsHide: true
    }).unref();
    return;
  }

  childProcess.spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
}

/**
 * @param {string} appName
 * @param {string} slug
 * @param {{ env?: Environment, platform?: NodeJS.Platform, homeDir?: string }} [options]
 * @returns {string}
 */
function defaultAppSupportDir(appName, slug, options = {}) {
  const platform = options.platform || currentPlatform();
  const env = options.env || process.env;
  const homeDir = options.homeDir || os.homedir();
  const pathImpl = pathForPlatform(platform);
  if (platform === "darwin") {
    return pathImpl.join(homeDir, "Library", "Application Support", appName);
  }
  if (platform === "win32") {
    return pathImpl.join(env.APPDATA || pathImpl.join(homeDir, "AppData", "Roaming"), appName);
  }
  return pathImpl.join(env.XDG_CONFIG_HOME || pathImpl.join(homeDir, ".config"), slug);
}

/**
 * @param {string} appName
 * @param {string} slug
 * @param {{ env?: Environment, platform?: NodeJS.Platform, homeDir?: string }} [options]
 * @returns {string}
 */
function defaultLogRoot(appName, slug, options = {}) {
  const platform = options.platform || currentPlatform();
  const env = options.env || process.env;
  const homeDir = options.homeDir || os.homedir();
  const pathImpl = pathForPlatform(platform);
  if (platform === "darwin") {
    return pathImpl.join(homeDir, "Library", "Logs", slug);
  }
  if (platform === "win32") {
    return pathImpl.join(env.LOCALAPPDATA || pathImpl.join(homeDir, "AppData", "Local"), appName, "Logs");
  }
  return pathImpl.join(env.XDG_STATE_HOME || pathImpl.join(homeDir, ".local", "state"), slug, "logs");
}

/**
 * @param {string} value
 * @param {string} homeDir
 * @returns {string}
 */
function expandHomeWithHomeDir(value, homeDir, platform = currentPlatform()) {
  const pathImpl = pathForPlatform(platform);
  const text = String(value || "");
  if (text === "~") return homeDir;
  if (text.startsWith("~/") || text.startsWith("~\\")) return pathImpl.join(homeDir, text.slice(2));
  return text;
}

function pathForPlatform(platform = currentPlatform()) {
  return platform === "win32" ? path.win32 : path.posix;
}

function pathDelimiterForPlatform(platform = currentPlatform()) {
  return platform === "win32" ? ";" : ":";
}

module.exports = {
  UNIX_BASE_PATH,
  commandInvocation,
  commandSearchPaths,
  defaultAppSupportDir,
  defaultCommandPath,
  defaultLogRoot,
  executableNames,
  executablePath,
  executablePathCandidates,
  expandHome,
  openUrl,
  pathDelimiterForPlatform,
  pathForPlatform,
  resolveExecutable,
  salesforceCliCandidates,
  defaultSalesforceCliName,
  uniquePathParts,
  withCommandPath
};
