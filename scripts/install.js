#!/usr/bin/env node
/**
 * OpenClaw Plugin Installation Script
 *
 * CLI entry point for install/uninstall actions.
 * Delegates merge logic to src/utils/agents-merge.js.
 *
 * Usage:
 *   node scripts/install.js install [workspace-path]
 *   node scripts/install.js uninstall [workspace-path] [--keep-state]
 */

const fs = require("fs");
const path = require("path");
const {
  mergeAgentsMd,
  unmergeAgentsMd,
  BLOCK_MARKERS,
} = require("../src/utils/agents-merge");

/**
 * Initialize state directory
 */
function initializeStateDir(workspacePath) {
  const stateDir = path.join(workspacePath, "autodeploy");

  if (!fs.existsSync(stateDir)) {
    fs.mkdirSync(stateDir, { recursive: true });
    console.log("[autodeploy] Created state directory:", stateDir);
  }

  // Initialize empty state files
  const stateFiles = {
    "hosts.json": [],
    "jobs.json": [],
    "operations.json": [],
    "deployment_state.json": {
      status: "initialized",
      completedSteps: [],
      sdkVersion: "",
      driverVersion: "",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  };

  for (const [file, defaultContent] of Object.entries(stateFiles)) {
    const filePath = path.join(stateDir, file);
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, JSON.stringify(defaultContent, null, 2));
      console.log(`[autodeploy] Created state file: ${file}`);
    }
  }

  return true;
}

/**
 * Clean up state directory (optional, for uninstall)
 */
function cleanupStateDir(workspacePath, keepState = true) {
  const stateDir = path.join(workspacePath, "autodeploy");

  if (!fs.existsSync(stateDir)) {
    return true;
  }

  if (keepState) {
    console.log("[autodeploy] State directory preserved:", stateDir);
    return true;
  }

  // Remove state directory
  fs.rmSync(stateDir, { recursive: true, force: true });
  console.log("[autodeploy] Removed state directory:", stateDir);

  return true;
}

/**
 * Main installation function
 */
function install(options) {
  const { workspacePath, pluginDir, action = "install", keepState = true } = options;

  console.log(`[autodeploy] ${action} starting...`);
  console.log(`[autodeploy] Plugin dir: ${pluginDir}`);
  console.log(`[autodeploy] Workspace: ${workspacePath}`);

  switch (action) {
    case "install":
    case "upgrade":
      if (mergeAgentsMd(workspacePath, pluginDir)) {
        console.log("[autodeploy] AGENTS.md merged successfully");
      } else {
        console.error("[autodeploy] AGENTS.md merge failed");
      }
      initializeStateDir(workspacePath);
      console.log("[autodeploy] Installation complete");
      break;

    case "uninstall":
      if (unmergeAgentsMd(workspacePath)) {
        console.log("[autodeploy] AGENTS.md unmerged successfully");
      }
      cleanupStateDir(workspacePath, keepState);
      console.log("[autodeploy] Uninstallation complete");
      break;

    default:
      console.error(`[autodeploy] Unknown action: ${action}`);
      return false;
  }

  return true;
}

// CLI execution
if (require.main === module) {
  const args = process.argv.slice(2);
  const action = args[0] || "install";
  const workspacePath = args[1] || process.cwd();
  const pluginDir = path.resolve(__dirname, "..");

  install({
    workspacePath,
    pluginDir,
    action,
    keepState: action === "uninstall" ? args.includes("--keep-state") : true,
  });
}

module.exports = {
  install,
  mergeAgentsMd,
  unmergeAgentsMd,
  initializeStateDir,
  cleanupStateDir,
  BLOCK_MARKERS,
};