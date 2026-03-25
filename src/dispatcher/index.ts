/**
 * MUSA Dispatcher
 *
 * Unified task orchestrator for MUSA operations.
 * Handles pre-checks, routing, execution, error handling, and state management.
 */

import type { StateManager, Intent, Operation } from "../core/state-manager.js"
import { parseIntent, getIntentDescription } from "./intent-parser.js"
import { routeToHandler, type RouteResult } from "./router.js"
import { runPreFlightCheck, type CheckResult } from "./pre-check.js"
import { checkPermission, type PermissionResult } from "./permission-gate.js"
import {
  normalizeError,
  precheckFailedError,
  permissionDeniedError,
  operationConflictError,
  formatDispatchError,
  type DispatchError,
} from "./error-normalizer.js"
import { INTENT_RISK } from "./permission-gate.js"

/**
 * Total steps per intent for job progress tracking
 */
const INTENT_TOTAL_STEPS: Partial<Record<Intent, number>> = {
  deploy_env: 6,      // dependencies, driver, toolkit, image, container, validate
  update_driver: 3,   // download, install, reload
  execute_document: 5, // load, parse, validate, review, execute
}

export { parseIntent, getIntentDescription } from "./intent-parser"
export { routeToHandler, type RouteResult } from "./router"
export { runPreFlightCheck, type CheckResult } from "./pre-check"
export { checkPermission, type PermissionResult } from "./permission-gate"
export { normalizeError, formatDispatchError, type DispatchError } from "./error-normalizer"

/**
 * 可 resume 的状态
 */
const RESUMABLE_STATUSES = ["paused", "awaiting_input", "interrupted"] as const
type ResumableStatus = typeof RESUMABLE_STATUSES[number]

/**
 * 检查状态是否可 resume
 */
function isResumableStatus(op: Operation): boolean {
  return RESUMABLE_STATUSES.includes(op.execution.status as ResumableStatus)
}

/**
 * 检查恢复前提是否满足
 */
async function isResumeReady(
  op: Operation,
  stateManager: StateManager
): Promise<{ ready: boolean; reason?: string }> {
  switch (op.execution.status) {
    case "awaiting_input":
      // 检查 required input 是否已提供
      const params = op.input.params || {}
      const requiredInputs = (params._requiredInputs as string[]) || []
      const providedInputs = Object.keys(params).filter(k => !k.startsWith("_"))
      const missing = requiredInputs.filter(r => !providedInputs.includes(r))
      if (missing.length > 0) {
        return { ready: false, reason: `Missing required inputs: ${missing.join(", ")}` }
      }
      break

    case "interrupted":
      // 检查关联资源是否仍有效
      if (op.input.hostId) {
        const hosts = await stateManager.loadSnapshot()
        const host = hosts.hosts.find(h => h.id === op.input.hostId || h.host === op.input.hostId)
        if (!host || host.status !== "online") {
          return { ready: false, reason: `Host ${op.input.hostId} is not available` }
        }
      }
      break

    case "paused":
      // 检查执行上下文是否丢失
      if (!op.checkpoints || op.checkpoints.length === 0) {
        return { ready: false, reason: "No checkpoints recorded, cannot determine resume point" }
      }
      break
  }

  return { ready: true }
}

/**
 * Dispatch parameters
 */
export interface DispatchParams {
  intent: Intent
  context?: Record<string, unknown>
  action?: "start" | "status" | "resume" | "cancel"
  force?: boolean
  query?: string // For auto intent parsing
  mode?: "normal" | "internal"  // Internal mode for substep execution
  parentOperationId?: string    // For internal mode
}

/**
 * Dispatch result
 */
export interface DispatchResult {
  success: boolean
  intent: Intent
  action: string
  route: RouteResult | null
  precheck: CheckResult | null
  permission: PermissionResult | null
  operationId: string | null
  jobId: string | null
  error: DispatchError | null
  guidance: string
}

/**
 * Register musa_dispatch tool
 */
