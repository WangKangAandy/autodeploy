"use strict";

// NOTE: Import from dist to share the same executor instance with dist/adapter/hooks.js
const { executeDocker, getMode, getRemoteConfig, isRemoteReady } = require("../../dist/core/executor");
const { formatToolResult, formatToolError } = require("../../dist/core/utils");

/**
 * Register musa_docker tool
 * Executes commands in Docker containers for MUSA deployment
 */
function registerMusaDockerTool(api) {
  api.registerTool({
    name: "musa_docker",
    description: `Execute a command in a Docker container for MUSA deployment.

Supports two modes:
1. Docker exec (reuse existing container): Provide 'name' parameter
2. Docker run (one-shot container): Provide 'image' parameter

MT-GPU containers are automatically configured with:
- mthreads runtime for GPU access
- MTHREADS_VISIBLE_DEVICES=all
- MTHREADS_DRIVER_CAPABILITIES=compute,utility

Use musa_set_mode first to switch between local and remote deployment.`,
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "Command to execute in the container",
        },
        image: {
          type: "string",
          description: "Docker image for one-shot container (e.g., registry.mthreads.com/public/musa-train:rc4.3.1)",
        },
        name: {
          type: "string",
          description: "Existing container name for docker exec mode",
        },
        workdir: {
          type: "string",
          default: "/workspace",
          description: "Working directory in container (default: /workspace)",
        },
        visibleDevices: {
          type: "string",
          default: "all",
          description: "GPU devices visible to container (default: all)",
        },
        shmSize: {
          type: "string",
          default: "16G",
          description: "Shared memory size (default: 16G)",
        },
        volumes: {
          type: "array",
          items: { type: "string" },
          description: "Volume mounts (e.g., ['~/workspace:/workspace'])",
        },
        envVars: {
          type: "array",
          items: { type: "string" },
          description: "Environment variables (e.g., ['CUDA_VISIBLE_DEVICES=0'])",
        },
        sudo: {
          type: "boolean",
          default: false,
          description: "Run docker command with sudo",
        },
        timeout: {
          type: "number",
          default: 300,
          description: "Command timeout in seconds (default: 300)",
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

        // Validate: either image or name must be provided
        if (!params.image && !params.name) {
          return formatToolError(
            "Either 'image' (for docker run) or 'name' (for docker exec) must be provided",
            { params }
          );
        }

        // Add sudoPasswd for remote mode
        const args = { ...params };
        if (mode === "remote") {
          const config = getRemoteConfig();
          args.sudoPasswd = config.sudoPasswd;
        }

        const result = await executeDocker(args);

        return formatToolResult({
          success: result.exitCode === 0,
          mode,
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode,
          containerType: params.name ? "exec" : "run",
          image: params.image,
          name: params.name,
        });
      } catch (err) {
        return formatToolError(err, { command: params.command });
      }
    },
  });
}

module.exports = {
  registerMusaDockerTool,
};