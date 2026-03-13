import type { Plugin } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"
import * as fs from "fs"
import * as path from "path"

const REMOTE_TOOLS = ["remote-exec", "remote-sync", "remote-docker"]

const RemoteSSHPlugin: Plugin = async (input) => {
  const logFile = path.join(input.worktree, ".opencode", "remote-exec.log")

  // Ensure log directory exists
  const logDir = path.dirname(logFile)
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true })

  return {
    // Inject GPU connection env vars into shell environment for all tool calls.
    // This ensures tools spawned via Bash also have access to the remote config.
    "shell.env": async (_input, output) => {
      const envVars: Record<string, string> = {}
      const keys = [
        "GPU_HOST", "GPU_USER", "GPU_SSH_PASSWD", "GPU_PORT", "GPU_WORK_DIR",
        "TORCH_MUSA_DOCKER_IMAGE",
      ]
      for (const key of keys) {
        if (process.env[key]) envVars[key] = process.env[key]!
      }
      Object.assign(output.env, envVars)
    },

    // Log all remote tool executions for migration audit trail
    "tool.execute.after": async (input, _output) => {
      if (!REMOTE_TOOLS.includes(input.tool)) return

      const entry = [
        `[${new Date().toISOString()}]`,
        `tool=${input.tool}`,
        `session=${input.sessionID}`,
        `args=${JSON.stringify(input.args)}`,
      ].join(" ") + "\n"

      try {
        fs.appendFileSync(logFile, entry)
      } catch {
        // Non-critical -- don't break the tool if logging fails
      }
    },

    // Preserve Remote MT-GPU Machine connection state and migration progress when context is compacted.
    // Without this, the LLM loses track of which Remote MT-GPU Machine it's connected to
    // and what installation step it was on during long multi-step migrations.
    "experimental.session.compacting": async (_input, output) => {
      const stateLines: string[] = []

      // Preserve connection info
      const host = process.env.GPU_HOST
      const user = process.env.GPU_USER
      if (host && user) {
        stateLines.push(
          `## Remote MT-GPU Machine Connection`,
          `Connected to Remote MT-GPU Machine: ${user}@${host}:${process.env.GPU_PORT || "22"}`,
          `GPU_WORK_DIR: ${process.env.GPU_WORK_DIR || "~ (default)"}`,
        )
      }

      // Preserve Docker image info
      const dockerImage = process.env.TORCH_MUSA_DOCKER_IMAGE
      if (dockerImage) {
        stateLines.push(`Docker image: ${dockerImage}`)
      }

      // Preserve MUSA install state if it exists
      const stateFile = path.join(input.directory, ".musa_sdk_install_state.json")
      if (fs.existsSync(stateFile)) {
        try {
          const state = JSON.parse(fs.readFileSync(stateFile, "utf-8"))
          stateLines.push(
            ``,
            `## MUSA SDK Install State`,
            `MUSA SDK version: ${state.MUSA_SDK_VERSION || "unknown"}`,
            `Install state: ${state.INSTALL_STATE || "unknown"}`,
            `Last updated: ${state.TIMESTAMP || "unknown"}`,
          )
        } catch {
          // Ignore malformed state file
        }
      }

      // Read last 10 remote exec log entries for context
      if (fs.existsSync(logFile)) {
        try {
          const lines = fs.readFileSync(logFile, "utf-8").trim().split("\n")
          const recent = lines.slice(-10)
          if (recent.length > 0) {
            stateLines.push(
              ``,
              `## Recent Remote Commands (last ${recent.length})`,
              ...recent,
            )
          }
        } catch {
          // Ignore
        }
      }

      if (stateLines.length > 0) {
        output.context.push(stateLines.join("\n"))
      }
    },
  }
}

export default RemoteSSHPlugin