export function registerDispatcherTool(api: any, stateManager: StateManager): void {
  api.registerTool({
    name: "musa_dispatch",
    description: `Task orchestrator for MUSA operations.

Handles pre-checks, permission gating, routing to skills/tools, error handling, and state management.

Use this as the primary entry point for all MUSA-related operations.

**Intents:**
- deploy_env: Deploy complete MUSA environment
- update_driver: Update or reinstall GPU driver
- gpu_status: Check GPU status
- validate: Validate MUSA environment
- sync: Sync files between hosts
- run_container: Run Docker container
- execute_document: Execute deployment from document (parse, plan, execute)
- auto: Auto-detect intent from query`,

    parameters: {
      type: "object",
      properties: {
        intent: {
          type: "string",
          enum: ["deploy_env", "update_driver", "gpu_status", "run_container", "validate", "sync", "execute_document", "auto"],
          description: "Operation intent",
        },
        context: {
          type: "object",
          description: "Additional context (host, version, image, path, content, etc.)",
        },
        action: {
          type: "string",
          enum: ["start", "status", "resume", "cancel"],
          default: "start",
          description: "Action to perform",
        },
        force: {
          type: "boolean",
          default: false,
          description: "Skip confirmation for destructive operations",
        },
        query: {
          type: "string",
          description: "Natural language query (for auto intent)",
        },
      },
      required: ["intent"],
    },

    async execute(_toolCallId: string, params: DispatchParams): Promise<string> {
      const result = await dispatch(params, stateManager)
      return formatDispatchResult(result)
    },
  })

  api.logger.info?.("[musa] Registered tool: musa_dispatch")
}

/**
 * Main dispatch function
 *
 * Flow:
 * 1. Parse intent (auto mode)
 * 2. Classify operation risk level (lightweight, no side effects)
 * 3. Run pre-flight checks
 * 4. Check permissions
 * 4.5 Resume semantic check (for resume action)
 * 5. Atomic operation start (conflict check + start under lock)
 * 6. Route to handler
 */
