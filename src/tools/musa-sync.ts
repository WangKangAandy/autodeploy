import { executeSync, getMode, getRemoteConfig, isRemoteReady } from "../core/executor"
import { formatToolResult, formatToolError } from "../core/utils"
import type { SyncArgs } from "../core/ssh-client"
import type { StateManager } from "../core/state-manager"

let stateManager: StateManager | null = null

interface SyncParams {
  localPath: string
  remotePath: string
  direction?: "push" | "pull"
  delete?: boolean
  exclude?: string[]
  timeout?: number
}

/**
 * Register musa_sync tool
 * Syncs files between local and remote for MUSA deployment
 */
export function registerMusaSyncTool(api: any, sm: StateManager | null = null): void {
  stateManager = sm
  api.registerTool({
    name: "musa_sync",
    description: `Sync files between local machine and remote host for MUSA deployment.

Only available in remote mode. Use musa_set_mode first to configure remote connection.

Directions:
- push: Copy local files to remote host
- pull: Copy remote files to local machine

Uses rsync over SSH for efficient file transfer.`,
    parameters: {
      type: "object",
      properties: {
        localPath: {
          type: "string",
          description: "Local file or directory path",
        },
        remotePath: {
          type: "string",
          description: "Remote file or directory path",
        },
        direction: {
          type: "string",
          enum: ["push", "pull"],
          default: "push",
          description: "Sync direction: 'push' (local->remote) or 'pull' (remote->local)",
        },
        delete: {
          type: "boolean",
          default: false,
          description: "Delete extraneous files at destination (rsync --delete)",
        },
        exclude: {
          type: "array",
          items: { type: "string" },
          description: "Exclude patterns (e.g., ['*.tmp', '.git'])",
        },
        timeout: {
          type: "number",
          default: 600,
          description: "Sync timeout in seconds (default: 600)",
        },
      },
      required: ["localPath", "remotePath"],
    },
    async execute(_toolCallId: string, params: SyncParams) {
      const startTime = Date.now()
      try {
        const mode = getMode()

        if (mode === "local") {
          return formatToolError(
            "musa_sync is designed for remote mode. In local mode, use musa_exec with cp command instead.",
            { currentMode: mode }
          )
        }

        if (!isRemoteReady()) {
          return formatToolError(
            "Remote mode is not configured. Call musa_set_mode first with host, user, and password.",
            { currentMode: mode }
          )
        }

        const result = await executeSync(params as SyncArgs)

        if (stateManager?.isReady()) {
          await stateManager.recordToolExecution({
            tool: "musa_sync",
            command: `rsync ${params.direction || "push"} ${params.localPath} ↔ ${params.remotePath}`,
            exitCode: result.exitCode,
            success: result.exitCode === 0,
            durationMs: Date.now() - startTime,
            stdoutPreview: result.stdout?.substring(0, 500),
            timestamp: new Date().toISOString(),
          }).catch(() => {})
        }

        return formatToolResult({
          success: result.exitCode === 0,
          mode,
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode,
          direction: params.direction || "push",
          localPath: params.localPath,
          remotePath: params.remotePath,
        })
      } catch (err) {
        return formatToolError(err, { params })
      }
    },
  })
}
