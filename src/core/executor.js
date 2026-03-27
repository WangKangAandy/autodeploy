"use strict";

const { execLocal, execLocalDocker } = require("./local-exec");
const { execRemote, execRemoteDocker, syncFiles } = require("./ssh-client");

// ============================================================================
// Executor State
// ============================================================================

/**
 * Executor is stateless - it derives mode from StateManager.
 * StateManager is the single source of truth for connection state.
 */

let stateManager = null;      // StateManager reference (injected at init)
let cachedMode = "local";     // Runtime cache (refreshed before each request)
let cachedRemoteConfig = null; // Runtime cache for remote config

// ============================================================================
// Initialization
// ============================================================================

/**
 * Initialize executor with StateManager reference
 * Called by plugin entry point (index.js)
 *
 * @param {Object} sm - StateManager instance
 */
function init(sm) {
  stateManager = sm;
}

/**
 * Refresh cache from StateManager
 * Called at the start of each request (before_prompt_build hook)
 *
 * This ensures executor always uses the latest state from StateManager.
 *
 * @throws Error if StateManager is not available and no cache exists
 */
async function refreshCache() {
  if (!stateManager) {
    // No StateManager available
    // Only allow local mode to continue (no remote dependency)
    // Remote mode MUST fail because we cannot verify state consistency
    if (cachedMode === "remote") {
      throw new Error(
        "StateManager not available while in remote mode. " +
        "Cannot safely use cached remote config without state verification. " +
        "Please ensure StateManager is initialized or switch to local mode."
      );
    }

    // Local mode: safe to continue or initialize
    if (!cachedMode) {
      cachedMode = "local";
      cachedRemoteConfig = null;
    }
    console.warn("[executor] StateManager not available, using local mode");
    return;
  }

  try {
    // Step 1: Get execution mode from StateManager (single source of truth)
    const mode = await stateManager.getExecutionMode();

    if (mode === "remote") {
      // Step 2: Get remote config for remote mode
      const remoteConfig = await stateManager.getRemoteConfig();

      if (remoteConfig && remoteConfig.host && remoteConfig.user) {
        cachedMode = "remote";
        cachedRemoteConfig = remoteConfig;
      } else {
        // Mode says remote but config is incomplete - this is an error state
        throw new Error(
          "Execution mode is 'remote' but remote config is incomplete or missing. " +
          "Please reconfigure remote mode with musa_set_mode."
        );
      }
    } else {
      // Local mode
      cachedMode = "local";
      cachedRemoteConfig = null;
    }
  } catch (err) {
    // Failure strategy:
    // - Local mode cache: can continue with local (no remote dependency)
    // - Remote mode cache: MUST fail - cannot safely use stale remote config
    //   because StateManager may have changed/corrupted/deleted host state
    //   and we don't want to execute with inconsistent state
    if (cachedMode === "local") {
      console.error("[executor] Failed to refresh cache from StateManager:", err.message);
      console.warn("[executor] Keeping local mode cache (no remote dependency)");
      return;
    }

    // Remote mode: propagate error to force user to reconfigure
    // This prevents "execution state inconsistent with persisted state"
    console.error("[executor] Failed to refresh remote config from StateManager:", err.message);
    throw new Error(
      "Remote mode refresh failed: " + err.message + ". " +
      "Please reconfigure remote mode with musa_set_mode or switch to local mode."
    );
  }
}

// ============================================================================
// Mode Management
// ============================================================================

/**
 * Set deployment mode
 *
 * DEPRECATED: This function is kept for backward compatibility.
 * The actual state is managed by StateManager.
 * Use stateManager.setDefaultHost() / clearDefaultHost() instead.
 *
 * @param {string} mode - 'local' or 'remote'
 * @param {Object|null} config - SSH configuration for remote mode
 */
function setMode(mode, config = null) {
  if (mode !== "local" && mode !== "remote") {
    throw new Error(`Invalid mode: ${mode}. Must be 'local' or 'remote'.`);
  }

  // Update cache directly (for immediate use)
  // The caller should also update StateManager for persistence
  cachedMode = mode;
  cachedRemoteConfig = config;
}

/**
 * Get current deployment mode
 *
 * @returns {string} Current mode ('local' or 'remote')
 */
function getMode() {
  return cachedMode;
}

/**
 * Get remote configuration
 *
 * @returns {Object|null} Remote configuration or null if in local mode
 */
function getRemoteConfig() {
  return cachedRemoteConfig;
}

/**
 * Check if remote mode is properly configured
 *
 * @returns {boolean} True if remote mode is ready
 */
function isRemoteReady() {
  return (
    cachedMode === "remote" &&
    cachedRemoteConfig &&
    cachedRemoteConfig.host &&
    cachedRemoteConfig.user
  );
}

// ============================================================================
// Execution Functions
// ============================================================================

/**
 * Ensure cache is synchronized before execution
 * This is called at the start of every execute* function
 */
async function ensureCacheSynced() {
  // If we have a StateManager, refresh cache before execution
  // This ensures we always use the latest persisted state
  if (stateManager) {
    await refreshCache();
  }
}

/**
 * Unified execution interface - automatically selects local/remote based on current mode
 *
 * @param {string} command - Command to execute
 * @param {Object} options - Execution options
 * @returns {Promise<{stdout: string, stderr: string, exitCode: number}>}
 */
async function execute(command, options = {}) {
  // Ensure cache is synced before execution
  await ensureCacheSynced();

  if (cachedMode === "remote") {
    if (!isRemoteReady()) {
      throw new Error(
        "Remote mode selected but no connection info provided. Use musa_set_mode to configure remote connection."
      );
    }
    return execRemote(cachedRemoteConfig, command, options);
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
  // Ensure cache is synced before execution
  await ensureCacheSynced();

  if (cachedMode === "remote") {
    if (!isRemoteReady()) {
      throw new Error(
        "Remote mode selected but no connection info provided. Use musa_set_mode to configure remote connection."
      );
    }
    // Add sudoPasswd from config if available
    if (cachedRemoteConfig.sudoPasswd && !args.sudoPasswd) {
      args.sudoPasswd = cachedRemoteConfig.sudoPasswd;
    }
    return execRemoteDocker(cachedRemoteConfig, args);
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
  // Ensure cache is synced before execution
  await ensureCacheSynced();

  if (cachedMode === "local") {
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
  return syncFiles(cachedRemoteConfig, args);
}

// ============================================================================
// Exports
// ============================================================================

module.exports = {
  init,
  refreshCache,
  setMode,
  getMode,
  getRemoteConfig,
  isRemoteReady,
  execute,
  executeDocker,
  executeSync,
};