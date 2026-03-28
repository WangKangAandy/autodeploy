/**
 * Orchestrator
 *
 * Parses and executes meta skill orchestrations.
 * Handles sequential execution of atomic skills with state passing and resume support.
 *
 * Orchestration steps are derived from skills/index.yml dependsOn field.
 * This ensures single source of truth - no duplication.
 */

import * as fs from "fs"
import * as path from "path"
import type { StateManager } from "../core/state-manager.js"
import { getSkillMeta, getSkillPath, isMetaSkill as isMetaSkillFromRegistry } from "./skill-registry.js"

/**
 * Orchestration step definition
 */
export interface OrchestrationStep {
  skillId: string
  description?: string
  optional?: boolean
  parallelWith?: string[]  // Future: parallel step support
}

/**
 * Orchestration definition parsed from meta skill
 */
export interface Orchestration {
  metaSkillId: string
  steps: OrchestrationStep[]
  inputs: Record<string, string>  // Input mappings
  outputs: string[]  // Expected outputs
}

/**
 * Step execution result
 */
export interface StepResult {
  skillId: string
  success: boolean
  output?: Record<string, unknown>
  error?: string
  skipped?: boolean
}

/**
 * Orchestration execution result
 */
export interface OrchestrationResult {
  metaSkillId: string
  success: boolean
  steps: StepResult[]
  finalOutput?: Record<string, unknown>
  error?: string
}

/**
 * Build orchestration from skill registry's dependsOn field
 * This is the primary source of truth for orchestration steps
 */
function buildOrchestrationFromRegistry(metaSkillId: string): Orchestration | null {
  const meta = getSkillMeta(metaSkillId)
  if (!meta || meta.kind !== "meta") {
    return null
  }

  // dependsOn contains the ordered list of atomic skill IDs
  const dependsOn = meta.dependsOn
  if (!dependsOn || dependsOn.length === 0) {
    return null
  }

  // Build steps from dependsOn
  const steps: OrchestrationStep[] = dependsOn.map(skillId => {
    const skillMeta = getSkillMeta(skillId)
    return {
      skillId,
      description: skillMeta?.description,
    }
  })

  // Build input mappings from meta skill's inputs
  const inputs: Record<string, string> = {}
  if (meta.inputs?.required) {
    for (const input of meta.inputs.required) {
      inputs[input] = `context.${input}`
    }
  }
  if (meta.inputs?.optional) {
    for (const input of meta.inputs.optional) {
      inputs[input] = `context.${input}`
    }
  }

  return {
    metaSkillId,
    steps,
    inputs,
    outputs: meta.outputs || [],
  }
}

/**
 * Fallback orchestrations for known meta skills
 * Used when registry is not available or skill not in registry
 */
const FALLBACK_ORCHESTRATIONS: Record<string, Orchestration> = {
  deploy_musa_base_env: {
    metaSkillId: "deploy_musa_base_env",
    steps: [
      { skillId: "ensure_system_dependencies", description: "Install system dependencies" },
      { skillId: "ensure_musa_driver", description: "Install/verify MUSA driver" },
      { skillId: "ensure_mt_container_toolkit", description: "Install/verify container toolkit" },
      { skillId: "manage_container_images", description: "Pull runtime image" },
      { skillId: "validate_musa_container_environment", description: "Validate container environment" },
    ],
    inputs: {
      MUSA_SDK_VERSION: "context.MUSA_SDK_VERSION",
      MT_GPU_DRIVER_VERSION: "context.MT_GPU_DRIVER_VERSION",
      DOCKER_IMAGE: "context.DOCKER_IMAGE",
    },
    outputs: [
      "driver installed and loaded",
      "container toolkit bound to Docker",
      "validation container running",
    ],
  },

  update_musa_driver: {
    metaSkillId: "update_musa_driver",
    steps: [
      { skillId: "ensure_musa_driver", description: "Update MUSA driver" },
    ],
    inputs: {
      MT_GPU_DRIVER_VERSION: "context.MT_GPU_DRIVER_VERSION",
      MUSA_SDK_VERSION: "context.MUSA_SDK_VERSION",
    },
    outputs: [
      "new driver installed and loaded",
    ],
  },
}

