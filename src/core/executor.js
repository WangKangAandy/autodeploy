"use strict";

const { execLocal, execLocalDocker } = require("./local-exec");
const { execRemote, execRemoteDocker, syncFiles } = require("./ssh-client");

// Runtime execution mode (set dynamically by skills)
let currentMode = "local";
let remoteConfig = null;

/**
 * Set deployment mode
 *
 * @param {string} mode - 'local' or 'remote'
 * @param {Object|null} config - SSH configuration for remote mode
 */
function setMode(mode, config = null) {
  if (mode !== "local" && mode !== "remote") {
    throw new Error(`Invalid mode: ${mode}. Must be 'local' or 'remote'.`);
  }
  currentMode = mode;
  remoteConfig = config;
}

/**
 * Get current deployment mode
 *
 * @returns {string} Current mode ('local' or 'remote')
 */
function getMode() {
  return currentMode;
}

/**
 * Get remote configuration
 *
 * @returns {Object|null} Remote configuration or null if in local mode
 */
function getRemoteConfig() {
  return remoteConfig;
}

/**
 * Check if remote mode is properly configured
 *
 * @returns {boolean} True if remote mode is ready
 */
function isRemoteReady() {
  return (
    currentMode === "remote" &&
    remoteConfig &&
    remoteConfig.host &&
    remoteConfig.user &&
    remoteConfig.password
  );
}

/**
 * Unified execution interface - automatically selects local/remote based on current mode
 *
 * @param {string} command - Command to execute
 * @param {Object} options - Execution options
 * @returns {Promise<{stdout: string, stderr: string, exitCode: number}>}
 */
async function execute(command, options = {}) {
  if (currentMode === "remote") {
    if (!isRemoteReady()) {
      throw new Error(
        "Remote mode selected but no connection info provided. Use musa_set_mode to configure remote connection."
      );
    }
    return execRemote(remoteConfig, command, options);
  }
  return execLocal(command, options);
}

/**
 * Unified Docker execution interface
 *
 * @param {Object} args - Docker execution arguments
 * @returns {Promise<{stdout: string, stderr: string, exitCode: number}>}
 */
async function executeDocker(args) {
  if (currentMode === "remote") {
    if (!isRemoteReady()) {
      throw new Error(
        "Remote mode selected but no connection info provided. Use musa_set_mode to configure remote connection."
      );
    }
    // Add sudoPasswd from config if available
    if (remoteConfig.sudoPasswd && !args.sudoPasswd) {
      args.sudoPasswd = remoteConfig.sudoPasswd;
    }
    return execRemoteDocker(remoteConfig, args);
  }
  return execLocalDocker(args);
}

/**
 * Sync files (only available in remote mode)
 *
 * @param {Object} args - Sync arguments
 * @returns {Promise<{stdout: string, stderr: string, exitCode: number}>}
 */
async function executeSync(args) {
  if (currentMode === "local") {
    // For local mode, use cp command instead
    const { execLocal } = require("./local-exec");
    const src =
      args.direction === "push" ? args.localPath : args.remotePath;
    const dst =
      args.direction === "push" ? args.remotePath : args.localPath;
    return execLocal(`cp -r "${src}" "${dst}"`, { timeout: args.timeout });
  }

  if (!isRemoteReady()) {
    throw new Error(
      "Remote mode selected but no connection info provided. Use musa_set_mode to configure remote connection."
    );
  }
  return syncFiles(remoteConfig, args);
}

module.exports = {
  setMode,
  getMode,
  getRemoteConfig,
  isRemoteReady,
  execute,
  executeDocker,
  executeSync,
};