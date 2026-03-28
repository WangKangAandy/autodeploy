/**
 * Router
 *
 * Routes intents to appropriate skills, tools, or handlers.
 * Supports both user-facing intents and internal skill routing.
 * Enforces exposure boundaries for internal skills.
 */

import type { Intent } from "../core/state-manager.js"
import type { StateManager } from "../core/state-manager.js"
import { getIntentSkillPath } from "./intent-parser.js"
import { getOrchestration, type Orchestration } from "./orchestrator.js"
import {
  getSkillMeta,
  getSkillPath,
  canCallSkill,
  isMetaSkill,
} from "./skill-registry.js"

/**
 * Build orchestration steps message from orchestration definition
 */
function buildOrchestrationMessage(orchestration: Orchestration | null, title: string): string {
  if (!orchestration) {
    return title
  }

  const lines: string[] = [title, ""]
  lines.push("Orchestration steps:")

  orchestration.steps.forEach((step, index) => {
    lines.push(`${index + 1}. ${step.skillId}${step.description ? ` - ${step.description}` : ""}`)
  })

  return lines.join("\n")
}

/**
 * Build skill message from metadata (single source of truth)
 */
function buildSkillMessage(skillId: string, contextDescription?: string): string {
  const meta = getSkillMeta(skillId)

  if (!meta) {
    // Log warning for missing metadata - helps detect incomplete registry
    console.warn(`[router] Skill metadata not found for: ${skillId}. Registry may be incomplete.`)
    return `Execute skill: ${skillId}`
  }

  const lines: string[] = [meta.description]

  // Add inputs context from metadata
  if (meta.inputs) {
    lines.push("")
    lines.push("Inputs:")

    if (meta.inputs.required && meta.inputs.required.length > 0) {
      lines.push(`- Required: ${meta.inputs.required.join(", ")}`)
    }

    if (meta.inputs.optional && meta.inputs.optional.length > 0) {
      lines.push(`- Optional: ${meta.inputs.optional.join(", ")}`)
    }
  }

  // Add risk and exposure info
  lines.push("")
  lines.push(`Risk: ${meta.riskLevel} | Exposure: ${meta.exposure}`)

  if (contextDescription) {
    lines.push("")
    lines.push(contextDescription)
  }

  return lines.join("\n")
}

/**
 * Build skillMeta from registry or return undefined
 */
function buildSkillMeta(skillId: string): { id: string; kind: "atomic" | "meta"; exposure: "user" | "internal" } | undefined {
  const meta = getSkillMeta(skillId)
  if (!meta) {
    return undefined
  }
  return {
    id: meta.id,
    kind: meta.kind,
    exposure: meta.exposure,
  }
}

export interface RouteResult {
  type: "skill" | "tool" | "direct" | "orchestration" | "error"
  target: string
  params: Record<string, unknown>
  message: string
  orchestration?: {
    metaSkillId: string
    steps: string[]
  }
  skillMeta?: {
    id: string
    kind: "atomic" | "meta"
    exposure: "user" | "internal"
  }
}

export interface RouterContext {
  intent: Intent | string
  context: Record<string, unknown>
  action: "start" | "status" | "resume" | "cancel"
  stateManager: StateManager
  internalMode?: boolean
}

/**
 * Route an intent to the appropriate handler
 */
export async function routeToHandler(ctx: RouterContext): Promise<RouteResult> {
  const { intent, context, action, internalMode = false } = ctx

  // Check if this is an internal skill dispatch
  if (internalMode && typeof intent === "string") {
    return routeInternalSkill(intent, context)
  }

  // Standard intent routing
  switch (intent) {
    case "deploy_env":
      return routeDeployEnv(context, action)

    case "update_driver":
      return routeUpdateDriver(context, action)

    case "gpu_status":
      return routeGpuStatus(context)

    case "validate":
      return routeValidate(context)

    case "sync":
      return routeSync(context)

    case "run_container":
      return routeRunContainer(context)

    case "execute_document":
      return routeExecuteDocument(context, action)

    case "prepare_model":
      return routePrepareModel(context)

    case "prepare_dataset":
      return routePrepareDataset(context)

    case "prepare_package":
      return routePreparePackage(context)

    case "manage_images":
      return routeManageImages(context)

    case "prepare_repo":
      return routePrepareRepo(context)

    case "auto":
      return {
        type: "error",
        target: "intent_parser",
        params: {},
        message: "Could not determine intent. Please specify an explicit intent.",
      }

    default:
      // Check if it's a skill ID - this is user-mode routing
      if (typeof intent === "string") {
        return routeSkillById(intent, context, false)
      }

      return {
        type: "error",
        target: "router",
        params: { intent },
        message: `Unknown intent: ${intent}`,
      }
  }
}

