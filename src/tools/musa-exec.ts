import {
  init,
  setMode,
  getMode,
  getRemoteConfig,
  isRemoteReady,
  execute,
  refreshCache,
} from "../core/executor"
import { formatToolResult, formatToolError, type ToolResult } from "../core/utils"
import type { StateManager } from "../core/state-manager"
import type { ExecOptions } from "../core/local-exec"
import type { SSHConfig } from "../core/ssh-client"

// StateManager reference for persistence
let stateManager: StateManager | null = null

interface SetModeParams {
  mode: "local" | "remote"
  host?: string
  user?: string
  password?: string
  port?: number
  sudoPasswd?: string
}

interface ExecParams {
  command: string
  workdir?: string
  sudo?: boolean
  timeout?: number
}

/**
 * Register musa_mode tool
 * Unified tool for getting/setting deployment mode
 */
export function registerMusaModeTool(api: any, sm: StateManager | null = null): void {
  stateManager = sm

  api.registerTool({
    name: "musa_mode",
    description: `Get or set MUSA deployment mode (local or remote).

**Get mode:** Call without parameters to check current mode.
**Set mode:** Provide mode and connection details for remote.

Remote mode requires: host, user, password.`,
    parameters: {
      type: "object",
      properties: {
        mode: {
          type: "string",
          enum: ["local", "remote"],
          description: "Set mode: 'local' or 'remote'. Omit to get current mode.",
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
    },
    async execute(_toolCallId: string, params: SetModeParams) {
      try {
        // No mode parameter: get current mode
        if (!params.mode) {
          return await getCurrentMode()
        }

        const { mode, host, user, password, port = 22, sudoPasswd } = params

        if (mode === "remote") {
          if (!host || !user || !password) {
            return formatToolError(
              "Remote mode requires host, user, and password parameters",
              { mode }
            )
          }

          if (!stateManager) {
            return formatToolError(
              "StateManager not available. Cannot persist remote mode configuration.",
              { mode }
            )
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
          })

          // 2. Set as default host (this persists the mode)
          await stateManager.setDefaultHost(hostId)

          // 3. Refresh executor cache from StateManager
          await refreshCache()

          return formatToolResult({
            success: true,
            mode: "remote",
            message: `Deployment mode set to remote. Target: ${user}@${host}:${port}`,
            connection: { host, user, port },
          })
        } else {
          // Local mode: clear default host
          if (stateManager) {
            await stateManager.clearDefaultHost()
            await refreshCache()
          }

          return formatToolResult({
            success: true,
            mode: "local",
            message: "Deployment mode set to local. Commands will execute on this machine.",
          })
        }
      } catch (err) {
        return formatToolError(err, { mode: params.mode })
      }
    },
  })
}

/**
 * Get current deployment mode
 */
async function getCurrentMode(): Promise<ToolResult> {
  if (!stateManager) {
    const mode = getMode()
    const config = getRemoteConfig()

    if (mode === "remote" && config) {
      return formatToolResult({
        mode: "remote",
        connection: { host: config.host, user: config.user, port: config.port },
        ready: isRemoteReady(),
        source: "executor_cache",
      })
    }

    return formatToolResult({ mode: "local", ready: true, source: "executor_cache" })
  }

  try {
    const mode = await stateManager.getExecutionMode()
    const defaultHost = await stateManager.getDefaultHost()

    if (mode === "remote" && defaultHost) {
      return formatToolResult({
        mode: "remote",
        connection: {
          host: defaultHost.host,
          user: defaultHost.user,
          port: defaultHost.port || 22,
        },
        hostId: defaultHost.id,
        status: defaultHost.status,
        environment: defaultHost.environment,
        ready: true,
        source: "state_manager",
      })
    }

    return formatToolResult({
      mode: "local",
      ready: true,
      hostsCount: 0,
      source: "state_manager",
    })
  } catch (err) {
    console.error("[musa_mode] Failed to read from StateManager:", (err as Error).message)
    const mode = getMode()
    const config = getRemoteConfig()

    if (mode === "remote" && config) {
      return formatToolResult({
        mode: "remote",
        connection: { host: config.host, user: config.user, port: config.port },
        ready: isRemoteReady(),
        source: "executor_cache_fallback",
        error: (err as Error).message,
      })
    }

    return formatToolResult({
      mode: "local",
      ready: true,
      source: "executor_cache_fallback",
      error: (err as Error).message,
    })
  }
}

/**
 * Register musa_exec tool
 * Executes a shell command for MUSA deployment
 */
export function registerMusaExecTool(api: any, sm: StateManager | null = null): void {
  if (sm) {
    init(sm)
  }

  api.registerTool({
    name: "musa_exec",
    description: `Execute a shell command for MUSA deployment.

Automatically uses local or remote mode based on the current session settings.
Use musa_mode to switch between local and remote deployment.

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
    async execute(_toolCallId: string, params: ExecParams) {
      const startTime = Date.now()
      try {
        const mode = getMode()

        if (mode === "remote" && !isRemoteReady()) {
          return formatToolError(
            "Remote mode is not configured. Call musa_mode with host, user, and password.",
            { currentMode: mode }
          )
        }

        const options: ExecOptions & { sudoPasswd?: string } = { ...params }
        if (mode === "remote") {
          const config = getRemoteConfig()
          if (config) {
            options.sudoPasswd = (config as SSHConfig & { sudoPasswd?: string }).sudoPasswd
          }
        }

        const result = await execute(params.command, options)

        // Auto-report to StateManager
        if (stateManager?.isReady()) {
          await stateManager.recordToolExecution({
            tool: "musa_exec",
            command: params.command,
            exitCode: result.exitCode,
            success: result.exitCode === 0,
            durationMs: Date.now() - startTime,
            stdoutPreview: result.stdout?.substring(0, 500),
            stderrPreview: result.stderr?.substring(0, 500),
            timestamp: new Date().toISOString(),
          }).catch(() => {}) // Never fail the tool call due to recording
        }

        return formatToolResult({
          success: result.exitCode === 0,
          mode,
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode,
        })
      } catch (err) {
        if (stateManager?.isReady()) {
          await stateManager.recordToolExecution({
            tool: "musa_exec",
            command: params.command,
            exitCode: -1,
            success: false,
            durationMs: Date.now() - startTime,
            error: err instanceof Error ? err.message : String(err),
            timestamp: new Date().toISOString(),
          }).catch(() => {})
        }
        return formatToolError(err, { command: params.command })
      }
    },
  })
}

