/**
 * SSH Configuration
 */
export interface SSHConfig {
  host: string
  user: string
  password: string
  port: string
  sudoPasswd?: string
}

/**
 * Environment configuration including optional fields
 */
export interface EnvConfig extends SSHConfig {
  sudoPasswd: string
  workdir: string
  dockerImage?: string
}

/**
 * Command execution options
 */
export interface ExecOptions {
  workdir?: string
  sudo?: boolean
  timeout?: number
}

/**
 * Command execution result
 */
export interface ExecResult {
  stdout: string
  stderr: string
  exitCode: number
}

/**
 * Docker execution arguments
 */
export interface DockerArgs {
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
 * File sync arguments
 */
export interface SyncArgs {
  localPath: string
  remotePath: string
  direction?: "push" | "pull"
  delete?: boolean
  exclude?: string[]
  timeout?: number
}

/**
 * Sync result
 */
export interface SyncResult {
  stdout: string
  stderr: string
  exitCode: number
}

/**
 * MCP Tool response content
 */
export interface ToolContent {
  type: "text"
  text: string
}

/**
 * MCP Tool response
 */
export interface ToolResponse {
  content: ToolContent[]
  isError?: boolean
}