import * as fs from "fs"
import type { StateManager, Intent } from "../core/state-manager.js"
import { route, getRiskLevel, type RouteResult } from "./route-table.js"
import { getIntentList, getIntentToSkillMap, getSkillMeta, getSkillPath } from "./skill-registry.js"
import { generateTraceId, startSpan, finishSpan } from "../shared/trace.js"
import { createLogger } from "../shared/logger.js"
import { getLarkTicket } from "../shared/lark-ticket.js"

export interface DispatchParams {
  intent: Intent
  context?: Record<string, unknown>
  action?: "start" | "status" | "resume" | "cancel"
  force?: boolean
  query?: string
}

export interface DispatchResult {
  success: boolean
  intent: Intent
  operationId: string | null
  error: string | null
  guidance: string
}

// Re-exports
export { route, getRiskLevel, type RouteResult } from "./route-table"
export { getSkillMeta, getSkillPath, getIntentList, getIntentToSkillMap } from "./skill-registry"

export function registerDispatcherTool(api: any, stateManager: StateManager): void {
  const skillIntents = getIntentList()
  const nonSkillIntents = ["gpu_status", "validate", "sync", "run_container", "execute_document"]
  const intentEnum = [...skillIntents, ...nonSkillIntents, "auto"]

  // Build description from skill registry
  const intentToSkill = getIntentToSkillMap()
  const descriptions = intentEnum
    .filter((i) => i !== "auto")
    .map((i) => {
      const skill = intentToSkill.get(i)
      return `- ${i}: ${skill?.description ?? i}`
    })
    .join("\n")

  api.registerTool({
    name: "musa_dispatch",
    description: `Task orchestrator for MUSA operations.\n\nIntents:\n${descriptions}\n- auto: Auto-detect intent from query`,
    parameters: {
      type: "object",
      properties: {
        intent: { type: "string", enum: intentEnum, description: "Operation intent" },
        context: { type: "object", description: "Additional context" },
        action: {
          type: "string",
          enum: ["start", "status", "resume", "cancel"],
          default: "start",
        },
        force: { type: "boolean", default: false },
        query: { type: "string", description: "Natural language query (for auto intent)" },
      },
      required: ["intent"],
    },
    async execute(_toolCallId: string, params: DispatchParams): Promise<string> {
      const result = await dispatch(params, stateManager)
      return result.error ?? result.guidance
    },
  })
}

export async function dispatch(
  params: DispatchParams,
  stateManager: StateManager
): Promise<DispatchResult> {
  const { intent, context = {}, action = "start", force = false } = params
  const logger = createLogger("dispatcher")

  // 1. For 'auto', ask for explicit intent
  if (intent === "auto") {
    return {
      success: false,
      intent,
      operationId: null,
      error: "Could not determine intent. Please specify explicitly.",
      guidance: "",
    }
  }

  // 2. Risk check
  const risk = getRiskLevel(intent)
  if (risk === "destructive" && !force) {
    return {
      success: false,
      intent,
      operationId: null,
      error: `Operation "${intent}" is destructive. Pass force=true to confirm.`,
      guidance: "",
    }
  }

  // 3. Mode check (informational only)
  await stateManager.getExecutionMode()

  // 4. Trace
  const larkTicket = getLarkTicket()
  const traceId = larkTicket?.messageId ?? generateTraceId()
  const span = startSpan("dispatch", { intent })

  // 5. Start operation for destructive ops
  let operationId: string | null = null
  if (risk === "destructive" && action === "start") {
    const result = await stateManager.startOperationIfNoConflict(intent as Intent, context, {
      traceId,
    })
    if (!result.started) {
      finishSpan(span, "error", { code: "CONFLICT", message: "Conflicting operation in progress" })
      return {
        success: false,
        intent,
        operationId: null,
        error: "Conflicting operation in progress.",
        guidance: "",
      }
    }
    operationId = result.operationId!
  }

  // 6. Route
  const routeResult = route(intent, context)

  // 6.5 Handle document: load content and return as guidance
  if (routeResult.type === "document") {
    const docGuidance = await loadDocumentGuidance(context)
    finishSpan(span, docGuidance.startsWith("Error") ? "error" : "ok")
    return {
      success: !docGuidance.startsWith("Error"),
      intent,
      operationId,
      error: null,
      guidance: docGuidance,
    }
  }

  if (routeResult.type === "error") {
    finishSpan(span, "error", { code: "UNKNOWN_INTENT", message: routeResult.message })
    return { success: false, intent, operationId, error: routeResult.message, guidance: "" }
  }

  finishSpan(span, "ok")
  logger.info("Dispatch completed", { traceId, intent, type: routeResult.type })

  return {
    success: true,
    intent,
    operationId,
    error: null,
    guidance: formatGuidance(routeResult, intent),
  }
}

/**
 * Load document and return as guidance for LLM to execute
 */
async function loadDocumentGuidance(context: Record<string, unknown>): Promise<string> {
  const docPath = context.path as string | undefined
  const content = context.content as string | undefined

  let docContent: string
  if (docPath) {
    try {
      docContent = await fs.promises.readFile(docPath, "utf-8")
    } catch (err) {
      return `Error: Failed to read document at ${docPath}: ${err}`
    }
  } else if (content) {
    docContent = content
  } else {
    return "Error: Provide path or content parameter for document execution."
  }

  return `## Document Loaded\n\n**Source**: ${docPath || "pasted content"}\n**Length**: ${docContent.length} chars\n\n---\n\n${docContent}\n\n---\n\n**Instructions**: Read the document above. Execute each step sequentially using musa_exec/musa_docker. Validate results at each checkpoint.`
}

function formatGuidance(r: RouteResult, intent: string): string {
  const lines: string[] = []
  lines.push(`## Dispatch: ${intent}`)
  lines.push(`**Type**: ${r.type}`)

  if (r.skillId) {
    lines.push(`**Skill**: ${r.skillId}`)
    if (r.description) lines.push(`**Description**: ${r.description}`)
    if (r.readPath) lines.push(`**Skill file**: ${r.readPath}`)
  }

  if (r.target) lines.push(`**Tool**: ${r.target}`)

  if (r.orchestration) {
    lines.push("")
    lines.push("**Steps**:")
    r.orchestration.steps.forEach((s, i) => {
      lines.push(`${i + 1}. ${s.skillId}${s.description ? ` — ${s.description}` : ""}`)
    })
  }

  if (r.params && Object.keys(r.params).length > 0) {
    lines.push("")
    lines.push("**Params**: " + JSON.stringify(r.params, null, 2))
  }

  lines.push("")
  lines.push(r.message)

  return lines.join("\n")
}
