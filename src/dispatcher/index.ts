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
import { getResumePoint } from "./orchestrator.js"
import {
  type TracePayload,
  generateTraceId,
  startSpan,
  finishSpan,
} from "../shared/trace.js"
import { createLogger } from "../shared/logger.js"
import { getLarkTicket, type LarkTicket } from "../shared/lark-ticket.js"
import { getIntentList, getIntentToSkillMap } from "./skill-registry.js"

/**
 * Build intent descriptions from skill registry
 *
 * Generates markdown list of intent descriptions for tool documentation.
 */
function buildIntentDescriptions(intents: string[]): string {
  const intentToSkill = getIntentToSkillMap()
  const lines: string[] = []

  for (const intent of intents) {
    const skill = intentToSkill.get(intent)
    if (skill) {
      lines.push(`- ${intent}: ${skill.description}`)
    } else {
      lines.push(`- ${intent}: Execute ${intent} operation`)
    }
  }

  return lines.join("\n")
}

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
export {
  getOrchestration,
  executeOrchestration,
  getResumePoint,
  type ResumePoint,
  formatOrchestrationSummary,
  type Orchestration,
  type OrchestrationStep,
  type OrchestrationResult,
} from "./orchestrator"
export {
  getSkillMeta,
  getSkillPath,
  getSkillCategory,
  canCallSkill,
  isMetaSkill,
  isUserExposed,
  getIntentList,
  getIntentToSkillMap,
  type SkillMeta,
} from "./skill-registry"

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
  context?: Record<string, unknown> & {
    trace?: TracePayload  // Unified trace payload for distributed tracing
  }
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
  // Load registry and get intents from single source of truth (skills/index.yml)
  const skillIntents = getIntentList()

  // Add 'auto' for auto-detection mode
  const intentEnum = [...skillIntents, "auto"]

  // Build intent descriptions dynamically from skill registry
  const intentDescriptions = buildIntentDescriptions(skillIntents)

  api.registerTool({
    name: "musa_dispatch",
    description: `Task orchestrator for MUSA operations.

Handles pre-checks, permission gating, routing to skills/tools, error handling, and state management.

Use this as the primary entry point for all MUSA-related operations.

**Intents:**
${intentDescriptions}
- auto: Auto-detect intent from query`,

    parameters: {
      type: "object",
      properties: {
        intent: {
          type: "string",
          enum: intentEnum,
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
    // Use existing operation ID and get resume point
    if (action === "resume") {
      const operationIdParam = context.operationId as string

      // Step 1: Get resume point for orchestration (before modifying state)
      const resumePoint = await getResumePoint(stateManager, operationIdParam)

      // Step 2: Get associated job for tracking (before modifying state)
      const job = await stateManager.getJobByOperationId(operationIdParam)

      // Step 3: Validate routing first (before modifying state)
      const route = await routeToHandler({
        intent: resolvedIntent,
        context: {
          ...context,
          resume: true,
          resumePoint: resumePoint ? {
            metaSkillId: resumePoint.metaSkillId,
            fromStep: resumePoint.fromStep,
            savedContext: resumePoint.context,
          } : undefined,
        },
        action: "resume",
        stateManager,
      })

      // If routing failed, return error without modifying operation state
      if (route.type === "error") {
        return {
          success: false,
          intent: resolvedIntent,
          action: "resume",
          route,
          precheck,
          permission,
          operationId: operationIdParam,
          jobId: job?.id ?? null,
          error: {
            code: "EXECUTION_ERROR",
            intent: resolvedIntent,
            step: "routing",
            originalError: route.message,
            guidance: "Check the error and retry.",
            recoverable: true,
          },
          guidance: buildGuidance(route, resolvedIntent, "resume"),
        }
      }

      // Step 4: Routing validated, now resume the operation through state manager
      const resumed = await stateManager.resumeOperation(operationIdParam)
      if (!resumed) {
        // Routing succeeded but state transition failed - this is a system error
        return {
          success: false,
          intent: resolvedIntent,
          action: "resume",
          route,
          precheck,
          permission,
          operationId: operationIdParam,
          jobId: job?.id ?? null,
          error: {
            code: "RESUME_FAILED",
            intent: resolvedIntent,
            step: "resume_lifecycle",
            originalError: "Failed to resume operation through state manager",
            guidance: "The operation may not be in a resumable state. The routing was validated but the state transition failed.",
            recoverable: true,
          },
          guidance: "Failed to resume operation. It may not be in a resumable state.",
        }
      }

      // Success: operation resumed and routing validated
      return {
        success: true,
        intent: resolvedIntent,
        action: "resume",
        route,
        precheck,
        permission,
        operationId: operationIdParam,
        jobId: job?.id ?? null,
        error: null,
        guidance: buildGuidance(route, resolvedIntent, "resume"),
      }
    }
  }

  // 5. Atomic operation start (conflict check + start under lock)
  // For destructive operations, use atomic start to prevent race conditions
  // For non-destructive operations, use simple start (no conflict check needed)
  let operationId: string | null = null
  let jobId: string | null = null

  // Trace handling
  const trace = context.trace
  const logger = createLogger("dispatcher")

  // Try to get LarkTicket from openclaw-lark (AsyncLocalStorage propagation)
  const larkTicket = getLarkTicket()

  // Trace inheritance rules (enforced constraint):
  // 1. LarkTicket available (Feishu entry): Use messageId as traceId
  // 2. Main chain call (platform/Claude entry): MUST inherit upstream trace, forbidden to regenerate
  // 3. Independent entry (CLI/API direct call): Allowed to create new trace
  //
  // Code-level constraint: trace?.traceId or larkTicket?.messageId exists MUST be used
  // Violating this rule should be treated as a bug
  let traceId: string
  if (larkTicket?.messageId) {
    // Feishu entry via openclaw-lark: use messageId as traceId
    traceId = larkTicket.messageId
    logger.debug("Using LarkTicket messageId as traceId", { traceId, chatId: larkTicket.chatId })
  } else if (trace?.traceId) {
    // Main chain: force inherit
    traceId = trace.traceId
    logger.debug("Inheriting upstream trace", { traceId })
  } else {
    // Independent entry: allowed to create new (but log warning for audit)
    traceId = generateTraceId()
    logger.warn("No upstream trace, generating new traceId (standalone entry only)", { traceId })
  }

  // Create span for dispatch
  const span = startSpan("dispatch", { intent: resolvedIntent })

  try {
    const enrichedContext = { ...context, hostId }

    // Prepare trace info for operation
    const traceInfo = {
      traceId,
      parentSpanId: trace?.parentSpanId,
      sourceService: larkTicket ? "feishu-bridge" : trace?.sourceService,
    }

    if (isDestructive && action === "start") {
      // Atomic: conflict check + start under global lock
      const result = await stateManager.startOperationIfNoConflict(
        resolvedIntent,
        enrichedContext,
        traceInfo
      )

      if (!result.started) {
        const error = operationConflictError(resolvedIntent, hostId, result.conflict!.id)
        finishSpan(span, "error", { code: "OPERATION_CONFLICT", message: error.guidance })
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
      operationId = await stateManager.startOperation(resolvedIntent, enrichedContext, traceInfo)
    }

    // Log dispatch started with trace
    logger.info("Dispatch started", { traceId, operationId, intent: resolvedIntent })

    // 5.5 Start job tracking for destructive operations
    // Job tracks progress steps, used by context-builder for relevance sorting
    if (isDestructive && action === "start") {
      const totalSteps = INTENT_TOTAL_STEPS[resolvedIntent] || 0
      jobId = await stateManager.startJob(operationId, totalSteps, hostId, traceId)
    }

    // 6. Route to handler
    const route = await routeToHandler({
      intent: resolvedIntent,
      context,
      action,
      stateManager,
    })

    // 7. Return route result (actual execution is delegated to skills/tools)
    if (route.type !== "error") {
      finishSpan(span, "ok")
    } else {
      finishSpan(span, "error", { code: "ROUTING_ERROR", message: route.message })
    }

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
    finishSpan(span, "error", { code: "DISPATCH_ERROR", message: error.originalError })

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

  if (route.type === "orchestration") {
    lines.push("### Orchestration Execution")
    lines.push("")
    lines.push(route.message)
    if (route.orchestration) {
      lines.push("")
      lines.push(`**Meta Skill**: ${route.orchestration.metaSkillId}`)
      lines.push(`**Steps**: ${route.orchestration.steps.length} atomic skills`)
      lines.push("")
      lines.push("The orchestrator will execute each atomic skill in sequence.")
      lines.push("Progress will be tracked in the operation state.")
    }
    if (route.skillMeta) {
      lines.push("")
      lines.push(`**Kind**: ${route.skillMeta.kind}`)
      lines.push(`**Exposure**: ${route.skillMeta.exposure}`)
    }
  } else if (route.type === "skill") {
    lines.push("### Next Steps")
    lines.push("")
    lines.push("Follow the skill workflow at the path above.")
    lines.push("The skill will guide you through the deployment process.")
    if (route.skillMeta) {
      lines.push("")
      lines.push(`**Kind**: ${route.skillMeta.kind}`)
      lines.push(`**Exposure**: ${route.skillMeta.exposure}`)
    }
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