/**
 * Skill Registry Deep Tests
 *
 * Tests for skills/index.yml loading, intent mapping, and skill metadata queries.
 *
 * Note: The registry is a singleton, so tests are designed to work with
 * shared state. Each test should set up its expected state independently.
 */

import { describe, it, expect, vi, beforeAll } from "vitest"
import {
  loadRegistry,
  getSkillMeta,
  getSkillByIntent,
  getSkillPath,
  getSkillCategory,
  isMetaSkill,
  isUserExposed,
  canCallSkill,
  getSkillsByExposure,
  getSkillsByKind,
  getIntentList,
  getIntentToSkillMap,
  type SkillMeta,
} from "../../src/dispatcher/skill-registry.js"

// We're testing against the real skills/index.yml
// This is an integration-style test that validates the actual data

describe("skill-registry", () => {
  // Load registry once before all tests
  beforeAll(() => {
    loadRegistry()
  })

  describe("getSkillMeta", () => {
    it("should return null for non-existent skill", () => {
      const skill = getSkillMeta("nonexistent_skill_xyz")
      expect(skill).toBeNull()
    })

    it("should return skill metadata for deploy_musa_base_env", () => {
      const skill = getSkillMeta("deploy_musa_base_env")
      expect(skill).not.toBeNull()
      expect(skill?.id).toBe("deploy_musa_base_env")
      expect(skill?.kind).toBe("meta")
      expect(skill?.exposure).toBe("user")
      expect(skill?.riskLevel).toBe("destructive")
      expect(skill?.category).toBe("env")
    })

    it("should return skill metadata for ensure_musa_driver", () => {
      const skill = getSkillMeta("ensure_musa_driver")
      expect(skill).not.toBeNull()
      expect(skill?.kind).toBe("atomic")
      expect(skill?.exposure).toBe("internal")
      expect(skill?.riskLevel).toBe("destructive")
    })

    it("should return skill metadata for prepare_model_artifacts", () => {
      const skill = getSkillMeta("prepare_model_artifacts")
      expect(skill).not.toBeNull()
      expect(skill?.dispatchIntent).toBe("prepare_model")
      expect(skill?.category).toBe("assets")
    })

    it("should have normalized camelCase fields from snake_case YAML", () => {
      const skill = getSkillMeta("deploy_musa_base_env")
      expect(skill?.riskLevel).toBeDefined() // risk_level → riskLevel
      expect(skill?.dispatchIntent).toBeDefined() // dispatch_intent → dispatchIntent
      expect(skill?.dependsOn).toBeDefined() // depends_on → dependsOn
      expect(skill?.dependsOn).toContain("ensure_musa_driver")
    })
  })

  describe("getSkillByIntent", () => {
    it("should return null for unmapped intent", () => {
      const skill = getSkillByIntent("unknown_intent_xyz")
      expect(skill).toBeNull()
    })

    it("should return deploy_musa_base_env for deploy_env intent", () => {
      const skill = getSkillByIntent("deploy_env")
      expect(skill).not.toBeNull()
      expect(skill?.id).toBe("deploy_musa_base_env")
    })

    it("should return update_musa_driver for update_driver intent", () => {
      const skill = getSkillByIntent("update_driver")
      expect(skill).not.toBeNull()
      expect(skill?.id).toBe("update_musa_driver")
    })

    it("should return prepare_model_artifacts for prepare_model intent", () => {
      const skill = getSkillByIntent("prepare_model")
      expect(skill).not.toBeNull()
      expect(skill?.id).toBe("prepare_model_artifacts")
    })

    it("should return prepare_dataset_artifacts for prepare_dataset intent", () => {
      const skill = getSkillByIntent("prepare_dataset")
      expect(skill).not.toBeNull()
      expect(skill?.id).toBe("prepare_dataset_artifacts")
    })

    it("should return prepare_musa_package for prepare_package intent", () => {
      const skill = getSkillByIntent("prepare_package")
      expect(skill).not.toBeNull()
      expect(skill?.id).toBe("prepare_musa_package")
    })

    it("should return prepare_dependency_repo for prepare_repo intent", () => {
      const skill = getSkillByIntent("prepare_repo")
      expect(skill).not.toBeNull()
      expect(skill?.id).toBe("prepare_dependency_repo")
    })
  })

  describe("getSkillPath", () => {
    it("should return null for unknown skill", () => {
      const pathResult = getSkillPath("unknown_skill_xyz")
      expect(pathResult).toBeNull()
    })

    it("should return absolute path for deploy_musa_base_env", () => {
      const skillPath = getSkillPath("deploy_musa_base_env")
      expect(skillPath).not.toBeNull()
      expect(skillPath).toContain("skills")
      expect(skillPath).toContain("env/deploy_musa_base_env/SKILL.md")
    })

    it("should return absolute path for internal skills", () => {
      const skillPath = getSkillPath("ensure_system_dependencies")
      expect(skillPath).not.toBeNull()
      expect(skillPath).toContain("env/ensure_system_dependencies/SKILL.md")
    })
  })

  describe("getSkillCategory", () => {
    it("should return correct category for env skills", () => {
      expect(getSkillCategory("deploy_musa_base_env")).toBe("env")
      expect(getSkillCategory("ensure_musa_driver")).toBe("env")
    })

    it("should return correct category for assets skills", () => {
      expect(getSkillCategory("prepare_model_artifacts")).toBe("assets")
      expect(getSkillCategory("prepare_dataset_artifacts")).toBe("assets")
    })

    it("should return null for unknown skill", () => {
      expect(getSkillCategory("unknown_skill")).toBeNull()
    })
  })

  describe("isMetaSkill", () => {
    it("should return true for meta skills", () => {
      expect(isMetaSkill("deploy_musa_base_env")).toBe(true)
      expect(isMetaSkill("update_musa_driver")).toBe(true)
    })

    it("should return false for atomic skills", () => {
      expect(isMetaSkill("ensure_musa_driver")).toBe(false)
      expect(isMetaSkill("prepare_model_artifacts")).toBe(false)
    })

    it("should return false for unknown skill", () => {
      expect(isMetaSkill("unknown_skill")).toBe(false)
    })
  })

  describe("isUserExposed", () => {
    it("should return true for user-exposed skills", () => {
      expect(isUserExposed("deploy_musa_base_env")).toBe(true)
      expect(isUserExposed("prepare_model_artifacts")).toBe(true)
    })

    it("should return false for internal skills", () => {
      expect(isUserExposed("ensure_system_dependencies")).toBe(false)
      expect(isUserExposed("ensure_musa_driver")).toBe(false)
      expect(isUserExposed("validate_musa_container_environment")).toBe(false)
    })

    it("should return false for unknown skill", () => {
      expect(isUserExposed("unknown_skill")).toBe(false)
    })
  })

  describe("canCallSkill", () => {
    it("should allow user skill in any mode", () => {
      expect(canCallSkill("deploy_musa_base_env", false)).toBe(true)
      expect(canCallSkill("deploy_musa_base_env", true)).toBe(true)
    })

    it("should restrict internal skill to internal mode only", () => {
      expect(canCallSkill("ensure_musa_driver", false)).toBe(false)
      expect(canCallSkill("ensure_musa_driver", true)).toBe(true)
    })

    it("should allow unknown skill in internal mode only (default)", () => {
      // Unknown skills have undefined exposure, so isUserExposed returns false
      expect(canCallSkill("unknown_skill", false)).toBe(false)
      expect(canCallSkill("unknown_skill", true)).toBe(true)
    })
  })

  describe("getSkillsByExposure", () => {
    it("should return all user-exposed skills", () => {
      const userSkills = getSkillsByExposure("user")
      expect(userSkills.length).toBeGreaterThan(0)

      // Verify all returned skills are user-exposed
      for (const skill of userSkills) {
        expect(skill.exposure).toBe("user")
      }

      // Verify known user skills are included
      const userSkillIds = userSkills.map(s => s.id)
      expect(userSkillIds).toContain("deploy_musa_base_env")
      expect(userSkillIds).toContain("update_musa_driver")
      expect(userSkillIds).toContain("prepare_model_artifacts")
    })

    it("should return all internal skills", () => {
      const internalSkills = getSkillsByExposure("internal")
      expect(internalSkills.length).toBeGreaterThan(0)

      // Verify all returned skills are internal
      for (const skill of internalSkills) {
        expect(skill.exposure).toBe("internal")
      }

      // Verify known internal skills are included
      const internalSkillIds = internalSkills.map(s => s.id)
      expect(internalSkillIds).toContain("ensure_system_dependencies")
      expect(internalSkillIds).toContain("ensure_musa_driver")
    })
  })

  describe("getSkillsByKind", () => {
    it("should return all meta skills", () => {
      const metaSkills = getSkillsByKind("meta")
      expect(metaSkills.length).toBeGreaterThan(0)

      for (const skill of metaSkills) {
        expect(skill.kind).toBe("meta")
      }

      const metaSkillIds = metaSkills.map(s => s.id)
      expect(metaSkillIds).toContain("deploy_musa_base_env")
      expect(metaSkillIds).toContain("update_musa_driver")
    })

    it("should return all atomic skills", () => {
      const atomicSkills = getSkillsByKind("atomic")
      expect(atomicSkills.length).toBeGreaterThan(0)

      for (const skill of atomicSkills) {
        expect(skill.kind).toBe("atomic")
      }

      const atomicSkillIds = atomicSkills.map(s => s.id)
      expect(atomicSkillIds).toContain("ensure_musa_driver")
      expect(atomicSkillIds).toContain("prepare_model_artifacts")
    })
  })

  describe("getIntentList", () => {
    it("should return all dispatch intents from skills", () => {
      const intents = getIntentList()

      expect(intents.length).toBeGreaterThan(0)

      // Verify known intents are included
      expect(intents).toContain("deploy_env")
      expect(intents).toContain("update_driver")
      expect(intents).toContain("prepare_model")
      expect(intents).toContain("prepare_dataset")
      expect(intents).toContain("prepare_package")
      expect(intents).toContain("prepare_repo")

      // Should be sorted
      const sortedIntents = [...intents].sort()
      expect(intents).toEqual(sortedIntents)
    })

    it("should not contain intents without dispatch_intent mapping", () => {
      const intents = getIntentList()

      // These skills don't have dispatch_intent
      expect(intents).not.toContain("ensure_musa_driver") // internal skill
    })
  })

  describe("getIntentToSkillMap", () => {
    it("should return complete intent-to-skill mapping", () => {
      const map = getIntentToSkillMap()

      expect(map.size).toBeGreaterThan(0)

      // Verify known mappings
      expect(map.get("deploy_env")?.id).toBe("deploy_musa_base_env")
      expect(map.get("update_driver")?.id).toBe("update_musa_driver")
      expect(map.get("prepare_model")?.id).toBe("prepare_model_artifacts")
    })

    it("should have one-to-one mapping (no duplicates)", () => {
      const map = getIntentToSkillMap()
      const skillIds = Array.from(map.values()).map(s => s.id)
      const uniqueSkillIds = new Set(skillIds)

      // Each intent maps to exactly one skill
      expect(skillIds.length).toBe(uniqueSkillIds.size)
    })
  })

  describe("dependency chain validation", () => {
    it("should have valid dependsOn references for deploy_musa_base_env", () => {
      const skill = getSkillMeta("deploy_musa_base_env")
      expect(skill?.dependsOn).toBeDefined()
      expect(skill?.dependsOn?.length).toBeGreaterThan(0)

      // Verify each dependency exists
      for (const depId of skill?.dependsOn || []) {
        const depSkill = getSkillMeta(depId)
        expect(depSkill).not.toBeNull(`Dependency ${depId} should exist`)
      }
    })

    it("should have valid dependsOn references for update_musa_driver", () => {
      const skill = getSkillMeta("update_musa_driver")
      expect(skill?.dependsOn).toBeDefined()
      expect(skill?.dependsOn?.length).toBeGreaterThan(0)

      for (const depId of skill?.dependsOn || []) {
        const depSkill = getSkillMeta(depId)
        expect(depSkill).not.toBeNull(`Dependency ${depId} should exist`)
      }
    })
  })

  describe("risk level validation", () => {
    it("should have destructive risk for deployment skills", () => {
      const deploy = getSkillMeta("deploy_musa_base_env")
      expect(deploy?.riskLevel).toBe("destructive")

      const update = getSkillMeta("update_musa_driver")
      expect(update?.riskLevel).toBe("destructive")
    })

    it("should have idempotent risk for prepare skills", () => {
      const model = getSkillMeta("prepare_model_artifacts")
      expect(model?.riskLevel).toBe("idempotent")

      const dataset = getSkillMeta("prepare_dataset_artifacts")
      expect(dataset?.riskLevel).toBe("idempotent")

      const pkg = getSkillMeta("prepare_musa_package")
      expect(pkg?.riskLevel).toBe("idempotent")
    })

    it("should have safe risk for validation skill", () => {
      const validate = getSkillMeta("validate_musa_container_environment")
      expect(validate?.riskLevel).toBe("safe")
    })
  })

  describe("triggers validation", () => {
    it("should have triggers for user-exposed skills", () => {
      const deploy = getSkillMeta("deploy_musa_base_env")
      expect(deploy?.triggers).toBeDefined()
      expect(deploy?.triggers?.length).toBeGreaterThan(0)
      expect(deploy?.triggers).toContain("部署 MUSA 环境")
      expect(deploy?.triggers).toContain("deploy MUSA environment")
    })

    it("should have Chinese and English triggers", () => {
      const prepare = getSkillMeta("prepare_model_artifacts")
      expect(prepare?.triggers).toBeDefined()
      expect(prepare?.triggers?.some(t => t.includes("模型"))).toBe(true)
      expect(prepare?.triggers?.some(t => t.includes("model"))).toBe(true)
    })
  })

  describe("inputs validation", () => {
    it("should have required inputs for deploy_musa_base_env", () => {
      const skill = getSkillMeta("deploy_musa_base_env")
      expect(skill?.inputs?.required).toBeDefined()
      expect(skill?.inputs?.required).toContain("MUSA_SDK_VERSION")
      expect(skill?.inputs?.required).toContain("MT_GPU_DRIVER_VERSION")
      expect(skill?.inputs?.optional).toBeDefined()
    })

    it("should have required inputs for prepare_model_artifacts", () => {
      const skill = getSkillMeta("prepare_model_artifacts")
      expect(skill?.inputs?.required).toBeDefined()
      expect(skill?.inputs?.required).toContain("MODEL_NAME")
    })

    it("should have empty required inputs for system dependencies", () => {
      const skill = getSkillMeta("ensure_system_dependencies")
      expect(skill?.inputs?.required).toEqual([])
    })
  })
})