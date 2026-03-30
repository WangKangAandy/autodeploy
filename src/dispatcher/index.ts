/**
 * Dispatcher — operation lifecycle manager
 *
 * NOT a router. The LLM decides what to do.
 * This module handles: operation tracking, conflict detection, tracing,
 * and execution contracts for document-driven deployment.
 */

import * as fs from "fs"
import type { StateManager, Intent } from "../core/state-manager.js"
// skill-registry removed — OpenClaw native skill discovery handles SKILL.md routing
import { generateTraceId, startSpan, finishSpan } from "../shared/trace.js"
import { createLogger } from "../shared/logger.js"
import { getLarkTicket } from "../shared/lark-ticket.js"



// ============================================================================
// Types
// ============================================================================

export interface DispatchParams {
  intent: Intent
  context?: Record<string, unknown>
  action?: "start" | "status" | "resume" | "cancel"
  force?: boolean
}

export interface DispatchResult {
  success: boolean
  intent: Intent
  operationId: string | null
  traceId: string
  error: string | null
  guidance: string
}

// ============================================================================
// Execution Contract
// ============================================================================

/**
 * Build an execution contract from a document.
 *
 * An execution contract wraps a deployment document with:
 * 1. Strict execution rules (no early exit, must handle failures)
 * 2. The original document content
 * 3. Reporting requirements
 *
 * This is NOT a parser. We don't extract steps from the document.
 * The LLM reads the document and decides the steps.
 * The contract constrains HOW the LLM executes, not WHAT it executes.
 */
function buildExecutionContract(docContent: string, source: string): string {
  return `## Execution Contract

### Execution Rules (MUST follow)
1. **No early exit**: Execute ALL steps in the document. Do NOT stop at the first failure.
2. **Fix before giving up**: If a step fails (file not found, command error, path mismatch):
   - Search for alternatives (e.g., \`find /data -name "ModelName*" -maxdepth 3\`)
   - Try common path variations
   - Check environment variables
   - Only report as blocked if 3+ attempts fail on the same step
3. **Verify each step**: After each command, check the output matches expectations.
4. **Adapt paths**: Document paths may not match the actual filesystem. Always verify and adapt.
5. **Report progress**: After completing each major section, briefly state what was done.

### Stop conditions (ONLY these allow stopping)
- Remote machine is unreachable (SSH connection failed)
- User explicitly says "stop" or "cancel"
- A step requires credentials/permissions you don't have (after asking user)

### Document
**Source**: ${source}

---

${docContent}

---

### After completion
Report: steps executed, any adaptations made, final status.`
}

// ============================================================================
// Risk classification
// ============================================================================

const DESTRUCTIVE_INTENTS = new Set([
  "deploy_env", "update_driver", "execute_document",
])

function isDestructive(intent: string): boolean {
  return DESTRUCTIVE_INTENTS.has(intent)
}

// ============================================================================
// Tool registration
// ============================================================================

export function registerDispatcherTool(api: any, stateManager: StateManager): void {
  api.registerTool({
    name: "musa_dispatch",
    description: `Operation lifecycle manager for MUSA deployments.

Use this to:
- Track deployment operations (start/status/resume/cancel)
- Execute documents with an execution contract (enforces completion)
- Detect conflicting operations on the same host

Do NOT use this for simple commands — use musa_exec directly.`,
    parameters: {
      type: "object",
      properties: {
        intent: {
          type: "string",
          description: "Operation type: deploy_env, update_driver, execute_document, prepare_model, prepare_dataset, prepare_package, prepare_repo, gpu_status, validate, sync, run_container",
        },
        context: { type: "object", description: "Operation context (path, VERSION, etc.)" },
        action: {
          type: "string",
          enum: ["start", "status", "resume", "cancel"],
          default: "start",
          description: "start=new operation, status=check progress, resume=continue paused, cancel=abort",
        },
        force: { type: "boolean", default: false, description: "Skip confirmation for destructive ops" },
      },
      required: ["intent"],
    },
    async execute(_toolCallId: string, params: DispatchParams): Promise<string> {
      const result = await dispatch(params, stateManager)
      return JSON.stringify(result, null, 2)
    },
  })
}

// ============================================================================
// Dispatch logic
// ============================================================================