/**
 * Route to a skill by its ID
 *
 * @param skillId - The skill ID to route to
 * @param context - Execution context
 * @param internalMode - Whether this is an internal dispatch (allows internal skills)
 */
async function routeSkillById(
  skillId: string,
  context: Record<string, unknown>,
  internalMode: boolean
): Promise<RouteResult> {
  // Check exposure permission
  if (!canCallSkill(skillId, internalMode)) {
    return {
      type: "error",
      target: "router",
      params: { skillId, internalMode },
      message: `Skill "${skillId}" is internal and cannot be called in user mode. ` +
        `Internal skills can only be called through meta skill orchestration.`,
    }
  }

  // Get skill path from registry
  const skillPath = getSkillPath(skillId)

  if (!skillPath) {
    return {
      type: "error",
      target: "router",
      params: { skillId },
      message: `Unknown skill ID: ${skillId}`,
    }
  }

  // Get skill metadata
  const meta = getSkillMeta(skillId)

  if (!meta) {
    return {
      type: "error",
      target: "router",
      params: { skillId },
      message: `Skill "${skillId}" not found in registry.`,
    }
  }

  const skillMeta = {
    id: meta.id,
    kind: meta.kind,
    exposure: meta.exposure,
  }

  // Check if it's a meta skill
  if (isMetaSkill(skillId)) {
    const orchestration = getOrchestration(skillId)
    return {
      type: "orchestration",
      target: skillPath,
      params: context,
      message: `Execute meta skill ${skillId} orchestration.`,
      orchestration: orchestration ? {
        metaSkillId: skillId,
        steps: orchestration.steps.map(s => s.skillId),
      } : undefined,
      skillMeta,
    }
  }

  return {
    type: "skill",
    target: skillPath,
    params: context,
    message: `Execute atomic skill: ${skillId}`,
    skillMeta,
  }
}

/**
 * Route internal skill dispatch
 * Internal mode is always true here
 */
async function routeInternalSkill(
  skillId: string,
  context: Record<string, unknown>
): Promise<RouteResult> {
  return routeSkillById(skillId, context, true)
}

/**
 * Route deploy_env intent
 */
async function routeDeployEnv(context: Record<string, unknown>, action: string): Promise<RouteResult> {
  const skillId = "deploy_musa_base_env"
  const skillPath = getIntentSkillPath("deploy_env")
  const orchestration = getOrchestration(skillId)
  const skillMeta = buildSkillMeta(skillId)

  if (action === "status") {
    return {
      type: "direct",
      target: "check_deployment_status",
      params: {},
      message: "Check deployment status from state file: .musa_deployment_state.json",
    }
  }

  if (action === "resume") {
    // Extract resume point from context (set by dispatch)
    const resumePoint = context.resumePoint as {
      metaSkillId: string
      fromStep: number
      savedContext: Record<string, unknown>
    } | undefined

    // Build resume message with step info
    let resumeMessage = "Resume MUSA environment deployment from last checkpoint."
    if (resumePoint && orchestration) {
      const failedStep = orchestration.steps[resumePoint.fromStep]
      const remainingSteps = orchestration.steps.slice(resumePoint.fromStep)

      resumeMessage = `Resume MUSA environment deployment from step ${resumePoint.fromStep + 1}.

Previously failed at: ${failedStep?.skillId ?? "unknown"}
Remaining steps: ${remainingSteps.map(s => s.skillId).join(", ")}`
    }

    return {
      type: "orchestration",
      target: skillPath!,
      params: { resume: true, resumePoint, ...context },
      message: resumeMessage,
      orchestration: orchestration ? {
        metaSkillId: skillId,
        steps: orchestration.steps.map(s => s.skillId),
      } : undefined,
      skillMeta,
    }
  }

  return {
    type: "orchestration",
    target: skillPath!,
    params: context,
    message: buildOrchestrationMessage(orchestration, "Start MUSA environment deployment."),
    orchestration: orchestration ? {
      metaSkillId: skillId,
      steps: orchestration.steps.map(s => s.skillId),
    } : undefined,
    skillMeta,
  }
}

/**
 * Route update_driver intent
 */
async function routeUpdateDriver(context: Record<string, unknown>, action: string): Promise<RouteResult> {
  const skillId = "update_musa_driver"
  const skillPath = getIntentSkillPath("update_driver")
  const orchestration = getOrchestration(skillId)
  const skillMeta = buildSkillMeta(skillId)

  return {
    type: "orchestration",
    target: skillPath!,
    params: context,
    message: buildOrchestrationMessage(orchestration, "Start GPU driver update."),
    orchestration: orchestration ? {
      metaSkillId: skillId,
      steps: orchestration.steps.map(s => s.skillId),
    } : undefined,
    skillMeta,
  }
}

