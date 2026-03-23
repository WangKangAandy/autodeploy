"use strict";

const {
  setMode,
  getMode,
  getRemoteConfig,
  isRemoteReady,
  execute,
} = require("../core/executor");
const { formatToolResult, formatToolError } = require("../core/utils");

/**
 * Register musa_set_mode tool
 * Sets the deployment mode (local or remote)
 */
function registerMusaSetModeTool(api) {
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

          setMode("remote", {
            host,
            user,
            password,
            port,
            sudoPasswd: sudoPasswd || password,
          });

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
          setMode("local", null);
          return formatToolResult({
            success: true,
            mode: "local",
            message: "Deployment mode set to local. Commands will execute on this machine.",
          });
        }
      } catch (err) {
        return formatToolError(err, { params });
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
 */
function registerMusaGetModeTool(api) {
  api.registerTool({
    name: "musa_get_mode",
    description: `Get the current MUSA deployment mode.

Returns:
- mode: 'local' or 'remote'
- connection info if in remote mode`,
    parameters: {
      type: "object",
      properties: {},
    },
    async execute(_toolCallId, _params) {
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
        });
      }

      return formatToolResult({
        mode: "local",
        ready: true,
      });
    },
  });
}

module.exports = {
  registerMusaSetModeTool,
  registerMusaExecTool,
  registerMusaGetModeTool,
};