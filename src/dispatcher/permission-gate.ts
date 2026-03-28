/**
 * Permission Gate
 *
 * Defines risk levels for operations and handles confirmation requirements.
 */

import type { Intent } from "../core/state-manager"

export type RiskLevel = "read_only" | "safe_write" | "destructive"

/**
 * Risk level mapping for each intent
 */
export const INTENT_RISK: Record<Intent, RiskLevel> = {
  gpu_status: "read_only",
  validate: "read_only",
  sync: "safe_write",
  run_container: "safe_write",
  deploy_env: "destructive",
  update_driver: "destructive",
  execute_document: "destructive",  // Documents may contain destructive commands
  prepare_model: "safe_write",      // Downloads files, idempotent
  prepare_dataset: "safe_write",    // Downloads files, idempotent
  prepare_package: "safe_write",    // Downloads packages, idempotent
  manage_images: "safe_write",      // Docker image operations, idempotent
  prepare_repo: "safe_write",       // Git clone/pull, idempotent
  auto: "read_only", // Will be re-evaluated after intent parsing
}

/**
 * Check if operation requires confirmation
 */
export function requiresConfirmation(intent: Intent, force: boolean = false): boolean {
  const risk = INTENT_RISK[intent]

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
 */
export function getRiskLevel(intent: Intent): RiskLevel {
  return INTENT_RISK[intent]
}

/**
 * Generate confirmation message for destructive operations
 */
export function getConfirmationMessage(intent: Intent, context?: Record<string, unknown>): string {
  switch (intent) {
    case "deploy_env":
      return "This operation will install/modify system packages, GPU drivers, and Docker configuration. Continue?"
    case "update_driver":
      return "This operation will replace the GPU driver and may require a system reboot. Continue?"
    case "execute_document":
      // For document execution, show plan preview if available
      if (context?.planPreview) {
        const plan = context.planPreview as { phases: { name: string; stepCount: number }[] }
        const phaseList = plan.phases.map(p => `- ${p.name} (${p.stepCount} steps)`).join("\n")
        return `This document contains ${plan.phases.length} phases:\n${phaseList}\n\nProceed with execution?`
      }
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