/**
 * Route gpu_status intent
 */
async function routeGpuStatus(context: Record<string, unknown>): Promise<RouteResult> {
  return {
    type: "tool",
    target: "musa_exec",
    params: {
      command: "mthreads-gmi",
      ...context,
    },
    message: "Check GPU status with mthreads-gmi.",
  }
}

/**
 * Route validate intent
 */
async function routeValidate(context: Record<string, unknown>): Promise<RouteResult> {
  // Validation is a multi-step process
  return {
    type: "direct",
    target: "validation_sequence",
    params: context,
    message: `Run validation sequence:
1. Host: mthreads-gmi
2. Container: docker run --rm --env MTHREADS_VISIBLE_DEVICES=all registry.mthreads.com/cloud-mirror/ubuntu:20.04 mthreads-gmi
3. PyTorch: python -c "import torch; print(torch.musa.is_available())"`,
  }
}

/**
 * Route sync intent
 */
async function routeSync(context: Record<string, unknown>): Promise<RouteResult> {
  return {
    type: "tool",
    target: "musa_sync",
    params: context,
    message: "Sync files between local and remote hosts.",
  }
}

/**
 * Route run_container intent
 */
async function routeRunContainer(context: Record<string, unknown>): Promise<RouteResult> {
  return {
    type: "tool",
    target: "musa_docker",
    params: context,
    message: "Run Docker container with GPU access.",
  }
}

/**
 * Route execute_document intent
 *
 * Document-driven execution orchestration:
 * 1. Load document (local file or pasted content)
 * 2. Parse document into structured plan
 * 3. Generate execution plan
 * 4. Safety validation
 * 5. Plan Review (awaiting user confirmation)
 * 6. Execute steps
 */
async function routeExecuteDocument(context: Record<string, unknown>, action: string): Promise<RouteResult> {
  if (action === "status") {
    return {
      type: "direct",
      target: "check_document_execution_status",
      params: context,
      message: "Check document execution status from state file.",
    }
  }

  if (action === "resume") {
    return {
      type: "direct",
      target: "resume_document_execution",
      params: { resume: true, ...context },
      message: "Resume document execution from last checkpoint.",
    }
  }

  return {
    type: "direct",
    target: "document_executor",
    params: context,
    message: `Execute deployment from document.

Flow:
1. Load document (local path or pasted content)
2. Parse document into phases and steps
3. Generate execution plan
4. Safety validation
5. Plan Review (await user confirmation)
6. Execute steps sequentially

Supported sources:
- Local file: path=/path/to/document.md
- Pasted content: content="..."`,
  }
}

/**
 * Route prepare_model intent
 */
async function routePrepareModel(context: Record<string, unknown>): Promise<RouteResult> {
  const skillId = "prepare_model_artifacts"
  const skillPath = getSkillPath(skillId)
  const skillMeta = buildSkillMeta(skillId)

  return {
    type: "skill",
    target: skillPath!,
    params: context,
    message: buildSkillMessage(skillId),
    skillMeta,
  }
}

/**
 * Route prepare_dataset intent
 */
async function routePrepareDataset(context: Record<string, unknown>): Promise<RouteResult> {
  const skillId = "prepare_dataset_artifacts"
  const skillPath = getSkillPath(skillId)
  const skillMeta = buildSkillMeta(skillId)

  return {
    type: "skill",
    target: skillPath!,
    params: context,
    message: buildSkillMessage(skillId),
    skillMeta,
  }
}

/**
 * Route prepare_package intent
 */
async function routePreparePackage(context: Record<string, unknown>): Promise<RouteResult> {
  const skillId = "prepare_musa_package"
  const skillPath = getSkillPath(skillId)
  const skillMeta = buildSkillMeta(skillId)

  return {
    type: "skill",
    target: skillPath!,
    params: context,
    message: buildSkillMessage(skillId),
    skillMeta,
  }
}

/**
 * Route manage_images intent
 */
async function routeManageImages(context: Record<string, unknown>): Promise<RouteResult> {
  const skillId = "manage_container_images"
  const skillPath = getSkillPath(skillId)
  const skillMeta = buildSkillMeta(skillId)

  return {
    type: "skill",
    target: skillPath!,
    params: context,
    message: buildSkillMessage(skillId),
    skillMeta,
  }
}

/**
 * Route prepare_repo intent
 */
async function routePrepareRepo(context: Record<string, unknown>): Promise<RouteResult> {
  const skillId = "prepare_dependency_repo"
  const skillPath = getSkillPath(skillId)
  const skillMeta = buildSkillMeta(skillId)

  return {
    type: "skill",
    target: skillPath!,
    params: context,
    message: buildSkillMessage(skillId),
    skillMeta,
  }
}