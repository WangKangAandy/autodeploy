/**
 * Document Execution Engine
 *
 * 步骤执行路由：
 * - skill_invoke: 使用 internal dispatch 模式
 * - shell: 使用 musa_exec
 * - docker_exec/docker_run: 使用 musa_docker
 * - validation: 验证分层 (infra/service/business)
 * - manual: 使用统一的 awaiting_input 结构
 */

import type {
  ExecutionPlan,
  PlanStep,
  ExecutionStep,
  ExecutionValidationResult,
  InternalDispatchParams,
  AwaitingInputContext,
} from "./types"
import { createManualStepContext } from "./plan-review"

// ============================================================================
// Execution Context
// ============================================================================

export interface ExecutionContext {
  operationId: string
  plan: ExecutionPlan
  stateManager: StateManagerAdapter
  executor: ExecutorAdapter
  dispatcher: DispatcherAdapter
}

/**
 * Adapter for StateManager (to avoid tight coupling)
 */
export interface StateManagerAdapter {
  updateOperation(operationId: string, update: Partial<OperationUpdate>): Promise<void>
  updateStepStatus(executionId: string, phaseId: string, stepId: string, update: StepStatusUpdate): Promise<void>
  getDocumentExecutionByOperationId(operationId: string): Promise<DocumentExecutionState | null>
}

/**
 * Adapter for Executor (musa_exec, musa_docker)
 */
export interface ExecutorAdapter {
  exec(command: string, options?: ExecOptions): Promise<ExecResult>
  dockerExec(options: DockerExecOptions): Promise<ExecResult>
  dockerRun(options: DockerRunOptions): Promise<ExecResult>
}

/**
 * Adapter for Dispatcher
 */
export interface DispatcherAdapter {
  internalDispatch(params: InternalDispatchParams): Promise<DispatchResult>
}

// ============================================================================
// Result Types
// ============================================================================

export interface StepExecutionResult {
  success: boolean
  output?: string
  error?: string
  exitCode?: number
}

export interface OperationUpdate {
  status?: string
  context?: Record<string, unknown>
  error?: string
}

export interface StepStatusUpdate {
  status: "pending" | "running" | "completed" | "failed" | "skipped" | "awaiting_input"
  output?: string
  error?: string
  completedAt?: string
}

export interface DocumentExecutionState {
  id: string
  operationId: string
  phases: Array<{
    id: string
    name: string
    steps: Array<{
      id: string
      status: string
    }>
  }>
}

// ============================================================================
// Exec Options & Results
// ============================================================================

export interface ExecOptions {
  sudo?: boolean
  timeout?: number
  cwd?: string
  env?: Record<string, string>
}

export interface DockerExecOptions {
  name: string
  command: string
  user?: string
  env?: Record<string, string>
}

export interface DockerRunOptions {
  image: string
  command?: string
  env?: Record<string, string>
  volumes?: Record<string, string>
  ports?: Record<string, string>
  remove?: boolean
}

export interface ExecResult {
  exitCode: number
  stdout: string
  stderr: string
}

export interface DispatchResult {
  success: boolean
  guidance?: string
  error?: {
    originalError: string
  }
}

// ============================================================================
// Step Execution
// ============================================================================

/**
 * Execute a single step
 */
export async function executeStep(
  step: PlanStep,
  context: ExecutionContext,
  currentPhaseId: string
): Promise<StepExecutionResult> {
  const executionStep = step.executionStep

  switch (executionStep.type) {
    case "skill_invoke":
      return await executeSkillInvoke(executionStep, context)

    case "shell":
      return await executeShell(executionStep, context)

    case "docker_exec":
      return await executeDockerExec(executionStep, context)

    case "docker_run":
      return await executeDockerRun(executionStep, context)

    case "validation":
      return await executeValidation(executionStep, context)

    case "manual":
      return await enterManualStep(executionStep, context, currentPhaseId)

    default:
      return {
        success: false,
        error: `Unknown step type: ${(executionStep as ExecutionStep).type}`,
      }
  }
}

// ============================================================================
// Step Type Implementations
// ============================================================================

/**
 * Execute skill_invoke using internal dispatch
 */