// Cache for built orchestrations
const orchestrationCache = new Map<string, Orchestration | null>()

/**
 * Get orchestration for a meta skill
 *
 * Priority:
 * 1. Build from registry (dependsOn field in index.yml)
 * 2. Fallback to hardcoded definitions
 */
export function getOrchestration(metaSkillId: string): Orchestration | null {
  // Check cache first
  if (orchestrationCache.has(metaSkillId)) {
    return orchestrationCache.get(metaSkillId) ?? null
  }

  // Try to build from registry
  const fromRegistry = buildOrchestrationFromRegistry(metaSkillId)
  if (fromRegistry) {
    orchestrationCache.set(metaSkillId, fromRegistry)
    return fromRegistry
  }

  // Fall back to hardcoded
  const fallback = FALLBACK_ORCHESTRATIONS[metaSkillId] ?? null
  orchestrationCache.set(metaSkillId, fallback)
  return fallback
}

/**
 * Check if a skill is a meta skill
 * Checks registry first, then fallback orchestrations
 */
export function isMetaSkill(skillId: string): boolean {
  // Check fallback orchestrations first (fastest)
  if (skillId in FALLBACK_ORCHESTRATIONS) {
    return true
  }
  // Fall back to registry
  return isMetaSkillFromRegistry(skillId)
}

/**
 * Parse orchestration from SKILL.md content
 * (Future: support dynamic orchestration from markdown)
 */
export function parseOrchestrationFromMarkdown(content: string): Orchestration | null {
  // Look for orchestration block in markdown
  // Format:
  // ## Orchestration
  // 1. skill_id_1
  // 2. skill_id_2
  // ...

  const orchestrationMatch = content.match(/## Orchestration\n([\s\S]*?)(?=\n##|$)/)
  if (!orchestrationMatch) {
    return null
  }

  const stepLines = orchestrationMatch[1]
    .split("\n")
    .filter(line => line.match(/^\d+\.\s+\w+/))

  const steps: OrchestrationStep[] = stepLines.map(line => {
    const match = line.match(/^\d+\.\s+(\w+)/)
    if (match) {
      return { skillId: match[1] }
    }
    return null
  }).filter((step): step is OrchestrationStep => step !== null)

  if (steps.length === 0) {
    return null
  }

  return {
    metaSkillId: "dynamic",
    steps,
    inputs: {},
    outputs: [],
  }
}

/**
 * Execute a meta skill orchestration
 *
 * @param metaSkillId - The meta skill ID
 * @param context - Execution context with inputs
 * @param stateManager - State manager for persistence
 * @param dispatcher - Dispatcher function for skill execution
 * @param fromStep - Resume from this step index (0-based)
 */
export async function executeOrchestration(
  metaSkillId: string,
  context: Record<string, unknown>,
  stateManager: StateManager,
  dispatcher: (params: {
    intent: string
    context: Record<string, unknown>
    mode: string
    parentOperationId: string
  }) => Promise<{ success: boolean; error?: string }>,
  fromStep: number = 0
): Promise<OrchestrationResult> {
  const orchestration = getOrchestration(metaSkillId)

  if (!orchestration) {
    return {
      metaSkillId,
      success: false,
      steps: [],
      error: `No orchestration found for meta skill: ${metaSkillId}`,
    }
  }

  const results: StepResult[] = []
  const accumulatedOutput: Record<string, unknown> = { ...context }

  // Get or create parent operation ID for checkpoint tracking
  const parentOperationId = context.parentOperationId as string || "unknown"

  for (let i = fromStep; i < orchestration.steps.length; i++) {
    const step = orchestration.steps[i]
    const skillPath = getSkillPath(step.skillId)

    if (!skillPath) {
      results.push({
        skillId: step.skillId,
        success: false,
        error: `Skill path not found for: ${step.skillId}`,
      })

      if (!step.optional) {
        return {
          metaSkillId,
          success: false,
          steps: results,
          error: `Required step failed: ${step.skillId}`,
        }
      }
      continue
    }

    // Prepare context for this step
    const stepContext = {
      ...accumulatedOutput,
      _stepIndex: i,
      _totalSteps: orchestration.steps.length,
      parentOperationId,
    }

    // Execute the skill via dispatcher
    try {
      const dispatchResult = await dispatcher({
        intent: step.skillId,
        context: stepContext,
        mode: "internal",
        parentOperationId,
      })

      results.push({
        skillId: step.skillId,
        success: dispatchResult.success,
        error: dispatchResult.error,
      })

      if (!dispatchResult.success && !step.optional) {
        // Save checkpoint for resume
        await saveCheckpoint(stateManager, parentOperationId, metaSkillId, i, accumulatedOutput)

        return {
          metaSkillId,
          success: false,
          steps: results,
          error: `Step ${i + 1} (${step.skillId}) failed: ${dispatchResult.error}`,
        }
      }

      // Merge output for next step (future: when skills return structured output)
      // accumulatedOutput = { ...accumulatedOutput, ...stepOutput }

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err)
      results.push({
        skillId: step.skillId,
        success: false,
        error: errorMessage,
      })

      if (!step.optional) {
        await saveCheckpoint(stateManager, parentOperationId, metaSkillId, i, accumulatedOutput)

        return {
          metaSkillId,
          success: false,
          steps: results,
          error: `Step ${i + 1} (${step.skillId}) threw error: ${errorMessage}`,
        }
      }
    }
  }

  return {
    metaSkillId,
    success: true,
    steps: results,
    finalOutput: accumulatedOutput,
  }
}

