"use strict";

const {
  setMode,
  getMode,
  getRemoteConfig,
  isRemoteReady,
  execute,
  refreshCache,
} = require("../core/executor");
const { formatToolResult, formatToolError } = require("../core/utils");

// StateManager reference for persistence
let stateManager = null;

/**
 * Register musa_set_mode tool
 * Sets the deployment mode (local or remote)
 *
 * @param {Object} api - OpenClaw plugin API
 * @param {Object} sm - StateManager instance for persistence
 */
function registerMusaSetModeTool(api, sm = null) {
  stateManager = sm;

  api.registerTool({
    name: "musa_set_mode",
    description: `Set MUSA deployment mode: local or remote.

For local mode: No additional parameters needed.
For remote mode: Provide SSH connection details (host, user, password).

This tool must be called before using musa_exec for remote deployment.`,
    parameters: {
      type: "object",
      properties: {
        mode: {
          type: "string",
          enum: ["local", "remote"],
          description: "Deployment mode: 'local' or 'remote'",
        },
        host: {
          type: "string",
          description: "Remote host IP or hostname (required for remote mode)",
        },
        user: {
          type: "string",
          description: "SSH username (required for remote mode)",
        },
        password: {
          type: "string",
          description: "SSH password (required for remote mode)",
        },
        port: {
          type: "number",
          default: 22,
          description: "SSH port (default: 22)",
        },
        sudoPasswd: {
          type: "string",
          description: "Sudo password for remote host (optional, defaults to SSH password)",
        },
      },
      required: ["mode"],
    },
    async execute(_toolCallId, params) {
      try {
        const { mode, host, user, password, port = 22, sudoPasswd } = params;

        if (mode === "remote") {
          if (!host || !user || !password) {
            return formatToolError(
              "Remote mode requires host, user, and password parameters",
              { mode }
            );
          }

          // StateManager is the single source of truth
          // Only write to StateManager, then refresh cache
          if (!stateManager) {
            return formatToolError(
              "StateManager not available. Cannot persist remote mode configuration.",
              { mode }
            );
          }

          // 1. Register/update the host in StateManager
          const hostId = await stateManager.registerHost({
            host,
            user,
            password,
            port,
            sudoPasswd: sudoPasswd || password,
            status: "online",
            environment: {
              dockerAvailable: false,
              toolkitInstalled: false,
              mthreadsGmiAvailable: false,
            },
          });

          // 2. Set as default host (this persists the mode)
          await stateManager.setDefaultHost(hostId);

          // 3. Refresh executor cache from StateManager
          await refreshCache();

          return formatToolResult({
            success: true,
            mode: "remote",
            message: `Deployment mode set to remote. Target: ${user}@${host}:${port}`,
            connection: {
              host,
              user,
              port,
            },
          });
        } else {
          // Local mode: clear default host
          if (stateManager) {
            await stateManager.clearDefaultHost();
            await refreshCache();
          }

          return formatToolResult({
            success: true,
            mode: "local",
            message: "Deployment mode set to local. Commands will execute on this machine.",
          });
        }
      } catch (err) {
        return formatToolError(err, { mode: params.mode });
      }
    },
  });
}

/**
 * Register musa_exec tool
 * Executes a shell command for MUSA deployment
 */
function registerMusaExecTool(api) {
  api.registerTool({
    name: "musa_exec",
    description: `Execute a shell command for MUSA deployment.

Automatically uses local or remote mode based on the current session settings.
Use musa_set_mode first to switch between local and remote deployment.

Common use cases:
- System package installation (apt install)
- GPU driver checks (mthreads-gmi)
- Docker commands (docker ps, docker pull)
- File operations
- System status checks`,
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "The shell command to execute",
        },
        workdir: {
          type: "string",
          description: "Working directory for command execution (default: ~ for remote, cwd for local)",
        },
        sudo: {
          type: "boolean",
          default: false,
          description: "Run command with sudo (password will be provided automatically)",
        },
        timeout: {
          type: "number",
          default: 120,
          description: "Command timeout in seconds (default: 120)",
        },
      },
      required: ["command"],
    },
    async execute(_toolCallId, params) {
      try {
        const mode = getMode();

        // Check if remote mode is properly configured
        if (mode === "remote" && !isRemoteReady()) {
          return formatToolError(
            "Remote mode is not configured. Call musa_set_mode first with host, user, and password.",
            { currentMode: mode }
          );
        }

        // Add sudoPasswd for remote mode
        const options = { ...params };
        if (mode === "remote") {
          const config = getRemoteConfig();
          options.sudoPasswd = config.sudoPasswd;
        }

        const result = await execute(params.command, options);

        return formatToolResult({
          success: result.exitCode === 0,
          mode,
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode,
        });
      } catch (err) {
        return formatToolError(err, { command: params.command });
      }
    },
  });
}

/**
 * Register musa_get_mode tool
 * Returns the current deployment mode
 *
 * Reads from StateManager (single source of truth), not executor cache.
 * Returns sanitized info (no password/sudoPasswd).
 */
function registerMusaGetModeTool(api) {
  api.registerTool({
    name: "musa_get_mode",
    description: `Get the current MUSA deployment mode.

Returns:
- mode: 'local' or 'remote'
- connection info if in remote mode (sanitized - no passwords)`,
    parameters: {
      type: "object",
      properties: {},
    },
    async execute(_toolCallId, _params) {
      // Read from StateManager (single source of truth)
      if (!stateManager) {
        // Fallback to executor cache if StateManager not available
        const mode = getMode();
        const config = getRemoteConfig();

        if (mode === "remote" && config) {
          return formatToolResult({
            mode: "remote",
            connection: {
              host: config.host,
              user: config.user,
              port: config.port,
              // Note: passwords not included for security
            },
            ready: isRemoteReady(),
            source: "executor_cache",
          });
        }

        return formatToolResult({
          mode: "local",
          ready: true,
          source: "executor_cache",
        });
      }

      // Primary path: read from StateManager
      try {
        const mode = await stateManager.getExecutionMode();
        const defaultHost = await stateManager.getDefaultHost();

        if (mode === "remote" && defaultHost) {
          return formatToolResult({
            mode: "remote",
            connection: {
              host: defaultHost.host,
              user: defaultHost.user,
              port: defaultHost.port || 22,
              // Note: passwords not included for security
            },
            hostId: defaultHost.id,
            status: defaultHost.status,
            environment: defaultHost.environment,
            ready: true,
            source: "state_manager",
          });
        }

        return formatToolResult({
          mode: "local",
          ready: true,
          hostsCount: (await stateManager.loadState("hosts.json")).length,
          source: "state_manager",
        });
      } catch (err) {
        // On error, fallback to executor cache
        console.error("[musa_get_mode] Failed to read from StateManager:", err.message);
        const mode = getMode();
        const config = getRemoteConfig();

        if (mode === "remote" && config) {
          return formatToolResult({
            mode: "remote",
            connection: {
              host: config.host,
              user: config.user,
              port: config.port,
            },
            ready: isRemoteReady(),
            source: "executor_cache_fallback",
            error: err.message,
          });
        }

        return formatToolResult({
          mode: "local",
          ready: true,
          source: "executor_cache_fallback",
          error: err.message,
        });
      }
    },
  });
}

module.exports = {
  registerMusaSetModeTool,
  registerMusaExecTool,
  registerMusaGetModeTool,
};