export async function dispatch(
  params: DispatchParams,
  stateManager: StateManager
): Promise<DispatchResult> {
  const { intent, context = {}, action = "start", force = false, query, mode = "normal", parentOperationId } = params
  const hostId = (context.hostId as string) || "local"

  // Internal dispatch mode: skip permission gate and plan review
  // Used for substep execution in document-driven orchestration
  if (mode === "internal" && parentOperationId) {
    return internalDispatch(intent, context, parentOperationId, stateManager)
  }

  // 1. Parse intent (auto mode)
  let resolvedIntent = intent
  if (intent === "auto" && query) {
    resolvedIntent = parseIntent(query)
  }

  // 2. Classify operation risk level (lightweight, no side effects)
  const isDestructive = INTENT_RISK[resolvedIntent] === "destructive"

  // 3. Run pre-flight checks
  const precheck = await runPreFlightCheck(resolvedIntent)
  if (!precheck.passed) {
    return {
      success: false,
      intent: resolvedIntent,
      action,
      route: null,
      precheck,
      permission: null,
      operationId: null,
      jobId: null,
      error: precheckFailedError(resolvedIntent, precheck.checks.filter(c => !c.passed)),
      guidance: precheck.guidance.join("\n"),
    }
  }

  // 4. Check permissions
  const permission = checkPermission(resolvedIntent, force)
  if (!permission.allowed) {
    return {
      success: false,
      intent: resolvedIntent,
      action,
      route: null,
      precheck,
      permission,
      operationId: null,
      jobId: null,
      error: permissionDeniedError(resolvedIntent, permission.confirmationMessage || ""),
      guidance: permission.confirmationMessage || "Operation requires confirmation.",
    }
  }

  // 4.5 Resume semantic check - 分层判断：状态合法 vs 恢复条件满足
  if (action === "resume") {
    const operationIdParam = context.operationId as string
    if (!operationIdParam) {
      return {
        success: false,
        intent: resolvedIntent,
        action,
        route: null,
        precheck,
        permission,
        operationId: null,
        jobId: null,
        error: {
          code: "OPERATION_NOT_FOUND",
          intent: resolvedIntent,
          step: "resume_check",
          originalError: "No operationId provided for resume",
          guidance: "Provide operationId in context to resume an operation.",
          recoverable: true,
        },
        guidance: "Provide operationId in context to resume an operation.",
      }
    }

    const existingOp = await stateManager.getOperation(operationIdParam)
    if (!existingOp) {
      return {
        success: false,
        intent: resolvedIntent,
        action,
        route: null,
        precheck,
        permission,
        operationId: null,
        jobId: null,
        error: {
          code: "OPERATION_NOT_FOUND",
          intent: resolvedIntent,
          step: "resume_check",
          originalError: `Operation ${operationIdParam} not found`,
          guidance: `Operation ${operationIdParam} not found. Cannot resume.`,
          recoverable: false,
        },
        guidance: `Operation ${operationIdParam} not found. Cannot resume.`,
      }
    }

    if (!isResumableStatus(existingOp)) {
      return {
        success: false,
        intent: resolvedIntent,
        action,
        route: null,
        precheck,
        permission,
        operationId: null,
        jobId: null,
        error: {
          code: "OPERATION_NOT_RESUMABLE",
          intent: resolvedIntent,
          step: "resume_check",
          originalError: `Operation status is "${existingOp.execution.status}"`,
          guidance: `Operation ${existingOp.id} is in status "${existingOp.execution.status}". Only [${RESUMABLE_STATUSES.join(", ")}] can be resumed.`,
          recoverable: true,
        },
        guidance: `Operation ${existingOp.id} is in status "${existingOp.execution.status}". Only [${RESUMABLE_STATUSES.join(", ")}] can be resumed.`,
      }
    }

    const readiness = await isResumeReady(existingOp, stateManager)
    if (!readiness.ready) {
      return {
        success: false,
        intent: resolvedIntent,
        action,
        route: null,
        precheck,
        permission,
        operationId: null,
        jobId: null,
        error: {
          code: "RESUME_PREREQUISITE_NOT_MET",
          intent: resolvedIntent,
          step: "resume_check",
          originalError: readiness.reason || "Unknown reason",
          guidance: `Cannot resume: ${readiness.reason}`,
          recoverable: true,
        },
        guidance: `Cannot resume: ${readiness.reason}`,
      }
    }

    // Resume is valid, continue with existing operation
    // Note: operationId will be set from existing operation
  }

  // 5. Atomic operation start (conflict check + start under lock)
  // For destructive operations, use atomic start to prevent race conditions
  // For non-destructive operations, use simple start (no conflict check needed)
  let operationId: string | null = null
  let jobId: string | null = null

  try {
    const enrichedContext = { ...context, hostId }

    if (isDestructive && action === "start") {
      // Atomic: conflict check + start under global lock
      const result = await stateManager.startOperationIfNoConflict(resolvedIntent, enrichedContext)

      if (!result.started) {
        const error = operationConflictError(resolvedIntent, hostId, result.conflict!.id)
        return {
          success: false,
          intent: resolvedIntent,
          action,
          route: null,
          precheck,
          permission,
          operationId: null,
          jobId: null,
          error,
          guidance: error.guidance,
        }
      }

      operationId = result.operationId!
    } else {
      // Non-destructive or non-start action: simple start without conflict check
      operationId = await stateManager.startOperation(resolvedIntent, enrichedContext)
    }

    // 5.5 Start job tracking for destructive operations
    // Job tracks progress steps, used by context-builder for relevance sorting
    if (isDestructive && action === "start") {
      const totalSteps = INTENT_TOTAL_STEPS[resolvedIntent] || 0
      jobId = await stateManager.startJob(operationId, totalSteps, hostId)
    }

    // 6. Route to handler
    const route = await routeToHandler({
      intent: resolvedIntent,
      context,
      action,
      stateManager,
    })

    // 7. Return route result (actual execution is delegated to skills/tools)
    return {
      success: route.type !== "error",
      intent: resolvedIntent,
      action,
      route,
      precheck,
      permission,
      operationId,
      jobId,
      error: route.type === "error"
        ? {
            code: "EXECUTION_ERROR",
            intent: resolvedIntent,
            step: "routing",
            originalError: route.message,
            guidance: "Check the error and retry.",
            recoverable: true,
          }
        : null,
      guidance: buildGuidance(route, resolvedIntent, action),
    }
  } catch (err) {
    // Error handling
    const error = normalizeError(err, resolvedIntent, "dispatch")

    if (operationId) {
      await stateManager.completeOperation(operationId, {
        success: false,
        summary: error.originalError,
        error: error.originalError,
      })
    }

    return {
      success: false,
      intent: resolvedIntent,
      action,
      route: null,
      precheck,
      permission,
      operationId,
      jobId,
      error,
      guidance: error.guidance,
    }
  }
}

