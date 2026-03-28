"use strict";

// NOTE: Import from dist to share the same executor instance with dist/adapter/hooks.js
const { executeSync, getMode, getRemoteConfig, isRemoteReady } = require("../../dist/core/executor");
const { formatToolResult, formatToolError } = require("../../dist/core/utils");

/**
 * Register musa_sync tool
 * Syncs files between local and remote for MUSA deployment
 */
function registerMusaSyncTool(api) {
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
    async execute(_toolCallId, params) {
      try {
        const mode = getMode();

        // Sync is primarily for remote mode
        if (mode === "local") {
          return formatToolError(
            "musa_sync is designed for remote mode. In local mode, use musa_exec with cp command instead.",
            { currentMode: mode }
          );
        }

        // Check if remote mode is properly configured
        if (!isRemoteReady()) {
          return formatToolError(
            "Remote mode is not configured. Call musa_set_mode first with host, user, and password.",
            { currentMode: mode }
          );
        }

        const result = await executeSync(params);

        return formatToolResult({
          success: result.exitCode === 0,
          mode,
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode,
          direction: params.direction || "push",
          localPath: params.localPath,
          remotePath: params.remotePath,
        });
      } catch (err) {
        return formatToolError(err, { params });
      }
    },
  });
}

module.exports = {
  registerMusaSyncTool,
};