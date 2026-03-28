/**
 * Orchestrator Tests
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as fs from "fs"
import * as path from "path"
import {
  getOrchestration,
  isMetaSkill,
  formatOrchestrationSummary,
  type Orchestration,
} from "../../src/dispatcher/orchestrator"

describe("getOrchestration", () => {
  it("should return orchestration for deploy_musa_base_env", () => {
    const orchestration = getOrchestration("deploy_musa_base_env")

    expect(orchestration).not.toBeNull()
    expect(orchestration?.metaSkillId).toBe("deploy_musa_base_env")
    expect(orchestration?.steps).toHaveLength(5)
    expect(orchestration?.steps[0].skillId).toBe("ensure_system_dependencies")
    expect(orchestration?.steps[1].skillId).toBe("ensure_musa_driver")
    expect(orchestration?.steps[2].skillId).toBe("ensure_mt_container_toolkit")
    expect(orchestration?.steps[3].skillId).toBe("manage_container_images")
    expect(orchestration?.steps[4].skillId).toBe("validate_musa_container_environment")
  })

  it("should return orchestration for update_musa_driver", () => {
    const orchestration = getOrchestration("update_musa_driver")

    expect(orchestration).not.toBeNull()
    expect(orchestration?.metaSkillId).toBe("update_musa_driver")
    expect(orchestration?.steps).toHaveLength(1)
    expect(orchestration?.steps[0].skillId).toBe("ensure_musa_driver")
  })

  it("should return null for unknown meta skill", () => {
    const orchestration = getOrchestration("unknown_skill")

    expect(orchestration).toBeNull()
  })
})

describe("isMetaSkill", () => {
  it("should return true for deploy_musa_base_env", () => {
    expect(isMetaSkill("deploy_musa_base_env")).toBe(true)
  })

  it("should return true for update_musa_driver", () => {
    expect(isMetaSkill("update_musa_driver")).toBe(true)
  })

  it("should return false for atomic skills", () => {
    expect(isMetaSkill("ensure_system_dependencies")).toBe(false)
    expect(isMetaSkill("ensure_musa_driver")).toBe(false)
    expect(isMetaSkill("manage_container_images")).toBe(false)
  })

  it("should return false for unknown skills", () => {
    expect(isMetaSkill("unknown_skill")).toBe(false)
  })
})

describe("formatOrchestrationSummary", () => {
  it("should format successful orchestration result", () => {
    const result = {
      metaSkillId: "deploy_musa_base_env",
      success: true,
      steps: [
        { skillId: "ensure_system_dependencies", success: true },
        { skillId: "ensure_musa_driver", success: true },
        { skillId: "ensure_mt_container_toolkit", success: true },
        { skillId: "manage_container_images", success: true },
        { skillId: "validate_musa_container_environment", success: true },
      ],
    }

    const summary = formatOrchestrationSummary(result)

    expect(summary).toContain("deploy_musa_base_env")
    expect(summary).toContain("✅ Success")
    expect(summary).toContain("ensure_system_dependencies")
    expect(summary).toContain("ensure_musa_driver")
  })

  it("should format failed orchestration result", () => {
    const result = {
      metaSkillId: "deploy_musa_base_env",
      success: false,
      steps: [
        { skillId: "ensure_system_dependencies", success: true },
        { skillId: "ensure_musa_driver", success: false, error: "Driver not found" },
      ],
      error: "Step 2 (ensure_musa_driver) failed",
    }

    const summary = formatOrchestrationSummary(result)

    expect(summary).toContain("❌ Failed")
    expect(summary).toContain("Driver not found")
    expect(summary).toContain("Step 2 (ensure_musa_driver) failed")
  })

  it("should format skipped steps", () => {
    const result = {
      metaSkillId: "update_musa_driver",
      success: true,
      steps: [
        { skillId: "ensure_musa_driver", success: true, skipped: true },
      ],
    }

    const summary = formatOrchestrationSummary(result)

    expect(summary).toContain("⏭️ Skipped")
  })
})

describe("Orchestration structure", () => {
  it("should have correct step order for deploy_musa_base_env", () => {
    const orchestration = getOrchestration("deploy_musa_base_env")
    const stepIds = orchestration?.steps.map(s => s.skillId)

    expect(stepIds).toEqual([
      "ensure_system_dependencies",
      "ensure_musa_driver",
      "ensure_mt_container_toolkit",
      "manage_container_images",
      "validate_musa_container_environment",
    ])
  })

  it("should have inputs defined for deploy_musa_base_env", () => {
    const orchestration = getOrchestration("deploy_musa_base_env")

    expect(orchestration?.inputs).toBeDefined()
    expect(orchestration?.inputs.MUSA_SDK_VERSION).toBe("context.MUSA_SDK_VERSION")
    expect(orchestration?.inputs.MT_GPU_DRIVER_VERSION).toBe("context.MT_GPU_DRIVER_VERSION")
    expect(orchestration?.inputs.DOCKER_IMAGE).toBe("context.DOCKER_IMAGE")
  })

  it("should have outputs defined for deploy_musa_base_env", () => {
    const orchestration = getOrchestration("deploy_musa_base_env")

    expect(orchestration?.outputs).toBeDefined()
    expect(orchestration?.outputs.length).toBeGreaterThan(0)
  })
})