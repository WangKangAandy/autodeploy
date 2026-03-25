/**
 * Plan Review Module
 *
 * Plan Review 是架构上的独立阶段：
 * - 状态落到 Operation.status = "awaiting_input"
 * - 使用统一的 AwaitingInputContext 结构
 * - 支持 Plan Review 和 Manual Step 两种类型
 */

import type {
  ExecutionPlan,
  ExecutionStep,
  AwaitingInputContext,
  PlanReviewPayload,
  ManualStepPayload,
  SafetyValidationResult,
  PlanReviewResult,
  UnparsedSectionPolicy,
} from "./types"

// ============================================================================
// Default Policy
// ============================================================================

/**
 * V1 默认策略
 */
export const DEFAULT_UNPARSED_POLICY: UnparsedSectionPolicy = {
  allowContinue: true,
  threshold: 0.3,  // 30% 未解析内容为阈值
  requireManualConfirm: true,
}

// ============================================================================
// Plan Review Generation
// ============================================================================

/**
 * Plan review summary for user confirmation
 */
export interface PlanReviewSummary {
  planId: string
  documentTitle: string
  source: string
  phases: {
    name: string
    stepCount: number
    hasDestructiveSteps: boolean
  }[]
  highRiskSteps: ExecutionStep[]
  unparsedSections: string[]
  requiresConfirmation: boolean
  reason?: string
}

/**
 * Generate plan review summary
 */
export function generatePlanReview(
  plan: ExecutionPlan,
  documentTitle: string,
  source: string,
  safetyResult: SafetyValidationResult
): PlanReviewSummary {
  // Analyze phases
  const phases = plan.phases.map(phase => ({
    name: phase.name,
    stepCount: phase.steps.length,
    hasDestructiveSteps: phase.steps.some(s => s.executionStep.riskLevel === "destructive"),
  }))

  // Handle unparsed sections
  const unparsedResult = handleUnparsedSections(plan, DEFAULT_UNPARSED_POLICY)

  return {
    planId: plan.id,
    documentTitle,
    source,
    phases,
    highRiskSteps: safetyResult.highRiskSteps,
    unparsedSections: plan.unparsedSections,
    requiresConfirmation: unparsedResult.requiresConfirmation || safetyResult.highRiskSteps.length > 0,
    reason: unparsedResult.reason,
  }
}

// ============================================================================
// Awaiting Input Context Creation
// ============================================================================

/**
 * Create awaiting input context for plan review
 */
export function createPlanReviewContext(
  plan: ExecutionPlan,
  summary: PlanReviewSummary
): AwaitingInputContext {
  const payload: PlanReviewPayload = {
    planId: plan.id,
    summary: formatSummary(summary),
    highRiskSteps: summary.highRiskSteps,
    unparsedSections: plan.unparsedSections,
  }

  return {
    type: "plan_review",
    payload,
    createdAt: new Date().toISOString(),
  }
}

/**
 * Create awaiting input context for manual step
 */
export function createManualStepContext(
  step: ExecutionStep,
  phaseId: string
): AwaitingInputContext {
  const payload: ManualStepPayload = {
    stepId: step.id,
    phaseId,
    description: step.description,
  }

  return {
    type: "manual_step",
    payload,
    createdAt: new Date().toISOString(),
  }
}

// ============================================================================
// Unparsed Sections Handling
// ============================================================================

/**
 * Handle unparsed sections according to policy
 */
export function handleUnparsedSections(
  plan: ExecutionPlan,
  policy: UnparsedSectionPolicy
): PlanReviewResult {
  if (plan.totalSections === 0) {
    return {
      requiresConfirmation: false,
      unparsedHighlight: [],
    }
  }

  const unparsedRatio = plan.unparsedSections.length / plan.totalSections

  if (unparsedRatio >= policy.threshold) {
    return {
      requiresConfirmation: true,
      reason: `未解析内容占比 ${(unparsedRatio * 100).toFixed(1)}%，需人工确认`,
      unparsedHighlight: plan.unparsedSections,
    }
  }

  return {
    requiresConfirmation: false,
    unparsedHighlight: plan.unparsedSections,
  }
}

// ============================================================================
// Formatting
// ============================================================================

/**
 * Format plan review summary for display
 */
export function formatPlanReviewForDisplay(summary: PlanReviewSummary): string {
  const lines: string[] = [
    "## 执行计划确认",
    "",
    `**文档：** ${summary.documentTitle} (来源: ${summary.source})`,
    "",
    "### 阶段概览",
  ]

  summary.phases.forEach((phase, index) => {
    const riskMarker = phase.hasDestructiveSteps ? " ⚠️" : ""
    lines.push(`${index + 1}. ${phase.name} (${phase.stepCount} steps)${riskMarker}`)
  })

  if (summary.highRiskSteps.length > 0) {
    lines.push("")
    lines.push("### 高风险步骤 ⚠️")
    summary.highRiskSteps.forEach(step => {
      const cmdPreview = step.command ? step.command.substring(0, 50) : step.description
      lines.push(`- [${step.id}] \`${cmdPreview}\` (${step.riskLevel})`)
    })
  }

  if (summary.unparsedSections.length > 0) {
    lines.push("")
    lines.push("### 未解析内容")
    lines.push(`- ${summary.unparsedSections.length} 个段落需要人工检查`)
  }

  if (summary.reason) {
    lines.push("")
    lines.push(`**注意：** ${summary.reason}`)
  }

  lines.push("")
  lines.push("是否继续执行？ [Y/n]")

  return lines.join("\n")
}

/**
 * Format summary string for payload
 */
function formatSummary(summary: PlanReviewSummary): string {
  const phaseCount = summary.phases.length
  const totalSteps = summary.phases.reduce((sum, p) => sum + p.stepCount, 0)
  const destructiveCount = summary.phases.filter(p => p.hasDestructiveSteps).length

  return `${phaseCount} phases, ${totalSteps} steps, ${destructiveCount} with destructive operations`
}

// ============================================================================
// Confirmation Result Types
// ============================================================================

export interface PlanReviewConfirmation {
  operationId: string
  confirmed: boolean
  userNotes?: string
}

export interface ManualStepConfirmation {
  operationId: string
  stepId: string
  action: "completed" | "skipped"
  notes?: string
}