/**
 * Tool Client for Feishu Bot
 *
 * This client wraps the agent-tools core executors for use in the Feishu bot.
 * It provides a simple interface for executing remote commands and Docker operations.
 */
import { logger } from "./utils/logger.js"

/**
 * SSH Configuration (local type to avoid import issues)
 */
interface SSHConfig {
  host: string
  user: string
  password: string
  port: string
  sudoPasswd?: string
}

/**
 * Command execution result (local type)
 */
export interface ExecResult {
  stdout: string
  stderr: string
  exitCode: number
}

/**
 * Docker execution arguments (local type)
 */
interface DockerArgs {
  command: string
  image?: string
  workdir?: string
  visibleDevices?: string
  shmSize?: string
  volumes?: string[]
  envVars?: string[]
  name?: string
  sudo?: boolean
  timeout?: number
}

/**
 * File sync arguments (local type)
 */
interface SyncArgs {
  localPath: string
  remotePath: string
  direction?: "push" | "pull"
  delete?: boolean
  exclude?: string[]
  timeout?: number
}

/**
 * Configuration for ToolClient
 */
export interface ToolClientConfig {
  host: string
  user: string
  password: string
  port?: string
  sudoPasswd?: string
}

// Dynamic imports for agent-tools (compiled dist)
let agentTools: {
  execRemote: (config: SSHConfig, command: string, options?: any) => Promise<ExecResult>
  execDocker: (config: SSHConfig, args: DockerArgs) => Promise<ExecResult>
  syncFiles: (config: SSHConfig, args: SyncArgs) => Promise<ExecResult>
  formatOutput: (stdout: string, stderr: string, exitCode: number) => string
} | null = null

async function loadAgentTools() {
  if (!agentTools) {
    const module = await import("../../agent-tools/dist/core/executors.js")
    agentTools = {
      execRemote: module.execRemote,
      execDocker: module.execDocker,
      syncFiles: module.syncFiles,
      formatOutput: module.formatOutput,
    }
  }
  return agentTools
}

/**
 * ToolClient - Provides access to remote execution tools for the Feishu bot
 */
export class ToolClient {
  private config: SSHConfig & { sudoPasswd: string }

  constructor(config: ToolClientConfig) {
    this.config = {
      host: config.host,
      user: config.user,
      password: config.password,
      port: config.port || "22",
      sudoPasswd: config.sudoPasswd || config.password,
    }
    logger.info(`ToolClient initialized for ${config.user}@${config.host}:${config.port || 22}`)
  }

  /**
   * Create a ToolClient from environment variables
   */
  static fromEnv(): ToolClient {
    const host = process.env.GPU_HOST
    const user = process.env.GPU_USER
    const password = process.env.GPU_SSH_PASSWD
    const port = process.env.GPU_PORT || "22"
    const sudoPasswd = process.env.MY_SUDO_PASSWD || password

    if (!host || !user || !password) {
      throw new Error(
        "Missing required environment variables. Set GPU_HOST, GPU_USER, and GPU_SSH_PASSWD."
      )
    }

    return new ToolClient({ host, user, password, port, sudoPasswd })
  }

  /**
   * Execute a shell command on the remote GPU host
   */
  async execCommand(
    command: string,
    options?: {
      workdir?: string
      sudo?: boolean
      timeout?: number
    }
  ): Promise<ExecResult> {
    logger.info(`Executing remote command: ${command.substring(0, 50)}...`)

    const tools = await loadAgentTools()
    const result = await tools.execRemote(this.config, command, {
      workdir: options?.workdir,
      sudo: options?.sudo,
      timeout: options?.timeout || 120,
    })

    logger.info(`Command completed with exit code: ${result.exitCode}`)
    return result
  }

  /**
   * Run a command inside a Docker container on the remote host
   */
  async execDocker(
    command: string,
    options?: {
      image?: string
      workdir?: string
      name?: string
      volumes?: string[]
      envVars?: string[]
      sudo?: boolean
      timeout?: number
    }
  ): Promise<ExecResult> {
    logger.info(`Executing Docker command: ${command.substring(0, 50)}...`)

    const dockerArgs: DockerArgs = {
      command,
      image: options?.image || process.env.TORCH_MUSA_DOCKER_IMAGE,
      workdir: options?.workdir || "/workspace",
      name: options?.name,
      volumes: options?.volumes || [],
      envVars: options?.envVars || [],
      sudo: options?.sudo,
      timeout: options?.timeout || 300,
    }

    const tools = await loadAgentTools()
    const result = await tools.execDocker(this.config, dockerArgs)

    logger.info(`Docker command completed with exit code: ${result.exitCode}`)
    return result
  }

  /**
   * Sync files between local and remote host
   */
  async syncFiles(
    localPath: string,
    remotePath: string,
    options?: {
      direction?: "push" | "pull"
      delete?: boolean
      exclude?: string[]
      timeout?: number
    }
  ): Promise<ExecResult> {
    const syncArgs: SyncArgs = {
      localPath,
      remotePath,
      direction: options?.direction || "push",
      delete: options?.delete || false,
      exclude: options?.exclude || [],
      timeout: options?.timeout || 600,
    }

    logger.info(`Syncing files: ${options?.direction || "push"} ${localPath} <-> ${remotePath}`)

    const tools = await loadAgentTools()
    const result = await tools.syncFiles(this.config, syncArgs)

    logger.info(`File sync completed with exit code: ${result.exitCode}`)
    return result
  }

  /**
   * Get GPU status from the remote host
   */
  async getGpuStatus(): Promise<string> {
    const result = await this.execCommand("mthreads-gmi")

    if (result.exitCode !== 0) {
      return `Failed to get GPU status: ${result.stderr}`
    }

    return result.stdout
  }

  /**
   * Check if the remote host is reachable
   */
  async checkConnection(): Promise<boolean> {
    try {
      const result = await this.execCommand("echo 'connection ok'", { timeout: 10 })
      return result.exitCode === 0
    } catch {
      return false
    }
  }

  /**
   * List running Docker containers on the remote host
   */
  async listContainers(): Promise<string> {
    const result = await this.execCommand("docker ps --format 'table {{.Names}}\\t{{.Image}}\\t{{.Status}}'")

    if (result.exitCode !== 0) {
      return `Failed to list containers: ${result.stderr}`
    }

    return result.stdout
  }

  /**
   * Get formatted output from an ExecResult
   */
  async formatResult(result: ExecResult): Promise<string> {
    const tools = await loadAgentTools()
    return tools.formatOutput(result.stdout, result.stderr, result.exitCode)
  }
}