/**
 * Safety Validator
 *
 * 定位：高风险预警 + 阻断少数已知禁令，不是真正沙箱。
 * 最终安全由 Plan Review 阶段的人工确认兜底。
 */

import type {
  ExecutionPlan,
  ExecutionStep,
  SafetyValidationResult,
  SafetyViolation,
} from "./types"

// ============================================================================
// Safety Rules
// ============================================================================

interface SafetyRule {
  id: string
  description: string
  check: (step: ExecutionStep) => string | null  // null = pass, string = violation reason
  severity: "error" | "warning"
}

const SAFETY_RULES: SafetyRule[] = [
  {
    id: "no_rm_rf",
    description: "No rm -rf / or similar destructive commands",
    check: (step) => {
      if (!step.command) return null
      // Match rm -rf /, rm -rf /*, rm -rf ~, etc.
      if (step.command.match(/rm\s+(-[rf]+\s+)+[\/~*]/)) {
        return "Destructive rm command detected: may delete critical files"
      }
      return null
    },
    severity: "error",
  },
  {
    id: "no_reboot",
    description: "No automatic reboot without explicit flag",
    check: (step) => {
      if (!step.command) return null
      if (step.command.match(/\b(reboot|shutdown)\b/)) {
        return "Reboot/shutdown command detected: requires explicit approval"
      }
      return null
    },
    severity: "error",
  },
  {
    id: "no_curl_bash",
    description: "No curl | bash without verification",
    check: (step) => {
      if (!step.command) return null
      if (step.command.match(/curl.*\|\s*(sudo\s+)?bash/)) {
        return "Unsafe curl | bash pattern: download and verify script before execution"
      }
      return null
    },
    severity: "warning",
  },
  {
    id: "sudo_scope",
    description: "Sudo only for system operations",
    check: (step) => {
      if (!step.command || !step.requiresSudo) return null
      // Check if sudo is used for git/docker pull/wget
      if (step.command.match(/sudo\s+(git|docker\s+pull|wget|curl)\s/)) {
        return "Sudo should not be used for git/docker pull/wget operations"
      }
      return null
    },
    severity: "error",
  },
  {
    id: "no_dd",
    description: "No dd commands without explicit approval",
    check: (step) => {
      if (!step.command) return null
      if (step.command.match(/\bdd\s+/)) {
        return "dd command detected: can cause data loss, requires approval"
      }
      return null
    },
    severity: "warning",
  },
  {
    id: "no_mkfs",
    description: "No filesystem formatting commands",
    check: (step) => {
      if (!step.command) return null
      if (step.command.match(/\bmkfs\./)) {
        return "Filesystem formatting command detected: will erase data"
      }
      return null
    },
    severity: "error",
  },
]

// ============================================================================
// Known Limitations (V1)
// ============================================================================

/**
 * V1 已知局限：
 *
 * - 变体命令如 `bash -lc "rm -rf ..."` 可能绕过检测
 * - heredoc / 多行脚本检测有限
 * - `python -c` 等脚本执行未覆盖
 * - `docker exec <container> sh -c "..."` 内部命令检测有限
 *
 * 这些局限通过 Plan Review 阶段的人工确认来兜底。
 */

// ============================================================================
// Validation Functions
// ============================================================================

/**
 * Validate execution plan for safety issues
 */
export function validateSafety(plan: ExecutionPlan): SafetyValidationResult {
  const violations: SafetyViolation[] = []
  const highRiskSteps: ExecutionStep[] = []
  const blockedSteps: ExecutionStep[] = []

  for (const phase of plan.phases) {
    for (const step of phase.steps) {
      const stepViolations = validateStep(step)

      for (const violation of stepViolations) {
        violations.push(violation)

        if (violation.severity === "error") {
          blockedSteps.push(step.executionStep)
        }
      }

      // Track high-risk steps for Plan Review
      if (step.executionStep.riskLevel === "destructive") {
        highRiskSteps.push(step.executionStep)
      }
    }
  }

  return {
    passed: !violations.some(v => v.severity === "error"),
    violations,
    highRiskSteps,
    blockedSteps,
  }
}

/**
 * Validate a single step against all rules
 */
function validateStep(step: PlanStep): SafetyViolation[] {
  const violations: SafetyViolation[] = []

  for (const rule of SAFETY_RULES) {
    const reason = rule.check(step.executionStep)
    if (reason) {
      violations.push({
        ruleId: rule.id,
        stepId: step.id,
        message: reason,
        severity: rule.severity,
      })
    }
  }

  return violations
}

// ============================================================================
// Step Risk Classification (Additional Helper)
// ============================================================================

/**
 * Get human-readable risk level description
 */
export function getRiskLevelDescription(level: "read_only" | "safe_write" | "destructive"): string {
  switch (level) {
    case "read_only":
      return "Read-only operation: no system changes"
    case "safe_write":
      return "Safe write: file operations without system impact"
    case "destructive":
      return "Destructive: may modify system state"
  }
}

/**
 * Check if step requires explicit user confirmation
 */
export function requiresExplicitConfirmation(step: ExecutionStep): boolean {
  // Always require confirmation for destructive operations
  if (step.riskLevel === "destructive") {
    return true
  }

  // Require confirmation for sudo operations
  if (step.requiresSudo) {
    return true
  }

  // Require confirmation for skill_invoke (it's a compound operation)
  if (step.type === "skill_invoke") {
    return true
  }

  return false
}

// Placeholder for PlanStep type
interface PlanStep {
  id: string
  executionStep: ExecutionStep
  status: "pending" | "running" | "completed" | "failed" | "skipped" | "awaiting_input"
  retryCount: number
}