export async function dispatch(
  params: DispatchParams,
  stateManager: StateManager,
): Promise<DispatchResult> {
  const { intent, context = {}, action = "start", force = false } = params
  const logger = createLogger("dispatcher")

  // Trace
  const larkTicket = getLarkTicket()
  const traceId = larkTicket?.messageId ?? generateTraceId()
  const span = startSpan("dispatch", { intent, action })

  // Status/resume/cancel: delegate to state manager
  if (action !== "start") {
    return handleLifecycleAction(action, intent, context, traceId, stateManager)
  }

  // Destructive ops: confirm + conflict check
  if (isDestructive(intent) && !force) {
    finishSpan(span, "error", { code: "BLOCKED", message: "needs_confirmation" })
    return {
      success: false,
      intent,
      operationId: null,
      traceId,
      error: `"${intent}" is destructive. Set force=true to confirm.`,
      guidance: "",
    }
  }

  // Start operation (for trackable intents)
  let operationId: string | null = null
  if (isDestructive(intent)) {
    const result = await stateManager.startOperationIfNoConflict(intent as Intent, context, { traceId })
    if (!result.started) {
      finishSpan(span, "error", { code: "CONFLICT", message: "conflicting operation" })
      return {
        success: false,
        intent,
        operationId: null,
        traceId,
        error: "Conflicting operation in progress on this host.",
        guidance: "",
      }
    }
    operationId = result.operationId!
  }

  // Build guidance based on intent
  let guidance: string
  if (intent === "execute_document") {
    guidance = await buildDocumentGuidance(context)
  } else {
    guidance = buildOperationGuidance(intent, context)
  }

  finishSpan(span, "ok")
  logger.info("Dispatch completed", { traceId, intent, operationId })

  return {
    success: true,
    intent,
    operationId,
    traceId,
    error: null,
    guidance,
  }
}

// ============================================================================
// Guidance builders
// ============================================================================

async function buildDocumentGuidance(context: Record<string, unknown>): Promise<string> {
  const docPath = context.path as string | undefined
  const content = context.content as string | undefined

  let docContent: string
  let source: string

  if (docPath) {
    try {
      docContent = await fs.promises.readFile(docPath, "utf-8")
      source = docPath
    } catch (err) {
      return `Error: Failed to read document at ${docPath}: ${err}`
    }
  } else if (content) {
    docContent = content
    source = "pasted content"
  } else {
    return "Error: Provide 'path' or 'content' in context for execute_document."
  }

  return buildExecutionContract(docContent, source)
}

function buildOperationGuidance(intent: string, context: Record<string, unknown>): string {
  const lines: string[] = []
  lines.push(`## Operation: ${intent}`)
  lines.push(`**Status**: started`)

  lines.push("")
  lines.push("Check available skills for detailed execution steps.")

  if (Object.keys(context).length > 0) {
    lines.push("")
    lines.push("**Context**:")
    for (const [k, v] of Object.entries(context)) {
      lines.push(`- ${k}: ${v}`)
    }
  }

  return lines.join("\n")
}

// ============================================================================
// Lifecycle actions
// ============================================================================

async function handleLifecycleAction(
  action: string,
  intent: Intent,
  context: Record<string, unknown>,
  traceId: string,
  stateManager: StateManager,
): Promise<DispatchResult> {
  const operationId = context.operationId as string | undefined

  if (action === "status") {
    if (!operationId) {
      return { success: false, intent, operationId: null, traceId, error: "operationId required for status", guidance: "" }
    }
    const op = await stateManager.getOperation(operationId)
    if (!op) {
      return { success: false, intent, operationId, traceId, error: `Operation ${operationId} not found`, guidance: "" }
    }
    return {
      success: true,
      intent,
      operationId,
      traceId,
      error: null,
      guidance: `Operation ${operationId}: ${op.execution.status} (${op.intent})`,
    }
  }

  if (action === "resume") {
    if (!operationId) {
      return { success: false, intent, operationId: null, traceId, error: "operationId required for resume", guidance: "" }
    }
    const resumed = await stateManager.resumeOperation(operationId)
    return {
      success: resumed,
      intent,
      operationId,
      traceId,
      error: resumed ? null : `Cannot resume operation ${operationId}`,
      guidance: resumed ? `Operation ${operationId} resumed.` : "",
    }
  }

  if (action === "cancel") {
    if (!operationId) {
      return { success: false, intent, operationId: null, traceId, error: "operationId required for cancel", guidance: "" }
    }
    await stateManager.completeOperation(operationId, {
      success: false,
      summary: "Cancelled by user",
      error: "User cancelled",
    })
    return {
      success: true,
      intent,
      operationId,
      traceId,
      error: null,
      guidance: `Operation ${operationId} cancelled.`,
    }
  }

  return { success: false, intent, operationId: null, traceId, error: `Unknown action: ${action}`, guidance: "" }
}
