/**
 * State Management Layer
 *
 * Persistent state for hosts and tool executions.
 */

import * as fs from "fs"
import * as path from "path"

// ============================================================================
// Type Definitions
// ============================================================================

export type HostSource = "manual" | "probed" | "config_file"

export interface HostState {
  id: string
  host: string
  user: string
  password?: string
  port: number
  isDefault?: boolean
  sudoPasswd?: string
  status: "online" | "offline" | "unknown"
  lastProbeTime: string
  source: HostSource
  sourceDetails?: {
    configFile?: string
    probedAt?: string
    addedBy?: string
  }
  gpu?: {
    type: string
    memory: string
    driverVersion: string
    sdkVersion: string
  }
  environment: {
    dockerAvailable: boolean
    toolkitInstalled: boolean
    mthreadsGmiAvailable: boolean
  }
}

export interface ContextSnapshot {
  mode: "local" | "remote"
  defaultHost: string | null
  hosts: HostState[]
}

export interface ToolExecution {
  tool: string
  command: string
  exitCode: number
  success: boolean
  durationMs: number
  stdoutPreview?: string
  stderrPreview?: string
  error?: string
  timestamp: string
}

// ============================================================================
// State Manager
// ============================================================================

const MAX_TOOL_EXECUTIONS = 200

export class StateManager {
  private workspacePath: string
  private stateDir: string
  private cache: Map<string, unknown> = new Map()
  private _ready: boolean = false

  constructor(workspacePath: string) {
    this.workspacePath = workspacePath
    this.stateDir = path.join(workspacePath, "autodeploy")
  }

  isReady(): boolean { return this._ready }

  assertReady(): void {
    if (!this._ready) {
      throw new Error("StateManager not ready. Ensure plugin.register() finishes before accepting requests.")
    }
  }

  // ==========================================================================
  // Initialization
  // ==========================================================================

  async initialize(): Promise<void> {
    await fs.promises.mkdir(this.stateDir, { recursive: true })

    const stateFiles = ["hosts.json", "tool-executions.json"]
    for (const file of stateFiles) {
      const filePath = path.join(this.stateDir, file)
      if (!fs.existsSync(filePath)) {
        await this.atomicWrite(file, [])
      }
    }

    this._ready = true
  }

  // ==========================================================================
  // Host Management
  // ==========================================================================

  async registerHost(
    host: Omit<HostState, "id" | "lastProbeTime" | "source" | "sourceDetails">,
    source: HostSource = "manual",
    details?: HostState["sourceDetails"],
  ): Promise<string> {
    const hosts = await this.loadState<HostState[]>("hosts.json")

    const existingIndex = hosts.findIndex(h => h.host === host.host)
    if (existingIndex >= 0) {
      hosts[existingIndex] = {
        ...hosts[existingIndex],
        ...host,
        source,
        sourceDetails: details,
        lastProbeTime: new Date().toISOString(),
      }
      await this.saveState("hosts.json", hosts)
      return hosts[existingIndex].id
    }

    const id = generateId("host")
    const newHost: HostState = {
      ...host,
      id,
      source,
      sourceDetails: details,
      lastProbeTime: new Date().toISOString(),
    }
    hosts.push(newHost)
    await this.saveState("hosts.json", hosts)
    return id
  }

  async getDefaultHost(): Promise<HostState | null> {
    const hosts = await this.loadState<HostState[]>("hosts.json")
    return hosts.find(h => h.isDefault === true) ?? null
  }

  async setDefaultHost(hostId: string): Promise<void> {
    const hosts = await this.loadState<HostState[]>("hosts.json")
    const target = hosts.find(h => h.id === hostId)
    if (!target) {
      throw new Error(`Host "${hostId}" not found. Available: ${hosts.map(h => h.id).join(", ") || "none"}`)
    }
    for (const host of hosts) {
      host.isDefault = host.id === hostId
    }
    await this.saveState("hosts.json", hosts)
  }

