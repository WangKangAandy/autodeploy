import { executeDocker, getMode, getRemoteConfig, isRemoteReady } from "../core/executor"
import { formatToolResult, formatToolError } from "../core/utils"
import type { DockerExecArgs } from "../core/local-exec"
import type { SSHConfig } from "../core/ssh-client"
import type { StateManager } from "../core/state-manager"

let stateManager: StateManager | null = null

interface DockerParams {
  command: string
  image?: string
  name?: string
  workdir?: string
  visibleDevices?: string
  shmSize?: string
  volumes?: string[]
  envVars?: string[]
  sudo?: boolean
  timeout?: number
}

/**
 * Register musa_docker tool
 * Executes commands in Docker containers for MUSA deployment
 */
export function registerMusaDockerTool(api: any, sm: StateManager | null = null): void {
  stateManager = sm
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

Use musa_mode to switch between local and remote deployment.`,
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
    async execute(_toolCallId: string, params: DockerParams) {
      const startTime = Date.now()
      try {
        const mode = getMode()

        if (mode === "remote" && !isRemoteReady()) {
          return formatToolError(
            "Remote mode is not configured. Call musa_mode with host, user, and password.",
            { currentMode: mode }
          )
        }

        if (!params.image && !params.name) {
          return formatToolError(
            "Either 'image' (for docker run) or 'name' (for docker exec) must be provided",
            { params }
          )
        }

        const args: DockerExecArgs & { sudoPasswd?: string } = { ...params } as DockerExecArgs & { sudoPasswd?: string }
        if (mode === "remote") {
          const config = getRemoteConfig()
          if (config) {
            args.sudoPasswd = (config as SSHConfig & { sudoPasswd?: string }).sudoPasswd
          }
        }

        const result = await executeDocker(args)

        if (stateManager?.isReady()) {
          await stateManager.recordToolExecution({
            tool: "musa_docker",
            command: `docker ${params.name ? "exec " + params.name : "run " + (params.image || "")} ${params.command}`,
            exitCode: result.exitCode,
            success: result.exitCode === 0,
            durationMs: Date.now() - startTime,
            stdoutPreview: result.stdout?.substring(0, 500),
            stderrPreview: result.stderr?.substring(0, 500),
            timestamp: new Date().toISOString(),
          }).catch(() => {})
        }

        return formatToolResult({
          success: result.exitCode === 0,
          mode,
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode,
          containerType: params.name ? "exec" : "run",
          image: params.image,
          name: params.name,
        })
      } catch (err) {
        if (stateManager?.isReady()) {
          await stateManager.recordToolExecution({
            tool: "musa_docker",
            command: params.command,
            exitCode: -1, success: false,
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
