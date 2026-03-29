/**
 * Permission Gate
 *
 * Defines risk levels for operations and handles confirmation requirements.
 *
 * Risk levels are derived from skills/index.yml (skill.riskLevel).
 * This file provides fallback values for intents not backed by skills.
 */

import type { Intent } from "../core/state-manager"
import { getIntentToSkillMap, loadRegistry } from "./skill-registry.js"

export type RiskLevel = "read_only" | "safe_write" | "destructive"

/**
 * Map skill.riskLevel to Intent RiskLevel
 *
 * skill.riskLevel: "safe" | "destructive" | "idempotent"
 * Intent RiskLevel: "read_only" | "safe_write" | "destructive"
 */
function mapSkillRiskToIntentRisk(skillRisk: string): RiskLevel {
  switch (skillRisk) {
    case "destructive":
      return "destructive"
    case "idempotent":
      return "safe_write"
    case "safe":
      return "read_only"
    default:
      return "safe_write" // Safe default
  }
}

/**
 * Fallback risk level mapping for intents not backed by skills
 *
 * Used for: gpu_status, validate, sync, run_container, execute_document, auto
 */
const DEFAULT_INTENT_RISK: Partial<Record<Intent, RiskLevel>> = {
  gpu_status: "read_only",
  validate: "read_only",
  sync: "safe_write",
  run_container: "safe_write",
  execute_document: "destructive",  // Documents may contain destructive commands
  auto: "read_only", // Will be re-evaluated after intent parsing
}

/**
 * Legacy static mapping (kept for backward compatibility)
 * @deprecated Use getRiskLevel() instead, which reads from skill registry
 */
export const INTENT_RISK: Record<Intent, RiskLevel> = {
  gpu_status: "read_only",
  validate: "read_only",
  sync: "safe_write",
  run_container: "safe_write",
  deploy_env: "destructive",
  update_driver: "destructive",
  execute_document: "destructive",
  prepare_model: "safe_write",
  prepare_dataset: "safe_write",
  prepare_package: "safe_write",
  manage_images: "safe_write",
  prepare_repo: "safe_write",
  auto: "read_only",
}

/**
 * Check if operation requires confirmation
 */
export function requiresConfirmation(intent: Intent, force: boolean = false): boolean {
  const risk = getRiskLevel(intent)

  if (risk === "read_only") {
    return false
  }

  if (risk === "safe_write") {
    return false // Warning only, no hard confirmation
  }

  if (risk === "destructive") {
    return !force // Requires confirmation unless force is true
  }

  return false
}

/**
 * Get risk level for intent
 *
 * Priority:
 * 1. Skill registry (skill.riskLevel mapped to RiskLevel)
 * 2. DEFAULT_INTENT_RISK fallback
 * 3. "safe_write" as safe default
 */
export function getRiskLevel(intent: Intent): RiskLevel {
  // 1. Try skill registry first
  loadRegistry()
  const skill = getIntentToSkillMap().get(intent)
  if (skill?.riskLevel) {
    return mapSkillRiskToIntentRisk(skill.riskLevel)
  }

  // 2. Fallback to default mapping
  if (DEFAULT_INTENT_RISK[intent]) {
    return DEFAULT_INTENT_RISK[intent]!
  }

  // 3. Safe default
  return "safe_write"
}

/**
 * Generate confirmation message for destructive operations
 *
 * Uses skill.description for skill-backed intents, with hardcoded fallbacks.
 */
export function getConfirmationMessage(intent: Intent, context?: Record<string, unknown>): string {
  // Special handling for document execution with plan preview
  if (intent === "execute_document" && context?.planPreview) {
    const plan = context.planPreview as { phases: { name: string; stepCount: number }[] }
    const phaseList = plan.phases.map(p => `- ${p.name} (${p.stepCount} steps)`).join("\n")
    return `This document contains ${plan.phases.length} phases:\n${phaseList}\n\nProceed with execution?`
  }

  // Try to get description from skill registry
  const skill = getIntentToSkillMap().get(intent)
  if (skill) {
    const desc = skill.description
    return `This operation will: ${desc}. Continue?`
  }

  // Hardcoded fallbacks for non-skill intents
  switch (intent) {
    case "deploy_env":
      return "This operation will install/modify system packages, GPU drivers, and Docker configuration. Continue?"
    case "update_driver":
      return "This operation will replace the GPU driver and may require a system reboot. Continue?"
    case "execute_document":
      return "This operation will execute commands from the provided document. Review the plan before execution. Continue?"
    default:
      return `Operation "${intent}" will modify system state. Continue?`
  }
}

/**
 * Permission check result
 */
export interface PermissionResult {
  allowed: boolean
  riskLevel: RiskLevel
  requiresConfirmation: boolean
  confirmationMessage?: string
}

/**
 * Check permission for an operation
 */
export function checkPermission(intent: Intent, force: boolean = false, context?: Record<string, unknown>): PermissionResult {
  const riskLevel = getRiskLevel(intent)
  const needsConfirmation = requiresConfirmation(intent, force)

  return {
    allowed: !needsConfirmation || force,
    riskLevel,
    requiresConfirmation: needsConfirmation,
    confirmationMessage: needsConfirmation ? getConfirmationMessage(intent, context) : undefined,
  }
}