/**
 * Build guidance message based on route result
 */
function buildGuidance(route: RouteResult, intent: Intent, action: string): string {
  const lines: string[] = []

  lines.push(`## Dispatch Result`)
  lines.push("")
  lines.push(`**Intent**: ${intent}`)
  lines.push(`**Action**: ${action}`)
  lines.push(`**Route Type**: ${route.type}`)
  lines.push(`**Target**: ${route.target}`)
  lines.push("")

  if (route.type === "skill") {
    lines.push("### Next Steps")
    lines.push("")
    lines.push("Follow the skill workflow at the path above.")
    lines.push("The skill will guide you through the deployment process.")
  } else if (route.type === "tool") {
    lines.push("### Next Steps")
    lines.push("")
    lines.push(`Execute the tool: ${route.target}`)
    lines.push(`Parameters: ${JSON.stringify(route.params, null, 2)}`)
  } else if (route.type === "direct") {
    lines.push("### Direct Execution")
    lines.push("")
    lines.push(route.message)
  }

  return lines.join("\n")
}

/**
 * Format dispatch result for display
 */
function formatDispatchResult(result: DispatchResult): string {
  if (result.error) {
    return formatDispatchError(result.error)
  }

  return result.guidance
}

/**
 * Internal dispatch for substep execution
 *
 * Used by document-driven orchestration to invoke skills/tools
 * without creating new top-level operations or going through
 * full permission gating.
 *
 * Key differences from normal dispatch:
 * - Does not create new top-level operation
 * - Does not go through permission gate
 * - Does not trigger plan review
 * - Inherits parent operation context
 * - Only does necessary precheck
 */
async function internalDispatch(
  intent: Intent,
  context: Record<string, unknown>,
  parentOperationId: string,
  stateManager: StateManager
): Promise<DispatchResult> {
  // Run minimal precheck
  const precheck = await runPreFlightCheck(intent)
  if (!precheck.passed) {
    return {
      success: false,
      intent,
      action: "start",
      route: null,
      precheck,
      permission: null,
      operationId: parentOperationId,  // Use parent operation
      jobId: null,
      error: precheckFailedError(intent, precheck.checks.filter(c => !c.passed)),
      guidance: precheck.guidance.join("\n"),
    }
  }

  // Route directly to handler
  const route = await routeToHandler({
    intent,
    context: { ...context, parentOperationId, internalMode: true },
    action: "start",
    stateManager,
  })

  return {
    success: route.type !== "error",
    intent,
    action: "start",
    route,
    precheck,
    permission: { allowed: true, riskLevel: INTENT_RISK[intent], requiresConfirmation: false },
    operationId: parentOperationId,
    jobId: null,
    error: route.type === "error"
      ? {
          code: "EXECUTION_ERROR",
          intent,
          step: "internal_routing",
          originalError: route.message,
          guidance: "Check the error and retry.",
          recoverable: true,
        }
      : null,
    guidance: buildGuidance(route, intent, "start"),
  }
}

export { internalDispatch }