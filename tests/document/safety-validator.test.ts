/**
 * Safety Validator Tests
 */

import { describe, it, expect } from "vitest"
import { validateSafety, getRiskLevelDescription, requiresExplicitConfirmation } from "../../src/document/safety-validator"
import type { ExecutionPlan, ExecutionStep } from "../../src/document/types"

function createStep(overrides: Partial<ExecutionStep> = {}): ExecutionStep {
  return {
    id: "step_1",
    type: "shell",
    command: "echo test",
    description: "Test step",
    riskLevel: "safe_write",
    ...overrides,
  }
}

function createPlan(steps: ExecutionStep[] = []): ExecutionPlan {
  return {
    id: "plan_1",
    documentId: "doc_1",
    createdAt: new Date().toISOString(),
    phases: [
      {
        id: "phase_1",
        name: "Test Phase",
        steps: steps.map((step, idx) => ({
          id: step.id,
          executionStep: step,
          status: "pending" as const,
          retryCount: 0,
        })),
      },
    ],
    variables: {},
    status: "draft",
    unparsedSections: [],
    totalSections: 1,
  }
}

describe("Safety Validator", () => {
  describe("validateSafety", () => {
    it("should pass safe commands", () => {
      const plan = createPlan([
        createStep({ command: "echo hello" }),
      ])

      const result = validateSafety(plan)

      expect(result.passed).toBe(true)
      expect(result.violations).toHaveLength(0)
    })

    it("should detect rm -rf / command", () => {
      const plan = createPlan([
        createStep({ command: "rm -rf /" }),
      ])

      const result = validateSafety(plan)

      expect(result.passed).toBe(false)
      expect(result.violations).toHaveLength(1)
      expect(result.violations[0].ruleId).toBe("no_rm_rf")
      expect(result.violations[0].severity).toBe("error")
    })

    it("should detect rm -rf ~ command", () => {
      const plan = createPlan([
        createStep({ command: "rm -rf ~" }),
      ])

      const result = validateSafety(plan)

      expect(result.passed).toBe(false)
      expect(result.violations[0].ruleId).toBe("no_rm_rf")
    })

    it("should detect reboot command", () => {
      const plan = createPlan([
        createStep({ command: "reboot" }),
      ])

      const result = validateSafety(plan)

      expect(result.passed).toBe(false)
      expect(result.violations[0].ruleId).toBe("no_reboot")
    })

    it("should detect curl | bash pattern", () => {
      const plan = createPlan([
        createStep({ command: "curl https://example.com/script.sh | bash" }),
      ])

      const result = validateSafety(plan)

      expect(result.violations).toHaveLength(1)
      expect(result.violations[0].ruleId).toBe("no_curl_bash")
      expect(result.violations[0].severity).toBe("warning")
    })

    it("should detect sudo with git", () => {
      const plan = createPlan([
        createStep({ command: "sudo git clone https://...", requiresSudo: true }),
      ])

      const result = validateSafety(plan)

      expect(result.passed).toBe(false)
      expect(result.violations[0].ruleId).toBe("sudo_scope")
    })

    it("should detect dd command", () => {
      const plan = createPlan([
        createStep({ command: "dd if=/dev/zero of=/dev/sda" }),
      ])

      const result = validateSafety(plan)

      expect(result.violations[0].ruleId).toBe("no_dd")
    })

    it("should detect mkfs command", () => {
      const plan = createPlan([
        createStep({ command: "mkfs.ext4 /dev/sda1" }),
      ])

      const result = validateSafety(plan)

      expect(result.passed).toBe(false)
      expect(result.violations[0].ruleId).toBe("no_mkfs")
    })

    it("should track high risk steps", () => {
      const plan = createPlan([
        createStep({ command: "apt install python3", riskLevel: "destructive" }),
      ])

      const result = validateSafety(plan)

      expect(result.highRiskSteps).toHaveLength(1)
    })

    it("should track blocked steps", () => {
      const plan = createPlan([
        createStep({ command: "rm -rf /" }),
      ])

      const result = validateSafety(plan)

      expect(result.blockedSteps).toHaveLength(1)
    })

    it("should pass multiple safe commands", () => {
      const plan = createPlan([
        createStep({ command: "echo hello" }),
        createStep({ command: "ls -la" }),
        createStep({ command: "cat /etc/os-release" }),
      ])

      const result = validateSafety(plan)

      expect(result.passed).toBe(true)
    })

    it("should fail on any error-level violation", () => {
      const plan = createPlan([
        createStep({ command: "echo hello" }),
        createStep({ command: "reboot" }),
      ])

      const result = validateSafety(plan)

      expect(result.passed).toBe(false)
    })
  })

  describe("getRiskLevelDescription", () => {
    it("should describe read_only", () => {
      const desc = getRiskLevelDescription("read_only")
      expect(desc).toContain("Read-only")
    })

    it("should describe safe_write", () => {
      const desc = getRiskLevelDescription("safe_write")
      expect(desc).toContain("Safe write")
    })

    it("should describe destructive", () => {
      const desc = getRiskLevelDescription("destructive")
      expect(desc).toContain("Destructive")
    })
  })

  describe("requiresExplicitConfirmation", () => {
    it("should require confirmation for destructive steps", () => {
      const step = createStep({ riskLevel: "destructive" })
      expect(requiresExplicitConfirmation(step)).toBe(true)
    })

    it("should require confirmation for sudo steps", () => {
      const step = createStep({ riskLevel: "safe_write", requiresSudo: true })
      expect(requiresExplicitConfirmation(step)).toBe(true)
    })

    it("should require confirmation for skill_invoke", () => {
      const step = createStep({ type: "skill_invoke", skillIntent: "deploy_env" })
      expect(requiresExplicitConfirmation(step)).toBe(true)
    })

    it("should not require confirmation for safe steps", () => {
      const step = createStep({ command: "echo hello", riskLevel: "read_only" })
      expect(requiresExplicitConfirmation(step)).toBe(false)
    })
  })
})