/**
 * State Management Layer
 *
 * Provides persistent state management for hosts, jobs, operations, and deployment progress.
 */

import * as fs from "fs"
import * as path from "path"

// ============================================================================
// Type Definitions
// ============================================================================

export type Intent = "deploy_env" | "update_driver" | "gpu_status" | "run_container" | "validate" | "sync" | "auto" | "execute_document" | "prepare_model" | "prepare_dataset" | "prepare_package" | "manage_images" | "prepare_repo"

export type RiskLevel = "read_only" | "safe_write" | "destructive"

// Host 来源类型 - 定义 hosts.json 的单一真源
export type HostSource = "manual" | "probed" | "config_file"

export interface HostState {
  id: string
  host: string
  user: string
  password?: string       // SSH password (可选，敏感信息)
  port: number
  isDefault?: boolean     // 是否为默认主机（用于派生执行模式）
  sudoPasswd?: string     // sudo 密码（可选）
  status: "online" | "offline" | "unknown"
  lastProbeTime: string
  source: HostSource  // 记录来源
  sourceDetails?: {
    configFile?: string  // 如果来自配置文件，记录文件路径
    probedAt?: string    // 如果是探测生成，记录探测时间
    addedBy?: string     // 如果是手工录入，记录操作者
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

/**
 * Operation Key - 统一的 operation identity schema
 *
 * 用于幂等检查和冲突检测。持久化到 operation 本身，而非临时计算。
 *
 * ## Version 语义说明 (V1 策略)
 *
 * `version` 字段虽然已定义，但**不参与冲突判断**。
 *
 * 设计决策：
 * - V1 追求稳定串行：同一资源不区分版本，必须排队执行
 * - 例：deploy_env 在 host A 上部署 v4.3.4 和 v4.3.5 会被判定为冲突
 * - 这避免了并发部署导致的资源竞争和状态不一致
 *
 * 未来如需支持"同一资源不同版本可并行"，需要：
 * - 修改 findConflictingOperation() 的比较逻辑
 * - 重新审视 precheck、rollback、resume、资源锁定范围
 * - 可能引入更细粒度的 per-version 锁
 */
export interface OperationKey {
  hostId: string
  intent: Intent
  scope?: "env" | "host" | "cluster" | "service"  // 操作范围
  target?: string    // 操作目标 (env name, service name)
  resource?: string  // 资源类型 (driver, sdk, container-image)
  version?: string   // 具体版本号（V1 不参与冲突判断，仅用于记录和审计）
}

export interface Operation {
  id: string
  traceId?: string           // Trace ID for request chain tracing
  parentSpanId?: string      // Parent span ID for span hierarchy
  sourceService?: string     // Calling source service (for cross-service debugging)
  type: "deployment" | "driver_update" | "validation" | "benchmark"
  intent: Intent
  operationKey: OperationKey  // 持久化的 operation key（幂等检查用）
  input: {
    hostId: string
    params: Record<string, unknown>
  }
  execution: {
    startTime: string
    endTime?: string
    status: "pending" | "running" | "completed" | "failed" | "rolled_back" | "paused" | "awaiting_input" | "interrupted"
    logPath: string
  }
  checkpoints: {
    step: string
    timestamp: string
    rollbackCommand?: string
    requiresConfirmation?: boolean
  }[]
  result?: {
    success: boolean
    summary: string
    error?: string
  }
}

export interface Job {
  id: string
  operationId: string
  traceId?: string           // Trace ID for request chain tracing
  // Note: Phase 1 only persists traceId; can be extended to spanId/sourceService for finer-grained tracing
  hostId?: string  // 关联的 host（用于 context-builder 的 relevance 排序）
  status: "pending" | "running" | "completed" | "failed"
  progress: {
    currentStep: string
    completedSteps: string[]
    totalSteps: number
    percentage: number
  }
}

export interface DeploymentState {
  status: "initialized" | "in_progress" | "completed" | "failed"
  completedSteps: string[]
  sdkVersion: string
  driverVersion: string
  createdAt: string
  updatedAt: string
}

/**
 * Rollback 结果状态枚举
 *
 * V1 设计：不承诺自动回滚，只返回 guidance。
 * 使用 status 而非 success: boolean，让调用方能区分不同的"未执行"原因。
 */
export type RollbackStatus =
  | "manual_required"      // 有 rollback command，需人工执行
  | "unsupported"          // 只读操作（gpu_status, validate）不需要 rollback
  | "no_checkpoint"        // operation 存在但无 checkpoint
  | "no_rollback_command"  // 有 checkpoint 但无 rollback command
  | "not_found"            // operation 不存在

// Rollback 结果 - v1 只返回 guidance，不承诺自动回滚
export interface RollbackResult {
  status: RollbackStatus  // 使用 status 枚举，而非 success: boolean
  guidance: string
  automaticRollback: boolean  // v1 始终为 false
  checkpoint?: {
    step: string
    rollbackCommand?: string
  }
}

export interface ContextSnapshot {
  mode: "local" | "remote"
  defaultHost: string | null
  hosts: HostState[]
  activeJob: {
    type: string
    status: string
    hostId?: string  // 关联的 host（用于 relevance 排序）
    progress?: { percentage: number }
  } | null
  lastDeploymentStatus: string | null
}

// ============================================================================
// Document Execution State Types
// ============================================================================

/**
 * Step state for document execution tracking
 */
export interface StepState {
  id: string
  kind: "shell" | "docker_exec" | "docker_run" | "validation" | "skill_invoke" | "manual"
  status: "pending" | "running" | "completed" | "failed" | "skipped" | "awaiting_input"
  output?: string
  error?: string
  startedAt?: string
  completedAt?: string
  retryCount: number
}

/**
 * Phase state for document execution tracking
 */
export interface PhaseState {
  id: string
  name: string
  status: "pending" | "running" | "completed" | "failed" | "skipped"
  steps: StepState[]
  startedAt?: string
  completedAt?: string
}

/**
 * Document execution state for tracking progress
 */
export interface DocumentExecutionState {
  id: string
  operationId: string              // 关联到 Operation
  planId: string
  documentId: string
  status: "pending" | "running" | "completed" | "failed" | "paused" | "awaiting_input"
  currentPhase: string
  currentStep: string
  phases: PhaseState[]
  variables: Record<string, string>
  createdAt: string
  updatedAt: string
  completedAt?: string
  error?: string
}

// ============================================================================
// State Manager Class
// ============================================================================

export class StateManager {
  private workspacePath: string
  private stateDir: string
  private cache: Map<string, unknown> = new Map()
  private lockHandle: fs.promises.FileHandle | null = null
  private _ready: boolean = false  // Initialization state tracking

  constructor(workspacePath: string) {
    this.workspacePath = workspacePath
    this.stateDir = path.join(workspacePath, "autodeploy")
  }

  /**
   * Check if StateManager is ready for operations
   */
  isReady(): boolean {
    return this._ready
  }

  /**
   * Assert StateManager is ready, throw error if not
   */
  assertReady(): void {
    if (!this._ready) {
      throw new Error(
        "StateManager not ready. Possible causes:\n" +
        "  - Plugin startup race: operations called before register() completed\n" +
        "  - Initialization failure: state directory or file creation failed\n" +
        "  - File system error: permission denied, disk full, or corruption\n" +
        "Ensure plugin.register() finishes before accepting requests."
      )
    }
  }

  // ============================================================================
  // Initialization
  // ============================================================================

  async initialize(): Promise<void> {
    try {
      await fs.promises.mkdir(this.stateDir, { recursive: true })

      // Initialize empty state files if not exist
      const stateFiles = ["hosts.json", "jobs.json", "operations.json", "deployment_state.json", "document_executions.json"]
      for (const file of stateFiles) {
        const filePath = path.join(this.stateDir, file)
        if (!fs.existsSync(filePath)) {
          await this.atomicWrite(file, this.getDefaultState(file))
        }
      }

      this._ready = true
    } catch (err) {
      this._ready = false
      throw err
    }
  }

  // ============================================================================
  // File Lock (V1 粗粒度锁 - 正确性优先，不保证吞吐)
  // ============================================================================

  /**
   * Acquire global lock for atomic operations
   *
   * V1 Trade-offs:
   * - 全局串行化：所有 operation 排队，不区分 host/intent
   * - 正确性优先：先保证无竞态，不保证吞吐
   * - 适合 v1：单实例、低并发场景
   *
   * 后续可升级为：
   * - per-host lock
   * - per-operationKey lock
   * - 分布式锁（Redis/etcd）
   */
  async acquireLock(timeout = 5000): Promise<boolean> {
    const lockPath = path.join(this.stateDir, ".lock")
    const startTime = Date.now()

    while (Date.now() - startTime < timeout) {
      try {
        this.lockHandle = await fs.promises.open(lockPath, "wx")
        return true
      } catch (err: any) {
        if (err.code === "EEXIST") {
          // 锁被占用，等待重试
          await new Promise(r => setTimeout(r, 100))
          continue
        }
        throw err
      }
    }
    return false  // 超时
  }

  /**
   * Release global lock
   */
  async releaseLock(): Promise<void> {
    if (!this.lockHandle) return

    const lockPath = path.join(this.stateDir, ".lock")
    try {
      await this.lockHandle.close()
      await fs.promises.unlink(lockPath)
    } catch {
      // 忽略 unlock 异常，避免覆盖业务异常
    } finally {
      this.lockHandle = null
    }
  }

  /**
   * Atomic conflict check + operation start
   *
   * Combines findConflictingOperation and startOperation into a single atomic operation.
   */
  async startOperationIfNoConflict(
    intent: Intent,
    params: Record<string, unknown>,
    trace?: {
      traceId: string
      parentSpanId?: string
      sourceService?: string
    }
  ): Promise<{ started: boolean; operationId?: string; conflict?: Operation }> {
    const acquired = await this.acquireLock()
    if (!acquired) {
      throw new Error("Failed to acquire lock within timeout")
    }

    try {
      const key = computeOperationKey(intent, params)
      const conflict = await this.findConflictingOperation(key)

      if (conflict) {
        return { started: false, conflict }
      }

      const operationId = await this.startOperation(intent, params, trace)
      return { started: true, operationId }
    } finally {
      await this.releaseLock()
    }
  }

  // ============================================================================
  // Snapshot Loading (for context builder)
  // ============================================================================

  async loadSnapshot(): Promise<ContextSnapshot> {
    const hosts = await this.loadState<HostState[]>("hosts.json")
    const jobs = await this.loadState<Job[]>("jobs.json")
    const deployment = await this.loadState<DeploymentState>("deployment_state.json")

    const activeJob = jobs.find(j => j.status === "running") || null

    return {
      mode: this.detectMode(),
      defaultHost: hosts.find(h => h.status === "online")?.host || null,
      hosts,
      activeJob: activeJob ? {
        type: activeJob.operationId,
        status: activeJob.status,
        hostId: activeJob.hostId,  // 传递给 context-builder
        progress: activeJob.progress,
      } : null,
      lastDeploymentStatus: deployment?.status || null,
    }
  }

  /**
   * Detect current execution mode from persisted executor state
   */
  /**
   * Detect execution mode (synchronous version for loadSnapshot)
   * Reuses the same logic as async getExecutionMode
   *
   * Note: This is kept synchronous for loadSnapshot compatibility.
   * It reads directly from cache/files to avoid async cascade.
   */
  private detectMode(): "local" | "remote" {
    // Try cache first (fast path)
    const cached = this.cache.get("hosts.json")
    if (cached) {
      const hosts = cached as HostState[]
      const hasDefault = hosts.some(h => h.isDefault === true)
      return hasDefault ? "remote" : "local"
    }

    // Fallback to file read (sync for loadSnapshot)
    try {
      const hostsFile = path.join(this.stateDir, "hosts.json")
      if (fs.existsSync(hostsFile)) {
        const content = fs.readFileSync(hostsFile, "utf-8")
        const hosts = JSON.parse(content)
        const hasDefault = hosts.some((h: HostState) => h.isDefault === true)
        return hasDefault ? "remote" : "local"
      }
    } catch {
      // Ignore errors
    }
    return "local"
  }

  // ============================================================================
  // Host Management
  // ============================================================================

  /**
   * Register a host with explicit source tracking
   *
   * Source priority: config_file > manual > probed
   */
  async registerHost(
    host: Omit<HostState, "id" | "lastProbeTime" | "source" | "sourceDetails">,
    source: HostSource = "manual",
    details?: HostState["sourceDetails"]
  ): Promise<string> {
    const hosts = await this.loadState<HostState[]>("hosts.json")

    // Check if host already exists
    const existingIndex = hosts.findIndex(h => h.host === host.host)
    if (existingIndex >= 0) {
      // Update existing record with new source
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

    // Create new record
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

  /**
   * Import hosts from configuration file
   */
  async importHostsFromConfig(configPath: string): Promise<number> {
    const configContent = await fs.promises.readFile(configPath, "utf-8")
    const config = JSON.parse(configContent)

    let imported = 0
    for (const hostConfig of config.hosts || []) {
      await this.registerHost(hostConfig, "config_file", { configFile: configPath })
      imported++
    }

    return imported
  }

  async updateHostStatus(hostId: string, status: Partial<HostState>): Promise<void> {
    const hosts = await this.loadState<HostState[]>("hosts.json")
    const index = hosts.findIndex(h => h.id === hostId)

    if (index >= 0) {
      hosts[index] = { ...hosts[index], ...status, lastProbeTime: new Date().toISOString() }
      await this.saveState("hosts.json", hosts)
    }
  }

  async probeAllHosts(): Promise<void> {
    const hosts = await this.loadState<HostState[]>("hosts.json")
    // TODO: Implement actual probe logic
    // For now, just update timestamp
    for (const host of hosts) {
      host.lastProbeTime = new Date().toISOString()
    }
    await this.saveState("hosts.json", hosts)
  }

  // ============================================================================
  // Default Host Management (for execution mode derivation)
  // ============================================================================

  /**
   * Get the default host (used to derive execution mode)
   * Returns null if no default host is set (local mode)
   */
  async getDefaultHost(): Promise<HostState | null> {
    const hosts = await this.loadState<HostState[]>("hosts.json")
    return hosts.find(h => h.isDefault === true) ?? null
  }

  /**
   * Set a host as the default host
   * This clears isDefault flag on all other hosts
   *
   * @param hostId - The host ID to set as default
   * @throws Error if hostId does not exist
   */
  async setDefaultHost(hostId: string): Promise<void> {
    const hosts = await this.loadState<HostState[]>("hosts.json")

    // Validate hostId exists
    const targetHost = hosts.find(h => h.id === hostId)
    if (!targetHost) {
      throw new Error(
        `Cannot set default host: host with ID "${hostId}" not found. ` +
        `Available hosts: ${hosts.map(h => h.id).join(", ") || "none"}`
      )
    }

    // Clear isDefault on all hosts, set on the target
    for (const host of hosts) {
      host.isDefault = host.id === hostId
    }

    await this.saveState("hosts.json", hosts)
  }

  /**
   * Clear the default host (switch to local mode)
   */
  async clearDefaultHost(): Promise<void> {
    const hosts = await this.loadState<HostState[]>("hosts.json")

    for (const host of hosts) {
      host.isDefault = false
    }

    await this.saveState("hosts.json", hosts)
  }

  /**
   * Get execution mode derived from default host
   * Returns "remote" if a default host exists, "local" otherwise
   */
  async getExecutionMode(): Promise<"local" | "remote"> {
    const defaultHost = await this.getDefaultHost()
    return defaultHost ? "remote" : "local"
  }

  /**
   * Get SSH config from the default host
   * Returns null if no default host or missing required fields
   */
  async getRemoteConfig(): Promise<{
    host: string
    user: string
    password?: string
    port: number
    sudoPasswd?: string
  } | null> {
    const defaultHost = await this.getDefaultHost()

    if (!defaultHost?.host || !defaultHost?.user) {
      return null
    }

    return {
      host: defaultHost.host,
      user: defaultHost.user,
      password: defaultHost.password,
      port: defaultHost.port || 22,
      sudoPasswd: defaultHost.sudoPasswd,
    }
  }

  // ============================================================================
  // Operation Management
  // ============================================================================

  /**
   * Start a new operation
   *
   * @param intent Operation intent
   * @param params Operation parameters (may include trace info)
   * @param trace Optional trace payload for distributed tracing
   */
  async startOperation(
    intent: Intent,
    params: Record<string, unknown>,
    trace?: {
      traceId: string
      parentSpanId?: string
      sourceService?: string
    }
  ): Promise<string> {
    const operations = await this.loadState<Operation[]>("operations.json")

    const id = generateId("op")
    const hostId = (params.hostId as string) || "local"

    // 计算 operation key 并持久化
    const operationKey = computeOperationKey(intent, params)

    const operation: Operation = {
      id,
      traceId: trace?.traceId,
      parentSpanId: trace?.parentSpanId,
      sourceService: trace?.sourceService,
      type: mapIntentToType(intent),
      intent,
      operationKey,  // 持久化！
      input: {
        hostId,
        params,
      },
      execution: {
        startTime: new Date().toISOString(),
        status: "running",
        logPath: `logs/${id}.log`,
      },
      checkpoints: [],
    }

    operations.push(operation)
    await this.saveState("operations.json", operations)

    return id
  }

  async createCheckpoint(opId: string, step: string, rollback?: string): Promise<void> {
    const operations = await this.loadState<Operation[]>("operations.json")
    const op = operations.find(o => o.id === opId)

    if (op) {
      op.checkpoints.push({
        step,
        timestamp: new Date().toISOString(),
        rollbackCommand: rollback,
      })
      await this.saveState("operations.json", operations)
    }
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

  /**
   * Find conflicting operation for idempotency check
   *
   * Returns running/pending operation with matching operation key.
   * Uses persisted operationKey for comparison, not temporary computed values.
   *
   * ## 冲突判定规则 (V1)
   *
   * 判定为冲突的条件：
   * 1. 状态为 pending 或 running
   * 2. hostId 相同
   * 3. intent 相同
   * 4. target 相同（如果都定义了）
   * 5. resource 相同（如果都都定义了）
   *
   * **注意：version 不参与冲突判断**
   * 这是 V1 的设计决策：同资源串行化，不区分版本。
   * 详见 OperationKey 接口注释。
   */
  async findConflictingOperation(key: OperationKey): Promise<Operation | null> {
    const operations = await this.loadState<Operation[]>("operations.json")

    return operations.find(op => {
      // 必须是 pending/running
      if (!["pending", "running"].includes(op.execution.status)) return false

      // 基于 operationKey 比较
      const opKey = op.operationKey
      if (!opKey) {
        // 兼容旧记录：fallback 到 hostId + intent
        return op.input.hostId === key.hostId && op.intent === key.intent
      }

      if (opKey.hostId !== key.hostId) return false
      if (opKey.intent !== key.intent) return false

      // 同 intent 但不同 target/resource 不算冲突
      if (key.target && opKey.target && key.target !== opKey.target) return false
      if (key.resource && opKey.resource && key.resource !== opKey.resource) return false

      // version intentionally excluded from conflict detection
      // V1 设计：同资源串行化，不区分版本

      return true
    }) || null
  }

  /**
   * Get operation by ID
   */
  async getOperation(opId: string): Promise<Operation | null> {
    const operations = await this.loadState<Operation[]>("operations.json")
    return operations.find(o => o.id === opId) || null
  }

  /**
   * Rollback operation - v1 only returns guidance, does not auto-execute
   *
   * v1 Constraint: We do NOT promise automatic rollback success.
   * This method only provides guidance for manual rollback.
   */
  async rollbackOperation(opId: string): Promise<RollbackResult> {
    const op = await this.getOperation(opId)

    // 明确区分：not_found vs no_checkpoint
    if (!op) {
      return {
        status: "not_found",
        guidance: `Operation ${opId} not found. Cannot rollback.`,
        automaticRollback: false,
      }
    }

    // 只读操作不支持 rollback（语义上不需要）
    if (op.intent === "gpu_status" || op.intent === "validate") {
      return {
        status: "unsupported",
        guidance: `${op.intent} operations are read-only and do not require rollback.`,
        automaticRollback: false,
      }
    }

    if (op.checkpoints.length === 0) {
      return {
        status: "no_checkpoint",
        guidance: `Operation ${opId} has no checkpoints recorded.`,
        automaticRollback: false,
      }
    }

    // Find last checkpoint with rollback command
    const lastCheckpoint = [...op.checkpoints].reverse().find(c => c.rollbackCommand)

    if (!lastCheckpoint) {
      return {
        status: "no_rollback_command",
        guidance: `Operation ${opId} has checkpoints but no rollback commands recorded.\nRecorded steps: ${op.checkpoints.map(c => c.step).join(", ")}`,
        automaticRollback: false,
        checkpoint: {
          step: op.checkpoints[op.checkpoints.length - 1]?.step || "unknown",
        },
      }
    }

    // v1: Return guidance only, do NOT execute rollback automatically
    const operations = await this.loadState<Operation[]>("operations.json")
    const opRecord = operations.find(o => o.id === opId)
    if (opRecord) {
      opRecord.execution.status = "rolled_back"
      await this.saveState("operations.json", operations)
    }

    // 返回 manual_required，明确表达"需人工执行"
    return {
      status: "manual_required",
      guidance: `To rollback operation ${opId}, manually execute:\n\n${lastCheckpoint.rollbackCommand}`,
      automaticRollback: false,
      checkpoint: {
        step: lastCheckpoint.step,
        rollbackCommand: lastCheckpoint.rollbackCommand,
      },
    }
  }
  // ============================================================================
  // Job Progress
  // ============================================================================

  /**
   * Start a new job for progress tracking
   *
   * @param operationId Associated operation ID
   * @param totalSteps Total number of steps in the job
   * @param hostId Optional host ID for context-builder relevance sorting
   * @param traceId Optional trace ID for distributed tracing
   */
  async startJob(
    operationId: string,
    totalSteps: number,
    hostId?: string,
    traceId?: string
  ): Promise<string> {
    const jobs = await this.loadState<Job[]>("jobs.json")

    const id = generateId("job")
    const job: Job = {
      id,
      operationId,
      traceId,
      hostId,  // 持久化关联的 host
      status: "running",
      progress: {
        currentStep: "initialized",
        completedSteps: [],
        totalSteps,
        percentage: 0,
      },
    }

    jobs.push(job)
    await this.saveState("jobs.json", jobs)

    return id
  }

  async updateJobProgress(jobId: string, step: string): Promise<void> {
    const jobs = await this.loadState<Job[]>("jobs.json")
    const job = jobs.find(j => j.id === jobId)

    if (job) {
      job.progress.completedSteps.push(job.progress.currentStep)
      job.progress.currentStep = step
      job.progress.percentage = Math.round(
        (job.progress.completedSteps.length / job.progress.totalSteps) * 100
      )
      await this.saveState("jobs.json", jobs)
    }
  }

  async completeJob(jobId: string, success: boolean): Promise<void> {
    const jobs = await this.loadState<Job[]>("jobs.json")
    const job = jobs.find(j => j.id === jobId)

    if (job) {
      job.status = success ? "completed" : "failed"
      job.progress.percentage = success ? 100 : job.progress.percentage
      await this.saveState("jobs.json", jobs)
    }
  }

  /**
   * Get job by operation ID
   */
  async getJobByOperationId(operationId: string): Promise<Job | null> {
    const jobs = await this.loadState<Job[]>("jobs.json")
    return jobs.find(j => j.operationId === operationId) ?? null
  }

  /**
   * Resume an operation - mark it as running again
   * Used when resuming a paused/interrupted operation
   */
  async resumeOperation(operationId: string): Promise<boolean> {
    const operations = await this.loadState<Operation[]>("operations.json")
    const op = operations.find(o => o.id === operationId)

    if (!op) {
      return false
    }

    // Check if operation is in a resumable state
    const resumableStatuses = ["paused", "awaiting_input", "interrupted"]
    if (!resumableStatuses.includes(op.execution.status)) {
      return false
    }

    // Update status to running
    op.execution.status = "running"
    await this.saveState("operations.json", operations)

    return true
  }

  // ============================================================================
  // Deployment State
  // ============================================================================

  async updateDeploymentState(state: Partial<DeploymentState>): Promise<void> {
    const deployment = await this.loadState<DeploymentState>("deployment_state.json")
    Object.assign(deployment, state, { updatedAt: new Date().toISOString() })
    await this.saveState("deployment_state.json", deployment)
  }

  // ============================================================================
  // Document Execution Management
  // ============================================================================

  /**
   * Start a new document execution
   */
  async startDocumentExecution(
    operationId: string,
    planId: string,
    documentId: string,
    phases: PhaseState[],
    variables: Record<string, string>
  ): Promise<string> {
    const executions = await this.loadState<DocumentExecutionState[]>("document_executions.json")

    const id = generateId("docexec")

    const execution: DocumentExecutionState = {
      id,
      operationId,
      planId,
      documentId,
      status: "running",
      currentPhase: phases[0]?.id || "",
      currentStep: "",
      phases,
      variables,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    executions.push(execution)
    await this.saveState("document_executions.json", executions)

    return id
  }

  /**
   * Get document execution by ID
   */
  async getDocumentExecution(executionId: string): Promise<DocumentExecutionState | null> {
    const executions = await this.loadState<DocumentExecutionState[]>("document_executions.json")
    return executions.find(e => e.id === executionId) || null
  }

  /**
   * Get document execution by operation ID
   */
  async getDocumentExecutionByOperationId(operationId: string): Promise<DocumentExecutionState | null> {
    const executions = await this.loadState<DocumentExecutionState[]>("document_executions.json")
    return executions.find(e => e.operationId === operationId) || null
  }

  /**
   * Update step status in document execution
   */
  async updateStepStatus(
    executionId: string,
    phaseId: string,
    stepId: string,
    update: Partial<StepState>
  ): Promise<void> {
    const executions = await this.loadState<DocumentExecutionState[]>("document_executions.json")
    const execution = executions.find(e => e.id === executionId)

    if (!execution) return

    const phase = execution.phases.find(p => p.id === phaseId)
    if (!phase) return

    const step = phase.steps.find(s => s.id === stepId)
    if (!step) return

    Object.assign(step, update)
    execution.updatedAt = new Date().toISOString()

    await this.saveState("document_executions.json", executions)
  }

  /**
   * Update document execution state (only updates DocumentExecutionState, not Operation)
   */
  async updateDocumentExecutionState(
    executionId: string,
    update: Partial<DocumentExecutionState>
  ): Promise<void> {
    const executions = await this.loadState<DocumentExecutionState[]>("document_executions.json")
    const execution = executions.find(e => e.id === executionId)

    if (!execution) return

    Object.assign(execution, update, { updatedAt: new Date().toISOString() })
    await this.saveState("document_executions.json", executions)

    // ❌ 不要反向同步到 Operation
    // Operation 状态由主流程驱动，不从这里反推
  }

  /**
   * Check and mark completion (only allowed reverse sync)
   * 唯一允许的反向设置：所有 phase 完成 → operation completed
   */
  async checkAndMarkCompletion(executionId: string): Promise<boolean> {
    const execution = await this.getDocumentExecution(executionId)
    if (!execution) return false

    // 检查是否所有 phase 都已完成
    const allPhasesCompleted = execution.phases.every(
      p => p.status === "completed" || p.status === "skipped"
    )

    if (allPhasesCompleted) {
      // 更新 execution 状态
      await this.updateDocumentExecutionState(executionId, {
        status: "completed",
        completedAt: new Date().toISOString(),
      })

      // 这是唯一允许的反向设置
      await this.updateOperation(execution.operationId, {
        execution: {
          ...((await this.getOperation(execution.operationId))?.execution || {}),
          status: "completed",
          endTime: new Date().toISOString(),
        },
      } as any)

      return true
    }

    return false
  }

  /**
   * Update operation (helper for completion check)
   */
  private async updateOperation(opId: string, update: Partial<Operation>): Promise<void> {
    const operations = await this.loadState<Operation[]>("operations.json")
    const op = operations.find(o => o.id === opId)

    if (op) {
      Object.assign(op, update)
      await this.saveState("operations.json", operations)
    }
  }

  // ============================================================================
  // Persistence
  // ============================================================================

  async persistAll(): Promise<void> {
    // Cache is already persisted on each update
    // This method is called on session end as a safety measure
    const keys = Array.from(this.cache.keys())
    for (const key of keys) {
      const data = this.cache.get(key)
      await this.atomicWrite(key, data)
    }
  }

  private async loadState<T>(file: string): Promise<T> {
    const cached = this.cache.get(file)
    if (cached) {
      return cached as T
    }

    const filePath = path.join(this.stateDir, file)
    try {
      const data = await fs.promises.readFile(filePath, "utf-8")
      const parsed = JSON.parse(data)
      this.cache.set(file, parsed)
      return parsed as T
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        const defaultState = this.getDefaultState(file)
        await this.atomicWrite(file, defaultState)
        this.cache.set(file, defaultState)
        return defaultState as T
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

    // Write with restrictive permissions for sensitive files
    // hosts.json contains passwords - should be 600 (owner read/write only)
    const isSensitiveFile = file === "hosts.json"

    await fs.promises.writeFile(tempPath, JSON.stringify(data, null, 2))

    // Set file permissions before rename (works on Linux)
    if (isSensitiveFile) {
      await fs.promises.chmod(tempPath, 0o600) // Owner read/write only
    }

    await fs.promises.rename(tempPath, filePath)
  }

  private getDefaultState(file: string): unknown {
    switch (file) {
      case "hosts.json":
        return []
      case "jobs.json":
        return []
      case "operations.json":
        return []
      case "deployment_state.json":
        return {
          status: "initialized",
          completedSteps: [],
          sdkVersion: "",
          driverVersion: "",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }
      case "document_executions.json":
        return []
      default:
        return {}
    }
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
}

function mapIntentToType(intent: Intent): Operation["type"] {
  switch (intent) {
    case "deploy_env":
      return "deployment"
    case "update_driver":
      return "driver_update"
    case "validate":
      return "validation"
    case "execute_document":
      return "deployment"  // Document execution is a deployment orchestration
    case "gpu_status":
    case "run_container":
    case "sync":
    case "auto":
      return "benchmark"
    default:
      return "deployment"
  }
}

/**
 * Compute operation key for idempotency check
 *
 * Creates a deterministic key from intent and context parameters.
 * This key is persisted with the operation for reliable conflict detection.
 */
function computeOperationKey(intent: Intent, params: Record<string, unknown>): OperationKey {
  const key: OperationKey = {
    hostId: (params.hostId as string) || "local",
    intent,
  }

  // Intent-specific normalization
  switch (intent) {
    case "deploy_env":
      key.scope = "env"
      key.target = (params.envName as string) || "default"
      key.resource = "sdk"
      key.version = params.sdkVersion as string
      break
    case "update_driver":
      key.scope = "host"
      key.resource = "driver"
      key.version = params.driverVersion as string
      break
    case "run_container":
      key.scope = "service"
      key.target = params.containerName as string
      key.resource = "container-image"
      key.version = params.image as string
      break
    case "validate":
      key.scope = "host"
      key.resource = "validation"
      break
    case "execute_document":
      key.scope = "env"
      key.target = (params.documentId as string) || "unknown"
      key.resource = "document"
      break
    case "gpu_status":
    case "sync":
    case "auto":
      // 这些操作不需要额外的 key 维度
      break
  }

  return key
}