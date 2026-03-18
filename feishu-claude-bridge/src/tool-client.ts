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
    try {
      const module = await import("../../agent-tools/dist/core/executors.js")
      agentTools = {
        execRemote: module.execRemote,
        execDocker: module.execDocker,
        syncFiles: module.syncFiles,
        formatOutput: module.formatOutput,
      }
      logger.info("Agent tools loaded successfully")
    } catch (error) {
      logger.error(`Failed to load agent tools: ${error}`)
      throw new Error("Agent tools not available. Make sure agent-tools is built.")
    }
  }
  return agentTools
}

/**
 * ToolClient - Provides access to remote execution tools for the Feishu bot
 */
export class ToolClient {
  private config: SSHConfig & { sudoPasswd: string }
  private credentialsSource: string

  constructor(config: ToolClientConfig, source: string = "config") {
    this.config = {
      host: config.host,
      user: config.user,
      password: config.password,
      port: config.port || "22",
      sudoPasswd: config.sudoPasswd || config.password,
    }
    this.credentialsSource = source
    logger.info(`ToolClient initialized for ${config.user}@${config.host}:${config.port || 22} (source: ${source})`)
  }

  /**
   * Get the credentials source
   */
  getCredentialsSource(): string {
    return this.credentialsSource
  }

  /**
   * Get masked host info for logging
   */
  getHostInfo(): string {
    return `${this.config.user}@${this.config.host}:${this.config.port}`
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

    return new ToolClient({ host, user, password, port, sudoPasswd }, "env")
  }

  /**
   * Create a ToolClient from dynamic credentials (parsed from user message)
   */
  static fromCredentials(host: string, user: string, password: string, port?: string): ToolClient {
    return new ToolClient({ host, user, password, port }, "dynamic")
  }

  /**
   * Check if the client has valid configuration
   */
  isValid(): boolean {
    return !!(this.config.host && this.config.user && this.config.password)
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
    logger.info(`Executing remote command on ${this.config.host}: ${command.substring(0, 50)}...`)

    try {
      const tools = await loadAgentTools()
      const result = await tools.execRemote(this.config, command, {
        workdir: options?.workdir,
        sudo: options?.sudo,
        timeout: options?.timeout || 120,
      })

      logger.info(`Command completed with exit code: ${result.exitCode}`)
      return result
    } catch (error: any) {
      logger.error(`Command execution failed: ${error.message}`)
      return {
        stdout: "",
        stderr: error.message,
        exitCode: -1,
      }
    }
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
    logger.info(`Executing Docker command on ${this.config.host}: ${command.substring(0, 50)}...`)

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

    try {
      const tools = await loadAgentTools()
      const result = await tools.execDocker(this.config, dockerArgs)

      logger.info(`Docker command completed with exit code: ${result.exitCode}`)
      return result
    } catch (error: any) {
      logger.error(`Docker execution failed: ${error.message}`)
      return {
        stdout: "",
        stderr: error.message,
        exitCode: -1,
      }
    }
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
      return `Failed to get GPU status from ${this.config.host}: ${result.stderr || "Connection failed"}`
    }

    return result.stdout
  }

  /**
   * Check if the remote host is reachable
   */
  async checkConnection(): Promise<{ success: boolean; message: string }> {
    try {
      const result = await this.execCommand("echo 'connection ok'", { timeout: 10 })
      if (result.exitCode === 0) {
        return { success: true, message: `Successfully connected to ${this.config.host}` }
      }
      return { success: false, message: `Connection failed: ${result.stderr}` }
    } catch (error: any) {
      return { success: false, message: `Connection error: ${error.message}` }
    }
  }

  /**
   * Get MUSA environment status
   */
  async getMusaStatus(): Promise<string> {
    const results: string[] = []

    // Check GPU
    const gpuResult = await this.execCommand("mthreads-gmi 2>/dev/null | head -20")
    if (gpuResult.exitCode === 0 && gpuResult.stdout.trim()) {
      results.push("=== GPU 状态 ===")
      results.push(gpuResult.stdout.trim())
    } else {
      results.push("=== GPU 状态 ===")
      results.push("无法获取 GPU 信息（可能驱动未安装或 mthreads-gmi 不可用）")
    }

    // Check Docker
    const dockerResult = await this.execCommand("docker --version 2>/dev/null")
    if (dockerResult.exitCode === 0) {
      results.push("\n=== Docker ===")
      results.push(dockerResult.stdout.trim())

      // Check running containers
      const containersResult = await this.execCommand("docker ps --format 'table {{.Names}}\\t{{.Image}}\\t{{.Status}}' 2>/dev/null")
      if (containersResult.exitCode === 0 && containersResult.stdout.trim()) {
        results.push("\n运行中的容器:")
        results.push(containersResult.stdout.trim())
      }
    } else {
      results.push("\n=== Docker ===")
      results.push("Docker 未安装或不可用")
    }

    // Check MUSA driver
    const driverResult = await this.execCommand("dpkg -s musa 2>/dev/null | grep -E '^(Package|Version|Status)' || echo 'MUSA 驱动未安装'")
    results.push("\n=== MUSA 驱动 ===")
    results.push(driverResult.stdout.trim())

    return results.join("\n")
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