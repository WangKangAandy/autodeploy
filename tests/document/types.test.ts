/**
 * Document Module Tests
 */

import { describe, it, expect } from "vitest"

// Import types for validation
import type {
  DocumentLoader,
  RawDocument,
  DocumentProvenance,
  ParsedDocument,
  ExecutionPhase,
  ExecutionStep,
  ExecutionPlan,
  PlanPhase,
  PlanStep,
  DocumentExecutionState,
  PhaseState,
  StepState,
  SafetyValidationResult,
  ExecutionValidationResult,
  AwaitingInputContext,
  PlanReviewPayload,
  ManualStepPayload,
} from "../../src/document/types"

describe("Document Types", () => {
  describe("RawDocument", () => {
    it("should accept valid local document", () => {
      const doc: RawDocument = {
        source: "local",
        content: "# Test\n\nContent here",
        provenance: {
          fetchedAt: new Date().toISOString(),
          contentHash: "abc123",
        },
      }
      expect(doc.source).toBe("local")
      expect(doc.content).toContain("# Test")
    })

    it("should accept valid pasted document", () => {
      const doc: RawDocument = {
        source: "pasted",
        content: "Pasted content",
        provenance: {
          fetchedAt: new Date().toISOString(),
          contentHash: "def456",
        },
        originalFormat: "markdown",
      }
      expect(doc.source).toBe("pasted")
    })
  })

  describe("ExecutionStep", () => {
    it("should create shell step", () => {
      const step: ExecutionStep = {
        id: "step_1",
        type: "shell",
        command: "echo hello",
        description: "Say hello",
        riskLevel: "read_only",
      }
      expect(step.type).toBe("shell")
      expect(step.riskLevel).toBe("read_only")
    })

    it("should create docker_exec step", () => {
      const step: ExecutionStep = {
        id: "step_2",
        type: "docker_exec",
        command: "docker exec mycontainer ls",
        description: "List files",
        riskLevel: "safe_write",
      }
      expect(step.type).toBe("docker_exec")
    })

    it("should create validation step with level", () => {
      const step: ExecutionStep = {
        id: "step_3",
        type: "validation",
        command: "curl http://localhost:8000/health",
        description: "Health check",
        riskLevel: "read_only",
        validationLevel: "service",
        expectedOutput: "OK",
      }
      expect(step.validationLevel).toBe("service")
      expect(step.expectedOutput).toBe("OK")
    })

    it("should create skill_invoke step", () => {
      const step: ExecutionStep = {
        id: "step_4",
        type: "skill_invoke",
        skillIntent: "deploy_env",
        description: "Deploy environment",
        riskLevel: "destructive",
      }
      expect(step.type).toBe("skill_invoke")
      expect(step.skillIntent).toBe("deploy_env")
    })

    it("should create manual step", () => {
      const step: ExecutionStep = {
        id: "step_5",
        type: "manual",
        description: "Verify service is running",
        riskLevel: "read_only",
      }
      expect(step.type).toBe("manual")
    })
  })

  describe("ExecutionPlan", () => {
    it("should create valid plan", () => {
      const plan: ExecutionPlan = {
        id: "plan_1",
        documentId: "doc_1",
        createdAt: new Date().toISOString(),
        phases: [],
        variables: {},
        status: "draft",
        unparsedSections: [],
        totalSections: 0,
      }
      expect(plan.status).toBe("draft")
    })
  })

  describe("DocumentExecutionState", () => {
    it("should create valid execution state", () => {
      const state: DocumentExecutionState = {
        id: "exec_1",
        operationId: "op_1",
        planId: "plan_1",
        documentId: "doc_1",
        status: "running",
        currentPhase: "phase_1",
        currentStep: "step_1",
        phases: [],
        variables: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
      expect(state.status).toBe("running")
      expect(state.operationId).toBe("op_1")
    })
  })

  describe("AwaitingInputContext", () => {
    it("should create plan_review context", () => {
      const payload: PlanReviewPayload = {
        planId: "plan_1",
        summary: "3 phases, 10 steps",
        highRiskSteps: [],
        unparsedSections: [],
      }
      const context: AwaitingInputContext = {
        type: "plan_review",
        payload,
        createdAt: new Date().toISOString(),
      }
      expect(context.type).toBe("plan_review")
    })

    it("should create manual_step context", () => {
      const payload: ManualStepPayload = {
        stepId: "step_1",
        phaseId: "phase_1",
        description: "Verify deployment",
      }
      const context: AwaitingInputContext = {
        type: "manual_step",
        payload,
        createdAt: new Date().toISOString(),
      }
      expect(context.type).toBe("manual_step")
    })
  })

  describe("SafetyValidationResult", () => {
    it("should create passed result", () => {
      const result: SafetyValidationResult = {
        passed: true,
        violations: [],
        highRiskSteps: [],
        blockedSteps: [],
      }
      expect(result.passed).toBe(true)
    })

    it("should create failed result with violations", () => {
      const result: SafetyValidationResult = {
        passed: false,
        violations: [
          {
            ruleId: "no_rm_rf",
            stepId: "step_1",
            message: "Destructive rm command detected",
            severity: "error",
          },
        ],
        highRiskSteps: [],
        blockedSteps: [],
      }
      expect(result.passed).toBe(false)
      expect(result.violations).toHaveLength(1)
    })
  })

  describe("ExecutionValidationResult", () => {
    it("should create infra validation result", () => {
      const result: ExecutionValidationResult = {
        level: "infra",
        passed: true,
        details: "Command executed successfully",
      }
      expect(result.level).toBe("infra")
    })

    it("should create business validation result", () => {
      const result: ExecutionValidationResult = {
        level: "business",
        passed: true,
        details: "Model inference successful",
      }
      expect(result.level).toBe("business")
    })
  })
})