/**
 * Route Table — single source of truth for intent→handler mapping
 */
import type { Intent } from "../core/state-manager.js"
import { getSkillMeta, getSkillPath, isMetaSkill, getIntentToSkillMap, loadRegistry } from "./skill-registry.js"

export type RiskLevel = "read_only" | "safe_write" | "destructive"

export interface RouteResult {
  type: "skill" | "orchestration" | "tool" | "direct" | "document" | "error"
  skillId?: string
  target?: string
  description?: string
  readPath?: string
  params: Record<string, unknown>
  message: string
  orchestration?: OrchestrationInfo | null
}

export interface OrchestrationInfo {
  metaSkillId: string
  steps: OrchestrationStep[]
}

export interface OrchestrationStep {
  skillId: string
  description?: string
}

// Risk levels: read from skill registry, with fallbacks for non-skill intents
const NON_SKILL_RISK: Partial<Record<string, RiskLevel>> = {
  gpu_status: "read_only",
  validate: "read_only",
  sync: "safe_write",
  run_container: "safe_write",
  execute_document: "destructive",
  auto: "read_only",
}

export function getRiskLevel(intent: string): RiskLevel {
  loadRegistry()
  const skill = getIntentToSkillMap().get(intent)
  if (skill?.riskLevel) {
    if (skill.riskLevel === "destructive") return "destructive"
    if (skill.riskLevel === "safe") return "read_only"
    return "safe_write"
  }
  return NON_SKILL_RISK[intent] ?? "safe_write"
}

// Tool-based intents (no skill, direct tool call)
const TOOL_ROUTES: Record<string, { tool: string; defaultParams?: Record<string, unknown> }> = {
  gpu_status: { tool: "musa_exec", defaultParams: { command: "mthreads-gmi" } },
  sync: { tool: "musa_sync" },
  run_container: { tool: "musa_docker" },
}

// Direct intents
const DIRECT_ROUTES: Record<string, string> = {
  validate:
    'Run validation: 1) mthreads-gmi  2) docker run --rm --env MTHREADS_VISIBLE_DEVICES=all registry.mthreads.com/cloud-mirror/ubuntu:20.04 mthreads-gmi  3) python -c "import torch; print(torch.musa.is_available())"',
}

/**
 * Build orchestration info from skill registry's dependsOn
 */
function buildOrchestration(skillId: string): OrchestrationInfo | null {
  const meta = getSkillMeta(skillId)
  if (!meta?.dependsOn?.length) return null
  return {
    metaSkillId: skillId,
    steps: meta.dependsOn.map((id) => {
      const stepMeta = getSkillMeta(id)
      return { skillId: id, description: stepMeta?.description }
    }),
  }
}

/**
 * Route an intent to its handler
 */
export function route(intent: string, context: Record<string, unknown>): RouteResult {
  loadRegistry()

  // 1. Document execution
  if (intent === "execute_document") {
    return { type: "document", params: context, message: "Execute deployment from document." }
  }

  // 2. Tool-based routes
  const toolRoute = TOOL_ROUTES[intent]
  if (toolRoute) {
    return {
      type: "tool",
      target: toolRoute.tool,
      params: { ...toolRoute.defaultParams, ...context },
      message: `Execute via ${toolRoute.tool}`,
    }
  }

  // 3. Direct routes
  const directMsg = DIRECT_ROUTES[intent]
  if (directMsg) {
    return { type: "direct", params: context, message: directMsg }
  }

  // 4. Skill-based routes (from skills/index.yml dispatch_intent mapping)
  const intentMap = getIntentToSkillMap()
  const skill = intentMap.get(intent)
  if (skill) {
    const skillPath = getSkillPath(skill.id)
    const meta = getSkillMeta(skill.id)

    if (isMetaSkill(skill.id)) {
      const orch = buildOrchestration(skill.id)
      return {
        type: "orchestration",
        skillId: skill.id,
        description: meta?.description,
        readPath: skillPath ?? undefined,
        params: context,
        message: orch
          ? `Orchestration: ${orch.steps.map((s, i) => `${i + 1}. ${s.skillId}`).join(", ")}`
          : `Execute meta skill: ${skill.id}`,
        orchestration: orch,
      }
    }

    return {
      type: "skill",
      skillId: skill.id,
      description: meta?.description,
      readPath: skillPath ?? undefined,
      params: context,
      message: meta?.description ?? `Execute skill: ${skill.id}`,
    }
  }

  // 5. Try as direct skill ID
  const directSkillPath = getSkillPath(intent)
  if (directSkillPath) {
    const meta = getSkillMeta(intent)
    return {
      type: isMetaSkill(intent) ? "orchestration" : "skill",
      skillId: intent,
      description: meta?.description,
      readPath: directSkillPath,
      params: context,
      message: meta?.description ?? `Execute skill: ${intent}`,
      orchestration: isMetaSkill(intent) ? buildOrchestration(intent) : null,
    }
  }

  return { type: "error", params: { intent }, message: `Unknown intent: ${intent}` }
}
