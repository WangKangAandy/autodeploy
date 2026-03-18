import { getEnvConfig } from "../shared/env-loader.js"
import {
  syncFiles,
  formatOutput,
  truncateOutput,
} from "../core/index.js"
import type { ToolResponse, SyncArgs } from "../core/index.js"

/**
 * Remote Sync Tool - Sync files between local machine and Remote MT-GPU Machine
 */
export const RemoteSyncTool = {
  name: "remote-sync",
  description: `Sync files between the local machine and the Remote MT-GPU Machine via rsync over SSH.
Supports both push (local to remote) and pull (remote to local) directions.
Requires GPU_HOST, GPU_USER, GPU_SSH_PASSWD environment variables.`,
  inputSchema: {
    type: "object",
    properties: {
      local_path: {
        type: "string",
        description:
          "Local file or directory path. Can be relative or absolute path.",
      },
      remote_path: {
        type: "string",
        description:
          "Remote file or directory path on the Remote MT-GPU Machine. Relative paths are relative to GPU_WORK_DIR.",
      },
      direction: {
        type: "string",
        description: "Sync direction: 'push' (local to remote) or 'pull' (remote to local)",
        enum: ["push", "pull"],
        default: "push",
      },
      delete: {
        type: "boolean",
        description:
          "Delete files in destination that don't exist in source. Use with caution. Default: false",
        default: false,
      },
      exclude: {
        type: "array",
        items: { type: "string" },
        description:
          "Patterns to exclude from sync (rsync --exclude patterns). E.g. ['*.tmp', '.git']",
        default: [],
      },
      timeout: {
        type: "number",
        description: "Timeout in seconds. Default 600 (10 minutes)",
        default: 600,
      },
    },
    required: ["local_path", "remote_path"],
  },

  async execute(args: any): Promise<ToolResponse> {
    try {
      const env = getEnvConfig()

      // Build sync args
      const syncArgs: SyncArgs = {
        localPath: args.local_path,
        remotePath: args.remote_path,
        direction: args.direction || "push",
        delete: args.delete || false,
        exclude: args.exclude || [],
        timeout: args.timeout || 600,
      }

      // Execute via core executor
      const result = await syncFiles(
        {
          host: env.host,
          user: env.user,
          password: env.passwd,
          port: env.port,
        },
        syncArgs
      )

      // Format output
      const output = formatOutput(result.stdout, result.stderr, result.exitCode)

      return {
        content: [
          {
            type: "text",
            text: truncateOutput(output),
          },
        ],
        isError: result.exitCode !== 0,
      }
    } catch (error: any) {
      return {
        content: [
          {
            type: "text",
            text: `File sync failed: ${error.message}`,
          },
        ],
        isError: true,
      }
    }
  },
}