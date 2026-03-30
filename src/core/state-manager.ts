/**
 * State Management Layer
 *
 * Persistent state for hosts, operations, and tool executions.
 */

import * as fs from "fs"
import * as path from "path"

// ============================================================================
// Type Definitions
// ============================================================================

export type Intent =
  | "deploy_env" | "update_driver" | "gpu_status" | "run_container"
  | "validate" | "sync" | "auto" | "execute_document"
  | "prepare_model" | "prepare_dataset" | "prepare_package"
  | "manage_images" | "prepare_repo"

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

export interface OperationKey {
  hostId: string
  intent: Intent
  scope?: "env" | "host" | "cluster" | "service"
  target?: string
  resource?: string
  version?: string
}

export interface Operation {
  id: string
  traceId?: string
  parentSpanId?: string
  sourceService?: string
  type: "deployment" | "driver_update" | "validation" | "benchmark"
  intent: Intent
  operationKey: OperationKey
  input: {
    hostId: string
    params: Record<string, unknown>
  }
  execution: {
    startTime: string
    endTime?: string
    status: "pending" | "running" | "completed" | "failed" | "paused" | "interrupted"
  }
  result?: {
    success: boolean
    summary: string
    error?: string
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

const MAX_OPERATIONS = 100
const MAX_TOOL_EXECUTIONS = 200

export class StateManager {
  private workspacePath: string
  private stateDir: string
  private cache: Map<string, unknown> = new Map()
  private lockHandle: fs.promises.FileHandle | null = null
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

    const stateFiles = ["hosts.json", "operations.json", "tool-executions.json"]
    for (const file of stateFiles) {
      const filePath = path.join(this.stateDir, file)
      if (!fs.existsSync(filePath)) {
        await this.atomicWrite(file, [])
      }
    }

    this._ready = true
  }

  // ==========================================================================
  // Locking
  // ==========================================================================

  async acquireLock(timeout = 5000): Promise<boolean> {
    const lockPath = path.join(this.stateDir, ".lock")
    const startTime = Date.now()

    while (Date.now() - startTime < timeout) {
      try {
        this.lockHandle = await fs.promises.open(lockPath, "wx")
        return true
      } catch (err: any) {
        if (err.code === "EEXIST") {
          await new Promise(r => setTimeout(r, 100))
          continue
        }
        throw err
      }
    }
    return false
  }

  async releaseLock(): Promise<void> {
    if (!this.lockHandle) return
    const lockPath = path.join(this.stateDir, ".lock")
    try {
      await this.lockHandle.close()
      await fs.promises.unlink(lockPath)
    } catch {
      // Ignore
    } finally {
      this.lockHandle = null
    }
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
  // Operation Management
  // ==========================================================================

  async startOperationIfNoConflict(
    intent: Intent,
    params: Record<string, unknown>,
    trace?: { traceId: string; parentSpanId?: string; sourceService?: string },
  ): Promise<{ started: boolean; operationId?: string; conflict?: Operation }> {
    const acquired = await this.acquireLock()
    if (!acquired) throw new Error("Failed to acquire lock within timeout")

    try {
      const key = computeOperationKey(intent, params)
      const conflict = await this.findConflictingOperation(key)
      if (conflict) return { started: false, conflict }

      const operationId = await this.startOperation(intent, params, trace)
      return { started: true, operationId }
    } finally {
      await this.releaseLock()
    }
  }

  async startOperation(
    intent: Intent,
    params: Record<string, unknown>,
    trace?: { traceId: string; parentSpanId?: string; sourceService?: string },
  ): Promise<string> {
    const operations = await this.loadState<Operation[]>("operations.json")

    const id = generateId("op")
    const hostId = (params.hostId as string) || "local"

    const operation: Operation = {
      id,
      traceId: trace?.traceId,
      parentSpanId: trace?.parentSpanId,
      sourceService: trace?.sourceService,
      type: mapIntentToType(intent),
      intent,
      operationKey: computeOperationKey(intent, params),
      input: { hostId, params },
      execution: { startTime: new Date().toISOString(), status: "running" },
    }

    operations.push(operation)

    // Trim old operations
    if (operations.length > MAX_OPERATIONS) {
      operations.splice(0, operations.length - MAX_OPERATIONS)
    }

    await this.saveState("operations.json", operations)
    return id
  }

  async completeOperation(opId: string, result: { success: boolean; summary: string; error?: string }): Promise<void> {
    const operations = await this.loadState<Operation[]>("operations.json")
    const op = operations.find(o => o.id === opId)
    if (op) {
      op.execution.endTime = new Date().toISOString()
      op.execution.status = result.success ? "completed" : "failed"
      op.result = result
      await this.saveState("operations.json", operations)
    }
  }

  async getOperation(opId: string): Promise<Operation | null> {
    const operations = await this.loadState<Operation[]>("operations.json")
    return operations.find(o => o.id === opId) || null
  }

  async resumeOperation(operationId: string): Promise<boolean> {
    const operations = await this.loadState<Operation[]>("operations.json")
    const op = operations.find(o => o.id === operationId)
    if (!op) return false

    const resumable = ["paused", "interrupted"]
    if (!resumable.includes(op.execution.status)) return false

    op.execution.status = "running"
    await this.saveState("operations.json", operations)
    return true
  }

  async findConflictingOperation(key: OperationKey): Promise<Operation | null> {
    const operations = await this.loadState<Operation[]>("operations.json")

    return operations.find(op => {
      if (!["pending", "running"].includes(op.execution.status)) return false

      const opKey = op.operationKey
      if (!opKey) {
        return op.input.hostId === key.hostId && op.intent === key.intent
      }

      if (opKey.hostId !== key.hostId) return false
      if (opKey.intent !== key.intent) return false
      if (key.target && opKey.target && key.target !== opKey.target) return false
      if (key.resource && opKey.resource && key.resource !== opKey.resource) return false

      return true
    }) || null
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

function mapIntentToType(intent: Intent): Operation["type"] {
  switch (intent) {
    case "deploy_env": case "execute_document": return "deployment"
    case "update_driver": return "driver_update"
    case "validate": return "validation"
    default: return "benchmark"
  }
}

function computeOperationKey(intent: Intent, params: Record<string, unknown>): OperationKey {
  const key: OperationKey = {
    hostId: (params.hostId as string) || "local",
    intent,
  }

  switch (intent) {
    case "deploy_env":
      key.scope = "env"; key.target = (params.envName as string) || "default"
      key.resource = "sdk"; key.version = params.sdkVersion as string
      break
    case "update_driver":
      key.scope = "host"; key.resource = "driver"; key.version = params.driverVersion as string
      break
    case "run_container":
      key.scope = "service"; key.target = params.containerName as string
      key.resource = "container-image"; key.version = params.image as string
      break
    case "execute_document":
      key.scope = "env"; key.target = (params.documentId as string) || "unknown"
      key.resource = "document"
      break
  }

  return key
}