  async clearDefaultHost(): Promise<void> {
    const hosts = await this.loadState<HostState[]>("hosts.json")
    for (const host of hosts) { host.isDefault = false }
    await this.saveState("hosts.json", hosts)
  }

  async getExecutionMode(): Promise<"local" | "remote"> {
    const defaultHost = await this.getDefaultHost()
    return defaultHost ? "remote" : "local"
  }

  async getRemoteConfig(): Promise<{
    host: string; user: string; password?: string; port: number; sudoPasswd?: string
  } | null> {
    const defaultHost = await this.getDefaultHost()
    if (!defaultHost?.host || !defaultHost?.user) return null
    return {
      host: defaultHost.host,
      user: defaultHost.user,
      password: defaultHost.password,
      port: defaultHost.port || 22,
      sudoPasswd: defaultHost.sudoPasswd,
    }
  }

  // ==========================================================================
  // Snapshot (for context-builder)
  // ==========================================================================

  async loadSnapshot(): Promise<ContextSnapshot> {
    const hosts = await this.loadState<HostState[]>("hosts.json")
    return {
      mode: this.detectMode(),
      defaultHost: hosts.find(h => h.isDefault)?.host || null,
      hosts,
    }
  }

  private detectMode(): "local" | "remote" {
    const cached = this.cache.get("hosts.json")
    if (cached) {
      return (cached as HostState[]).some(h => h.isDefault) ? "remote" : "local"
    }
    try {
      const hostsFile = path.join(this.stateDir, "hosts.json")
      if (fs.existsSync(hostsFile)) {
        const hosts = JSON.parse(fs.readFileSync(hostsFile, "utf-8"))
        return hosts.some((h: HostState) => h.isDefault) ? "remote" : "local"
      }
    } catch { /* ignore */ }
    return "local"
  }

  // ==========================================================================
  // Tool Execution Recording
  // ==========================================================================

  async recordToolExecution(exec: ToolExecution): Promise<void> {
    this.assertReady()
    const executions = await this.loadState<ToolExecution[]>("tool-executions.json")
    executions.push(exec)
    if (executions.length > MAX_TOOL_EXECUTIONS) {
      executions.splice(0, executions.length - MAX_TOOL_EXECUTIONS)
    }
    await this.saveState("tool-executions.json", executions)
  }

  async getRecentToolExecutions(limit = 5): Promise<ToolExecution[]> {
    this.assertReady()
    const executions = await this.loadState<ToolExecution[]>("tool-executions.json")
    return executions.slice(-limit)
  }

  // ==========================================================================
  // Persistence on session end
  // ==========================================================================

  async persistAll(): Promise<void> {
    for (const [key, data] of this.cache.entries()) {
      await this.atomicWrite(key, data)
    }
  }

  // ==========================================================================
  // Internal
  // ==========================================================================

  private async loadState<T>(file: string): Promise<T> {
    const cached = this.cache.get(file)
    if (cached) return cached as T

    const filePath = path.join(this.stateDir, file)
    try {
      const data = JSON.parse(await fs.promises.readFile(filePath, "utf-8"))
      this.cache.set(file, data)
      return data as T
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        const defaultState = [] as unknown as T
        await this.atomicWrite(file, defaultState)
        this.cache.set(file, defaultState)
        return defaultState
      }
      throw err
    }
  }

  private async saveState(file: string, data: unknown): Promise<void> {
    this.cache.set(file, data)
    await this.atomicWrite(file, data)
  }

  private async atomicWrite(file: string, data: unknown): Promise<void> {
    const filePath = path.join(this.stateDir, file)
    const tempPath = `${filePath}.tmp`

    await fs.promises.writeFile(tempPath, JSON.stringify(data, null, 2))

    // Sensitive files get restrictive permissions
    if (file === "hosts.json") {
      await fs.promises.chmod(tempPath, 0o600)
    }

    await fs.promises.rename(tempPath, filePath)
  }
}

// ============================================================================
// Helpers
// ============================================================================

function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
}