/**
 * Save checkpoint for resume
 * Uses file-based checkpoint for orchestration state
 */
async function saveCheckpoint(
  stateManager: StateManager,
  operationId: string,
  metaSkillId: string,
  failedStepIndex: number,
  context: Record<string, unknown>
): Promise<void> {
  try {
    // Save to orchestration checkpoint file
    const checkpointFile = `.orchestration_checkpoint_${operationId}.json`
    const checkpoint = {
      operationId,
      metaSkillId,
      failedStepIndex,
      context,
      timestamp: new Date().toISOString(),
    }

    const fs = await import("fs")
    await fs.promises.writeFile(checkpointFile, JSON.stringify(checkpoint, null, 2))
  } catch (err) {
    // Log but don't fail
    console.error("Failed to save checkpoint:", err)
  }
}

/**
 * Resume point returned from checkpoint
 */
export interface ResumePoint {
  metaSkillId: string
  fromStep: number
  context: Record<string, unknown>
}

/**
 * Get resume point from checkpoint
 */
export async function getResumePoint(
  stateManager: StateManager,
  operationId: string
): Promise<ResumePoint | null> {
  try {
    const fs = await import("fs")
    const checkpointFile = `.orchestration_checkpoint_${operationId}.json`

    if (!fs.existsSync(checkpointFile)) {
      return null
    }

    const content = await fs.promises.readFile(checkpointFile, "utf-8")
    const checkpoint = JSON.parse(content)

    return {
      metaSkillId: checkpoint.metaSkillId,
      fromStep: checkpoint.failedStepIndex,
      context: checkpoint.context,
    }
  } catch (err) {
    return null
  }
}

/**
 * Generate orchestration summary for display
 */
export function formatOrchestrationSummary(result: OrchestrationResult): string {
  const lines: string[] = []

  lines.push(`## Orchestration: ${result.metaSkillId}`)
  lines.push("")
  lines.push(`**Status**: ${result.success ? "✅ Success" : "❌ Failed"}`)
  lines.push("")

  lines.push("### Steps")
  lines.push("")

  result.steps.forEach((step, index) => {
    const status = step.skipped ? "⏭️ Skipped" :
                   step.success ? "✅" : "❌"
    lines.push(`${index + 1}. ${status} ${step.skillId}`)

    if (step.error) {
      lines.push(`   Error: ${step.error}`)
    }
  })

  if (result.error) {
    lines.push("")
    lines.push(`**Error**: ${result.error}`)
  }

  return lines.join("\n")
}