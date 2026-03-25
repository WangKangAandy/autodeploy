/**
 * Execution Plan Generator
 *
 * 分析文档内容，决定映射方式：
 * - 基础设施阶段 → 调用现有 skill (deploy_env, update_driver, validate)
 * - 应用层阶段 → 直接执行文档命令
 */

import type {
  ParsedDocument,
  ExecutionPlan,
  PlanPhase,
  PlanStep,
  ExecutionStep,
  ExecutionPhase,
} from "./types"

// ============================================================================
// Phase Analysis Patterns (V1: MUSA-specific heuristics)
// ============================================================================

/**
 * MUSA-specific phase patterns for heuristic mapping
 * 当前只针对 MUSA 现有基础设施 skill，不是通用 phase analysis
 */
const MUSA_PHASE_PATTERNS = {
  requiresFullDeploy: ["apt install", "mthreads-gmi", "container toolkit"],
  requiresDriverUpdate: ["dpkg", "mtgpu", "driver", "驱动"],
  isValidationOnly: ["mthreads-gmi", "nvidia-smi", "musaInfo", "validate", "验证"],
}

interface PhaseAnalysis {
  requiresFullDeploy: boolean
  requiresDriverUpdate: boolean
  isValidationOnly: boolean
  isApplication: boolean
}

// ============================================================================
// Plan Generation
// ============================================================================

/**
 * Generate execution plan from parsed document
 */
export function generatePlan(document: ParsedDocument): ExecutionPlan {
  const planId = generateId("plan")
  const planPhases: PlanPhase[] = []

  for (const phase of document.phases) {
    const analysis = analyzePhase(phase)
    const planPhase = createPlanPhase(phase, analysis)
    planPhases.push(planPhase)
  }

  return {
    id: planId,
    documentId: document.id,
    createdAt: new Date().toISOString(),
    phases: planPhases,
    variables: document.metadata.customVars,
    status: "draft",
    unparsedSections: document.unparsedSections,
    totalSections: document.totalSections,
  }
}

// ============================================================================
// Phase Analysis
// ============================================================================

function analyzePhase(phase: ExecutionPhase): PhaseAnalysis {
  const commands = phase.steps.map(s => s.command || "").join(" ")
  const descriptions = phase.steps.map(s => s.description).join(" ")
  const combined = `${commands} ${descriptions}`.toLowerCase()

  const requiresFullDeploy = MUSA_PHASE_PATTERNS.requiresFullDeploy.some(
    pattern => combined.includes(pattern.toLowerCase())
  )

  const requiresDriverUpdate = MUSA_PHASE_PATTERNS.requiresDriverUpdate.some(
    pattern => combined.includes(pattern.toLowerCase())
  )

  const isValidationOnly = phase.steps.every(
    s => s.type === "validation"
  ) || MUSA_PHASE_PATTERNS.isValidationOnly.some(
    pattern => combined.includes(pattern.toLowerCase())
  )

  return {
    requiresFullDeploy,
    requiresDriverUpdate,
    isValidationOnly,
    isApplication: !requiresFullDeploy && !requiresDriverUpdate && !isValidationOnly,
  }
}

// ============================================================================
// Plan Phase Creation
// ============================================================================

function createPlanPhase(phase: ExecutionPhase, analysis: PhaseAnalysis): PlanPhase {
  const planPhaseId = phase.id

  // If phase requires full deploy, create a skill_invoke step
  if (analysis.requiresFullDeploy) {
    return createSkillInvokePhase(planPhaseId, phase.name, "deploy_env")
  }

  // If phase requires driver update, create a skill_invoke step
  if (analysis.requiresDriverUpdate) {
    return createSkillInvokePhase(planPhaseId, phase.name, "update_driver")
  }

  // If phase is validation only, map to validate intent or direct steps
  if (analysis.isValidationOnly) {
    return createValidationPhase(planPhaseId, phase)
  }

  // Default: application layer, execute steps directly
  return createDirectExecutionPhase(planPhaseId, phase)
}

/**
 * Create a phase that invokes an existing skill
 */
function createSkillInvokePhase(
  phaseId: string,
  phaseName: string,
  intent: "deploy_env" | "update_driver" | "validate"
): PlanPhase {
  const stepId = `${phaseId}_skill`

  const executionStep: ExecutionStep = {
    id: stepId,
    type: "skill_invoke",
    skillIntent: intent,
    description: `Invoke ${intent} skill for: ${phaseName}`,
    riskLevel: intent === "validate" ? "read_only" : "destructive",
  }

  const planStep: PlanStep = {
    id: stepId,
    executionStep,
    status: "pending",
    retryCount: 0,
  }

  return {
    id: phaseId,
    name: phaseName,
    steps: [planStep],
  }
}

/**
 * Create a validation phase
 */
function createValidationPhase(phaseId: string, phase: ExecutionPhase): PlanPhase {
  const steps: PlanStep[] = phase.steps.map((step, index) => ({
    id: `${phaseId}_step_${index}`,
    executionStep: step,
    status: "pending" as const,
    retryCount: 0,
  }))

  return {
    id: phaseId,
    name: phase.name,
    steps,
  }
}

/**
 * Create a phase for direct execution of steps
 */
function createDirectExecutionPhase(phaseId: string, phase: ExecutionPhase): PlanPhase {
  const steps: PlanStep[] = phase.steps.map((step, index) => ({
    id: `${phaseId}_step_${index}`,
    executionStep: step,
    status: "pending" as const,
    retryCount: 0,
  }))

  return {
    id: phaseId,
    name: phase.name,
    steps,
  }
}

// ============================================================================
// Plan Validation
// ============================================================================

export interface PlanValidationResult {
  valid: boolean
  issues: string[]
  warnings: string[]
}

/**
 * Validate execution plan before execution
 */
export function validatePlan(plan: ExecutionPlan): PlanValidationResult {
  const issues: string[] = []
  const warnings: string[] = []

  // Check for empty phases
  if (plan.phases.length === 0) {
    issues.push("Plan has no phases to execute")
  }

  // Check for phases with no steps
  for (const phase of plan.phases) {
    if (phase.steps.length === 0) {
      warnings.push(`Phase "${phase.name}" has no steps`)
    }
  }

  // Check for high ratio of unparsed sections
  if (plan.totalSections > 0) {
    const unparsedRatio = plan.unparsedSections.length / plan.totalSections
    if (unparsedRatio > 0.5) {
      warnings.push(
        `High unparsed content ratio (${(unparsedRatio * 100).toFixed(1)}%). ` +
        "Consider reviewing the document format."
      )
    }
  }

  return {
    valid: issues.length === 0,
    issues,
    warnings,
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
}