async function executeSkillInvoke(
  step: ExecutionStep,
  context: ExecutionContext
): Promise<StepExecutionResult> {
  if (!step.skillIntent) {
    return {
      success: false,
      error: "skill_invoke step missing skillIntent",
    }
  }

  try {
    const params: InternalDispatchParams = {
      intent: step.skillIntent,
      parentOperationId: context.operationId,
      context: {
        variables: context.plan.variables,
      },
      mode: "internal",
    }

    const result = await context.dispatcher.internalDispatch(params)

    return {
      success: result.success,
      output: result.guidance,
      error: result.error?.originalError,
    }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

/**
 * Execute shell command
 */
async function executeShell(
  step: ExecutionStep,
  context: ExecutionContext
): Promise<StepExecutionResult> {
  if (!step.command) {
    return {
      success: false,
      error: "shell step missing command",
    }
  }

  try {
    const result = await context.executor.exec(step.command, {
      sudo: step.requiresSudo,
    })

    return {
      success: result.exitCode === 0,
      output: result.stdout,
      error: result.stderr,
      exitCode: result.exitCode,
    }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

/**
 * Execute docker exec command
 */
async function executeDockerExec(
  step: ExecutionStep,
  context: ExecutionContext
): Promise<StepExecutionResult> {
  if (!step.command) {
    return {
      success: false,
      error: "docker_exec step missing command",
    }
  }

  // Parse docker exec command to extract container name and command
  const match = step.command.match(/docker exec\s+(?:-[a-z]+\s+)*(\S+)\s+(.+)/)
  if (!match) {
    return {
      success: false,
      error: `Invalid docker exec command: ${step.command}`,
    }
  }

  const containerName = match[1]
  const containerCommand = match[2]

  try {
    const result = await context.executor.dockerExec({
      name: containerName,
      command: containerCommand,
    })

    return {
      success: result.exitCode === 0,
      output: result.stdout,
      error: result.stderr,
      exitCode: result.exitCode,
    }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

/**
 * Execute docker run command
 */
async function executeDockerRun(
  step: ExecutionStep,
  context: ExecutionContext
): Promise<StepExecutionResult> {
  if (!step.command) {
    return {
      success: false,
      error: "docker_run step missing command",
    }
  }

  // Parse docker run command
  const parsed = parseDockerRunCommand(step.command)

  try {
    const result = await context.executor.dockerRun({
      image: parsed.image,
      command: parsed.command,
      env: parsed.env,
      volumes: parsed.volumes,
      ports: parsed.ports,
      remove: true,
    })

    return {
      success: result.exitCode === 0,
      output: result.stdout,
      error: result.stderr,
      exitCode: result.exitCode,
    }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

/**
 * Execute validation step
 */
async function executeValidation(
  step: ExecutionStep,
  context: ExecutionContext
): Promise<StepExecutionResult> {
  if (!step.command) {
    return {
      success: false,
      error: "validation step missing command",
    }
  }

  try {
    const result = await context.executor.exec(step.command)
    const validationLevel = step.validationLevel || "infra"

    // Check expected output if specified
    let passed = result.exitCode === 0
    if (step.expectedOutput && passed) {
      passed = result.stdout.includes(step.expectedOutput)
    }

    const validationResult: ExecutionValidationResult = {
      level: validationLevel,
      passed,
      details: passed
        ? `Validation passed (${validationLevel})`
        : `Validation failed (${validationLevel}): ${result.stderr || "No output matched"}`,
    }

    return {
      success: passed,
      output: JSON.stringify(validationResult),
      error: passed ? undefined : validationResult.details,
      exitCode: result.exitCode,
    }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

/**
 * Enter manual step (await user input)
 */
async function enterManualStep(
  step: ExecutionStep,
  context: ExecutionContext,
  phaseId: string
): Promise<StepExecutionResult> {
  // Create awaiting input context
  const awaitingInput = createManualStepContext(step, phaseId)

  // Update operation to awaiting_input state
  await context.stateManager.updateOperation(context.operationId, {
    status: "awaiting_input",
    context: { awaitingInput },
  })

  // Return with awaiting status (not completed)
  return {
    success: false,  // Not completed yet
    output: `Manual step awaiting user input: ${step.description}`,
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

interface ParsedDockerRun {
  image: string
  command?: string
  env?: Record<string, string>
  volumes?: Record<string, string>
  ports?: Record<string, string>
}

/**
 * Parse docker run command into components
 */
function parseDockerRunCommand(cmd: string): ParsedDockerRun {
  const result: ParsedDockerRun = {
    image: "",
  }

  const args = cmd.split(/\s+/)
  let i = 2  // Skip "docker run"

  while (i < args.length) {
    const arg = args[i]

    if (arg === "-e" && i + 1 < args.length) {
      // Environment variable
      const [key, value] = args[i + 1].split("=")
      result.env = result.env || {}
      result.env[key] = value
      i += 2
    } else if (arg === "-v" && i + 1 < args.length) {
      // Volume mount
      const [src, dest] = args[i + 1].split(":")
      result.volumes = result.volumes || {}
      result.volumes[src] = dest
      i += 2
    } else if (arg === "-p" && i + 1 < args.length) {
      // Port mapping
      const [host, container] = args[i + 1].split(":")
      result.ports = result.ports || {}
      result.ports[host] = container
      i += 2
    } else if (!arg.startsWith("-")) {
      // Image or command
      if (!result.image) {
        result.image = arg
      } else {
        result.command = args.slice(i).join(" ")
        break
      }
      i++
    } else {
      i++
    }
  }

  return result
}